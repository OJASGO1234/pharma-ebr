import { useState, type ReactNode } from 'react';
import type { User } from './api';

interface Props {
  user: User;
  title: string;
  meaning: string;
  children?: ReactNode;
  confirmLabel?: string;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}

/** 21 CFR Part 11 style e-signature prompt: user re-enters their password; the meaning is shown explicitly. */
export default function SignDialog({ user, title, meaning, children, confirmLabel = 'Sign', onConfirm, onClose }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { await onConfirm(password); onClose(); } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <div className="overlay">
      <form className="dialog" onSubmit={submit}>
        <h3>{title}</h3>
        {children}
        <div className="sigbox">
          <div>Signing as <b>{user.full_name}</b> ({user.username})</div>
          <div>Meaning: <span className="meaning">{meaning}</span></div>
        </div>
        <label>Re-enter your password to sign
          <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="row end">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button disabled={busy || !password}>{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
