import { useEffect, useState } from 'react';
import { api, limitText } from '../api';

export default function Master() {
  const [mbr, setMbr] = useState<any>(null);
  useEffect(() => { api('GET', '/api/mbr').then(setMbr); }, []);
  if (!mbr) return null;
  return (
    <>
      <h2>Master batch record: {mbr.product}</h2>
      <p className="muted">{mbr.version} · batch size {mbr.batch_size} · read-only (approved version)</p>
      {mbr.steps.map((s: any) => (
        <section className="card" key={s.id}>
          <h3>{s.seq}. {s.stage}: {s.title} {s.critical ? <span className="badge crit">critical</span> : null}</h3>
          <p className="instr">{s.instruction}</p>
          <table className="params">
            <thead><tr><th>Parameter</th><th>Limit</th><th>Target</th></tr></thead>
            <tbody>{s.params.map((p: any) => <tr key={p.id}><td>{p.name}</td><td>{limitText(p)}</td><td>{p.target ?? '–'}</td></tr>)}</tbody>
          </table>
        </section>
      ))}
    </>
  );
}
