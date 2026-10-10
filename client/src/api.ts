export interface User { id: number; username: string; full_name: string; role: 'operator' | 'qa' | 'admin' }

let token = sessionStorage.getItem('token') ?? '';
export const setToken = (t: string) => { token = t; t ? sessionStorage.setItem('token', t) : sessionStorage.removeItem('token'); };
export const hasToken = () => !!token;

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status})`);
  return data;
}

export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '');
export const limitText = (p: { low: number | null; high: number | null; unit: string }) =>
  p.low != null && p.high != null ? `${p.low} – ${p.high} ${p.unit}` : p.high != null ? `≤ ${p.high} ${p.unit}` : `≥ ${p.low} ${p.unit}`;
