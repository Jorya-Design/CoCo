import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { User, RoomState, Run, Worker } from '../shared/types.ts';

export function openStore(directory: string) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(resolve(directory, 'coco.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, password TEXT);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, title TEXT NOT NULL, created INTEGER NOT NULL, data TEXT NOT NULL, doc BLOB);
    CREATE TABLE IF NOT EXISTS members (room_id TEXT NOT NULL REFERENCES rooms(id), user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(room_id,user_id));
    CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  const publicUser = (row: any): User => ({ id: row.id, name: row.name, email: row.email });
  return {
    db,
    guest() {
      const user = { id: randomUUID(), name: 'Guest', email: null };
      db.prepare('INSERT INTO users(id,name) VALUES (?,?)').run(user.id, user.name); return user;
    },
    register(name: string, email: string, password: string, guestId?: string) {
      if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new Error('An account with this email already exists.');
      const salt = randomBytes(16).toString('hex');
      const hash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
      const guest = guestId && db.prepare('SELECT * FROM users WHERE id=? AND email IS NULL').get(guestId);
      const id = guest ? guestId! : randomUUID();
      if (guest) db.prepare('UPDATE users SET name=?,email=?,password=? WHERE id=?').run(name, email, hash, id);
      else db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(id, name, email, hash);
      return { id, name, email };
    },
    login(email: string, password: string) {
      const row = db.prepare('SELECT * FROM users WHERE email=?').get(email) as any;
      // Perform the same expensive derivation for absent accounts.
      const [salt, expected] = row?.password?.split(':') || ['missing-account-salt', '00'.repeat(64)];
      const actual = scryptSync(password, salt, 64);
      if (!row || !timingSafeEqual(actual, Buffer.from(expected, 'hex'))) throw new Error('Email or password is incorrect.');
      return publicUser(row);
    },
    session(user: User) {
      const token = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, user.id, Date.now() + 30 * 86400000); return token;
    },
    user(token: string | undefined): User | null {
      if (!token) return null;
      const row = db.prepare('SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE token=? AND expires>?').get(token, Date.now());
      return row ? publicUser(row) : null;
    },
    logout(token: string) { db.prepare('DELETE FROM sessions WHERE token=?').run(token); },
    isMember(room: string, user: string) { return !!db.prepare('SELECT 1 FROM members WHERE room_id=? AND user_id=?').get(room, user); },
    join(room: string, user: string) { db.prepare('INSERT OR IGNORE INTO members VALUES (?,?)').run(room, user); },
    rooms(user: string) { return db.prepare('SELECT rooms.id,rooms.title,rooms.created AS createdAt FROM rooms JOIN members ON rooms.id=members.room_id WHERE members.user_id=? ORDER BY rooms.created DESC').all(user); },
    createRoom(user: string, title: string): RoomState {
      const room: RoomState = { id: randomUUID(), title, createdAt: Date.now(), messages: [{ id: randomUUID(), role: 'agent', name: 'CoCo', text: 'Every great build starts with a conversation. Tell me what you have in mind, or start an interview and we’ll work through the details together.', at: Date.now() }], answers: [], interview: null, run: null, workers: [] };
      db.prepare('INSERT INTO rooms(id,title,created,data) VALUES (?,?,?,?)').run(room.id, title, room.createdAt, JSON.stringify(room));
      this.join(room.id, user); return room;
    },
    room(id: string): RoomState | null { const row = db.prepare('SELECT data FROM rooms WHERE id=?').get(id); return row ? JSON.parse(row.data as string) : null; },
    saveRoom(room: RoomState) { db.prepare('UPDATE rooms SET title=?,data=? WHERE id=?').run(room.title, JSON.stringify(room), room.id); },
    doc(id: string) { return db.prepare('SELECT doc FROM rooms WHERE id=?').get(id)?.doc as Uint8Array | null; },
    saveDoc(id: string, doc: Uint8Array) { db.prepare('UPDATE rooms SET doc=? WHERE id=?').run(doc, id); },
    invite(room: string) { const token = randomBytes(24).toString('hex'); db.prepare('INSERT INTO invites VALUES (?,?,?)').run(token, room, Date.now() + 7 * 86400000); return token; },
    resolveInvite(token: string) { return db.prepare('SELECT room_id FROM invites WHERE token=? AND expires>?').get(token, Date.now())?.room_id as string | undefined; },
    workers(): Worker[] { return db.prepare('SELECT data FROM workers').all().map(r => JSON.parse(r.data as string)).filter(w => w.lastSeen > Date.now() - 35000); },
    worker(worker: Worker) { db.prepare('INSERT INTO workers VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(worker.id, JSON.stringify(worker)); },
    activeRooms(): RoomState[] { return db.prepare('SELECT data FROM rooms').all().map(r => JSON.parse(r.data as string)).filter(r => r.run && ['running', 'paused'].includes(r.run.status)); },
  };
}
export type Store = ReturnType<typeof openStore>;
export function event(run: Run, text: string, level: 'info' | 'success' | 'error' = 'info', taskId?: string) {
  run.events.push({ id: randomUUID(), at: Date.now(), text, level, taskId });
  if (run.events.length > 1000) run.events.splice(0, run.events.length - 1000);
}
