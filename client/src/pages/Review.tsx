import { useCallback, useEffect, useState } from 'react';
import { api, fmtTime, limitText, type User } from '../api';
import SignDialog from '../SignDialog';

type Dlg = { kind: 'resolve'; dev: any } | { kind: 'release' } | { kind: 'reject' } | null;

export default function Review({ user }: { user: User }) {
  const [batches, setBatches] = useState<any[]>([]);
  const [id, setId] = useState<number | null>(null);
  const [rev, setRev] = useState<any>(null);
  const [error, setError] = useState('');
  const [dlg, setDlg] = useState<Dlg>(null);
  const [classification, setClassification] = useState('minor');
  const [text, setText] = useState('');

  useEffect(() => {
    api('GET', '/api/batches').then((all: any[]) => {
      const list = all.filter((b) => b.status === 'READY_FOR_QA');
      setBatches(list);
      if (list.length) setId(list[0].id);
    });
  }, []);

  const load = useCallback(() => (id ? api('GET', `/api/batches/${id}/review`).then(setRev).catch((e) => setError(e.message)) : Promise.resolve()), [id]);
  useEffect(() => { setRev(null); load(); }, [load]);

  const isQA = user.role === 'qa';
  const open = rev?.deviations.filter((d: any) => d.status === 'OPEN').length ?? 0;

  return (
    <>
      <h2>QA review by exception</h2>
      <p className="muted">Only deviations are shown. All in-limit data was checked automatically by the system against the master record.</p>
      {batches.length === 0 && <div className="card">No batches are waiting for QA review. (Run <code>npm run demo</code> or complete a batch as an operator.)</div>}
      {batches.length > 0 && (
        <label className="inline">Batch awaiting QA:&nbsp;
          <select value={id ?? ''} onChange={(e) => setId(Number(e.target.value))}>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_no}</option>)}
          </select>
        </label>
      )}
      {error && <div className="error">{error}</div>}

      {rev && (
        <>
          <div className="tiles">
            <div className="tile"><b>{rev.summary.steps_completed}/{rev.summary.steps_total}</b>steps completed &amp; signed</div>
            <div className="tile"><b>{rev.summary.params_in_limit}/{rev.summary.params_total}</b>parameters in limit</div>
            <div className={`tile ${rev.summary.deviations_total ? 'warnTile' : ''}`}><b>{rev.summary.deviations_total}</b>deviations</div>
            <div className={`tile ${open ? 'badTile' : 'okTile'}`}><b>{open}</b>open</div>
          </div>

          {rev.deviations.length === 0 && <div className="card ok">No deviations. Batch can be released.</div>}
          {rev.deviations.map((d: any) => (
            <div className="card dev" key={d.id}>
              <div className="row between">
                <h3>DEV-{d.id} · {d.stage} / {d.param_name}</h3>
                <span className={`status ${d.status}`}>{d.status}</span>
              </div>
              <div>Recorded <b className="bad">{d.value} {d.unit}</b>, limit {limitText(d)} · raised by {d.raised_by_name} at {fmtTime(d.raised_at)}</div>
              {d.status === 'RESOLVED'
                ? <div className="muted">[{d.classification}] {d.resolution}<br />Reviewed by {d.resolved_by_name} at {fmtTime(d.resolved_at)}</div>
                : isQA && <button onClick={() => { setText(''); setClassification('minor'); setDlg({ kind: 'resolve', dev: d }); }}>Assess &amp; resolve</button>}
            </div>
          ))}

          {isQA && (
            <div className="row">
              <button disabled={open > 0} onClick={() => setDlg({ kind: 'release' })} title={open ? 'Resolve all deviations first' : ''}>Release batch</button>
              <button className="danger" onClick={() => { setText(''); setDlg({ kind: 'reject' }); }}>Reject batch</button>
            </div>
          )}
        </>
      )}

      {dlg && (
        <SignDialog
          user={user}
          title={dlg.kind === 'resolve' ? `Resolve DEV-${dlg.dev.id}` : dlg.kind === 'release' ? 'Release batch' : 'Reject batch'}
          meaning={dlg.kind === 'resolve' ? 'Reviewed by (QA)' : dlg.kind === 'release' ? 'Approved for release' : 'Rejected by QA'}
          onClose={() => setDlg(null)}
          onConfirm={async (password) => {
            if (dlg.kind === 'resolve') {
              await api('POST', `/api/deviations/${dlg.dev.id}/resolve`, { classification, resolution: text, password });
            } else {
              await api('POST', `/api/batches/${id}/${dlg.kind}`, { password, note: text });
              setBatches((b) => b.filter((x) => x.id !== id));
            }
            setError('');
            await load();
          }}
        >
          {dlg.kind === 'resolve' && (
            <>
              <label>Classification
                <select value={classification} onChange={(e) => setClassification(e.target.value)}>
                  <option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option>
                </select>
              </label>
              <label>Impact assessment / resolution
                <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Re-tested on retained sample: within limit. No impact on quality." />
              </label>
            </>
          )}
          {dlg.kind === 'reject' && (
            <label>Reason for rejection<textarea value={text} onChange={(e) => setText(e.target.value)} /></label>
          )}
        </SignDialog>
      )}
    </>
  );
}
