import express, { type NextFunction, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { audit, verifyAuditChain } from './audit';
import { checkPassword, createSession, endSession, getSession, type Role, type User } from './auth';
import { BATCH_SIZE, MBR_VERSION, PRODUCT } from './db';

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fail = (status: number, msg: string): never => { throw new HttpError(status, msg); };

type Row = Record<string, any>;

export function createApp(db: DatabaseSync, staticDir?: string) {
  const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
  const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
  const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p);
  const now = () => new Date().toISOString();

  function tx<T>(fn: () => T): T {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  const app = express();
  app.use(express.json());

  // ---------- auth helpers ----------
  const me = (res: Response) => res.locals.user as User;

  function requireLogin(req: Request, res: Response, next: NextFunction) {
    const token = (req.headers.authorization ?? '').replace('Bearer ', '');
    const user = getSession(token);
    if (!user) return fail(401, 'Not logged in');
    res.locals.user = user;
    res.locals.token = token;
    next();
  }
  const requireRole = (...roles: Role[]) => (_req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(me(res).role)) return fail(403, `Role '${me(res).role}' is not allowed to do this`);
    next();
  };

  /** E-signature: the user must re-enter their password. Failed attempts are audited. */
  function verifySignature(user: User, password: unknown, meaning: string, batchId: number | null) {
    const row = one('SELECT pw_salt, pw_hash FROM users WHERE id = ?', user.id)!;
    if (typeof password !== 'string' || !password || !checkPassword(password, row.pw_salt, row.pw_hash)) {
      audit(db, { user: user.username, action: 'SIGNATURE_FAILED', entity: 'signature', batchId, newValue: meaning, reason: 'Wrong password' });
      fail(403, 'E-signature failed: password incorrect');
    }
  }

  function addSignature(user: User, batchId: number, meaning: string, content: unknown, ref: { stepId?: number; deviationId?: number }) {
    const ts = now();
    const recordHash = createHash('sha256').update(JSON.stringify({ batchId, meaning, user: user.username, ts, content })).digest('hex');
    const r = run('INSERT INTO signatures (batch_id, batch_step_id, deviation_id, user_id, meaning, signed_at, record_hash) VALUES (?,?,?,?,?,?,?)',
      batchId, ref.stepId ?? null, ref.deviationId ?? null, user.id, meaning, ts, recordHash);
    audit(db, { user: user.username, action: 'E_SIGN', entity: 'signature', entityId: Number(r.lastInsertRowid), batchId, newValue: meaning });
  }

  // ---------- queries ----------
  const DEVIATION_SQL = `
    SELECT d.*, b.batch_no, s.stage, s.title AS step_title, p.name AS param_name, p.unit, p.low, p.high,
           ru.full_name AS raised_by_name, vu.full_name AS resolved_by_name
    FROM deviations d
    JOIN batches b ON b.id = d.batch_id
    JOIN batch_steps bs ON bs.id = d.batch_step_id
    JOIN mbr_steps s ON s.id = bs.step_id
    JOIN mbr_params p ON p.id = d.param_id
    JOIN users ru ON ru.id = d.raised_by
    LEFT JOIN users vu ON vu.id = d.resolved_by`;

  function batchDetail(id: number): Row {
    const batch = one('SELECT b.*, u.full_name AS created_by_name FROM batches b JOIN users u ON u.id = b.created_by WHERE b.id = ?', id);
    if (!batch) fail(404, 'Batch not found');
    const steps = all(`
      SELECT bs.*, s.seq, s.stage, s.title, s.instruction, s.critical, pu.full_name AS performed_by_name, vu.full_name AS verified_by_name
      FROM batch_steps bs JOIN mbr_steps s ON s.id = bs.step_id
      LEFT JOIN users pu ON pu.id = bs.performed_by LEFT JOIN users vu ON vu.id = bs.verified_by
      WHERE bs.batch_id = ? ORDER BY s.seq`, id);
    for (const st of steps) {
      st.params = all(`
        SELECT p.*, v.value, v.in_limit, v.entered_at, u.full_name AS entered_by_name
        FROM mbr_params p
        LEFT JOIN batch_values v ON v.param_id = p.id AND v.batch_step_id = ?
        LEFT JOIN users u ON u.id = v.entered_by
        WHERE p.step_id = ? ORDER BY p.seq`, st.id, st.step_id);
      st.signatures = all(`SELECT sg.meaning, sg.signed_at, u.full_name FROM signatures sg JOIN users u ON u.id = sg.user_id
                           WHERE sg.batch_step_id = ? ORDER BY sg.id`, st.id);
    }
    const deviations = all(`${DEVIATION_SQL} WHERE d.batch_id = ? ORDER BY d.id`, id);
    return { ...batch!, steps, deviations };
  }

  function loadStep(id: number) {
    const st = one(`SELECT bs.*, s.seq, s.title, s.critical, b.status AS batch_status, b.batch_no
                    FROM batch_steps bs JOIN mbr_steps s ON s.id = bs.step_id JOIN batches b ON b.id = bs.batch_id WHERE bs.id = ?`, id);
    return st ?? fail(404, 'Step not found');
  }

  function refreshBatchStatus(batchId: number, user: User) {
    const b = one('SELECT status FROM batches WHERE id = ?', batchId)!;
    const open = one("SELECT COUNT(*) AS n FROM batch_steps WHERE batch_id = ? AND status != 'COMPLETED'", batchId)!.n;
    if (open === 0 && b.status === 'IN_PROGRESS') {
      run("UPDATE batches SET status = 'READY_FOR_QA' WHERE id = ?", batchId);
      audit(db, { user: user.username, action: 'STATUS_CHANGE', entity: 'batch', entityId: batchId, batchId, field: 'status', oldValue: 'IN_PROGRESS', newValue: 'READY_FOR_QA' });
    }
  }

  // ---------- public routes ----------
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};
    const u = one('SELECT * FROM users WHERE username = ?', String(username ?? ''));
    if (!u || typeof password !== 'string' || !checkPassword(password, u.pw_salt, u.pw_hash)) {
      audit(db, { user: String(username ?? '?'), action: 'LOGIN_FAILED', entity: 'user' });
      return fail(401, 'Invalid username or password');
    }
    const user: User = { id: u.id, username: u.username, full_name: u.full_name, role: u.role };
    audit(db, { user: user.username, action: 'LOGIN', entity: 'user', entityId: user.id });
    res.json({ token: createSession(user), user });
  });

  app.use('/api', requireLogin);

  app.post('/api/logout', (_req, res) => {
    audit(db, { user: me(res).username, action: 'LOGOUT', entity: 'user', entityId: me(res).id });
    endSession(res.locals.token);
    res.json({ ok: true });
  });

  app.get('/api/me', (_req, res) => { res.json(me(res)); });

  // ---------- master batch record ----------
  app.get('/api/mbr', (_req, res) => {
    const steps = all('SELECT * FROM mbr_steps ORDER BY seq');
    for (const s of steps) s.params = all('SELECT * FROM mbr_params WHERE step_id = ? ORDER BY seq', s.id);
    res.json({ version: MBR_VERSION, product: PRODUCT, batch_size: BATCH_SIZE, steps });
  });

  // ---------- batches ----------
  app.get('/api/batches', (_req, res) => {
    res.json(all(`
      SELECT b.*, u.full_name AS created_by_name,
        (SELECT COUNT(*) FROM batch_steps WHERE batch_id = b.id) AS steps_total,
        (SELECT COUNT(*) FROM batch_steps WHERE batch_id = b.id AND status = 'COMPLETED') AS steps_done,
        (SELECT COUNT(*) FROM deviations WHERE batch_id = b.id) AS deviations_total,
        (SELECT COUNT(*) FROM deviations WHERE batch_id = b.id AND status = 'OPEN') AS deviations_open
      FROM batches b JOIN users u ON u.id = b.created_by ORDER BY b.id DESC`));
  });

  app.post('/api/batches', requireRole('operator', 'admin'), (req, res) => {
    const user = me(res);
    const year = new Date().getFullYear();
    let batchNo = String(req.body?.batchNo ?? '').trim();
    if (!batchNo) {
      const n = one('SELECT COUNT(*) AS n FROM batches')!.n + 1;
      batchNo = `PCM-${year}-${String(n).padStart(3, '0')}`;
    }
    if (one('SELECT 1 FROM batches WHERE batch_no = ?', batchNo)) fail(409, `Batch ${batchNo} already exists`);
    const id = tx(() => {
      const r = run('INSERT INTO batches (batch_no, product, mbr_version, batch_size, status, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
        batchNo, PRODUCT, MBR_VERSION, BATCH_SIZE, 'CREATED', user.id, now());
      const bid = Number(r.lastInsertRowid);
      for (const s of all('SELECT id FROM mbr_steps ORDER BY seq')) run("INSERT INTO batch_steps (batch_id, step_id, status) VALUES (?,?,'PENDING')", bid, s.id);
      audit(db, { user: user.username, action: 'CREATE', entity: 'batch', entityId: bid, batchId: bid, field: 'batch_no', newValue: batchNo });
      return bid;
    });
    res.status(201).json(batchDetail(id));
  });

  app.get('/api/batches/:id', (req, res) => { res.json(batchDetail(Number(req.params.id))); });

  // ---------- execution ----------
  app.post('/api/batch-steps/:id/start', requireRole('operator'), (req, res) => {
    const user = me(res);
    const st = loadStep(Number(req.params.id));
    if (st.status !== 'PENDING') fail(409, `Step is already ${st.status}`);
    if (!['CREATED', 'IN_PROGRESS'].includes(st.batch_status)) fail(409, `Batch is ${st.batch_status}`);
    const prev = one(`SELECT COUNT(*) AS n FROM batch_steps bs JOIN mbr_steps s ON s.id = bs.step_id
                      WHERE bs.batch_id = ? AND s.seq < ? AND bs.status != 'COMPLETED'`, st.batch_id, st.seq)!.n;
    if (prev > 0) fail(409, 'Previous steps must be completed first');
    tx(() => {
      run("UPDATE batch_steps SET status = 'IN_PROGRESS' WHERE id = ?", st.id);
      audit(db, { user: user.username, action: 'STATUS_CHANGE', entity: 'batch_step', entityId: st.id, batchId: st.batch_id, field: 'status', oldValue: 'PENDING', newValue: 'IN_PROGRESS' });
      if (st.batch_status === 'CREATED') {
        run("UPDATE batches SET status = 'IN_PROGRESS' WHERE id = ?", st.batch_id);
        audit(db, { user: user.username, action: 'STATUS_CHANGE', entity: 'batch', entityId: st.batch_id, batchId: st.batch_id, field: 'status', oldValue: 'CREATED', newValue: 'IN_PROGRESS' });
      }
    });
    res.json(batchDetail(st.batch_id));
  });

  app.put('/api/batch-steps/:id/values/:paramId', requireRole('operator'), (req, res) => {
    const user = me(res);
    const st = loadStep(Number(req.params.id));
    const param = one('SELECT * FROM mbr_params WHERE id = ?', Number(req.params.paramId));
    if (!param) fail(404, 'Parameter not found');
    if (param!.step_id !== st.step_id) fail(400, 'Parameter does not belong to this step');
    if (st.status !== 'IN_PROGRESS') fail(409, `Values can only be entered while the step is IN_PROGRESS (now ${st.status})`);
    const raw = req.body?.value;
    const value = typeof raw === 'string' ? Number(raw.trim() === '' ? NaN : raw) : raw;
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(400, 'Value must be a number');
    const reason = String(req.body?.reason ?? '').trim();
    const existing = one('SELECT * FROM batch_values WHERE batch_step_id = ? AND param_id = ?', st.id, param!.id);
    if (existing && existing.value !== value && !reason) fail(400, 'A reason is required to change an entered value');

    const inLimit = (param!.low == null || value >= param!.low) && (param!.high == null || value <= param!.high);
    const limitText = `${param!.low ?? '-'} to ${param!.high ?? '-'} ${param!.unit}`;
    tx(() => {
      if (existing) {
        run('UPDATE batch_values SET value = ?, in_limit = ?, entered_by = ?, entered_at = ? WHERE id = ?', value, inLimit ? 1 : 0, user.id, now(), existing.id);
      } else {
        run('INSERT INTO batch_values (batch_step_id, param_id, value, in_limit, entered_by, entered_at) VALUES (?,?,?,?,?,?)', st.id, param!.id, value, inLimit ? 1 : 0, user.id, now());
      }
      audit(db, { user: user.username, action: existing ? 'UPDATE' : 'CREATE', entity: 'batch_value', entityId: param!.id, batchId: st.batch_id,
        field: `${st.title} / ${param!.name}`, oldValue: existing?.value, newValue: value, reason: reason || null });

      if (!inLimit) {
        const open = one("SELECT id FROM deviations WHERE batch_step_id = ? AND param_id = ? AND status = 'OPEN'", st.id, param!.id);
        if (open) {
          run('UPDATE deviations SET value = ? WHERE id = ?', value, open.id);
          audit(db, { user: user.username, action: 'UPDATE', entity: 'deviation', entityId: open.id, batchId: st.batch_id, field: 'value', oldValue: existing?.value, newValue: value, reason: reason || null });
        } else {
          const d = run('INSERT INTO deviations (batch_id, batch_step_id, param_id, value, raised_by, raised_at) VALUES (?,?,?,?,?,?)', st.batch_id, st.id, param!.id, value, user.id, now());
          audit(db, { user: user.username, action: 'DEVIATION_RAISED', entity: 'deviation', entityId: Number(d.lastInsertRowid), batchId: st.batch_id,
            field: `${st.title} / ${param!.name}`, newValue: value, reason: `Out of limit (${limitText})` });
        }
      }
    });
    res.json({ inLimit, deviationRaised: !inLimit, batch: batchDetail(st.batch_id) });
  });

  app.post('/api/batch-steps/:id/complete', requireRole('operator'), (req, res) => {
    const user = me(res);
    const st = loadStep(Number(req.params.id));
    if (st.status !== 'IN_PROGRESS') fail(409, `Step is ${st.status}, not IN_PROGRESS`);
    const missing = all(`SELECT p.name FROM mbr_params p LEFT JOIN batch_values v ON v.param_id = p.id AND v.batch_step_id = ?
                         WHERE p.step_id = ? AND v.id IS NULL`, st.id, st.step_id);
    if (missing.length) fail(400, `Enter all values first. Missing: ${missing.map((m) => m.name).join(', ')}`);

    if (st.critical) verifySignature(user, req.body?.password, 'Performed by', st.batch_id);
    tx(() => {
      const next = st.critical ? 'AWAITING_VERIFICATION' : 'COMPLETED';
      run('UPDATE batch_steps SET status = ?, performed_by = ?, performed_at = ? WHERE id = ?', next, user.id, now(), st.id);
      audit(db, { user: user.username, action: 'STATUS_CHANGE', entity: 'batch_step', entityId: st.id, batchId: st.batch_id, field: 'status', oldValue: 'IN_PROGRESS', newValue: next });
      if (st.critical) {
        const values = all('SELECT param_id, value FROM batch_values WHERE batch_step_id = ?', st.id);
        addSignature(user, st.batch_id, 'Performed by', { step: st.title, values }, { stepId: st.id });
      } else {
        refreshBatchStatus(st.batch_id, user);
      }
    });
    res.json(batchDetail(st.batch_id));
  });

  app.post('/api/batch-steps/:id/verify', requireRole('operator', 'qa'), (req, res) => {
    const user = me(res);
    const st = loadStep(Number(req.params.id));
    if (st.status !== 'AWAITING_VERIFICATION') fail(409, `Step is ${st.status}, not AWAITING_VERIFICATION`);
    if (st.performed_by === user.id) fail(403, 'The verifier must be a different person from the performer');
    verifySignature(user, req.body?.password, 'Verified by', st.batch_id);
    tx(() => {
      run("UPDATE batch_steps SET status = 'COMPLETED', verified_by = ?, verified_at = ? WHERE id = ?", user.id, now(), st.id);
      audit(db, { user: user.username, action: 'STATUS_CHANGE', entity: 'batch_step', entityId: st.id, batchId: st.batch_id, field: 'status', oldValue: 'AWAITING_VERIFICATION', newValue: 'COMPLETED' });
      const values = all('SELECT param_id, value FROM batch_values WHERE batch_step_id = ?', st.id);
      addSignature(user, st.batch_id, 'Verified by', { step: st.title, values }, { stepId: st.id });
      refreshBatchStatus(st.batch_id, user);
    });
    res.json(batchDetail(st.batch_id));
  });

  // ---------- deviations & QA ----------
  app.get('/api/deviations', (req, res) => {
    const where: string[] = [];
    const args: any[] = [];
    if (req.query.status) { where.push('d.status = ?'); args.push(String(req.query.status)); }
    if (req.query.batchId) { where.push('d.batch_id = ?'); args.push(Number(req.query.batchId)); }
    res.json(all(`${DEVIATION_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.id DESC`, ...args));
  });

  app.post('/api/deviations/:id/resolve', requireRole('qa'), (req, res) => {
    const user = me(res);
    const d = one('SELECT * FROM deviations WHERE id = ?', Number(req.params.id));
    if (!d) fail(404, 'Deviation not found');
    if (d!.status !== 'OPEN') fail(409, 'Deviation is already resolved');
    const classification = String(req.body?.classification ?? '');
    const resolution = String(req.body?.resolution ?? '').trim();
    if (!['minor', 'major', 'critical'].includes(classification)) fail(400, 'Classification must be minor, major or critical');
    if (resolution.length < 10) fail(400, 'Resolution / impact assessment is required (min 10 characters)');
    verifySignature(user, req.body?.password, 'Reviewed by (QA)', d!.batch_id);
    tx(() => {
      run("UPDATE deviations SET status = 'RESOLVED', classification = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?",
        classification, resolution, user.id, now(), d!.id);
      audit(db, { user: user.username, action: 'DEVIATION_RESOLVED', entity: 'deviation', entityId: d!.id, batchId: d!.batch_id, field: 'status', oldValue: 'OPEN', newValue: 'RESOLVED', reason: `[${classification}] ${resolution}` });
      addSignature(user, d!.batch_id, 'Reviewed by (QA)', { deviation: d!.id, classification, resolution }, { deviationId: d!.id });
    });
    res.json(one(`${DEVIATION_SQL} WHERE d.id = ?`, d!.id));
  });

  // Review by exception: only deviations are shown, not the in-limit data.
  app.get('/api/batches/:id/review', requireRole('qa', 'admin'), (req, res) => {
    const id = Number(req.params.id);
    const b = batchDetail(id);
    const params = b.steps.flatMap((s: Row) => s.params);
    res.json({
      batch: { id: b.id, batch_no: b.batch_no, product: b.product, mbr_version: b.mbr_version, status: b.status },
      summary: {
        steps_total: b.steps.length,
        steps_completed: b.steps.filter((s: Row) => s.status === 'COMPLETED').length,
        params_total: params.length,
        params_entered: params.filter((p: Row) => p.value != null).length,
        params_in_limit: params.filter((p: Row) => p.in_limit === 1).length,
        deviations_total: b.deviations.length,
        deviations_open: b.deviations.filter((d: Row) => d.status === 'OPEN').length,
      },
      deviations: b.deviations,
    });
  });

  function closeBatch(req: Request, res: Response, outcome: 'RELEASED' | 'REJECTED') {
    const user = me(res);
    const id = Number(req.params.id);
    const b = one('SELECT * FROM batches WHERE id = ?', id) ?? fail(404, 'Batch not found');
    if (b.status !== 'READY_FOR_QA') fail(409, `Batch is ${b.status}; only READY_FOR_QA batches can be ${outcome.toLowerCase()}`);
    const note = String(req.body?.note ?? '').trim();
    if (outcome === 'RELEASED') {
      const open = one("SELECT COUNT(*) AS n FROM deviations WHERE batch_id = ? AND status = 'OPEN'", id)!.n;
      if (open > 0) fail(409, `${open} open deviation(s) must be resolved before release`);
    } else if (!note) fail(400, 'A reason is required to reject a batch');
    verifySignature(user, req.body?.password, outcome === 'RELEASED' ? 'Approved for release' : 'Rejected by QA', id);
    tx(() => {
      run('UPDATE batches SET status = ?, closed_by = ?, closed_at = ?, closing_note = ? WHERE id = ?', outcome, user.id, now(), note || null, id);
      audit(db, { user: user.username, action: 'STATUS_CHANGE', entity: 'batch', entityId: id, batchId: id, field: 'status', oldValue: 'READY_FOR_QA', newValue: outcome, reason: note || null });
      addSignature(user, id, outcome === 'RELEASED' ? 'Approved for release' : 'Rejected by QA', { batch: b.batch_no, outcome }, {});
    });
    res.json(batchDetail(id));
  }
  app.post('/api/batches/:id/release', requireRole('qa'), (req, res) => closeBatch(req, res, 'RELEASED'));
  app.post('/api/batches/:id/reject', requireRole('qa'), (req, res) => closeBatch(req, res, 'REJECTED'));

  // ---------- audit trail (read-only) ----------
  app.get('/api/audit', (req, res) => {
    const where: string[] = [];
    const args: any[] = [];
    if (req.query.batchId) { where.push('batch_id = ?'); args.push(Number(req.query.batchId)); }
    if (req.query.user) { where.push('username = ?'); args.push(String(req.query.user)); }
    const limit = Math.min(Number(req.query.limit) || 300, 2000);
    res.json(all(`SELECT id, ts, username, action, entity, entity_id, batch_id, field, old_value, new_value, reason
                  FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${limit}`, ...args));
  });
  app.get('/api/audit/verify', (_req, res) => { res.json(verifyAuditChain(db)); });

  // ---------- static frontend + errors ----------
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^\/(?!api).*/, (_req, res) => { res.sendFile(path.join(staticDir, 'index.html')); });
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
