import { useEffect, useState } from 'react';
import { api, hasToken, setToken, type User } from './api';
import Batches from './pages/Batches';
import BatchExec from './pages/BatchExec';
import Review from './pages/Review';
import Audit from './pages/Audit';
import Master from './pages/Master';

type Page = 'batches' | 'review' | 'audit' | 'master';

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('operator1');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/login', { username, password });
      setToken(r.token);
      onLogin(r.user);
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>Pharma eBR</h1>
        <p className="muted">Sahyadri Pharma Ltd., Pune: <b>fictional demo plant</b></p>
        <label>User
          <select value={username} onChange={(e) => setUsername(e.target.value)}>
            <option value="operator1">operator1 – Asha Patil (Operator)</option>
            <option value="operator2">operator2 – Rahul Deshmukh (Operator)</option>
            <option value="qa1">qa1 – Dr. Meera Kulkarni (QA)</option>
            <option value="admin">admin – Sanjay Joshi (Admin)</option>
          </select>
        </label>
        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Pharma@123" autoFocus />
        </label>
        {error && <div className="error">{error}</div>}
        <button>Log in</button>
        <p className="muted small">Demo password for every user: <code>Pharma@123</code></p>
      </form>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!hasToken());
  const [page, setPage] = useState<Page>('batches');
  const [batchId, setBatchId] = useState<number | null>(null);

  useEffect(() => {
    if (hasToken()) api<User>('GET', '/api/me').then(setUser).catch(() => setToken('')).finally(() => setReady(true));
  }, []);

  if (!ready) return null;
  if (!user) return <Login onLogin={setUser} />;

  const go = (p: Page) => { setPage(p); setBatchId(null); };
  const logout = async () => { await api('POST', '/api/logout').catch(() => {}); setToken(''); setUser(null); };
  const isQA = user.role === 'qa' || user.role === 'admin';

  return (
    <>
      <header>
        <b className="brand">Pharma eBR</b>
        <nav>
          <button className={page === 'batches' ? 'active' : ''} onClick={() => go('batches')}>Batches</button>
          {isQA && <button className={page === 'review' ? 'active' : ''} onClick={() => go('review')}>QA Review</button>}
          <button className={page === 'master' ? 'active' : ''} onClick={() => go('master')}>Master Record</button>
          <button className={page === 'audit' ? 'active' : ''} onClick={() => go('audit')}>Audit Trail</button>
        </nav>
        <span className="who">{user.full_name} · <span className="badge">{user.role}</span> <button className="secondary" onClick={logout}>Log out</button></span>
      </header>
      <div className="banner">Fictional demo – not for real GMP use</div>
      <main>
        {page === 'batches' && (batchId
          ? <BatchExec id={batchId} user={user} onBack={() => setBatchId(null)} />
          : <Batches user={user} onOpen={setBatchId} />)}
        {page === 'review' && isQA && <Review user={user} />}
        {page === 'master' && <Master />}
        {page === 'audit' && <Audit />}
      </main>
    </>
  );
}
