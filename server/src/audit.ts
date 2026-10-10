import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

export interface AuditEvent {
  user: string;
  action: string;
  entity: string;
  entityId?: number | null;
  batchId?: number | null;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function rowHash(prev: string, r: Record<string, unknown>) {
  const parts = [prev, r.ts, r.username, r.action, r.entity, r.entity_id, r.batch_id, r.field, r.old_value, r.new_value, r.reason];
  return createHash('sha256').update(parts.map(s).join('|')).digest('hex');
}

/** Append one row to the audit trail. Each row's hash covers the previous row's hash (tamper evidence). */
export function audit(db: DatabaseSync, e: AuditEvent) {
  const prev = (db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get() as { hash: string } | undefined)?.hash ?? 'GENESIS';
  const row = {
    ts: new Date().toISOString(), username: e.user, action: e.action, entity: e.entity,
    entity_id: e.entityId ?? null, batch_id: e.batchId ?? null, field: e.field ?? null,
    old_value: e.oldValue == null ? null : String(e.oldValue), new_value: e.newValue == null ? null : String(e.newValue),
    reason: e.reason ?? null,
  };
  db.prepare(`INSERT INTO audit_log (ts, username, action, entity, entity_id, batch_id, field, old_value, new_value, reason, prev_hash, hash)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.ts, row.username, row.action, row.entity, row.entity_id, row.batch_id, row.field, row.old_value, row.new_value, row.reason, prev, rowHash(prev, row));
}

export function verifyAuditChain(db: DatabaseSync) {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all() as Record<string, unknown>[];
  let prev = 'GENESIS';
  for (const r of rows) {
    if (r.prev_hash !== prev || r.hash !== rowHash(prev, r)) return { valid: false, rows: rows.length, brokenAtId: r.id as number };
    prev = r.hash as string;
  }
  return { valid: true, rows: rows.length, brokenAtId: null };
}
