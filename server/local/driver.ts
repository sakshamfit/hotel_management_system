/**
 * Embedded SQLite driver with a single tiny API.
 *
 * Tries, in order:
 *   1. Node's built-in `node:sqlite` (Node ≥ 22.5; Electron ≥ 36) — zero deps.
 *   2. `better-sqlite3` (used automatically if the runtime does not ship the
 *      built-in module).
 *
 * Both expose the same shape: db.prepare(sql) → { run(...), get(...), all(...) }
 * and db.exec(sql). We only ever use positional `?` parameters.
 */
import { createRequire } from 'node:module';

/** Works in ESM (tsx/dev) and CJS (bundled server-local.cjs / Electron). */
const nodeRequire =
  typeof require !== 'undefined' ? require : createRequire(import.meta.url);

export interface SqlStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: bigint | number };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  close(): void;
}

interface NodeSqliteDatabaseSync {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: bigint | number };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  };
  exec(sql: string): void;
  close(): void;
}

function openNodeSqlite(dbPath: string): SqlDatabase | null {
  try {
    const mod = nodeRequire('node:sqlite') as { DatabaseSync?: new (path: string) => NodeSqliteDatabaseSync };
    if (!mod.DatabaseSync) return null;
    const db = new mod.DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    return db as unknown as SqlDatabase;
  } catch {
    return null;
  }
}

function openBetterSqlite3(dbPath: string): SqlDatabase | null {
  try {
    const mod = nodeRequire('better-sqlite3') as new (path: string) => SqlDatabase;
    const db = new mod(dbPath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    return db;
  } catch {
    return null;
  }
}

export function openSqlite(dbPath: string): SqlDatabase {
  const db = openNodeSqlite(dbPath) || openBetterSqlite3(dbPath);
  if (!db) {
    throw new Error(
      'No SQLite runtime available. This build needs Node.js ≥ 22.5 (node:sqlite) or the better-sqlite3 package.'
    );
  }
  return db;
}
