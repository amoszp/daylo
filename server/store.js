// Per-user storage: every record (a day, a shift's times, a packing-list item,
// a setting) is one JSON item in SQLite. Calendar-feed links live in their own table.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const KINDS = ['dia', 'tipo', 'pack', 'ajuste'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FEED_RE = /^[a-f0-9]{32}$/;
export const MAX_BATCH = 500;

export class Store {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'daylo.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS items (
        user_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
        data TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, kind, id)
      );
      CREATE TABLE IF NOT EXISTS feeds (
        token TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
      );
    `);
  }

  close() { this.db.close(); }

  static validKind(kind) { return KINDS.includes(kind); }
  static validId(id) { return typeof id === 'string' && ID_RE.test(id); }

  allItems(userId) {
    const out = Object.fromEntries(KINDS.map((k) => [k, []]));
    for (const row of this.db.prepare('SELECT kind, data FROM items WHERE user_id = ?').all(String(userId))) {
      if (out[row.kind]) out[row.kind].push(JSON.parse(row.data));
    }
    return out;
  }

  putItem(userId, kind, id, data) {
    const doc = { ...data, id };
    this.db.prepare(`INSERT INTO items (user_id, kind, id, data, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
      .run(String(userId), kind, id, JSON.stringify(doc), Date.now());
    return doc;
  }

  deleteItem(userId, kind, id) {
    return this.db.prepare('DELETE FROM items WHERE user_id = ? AND kind = ? AND id = ?').run(String(userId), kind, id).changes > 0;
  }

  /** Applies many puts and deletes at once, all or nothing (a pasted month, a deleted month, an undo). */
  batch(userId, ops) {
    if (!Array.isArray(ops) || ops.length > MAX_BATCH) throw Object.assign(new Error('bad batch'), { status: 400 });
    for (const op of ops) {
      const ok = op && Store.validKind(op.kind) && Store.validId(op.id)
        && ((op.op === 'put' && op.data && typeof op.data === 'object' && !Array.isArray(op.data)) || op.op === 'del');
      if (!ok) throw Object.assign(new Error('bad operation'), { status: 400 });
    }
    this.db.exec('BEGIN');
    try {
      for (const op of ops) {
        if (op.op === 'put') this.putItem(userId, op.kind, op.id, op.data);
        else this.deleteItem(userId, op.kind, op.id);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return ops.length;
  }

  // ---------- calendar feed ----------
  feedToken(userId) {
    return this.db.prepare('SELECT token FROM feeds WHERE user_id = ?').get(String(userId))?.token ?? null;
  }

  enableFeed(userId) {
    const existing = this.feedToken(userId);
    if (existing) return existing;
    const token = randomBytes(16).toString('hex');
    this.db.prepare('INSERT INTO feeds (token, user_id, created_at) VALUES (?, ?, ?)').run(token, String(userId), Date.now());
    return token;
  }

  disableFeed(userId) {
    return this.db.prepare('DELETE FROM feeds WHERE user_id = ?').run(String(userId)).changes > 0;
  }

  userForFeed(token) {
    if (!FEED_RE.test(String(token))) return null;
    return this.db.prepare('SELECT user_id FROM feeds WHERE token = ?').get(token)?.user_id ?? null;
  }
}
