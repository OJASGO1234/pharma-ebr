import { useEffect, useState } from 'react';
import { api, fmtTime } from '../api';

export default function Audit() {
  const [rows, setRows] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [batchId, setBatchId] = useState('');
  const [chain, setChain] = useState<any>(null);

  useEffect(() => { api('GET', '/api/batches').then(setBatches); }, []);
  useEffect(() => {
    api('GET', `/api/audit${batchId ? `?batchId=${batchId}` : ''}`).then(setRows);
    api('GET', '/api/audit/verify').then(setChain);
  }, [batchId]);

  return (
    <>
      <div className="row between">
        <h2>Audit trail</h2>
        {chain && <span className={chain.valid ? 'ok' : 'bad'}>{chain.valid ? `✔ Integrity check passed (${chain.rows} entries, hash-chained)` : `✘ Integrity check FAILED at entry ${chain.brokenAtId}`}</span>}
      </div>
      <label className="inline">Batch:&nbsp;
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          <option value="">All</option>
          {batches.map((b) => <option key={b.id} value={b.id}>{b.batch_no}</option>)}
        </select>
      </label>
      <table className="small">
        <thead><tr><th>#</th><th>Timestamp</th><th>User</th><th>Action</th><th>Record</th><th>Old value</th><th>New value</th><th>Reason</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td><td>{fmtTime(r.ts)}</td><td>{r.username}</td><td><b>{r.action}</b></td>
              <td>{r.entity}{r.entity_id ? ` #${r.entity_id}` : ''}{r.field ? <div className="muted">{r.field}</div> : null}</td>
              <td>{r.old_value}</td><td>{r.new_value}</td><td>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
