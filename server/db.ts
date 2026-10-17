import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 数据库：开发阶段用 Node 自带的 SQLite，一个文件就是全部数据。
// 默认放在 server/data/baseguard.db（不进 git）；测试用 ':memory:'。

export type Db = DatabaseSync;

export const DEFAULT_DB_PATH = 'server/data/baseguard.db';

export function openDb(path: string = process.env.BASEGUARD_DB ?? DEFAULT_DB_PATH): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

// 建表。以后加表、加字段都往 MIGRATIONS 末尾追加，user_version 记录做到第几条
const MIGRATIONS = [
  `CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);`,
  // 每个账号一份基地存档（整份 JSON），以及当前这场出击
  `CREATE TABLE bases (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE sorties (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    ai_id INTEGER NOT NULL,
    roster TEXT NOT NULL,
    seed INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    finished_at INTEGER
  );`,
];

function migrate(db: Db): void {
  const { user_version: done } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let i = done; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
