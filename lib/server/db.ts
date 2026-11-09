/**
 * One small async database interface over two drivers:
 * - local development: node:sqlite (a private file under .officeproof-data/)
 * - hosted (Vercel): PostgreSQL through `pg` (DATABASE_URL or POSTGRES_URL)
 *
 * Queries are written once with `?` placeholders and portable SQL; the Postgres driver rewrites the
 * placeholders to $1, $2, ... Only the schema (see schema.ts) differs between the two.
 */
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export type Dialect = 'sqlite' | 'postgres';
export type Param = string | number | null | Buffer;
export interface Db {
  readonly dialect: Dialect;
  all<T>(sql: string, params?: Param[]): Promise<T[]>;
  get<T>(sql: string, params?: Param[]): Promise<T | undefined>;
  run(sql: string, params?: Param[]): Promise<number>;
  exec(sql: string): Promise<void>;
  /** Runs `fn` in a transaction. Nested calls reuse the outer transaction. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

/** Serialises access so an open SQLite transaction is never interleaved with another request. */
class Mutex {
  private tail = Promise.resolve();
  lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

type SqliteDatabase = {
  prepare(sql: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown; run(...p: unknown[]): { changes: number | bigint } };
  exec(sql: string): void;
  close(): void;
};

function sqliteValue(value: Param) {
  return Buffer.isBuffer(value) ? new Uint8Array(value) : value;
}

function sqliteRow<T>(row: unknown): T {
  if (!row || typeof row !== 'object') return row as T;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    out[key] = value instanceof Uint8Array ? Buffer.from(value) : typeof value === 'bigint' ? Number(value) : value;
  }
  return out as T;
}

class SqliteDb implements Db {
  readonly dialect = 'sqlite' as const;
  private readonly db: SqliteDatabase;
  private readonly mutex: Mutex;
  private readonly inTx: boolean;
  constructor(db: SqliteDatabase, mutex: Mutex, inTx = false) { this.db = db; this.mutex = mutex; this.inTx = inTx; }

  private guard<T>(fn: () => T): Promise<T> {
    return this.inTx ? Promise.resolve().then(fn) : this.mutex.lock(async () => fn());
  }
  all<T>(sql: string, params: Param[] = []) { return this.guard(() => this.db.prepare(sql).all(...params.map(sqliteValue)).map(sqliteRow<T>)); }
  get<T>(sql: string, params: Param[] = []) {
    return this.guard(() => { const row = this.db.prepare(sql).get(...params.map(sqliteValue)); return row === undefined ? undefined : sqliteRow<T>(row); });
  }
  run(sql: string, params: Param[] = []) { return this.guard(() => Number(this.db.prepare(sql).run(...params.map(sqliteValue)).changes)); }
  exec(sql: string) { return this.guard(() => { this.db.exec(sql); }); }
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    return this.mutex.lock(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(new SqliteDb(this.db, this.mutex, true));
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    });
  }
}

function pgSql(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function pgRow<T>(row: Record<string, unknown>): T {
  // BIGINT columns arrive as strings from `pg`; every BIGINT here is a safe integer (sizes, counts).
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key] = typeof value === 'string' && /_(size|count|seq|run)$/.test(key) && /^-?\d+$/.test(value) ? Number(value) : value;
  return out as T;
}

type Queryable = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };

class PostgresDb implements Db {
  readonly dialect = 'postgres' as const;
  private readonly client: Queryable;
  private readonly pool: pg.Pool | null;
  constructor(client: Queryable, pool: pg.Pool | null) { this.client = client; this.pool = pool; }
  async all<T>(sql: string, params: Param[] = []) { return (await this.client.query(pgSql(sql), params)).rows.map(pgRow<T>); }
  async get<T>(sql: string, params: Param[] = []) { const rows = await this.all<T>(sql, params); return rows[0]; }
  async run(sql: string, params: Param[] = []) { return (await this.client.query(pgSql(sql), params)).rowCount ?? 0; }
  async exec(sql: string) { await this.client.query(sql); }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (!this.pool) return fn(this);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PostgresDb(client, null));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function openSqlite(file: string): Promise<{ db: Db; close: () => void }> {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Imported lazily so the hosted (Postgres) build never loads node:sqlite.
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(file, { timeout: 5000 }) as unknown as SqliteDatabase;
  if (file !== ':memory:') { try { chmodSync(file, 0o600); } catch { /* inherited permissions on Windows */ } }
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  return { db: new SqliteDb(raw, new Mutex()), close: () => raw.close() };
}

export function openPostgres(connectionString: string): { db: Db; close: () => Promise<void> } {
  const url = new URL(connectionString);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!local) url.searchParams.set('sslmode', 'verify-full');
  const pool = new pg.Pool({ connectionString: url.toString(), max: 3, connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000, ssl: local ? undefined : { rejectUnauthorized: true } });
  return { db: new PostgresDb(pool, pool), close: () => pool.end() };
}
