import type { Db } from './db.ts';

export const SCHEMA_VERSION = 1;

/** Table definitions. `BLOB`/`BIGINT` are swapped for the dialect; everything else is portable. */
function tables(blob: string) {
  return `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL, username_lower TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (username_lower TEXT PRIMARY KEY, failures INTEGER NOT NULL,
  first_at TEXT NOT NULL, locked_until TEXT);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  next_run INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id, created_at);
CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
  name_lower TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('xlsx','docx','pptx')), rules_json TEXT NOT NULL,
  disable_json TEXT NOT NULL, phrases_json TEXT NOT NULL, reference_name TEXT, reference_sha256 TEXT, reference_bytes ${blob},
  reference_size BIGINT, reference_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (project_id, name_lower));
CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE, hint TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  last_used_at TEXT, revoked_at TEXT);
CREATE INDEX IF NOT EXISTS tokens_project ON tokens(project_id, created_at);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  case_id TEXT NOT NULL REFERENCES cases(id), seq INTEGER NOT NULL, file_name TEXT NOT NULL, file_kind TEXT NOT NULL,
  file_sha256 TEXT NOT NULL, file_size BIGINT NOT NULL, file_bytes ${blob}, verdict TEXT NOT NULL CHECK (verdict IN ('pass','warn','fail')),
  result_json TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('upload','ci')), ci_json TEXT, diff_json TEXT,
  previous_seq INTEGER, ai_json TEXT, created_by TEXT REFERENCES users(id), token_id TEXT REFERENCES tokens(id),
  created_at TEXT NOT NULL, UNIQUE (project_id, seq));
CREATE INDEX IF NOT EXISTS runs_case ON runs(case_id, seq);
`;
}

export async function migrate(db: Db) {
  if (db.dialect === 'sqlite') {
    const row = await db.get<{ user_version: number }>('PRAGMA user_version');
    const version = row?.user_version ?? 0;
    if (version > SCHEMA_VERSION) throw new Error('The OfficeProof database is newer than this application');
    if (version < 1) {
      await db.tx(async tx => {
        await tx.exec(tables('BLOB').replaceAll('BIGINT', 'INTEGER'));
        await tx.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    }
    return;
  }
  await db.tx(async tx => {
    await tx.exec('SELECT pg_advisory_xact_lock(4207733)');
    await tx.exec(tables('BYTEA'));
  });
}
