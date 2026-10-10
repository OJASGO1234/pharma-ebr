import { useCallback, useEffect, useState } from 'react';
import { api, fmtTime, limitText, type User } from '../api';
import SignDialog from '../SignDialog';

type Sign = { step: any; kind: 'complete' | 'verify' } | null;

export default function BatchExec({ id, user, onBack }: { id: number; user: User; onBack: () => void }) {
  const [batch, setBatch] = useState<any>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sign, setSign] = useState<Sign>(null);

  const load = useCallback(() => api('GET', `/api/batches/${id}`).then(setBatch).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (!batch) return <p>{error || 'Loading…'}</p>;
  const isOperator = user.role === 'operator';

  async function act(fn: () => Promise<any>) {
    setError(''); setNotice('');
    try { await fn(); } catch (e) { setError((e as Error).message); }
  }
  const start = (stepId: number) => act(async () => setBatch(await api('POST', `/api/batch-steps/${stepId}/start`)));

  return (
    <>
      <button className="secondary" onClick={onBack}>← All batches</button>
      <div className="row between">
        <h2>Batch {batch.batch_no} <span className={`status ${batch.status}`}>{batch.status.replace(/_/g, ' ')}</span></h2>
        <div className="muted small">{batch.product} · {batch.mbr_version} · {batch.batch_size}</div>
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="warn">{notice}</div>}

      {batch.steps.map((s: any) => (
        <section className={`card step ${s.status}`} key={s.id}>
          <div className="row between">
            <h3>{s.seq}. {s.stage}: {s.title} {s.critical ? <span className="badge crit">critical – e-signature</span> : null}</h3>
            <span className={`status ${s.status}`}>{s.status.replace(/_/g, ' ')}</span>
          </div>
          <p className="instr">{s.instruction}</p>

          {s.status === 'PENDING'
            ? isOperator && <button onClick={() => start(s.id)}>Start step</button>
            : <ParamTable step={s} editable={isOperator && s.status === 'IN_PROGRESS'}
                onSaved={(r) => { setBatch(r.batch); if (r.deviationRaised) setNotice('Value is out of limit: a deviation was raised and must be resolved by QA before release.'); else setNotice(''); }}
                onError={setError} />}

          {s.status === 'IN_PROGRESS' && isOperator && (
            <button onClick={() => (s.critical ? setSign({ step: s, kind: 'complete' }) : act(async () => setBatch(await api('POST', `/api/batch-steps/${s.id}/complete`, {}))))}>
              Complete step{s.critical ? ' (sign)' : ''}
            </button>
          )}
          {s.status === 'AWAITING_VERIFICATION' && (
            s.performed_by !== user.id && (user.role === 'operator' || user.role === 'qa')
              ? <button onClick={() => setSign({ step: s, kind: 'verify' })}>Verify (second person sign)</button>
              : <div className="muted">Waiting for verification by a different person.</div>
          )}

          {s.signatures.length > 0 && (
            <div className="sigs">
              {s.signatures.map((g: any, i: number) => <span key={i} className="sig">✔ {g.meaning}: <b>{g.full_name}</b> · {fmtTime(g.signed_at)}</span>)}
            </div>
          )}
        </section>
      ))}

      {batch.deviations.length > 0 && (
        <section className="card">
          <h3>Deviations on this batch</h3>
          {batch.deviations.map((d: any) => (
            <div key={d.id} className="dev">
              <b>DEV-{d.id}</b> {d.stage} / {d.param_name}: <b className="bad">{d.value} {d.unit}</b> (limit {limitText(d)}) – <span className={`status ${d.status}`}>{d.status}</span>
              {d.resolution && <div className="muted small">[{d.classification}] {d.resolution} – {d.resolved_by_name}</div>}
            </div>
          ))}
        </section>
      )}

      {sign && (
        <SignDialog
          user={user}
          title={sign.kind === 'complete' ? `Sign: complete "${sign.step.stage}"` : `Sign: verify "${sign.step.stage}"`}
          meaning={sign.kind === 'complete' ? 'Performed by' : 'Verified by'}
          onClose={() => setSign(null)}
          onConfirm={async (password) => {
            setBatch(await api('POST', `/api/batch-steps/${sign.step.id}/${sign.kind}`, { password }));
            setError('');
          }}
        />
      )}
    </>
  );
}

function ParamTable({ step, editable, onSaved, onError }: { step: any; editable: boolean; onSaved: (r: any) => void; onError: (m: string) => void }) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});

  async function save(p: any) {
    onError('');
    try {
      const r = await api('PUT', `/api/batch-steps/${step.id}/values/${p.id}`, { value: drafts[p.id], reason: reasons[p.id] });
      setDrafts((d) => { const { [p.id]: _, ...rest } = d; return rest; });
      setReasons((d) => { const { [p.id]: _, ...rest } = d; return rest; });
      onSaved(r);
    } catch (e) { onError((e as Error).message); }
  }

  return (
    <table className="params">
      <thead><tr><th>Parameter</th><th>Limit</th><th>Target</th><th>Entered value</th><th>Result</th>{editable && <th>Enter / change</th>}</tr></thead>
      <tbody>
        {step.params.map((p: any) => {
          const entered = p.value != null;
          const changing = entered && drafts[p.id] !== undefined;
          return (
            <tr key={p.id} className={entered && !p.in_limit ? 'oot' : ''}>
              <td>{p.name}</td>
              <td>{limitText(p)}</td>
              <td>{p.target ?? '–'}</td>
              <td>{entered ? <b>{p.value} {p.unit}</b> : <span className="muted">–</span>}
                {entered && <div className="muted small">{p.entered_by_name} · {fmtTime(p.entered_at)}</div>}</td>
              <td>{entered ? (p.in_limit ? <span className="ok">In limit</span> : <span className="bad">OUT OF LIMIT</span>) : ''}</td>
              {editable && (
                <td className="entry">
                  <input type="number" step="any" placeholder={p.unit} value={drafts[p.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })} />
                  {entered && changing && <input placeholder="Reason for change (required)" value={reasons[p.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [p.id]: e.target.value })} />}
                  <button disabled={drafts[p.id] === undefined || drafts[p.id] === ''} onClick={() => save(p)}>{entered ? 'Change' : 'Save'}</button>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
