// Small HTTP client + scenario helpers, shared by the automated tests and the demo-data script.
export const PASSWORD = 'Pharma@123';

export interface Res { status: number; body: any }

export class Client {
  token = '';
  constructor(public base: string) {}

  async call(method: string, url: string, body?: unknown): Promise<Res> {
    const r = await fetch(this.base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }
  get = (u: string) => this.call('GET', u);
  post = (u: string, b: unknown = {}) => this.call('POST', u, b);
  put = (u: string, b: unknown) => this.call('PUT', u, b);

  static async login(base: string, username: string, password = PASSWORD) {
    const c = new Client(base);
    const r = await c.post('/api/login', { username, password });
    if (r.status !== 200) throw new Error(`login failed for ${username}: ${r.status}`);
    c.token = r.body.token;
    return c;
  }
}

/** A sensible in-limit value for a parameter. */
export function goodValue(p: { low: number | null; high: number | null; target: number | null }): number {
  if (p.target != null) return p.target;
  if (p.low != null && p.high != null) return (p.low + p.high) / 2;
  if (p.high != null) return p.high * 0.5;
  return (p.low as number) * 1.1;
}

/** Start a step, enter all values (overrides: param name -> value), complete it. */
export async function executeStep(op: Client, batch: any, stepIndex: number, overrides: Record<string, number> = {}) {
  const step = batch.steps[stepIndex];
  const s = await op.post(`/api/batch-steps/${step.id}/start`);
  if (s.status !== 200) throw new Error(`start failed: ${JSON.stringify(s.body)}`);
  for (const p of step.params) {
    const value = overrides[p.name] ?? goodValue(p);
    const r = await op.put(`/api/batch-steps/${step.id}/values/${p.id}`, { value });
    if (r.status !== 200) throw new Error(`value failed: ${JSON.stringify(r.body)}`);
  }
  const c = await op.post(`/api/batch-steps/${step.id}/complete`, { password: PASSWORD });
  if (c.status !== 200) throw new Error(`complete failed: ${JSON.stringify(c.body)}`);
  return c.body;
}

/** Run a whole batch through all 5 steps (operator1 performs, operator2 verifies critical steps). */
export async function runBatchToQa(base: string, overrides: Record<string, number> = {}) {
  const op1 = await Client.login(base, 'operator1');
  const op2 = await Client.login(base, 'operator2');
  let batch = (await op1.post('/api/batches', {})).body;
  for (let i = 0; i < batch.steps.length; i++) {
    batch = await executeStep(op1, batch, i, overrides);
    if (batch.steps[i].status === 'AWAITING_VERIFICATION') {
      const v = await op2.post(`/api/batch-steps/${batch.steps[i].id}/verify`, { password: PASSWORD });
      if (v.status !== 200) throw new Error(`verify failed: ${JSON.stringify(v.body)}`);
      batch = v.body;
    }
  }
  return batch;
}
