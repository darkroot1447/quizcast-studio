import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  defaultSettings,
  questionSchema,
  type Question,
  type SessionRecord,
  type Settings,
} from '../shared/schema.js';
import { seedQuestions } from '../data/questions.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const normalize = (text: string) => text.normalize('NFC').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, normalized TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY, finished_at INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      PRAGMA user_version = 1;
    `);
    if (!this.get('installationId')) this.set('installationId', randomUUID());
    if (!this.get('overlayToken')) this.set('overlayToken', randomBytes(32).toString('hex'));
    if (!this.get('settings')) this.set('settings', defaultSettings);
    if (!this.get('seeded')) {
      this.importQuestions(seedQuestions);
      this.set('seeded', true);
    }
  }
  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? (JSON.parse(row.value as string) as T) : undefined;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare('INSERT INTO meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }
  get settings(): Settings {
    return this.get<Settings>('settings')!;
  }
  questions(): Question[] {
    return this.db
      .prepare('SELECT payload FROM questions ORDER BY rowid')
      .all()
      .map((row) => JSON.parse(row.payload as string) as Question);
  }
  saveQuestion(input: Question, update = false) {
    const q = questionSchema.parse(input);
    if (update) {
      const result = this.db
        .prepare('UPDATE questions SET normalized = ?, payload = ? WHERE id = ?')
        .run(normalize(q.text), JSON.stringify(q), q.id);
      if (!result.changes) throw new Error('Soru bulunamadı.');
    } else {
      this.db
        .prepare('INSERT INTO questions VALUES (?, ?, ?)')
        .run(q.id, normalize(q.text), JSON.stringify(q));
    }
  }
  importQuestions(questions: Question[]) {
    const validated = questions.map((q) => questionSchema.parse(q));
    this.db.exec('BEGIN IMMEDIATE');
    let added = 0;
    try {
      const insert = this.db.prepare('INSERT OR IGNORE INTO questions VALUES (?, ?, ?)');
      for (const q of validated)
        added += Number(insert.run(q.id, normalize(q.text), JSON.stringify(q)).changes);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { added, skipped: validated.length - added };
  }
  deleteQuestion(id: string) {
    return this.db.prepare('DELETE FROM questions WHERE id = ?').run(id).changes > 0;
  }
  saveResult(result: SessionRecord) {
    this.db
      .prepare('INSERT OR IGNORE INTO results VALUES (?, ?, ?)')
      .run(result.id, result.finishedAt, JSON.stringify(result));
    this.db.exec(
      'DELETE FROM results WHERE id NOT IN (SELECT id FROM results ORDER BY finished_at DESC LIMIT 200)',
    );
  }
  history(): SessionRecord[] {
    return this.db
      .prepare('SELECT payload FROM results ORDER BY finished_at DESC LIMIT 50')
      .all()
      .map((row) => JSON.parse(row.payload as string));
  }
  setup(password: string) {
    if (this.get('password')) throw new Error('Kurulum zaten tamamlandı.');
    const salt = randomBytes(16).toString('hex');
    this.set('password', { salt, hash: scryptSync(password, salt, 64).toString('hex') });
  }
  authenticate(password: string) {
    const stored = this.get<{ salt: string; hash: string }>('password');
    if (!stored) return false;
    return timingSafeEqual(Buffer.from(stored.hash, 'hex'), scryptSync(password, stored.salt, 64));
  }
  createSession(now = Date.now()) {
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
    const token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO auth_sessions VALUES (?, ?)').run(digest(token), now + 12 * 60 * 60 * 1000);
    return token;
  }
  hasSession(token: string, now = Date.now()) {
    return !!this.db
      .prepare('SELECT 1 FROM auth_sessions WHERE token_hash = ? AND expires_at > ?')
      .get(digest(token), now);
  }
  removeSession(token: string) {
    this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(token));
  }
  close() {
    this.db.close();
  }
}
