import { useCallback, useEffect, useState } from 'react';
import { api, fmtTime, type User } from '../api';

export default function Batches({ user, onOpen }: { user: User; onOpen: (id: number) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(() => api('GET', '/api/batches').then(setRows).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    try {
      const b = await api('POST', '/api/batches', {});
      onOpen(b.id);
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <div className="row between">
        <h2>Batches</h2>
        {(user.role === 'operator' || user.role === 'admin') && <button onClick={create}>+ New paracetamol batch</button>}
      </div>
      {error && <div className="error">{error}</div>}
      <table>
        <thead><tr><th>Batch no.</th><th>Product</th><th>Status</th><th>Progress</th><th>Deviations (open / total)</th><th>Created</th><th /></tr></thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td><b>{b.batch_no}</b></td>
              <td>{b.product}</td>
              <td><span className={`status ${b.status}`}>{b.status.replace(/_/g, ' ')}</span></td>
              <td>{b.steps_done} / {b.steps_total} steps</td>
              <td>{b.deviations_open > 0 ? <b className="bad">{b.deviations_open}</b> : 0} / {b.deviations_total}</td>
              <td>{fmtTime(b.created_at)}<br /><span className="muted small">{b.created_by_name}</span></td>
              <td><button className="secondary" onClick={() => onOpen(b.id)}>Open</button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="muted">No batches yet. Create one (as an operator), or run <code>npm run demo</code>.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
