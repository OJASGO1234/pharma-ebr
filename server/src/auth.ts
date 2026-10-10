import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export type Role = 'operator' | 'qa' | 'admin';
export interface User { id: number; username: string; full_name: string; role: Role }

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 32).toString('hex') };
}

export function checkPassword(password: string, salt: string, hash: string): boolean {
  const a = Buffer.from(scryptSync(password, salt, 32).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

// In-memory sessions: fine for a demo, they reset when the server restarts.
const sessions = new Map<string, User>();
export const createSession = (u: User) => { const t = randomBytes(24).toString('hex'); sessions.set(t, u); return t; };
export const getSession = (t: string) => sessions.get(t);
export const endSession = (t: string) => sessions.delete(t);
