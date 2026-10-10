import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app';
import { openDb } from '../src/db';
import { Client, PASSWORD, runBatchToQa } from './helpers';

let server: Server;
let db: DatabaseSync;
let base: string;
let op1: Client, op2: Client, qa: Client;

before(async () => {
  db = openDb(':memory:');
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  op1 = await Client.login(base, 'operator1');
  op2 = await Client.login(base, 'operator2');
  qa = await Client.login(base, 'qa1');
});
after(() => { server.close(); });

const auditRows = (q: string, ...p: any[]) => db.prepare(`SELECT * FROM audit_log WHERE ${q} ORDER BY id`).all(...p) as any[];

describe('eBR acceptance tests', () => {
  it('TC-001 login: valid credentials accepted, invalid rejected and audited, API needs a token', async () => {
    const bad = await new Client(base).post('/api/login', { username: 'operator1', password: 'wrong' });
    assert.equal(bad.status, 401);
    assert.ok(auditRows("action = 'LOGIN_FAILED' AND username = 'operator1'").length >= 1);
    assert.equal((await new Client(base).get('/api/batches')).status, 401);
    assert.equal((await op1.get('/api/me')).body.role, 'operator');
  });

  it('TC-002 master batch record has 5 stages, each with instructions and parameter limits', async () => {
    const mbr = (await op1.get('/api/mbr')).body;
    assert.deepEqual(mbr.steps.map((s: any) => s.stage), ['Dispensing', 'Granulation', 'Compression', 'Coating', 'Packing']);
    for (const s of mbr.steps) {
      assert.ok(s.instruction.length > 20);
      assert.ok(s.params.length >= 3);
      assert.ok(s.params.every((p: any) => p.low != null || p.high != null), 'every parameter has a limit');
    }
    assert.deepEqual(mbr.steps.filter((s: any) => s.critical).map((s: any) => s.stage), ['Dispensing', 'Compression', 'Packing']);
  });

  it('TC-003 batch creation instantiates all steps, is audited, and enforces step sequence', async () => {
    const r = await op1.post('/api/batches', {});
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'CREATED');
    assert.equal(r.body.steps.length, 5);
    assert.equal((await qa.post('/api/batches', {})).status, 403, 'QA cannot create batches');
    const skip = await op1.post(`/api/batch-steps/${r.body.steps[1].id}/start`);
    assert.equal(skip.status, 409);
    assert.equal(auditRows("action = 'CREATE' AND entity = 'batch' AND batch_id = ?", r.body.id).length, 1);
  });

  it('TC-004 in-limit values are accepted without raising a deviation', async () => {
    const b = (await op1.post('/api/batches', {})).body;
    const step = b.steps[0];
    await op1.post(`/api/batch-steps/${step.id}/start`);
    const p = step.params.find((x: any) => x.name.startsWith('Paracetamol'));
    const r = await op1.put(`/api/batch-steps/${step.id}/values/${p.id}`, { value: 75.1 });
    assert.equal(r.status, 200);
    assert.equal(r.body.inLimit, true);
    assert.equal(r.body.batch.deviations.length, 0);
    const bad = await op1.put(`/api/batch-steps/${step.id}/values/${p.id}`, { value: 'abc' });
    assert.equal(bad.status, 400);
  });

  it('TC-005 out-of-limit value automatically raises a deviation (and is audited)', async () => {
    const b = (await op1.post('/api/batches', {})).body;
    const step = b.steps[0];
    await op1.post(`/api/batch-steps/${step.id}/start`);
    const p = step.params.find((x: any) => x.name.startsWith('Paracetamol'));
    const r = await op1.put(`/api/batch-steps/${step.id}/values/${p.id}`, { value: 76.4 });
    assert.equal(r.body.inLimit, false);
    assert.equal(r.body.batch.deviations.length, 1);
    assert.equal(r.body.batch.deviations[0].status, 'OPEN');
    const rows = auditRows("action = 'DEVIATION_RAISED' AND batch_id = ?", b.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].new_value, '76.4');
    assert.match(rows[0].reason, /Out of limit/);
  });

  it('TC-006 changing an entered value needs a reason; audit trail records old value, new value, user, time', async () => {
    const b = (await op1.post('/api/batches', {})).body;
    const step = b.steps[0];
    await op1.post(`/api/batch-steps/${step.id}/start`);
    const p = step.params.find((x: any) => x.name === 'Maize starch');
    await op1.put(`/api/batch-steps/${step.id}/values/${p.id}`, { value: 15.0 });
    const noReason = await op1.put(`/api/batch-steps/${step.id}/values/${p.id}`, { value: 15.1 });
    assert.equal(noReason.status, 400);
    const ok = await op1.put(`/api/batch-steps/${step.id}/values/${p.id}`, { value: 15.1, reason: 'Balance display misread' });
    assert.equal(ok.status, 200);
    const row = auditRows("action = 'UPDATE' AND entity = 'batch_value' AND batch_id = ?", b.id)[0];
    assert.equal(row.old_value, '15');
    assert.equal(row.new_value, '15.1');
    assert.equal(row.username, 'operator1');
    assert.equal(row.reason, 'Balance display misread');
    assert.ok(!Number.isNaN(Date.parse(row.ts)));
  });

  it('TC-007 critical step needs e-signature: wrong password fails, "Performed by" + independent "Verified by" succeed', async () => {
    const b = (await op1.post('/api/batches', {})).body;
    const step = b.steps[0];
    await op1.post(`/api/batch-steps/${step.id}/start`);
    for (const p of step.params) await op1.put(`/api/batch-steps/${step.id}/values/${p.id}`, { value: p.target ?? 50 });
    const wrong = await op1.post(`/api/batch-steps/${step.id}/complete`, { password: 'nope' });
    assert.equal(wrong.status, 403);
    assert.equal(auditRows("action = 'SIGNATURE_FAILED' AND batch_id = ?", b.id).length, 1);
    const none = await op1.post(`/api/batch-steps/${step.id}/complete`, {});
    assert.equal(none.status, 403);

    const done = await op1.post(`/api/batch-steps/${step.id}/complete`, { password: PASSWORD });
    assert.equal(done.body.steps[0].status, 'AWAITING_VERIFICATION');
    assert.equal((await op1.post(`/api/batch-steps/${step.id}/verify`, { password: PASSWORD })).status, 403, 'self-verification refused');
    const ver = await op2.post(`/api/batch-steps/${step.id}/verify`, { password: PASSWORD });
    assert.equal(ver.body.steps[0].status, 'COMPLETED');
    assert.deepEqual(ver.body.steps[0].signatures.map((s: any) => s.meaning), ['Performed by', 'Verified by']);
    assert.equal(ver.body.steps[0].signatures[1].full_name, 'Rahul Deshmukh');
  });

  it('TC-008 QA review by exception shows only deviations and blocks release while any is open', async () => {
    const b = await runBatchToQa(base, { 'Hardness': 11.2 });
    assert.equal(b.status, 'READY_FOR_QA');
    const rev = (await qa.get(`/api/batches/${b.id}/review`)).body;
    assert.equal(rev.deviations.length, 1);
    assert.equal(rev.deviations[0].param_name, 'Hardness');
    assert.ok(rev.summary.params_in_limit === rev.summary.params_total - 1);
    assert.equal((await op1.get(`/api/batches/${b.id}/review`)).status, 403, 'operators cannot use QA review');
    const rel = await qa.post(`/api/batches/${b.id}/release`, { password: PASSWORD });
    assert.equal(rel.status, 409);
    assert.match(rel.body.error, /open deviation/);
  });

  it('TC-009 QA resolves the deviation with e-signature, then releases the batch; operators cannot', async () => {
    const b = await runBatchToQa(base, { 'Friability': 1.4 });
    const dev = b.deviations[0];
    assert.equal((await op1.post(`/api/deviations/${dev.id}/resolve`, { classification: 'minor', resolution: 'Operator-level resolution attempt', password: PASSWORD })).status, 403);
    const weak = await qa.post(`/api/deviations/${dev.id}/resolve`, { classification: 'minor', resolution: 'short', password: PASSWORD });
    assert.equal(weak.status, 400);
    const badPw = await qa.post(`/api/deviations/${dev.id}/resolve`, { classification: 'minor', resolution: 'Re-tested on retained sample: 0.7 %, within limit', password: 'x' });
    assert.equal(badPw.status, 403);
    const res = await qa.post(`/api/deviations/${dev.id}/resolve`, { classification: 'minor', resolution: 'Re-tested on retained sample: 0.7 %, within limit', password: PASSWORD });
    assert.equal(res.body.status, 'RESOLVED');
    assert.equal(res.body.resolved_by_name, 'Dr. Meera Kulkarni');
    assert.equal((await op1.post(`/api/batches/${b.id}/release`, { password: PASSWORD })).status, 403);
    const rel = await qa.post(`/api/batches/${b.id}/release`, { password: PASSWORD });
    assert.equal(rel.status, 200);
    assert.equal(rel.body.status, 'RELEASED');
    assert.ok(auditRows("action = 'E_SIGN' AND new_value = 'Approved for release' AND batch_id = ?", b.id).length === 1);
  });

  it('TC-010 audit trail is append-only, tamper-evident and covers every state change', async () => {
    const b = await runBatchToQa(base);
    await qa.post(`/api/batches/${b.id}/release`, { password: PASSWORD });
    assert.throws(() => db.prepare("UPDATE audit_log SET new_value = 'x' WHERE id = 1").run(), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM audit_log').run(), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM signatures').run(), /append-only/);
    const v = (await qa.get('/api/audit/verify')).body;
    assert.equal(v.valid, true);
    const trail = (await qa.get(`/api/audit?batchId=${b.id}&limit=500`)).body as any[];
    const statuses = trail.filter((r) => r.action === 'STATUS_CHANGE' && r.entity === 'batch').map((r) => `${r.old_value}>${r.new_value}`).reverse();
    assert.deepEqual(statuses, ['CREATED>IN_PROGRESS', 'IN_PROGRESS>READY_FOR_QA', 'READY_FOR_QA>RELEASED']);
    assert.ok(trail.every((r) => r.username && r.ts));
    // a forged row (bypassing the app) breaks the hash chain
    db.exec('DROP TRIGGER audit_no_update');
    db.prepare("UPDATE audit_log SET new_value = 'tampered' WHERE id = 3").run();
    assert.equal((await qa.get('/api/audit/verify')).body.valid, false);
  });
});

