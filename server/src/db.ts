import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL,
  role TEXT NOT NULL, pw_salt TEXT NOT NULL, pw_hash TEXT NOT NULL);

-- Master batch record (MBR): the approved template every batch is executed against
CREATE TABLE IF NOT EXISTS mbr_steps (
  id INTEGER PRIMARY KEY, seq INTEGER NOT NULL, stage TEXT NOT NULL, title TEXT NOT NULL,
  instruction TEXT NOT NULL, critical INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS mbr_params (
  id INTEGER PRIMARY KEY, step_id INTEGER NOT NULL REFERENCES mbr_steps(id), seq INTEGER NOT NULL,
  name TEXT NOT NULL, unit TEXT NOT NULL, low REAL, high REAL, target REAL);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY, batch_no TEXT UNIQUE NOT NULL, product TEXT NOT NULL, mbr_version TEXT NOT NULL,
  batch_size TEXT NOT NULL, status TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  closed_by INTEGER REFERENCES users(id), closed_at TEXT, closing_note TEXT);
CREATE TABLE IF NOT EXISTS batch_steps (
  id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id), step_id INTEGER NOT NULL REFERENCES mbr_steps(id),
  status TEXT NOT NULL, performed_by INTEGER REFERENCES users(id), performed_at TEXT,
  verified_by INTEGER REFERENCES users(id), verified_at TEXT);
CREATE TABLE IF NOT EXISTS batch_values (
  id INTEGER PRIMARY KEY, batch_step_id INTEGER NOT NULL REFERENCES batch_steps(id), param_id INTEGER NOT NULL REFERENCES mbr_params(id),
  value REAL NOT NULL, in_limit INTEGER NOT NULL, entered_by INTEGER NOT NULL REFERENCES users(id), entered_at TEXT NOT NULL,
  UNIQUE (batch_step_id, param_id));
CREATE TABLE IF NOT EXISTS deviations (
  id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id), batch_step_id INTEGER NOT NULL REFERENCES batch_steps(id),
  param_id INTEGER NOT NULL REFERENCES mbr_params(id), value REAL NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN',
  raised_by INTEGER NOT NULL REFERENCES users(id), raised_at TEXT NOT NULL,
  classification TEXT, resolution TEXT, resolved_by INTEGER REFERENCES users(id), resolved_at TEXT);
CREATE TABLE IF NOT EXISTS signatures (
  id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id), batch_step_id INTEGER REFERENCES batch_steps(id),
  deviation_id INTEGER REFERENCES deviations(id), user_id INTEGER NOT NULL REFERENCES users(id),
  meaning TEXT NOT NULL, signed_at TEXT NOT NULL, record_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, username TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL,
  entity_id INTEGER, batch_id INTEGER, field TEXT, old_value TEXT, new_value TEXT, reason TEXT,
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL);

-- Append-only: the audit trail and signatures can never be edited or deleted
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS sig_no_update BEFORE UPDATE ON signatures BEGIN SELECT RAISE(ABORT, 'signatures are append-only'); END;
CREATE TRIGGER IF NOT EXISTS sig_no_delete BEFORE DELETE ON signatures BEGIN SELECT RAISE(ABORT, 'signatures are append-only'); END;
`;

export const DEMO_PASSWORD = 'Pharma@123';
export const MBR_VERSION = 'MBR-PCM500 v1.0';
export const PRODUCT = 'Paracetamol Tablets IP 500 mg';
export const BATCH_SIZE = '100 kg blend (approx. 166,000 tablets)';

const USERS = [
  ['operator1', 'Asha Patil', 'operator'],
  ['operator2', 'Rahul Deshmukh', 'operator'],
  ['qa1', 'Dr. Meera Kulkarni', 'qa'],
  ['admin', 'Sanjay Joshi', 'admin'],
] as const;

// [stage, title, instruction, critical, params: [name, unit, low, high, target]]
type P = [string, string, number | null, number | null, number | null];
const MBR: [string, string, string, number, P[]][] = [
  ['Dispensing', 'Dispense raw materials',
    'Verify the balance calibration label is in date. Dispense each material against the approved weights. A second person verifies the weighing of the API.', 1, [
      ['Room humidity', '% RH', null, 55, null],
      ['Paracetamol IP (API)', 'kg', 74.25, 75.75, 75],
      ['Maize starch', 'kg', 14.85, 15.15, 15],
      ['Povidone K30 (binder)', 'kg', 4.95, 5.05, 5]]],
  ['Granulation', 'Wet granulation and drying',
    'Load the dispensed powders into the RMG. Dry-mix, add binder solution, wet-mass, then dry in the FBD until LOD is within limit.', 0, [
      ['Impeller speed (mixing)', 'rpm', 100, 150, 125],
      ['Binder addition time', 'min', 8, 12, 10],
      ['FBD inlet air temperature', '°C', 55, 65, 60],
      ['Loss on drying (LOD)', '%', 1.0, 2.5, 1.8]]],
  ['Compression', 'Lubricate and compress tablets',
    'Blend granules with magnesium stearate for 5 min, then compress. Sample every 30 min and record in-process checks.', 1, [
      ['Average tablet weight', 'mg', 585, 615, 600],
      ['Hardness', 'kp', 6, 10, 8],
      ['Thickness', 'mm', 4.0, 4.6, 4.3],
      ['Friability', '%', null, 1.0, null],
      ['Disintegration time', 'min', null, 15, null]]],
  ['Coating', 'Film coating',
    'Load tablets in the coating pan, pre-heat, then spray the film-coating suspension until the target weight gain is reached.', 0, [
      ['Inlet air temperature', '°C', 45, 55, 50],
      ['Pan speed', 'rpm', 4, 8, 6],
      ['Spray rate', 'g/min', 80, 120, 100],
      ['Weight gain', '%', 2.0, 3.5, 2.7]]],
  ['Packing', 'Blister packing and cartoning',
    'Complete line clearance. Pack tablets in 10x10 Alu-PVC blisters and cartons. Perform yield reconciliation at the end.', 1, [
      ['Blister sealing temperature', '°C', 150, 170, 160],
      ['Carton reconciliation', '%', 99.5, 100.0, 100],
      ['Packing yield', '%', 95.0, 100.5, null]]],
];

export function openDb(file: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

function seed(db: DatabaseSync) {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (n > 0) return;
  const ins = db.prepare('INSERT INTO users (username, full_name, role, pw_salt, pw_hash) VALUES (?,?,?,?,?)');
  for (const [u, name, role] of USERS) {
    const { salt, hash } = hashPassword(DEMO_PASSWORD);
    ins.run(u, name, role, salt, hash);
  }
  const insStep = db.prepare('INSERT INTO mbr_steps (seq, stage, title, instruction, critical) VALUES (?,?,?,?,?)');
  const insParam = db.prepare('INSERT INTO mbr_params (step_id, seq, name, unit, low, high, target) VALUES (?,?,?,?,?,?,?)');
  MBR.forEach(([stage, title, instr, critical, params], i) => {
    const sid = Number(insStep.run(i + 1, stage, title, instr, critical).lastInsertRowid);
    params.forEach(([name, unit, low, high, target], j) => insParam.run(sid, j + 1, name, unit, low, high, target));
  });
}
