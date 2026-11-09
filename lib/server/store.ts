import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { compareRuns, diffCounts } from '../engine/diff.ts';
import { validateRules } from '../engine/rules.ts';
import { CHECKS } from '../engine/catalog.ts';
import type { FileKind, Rule, RunResult } from '../engine/types.ts';
import type { AiResult, CaseDetail, CaseSummary, CiInfo, DiffCounts, Overview, ProjectSummary, RunDetail, RunSummary, TokenInfo } from '../types.ts';
import { openPostgres, openSqlite, type Db } from './db.ts';
import { StoreError } from './errors.ts';
import { migrate } from './schema.ts';
export { StoreError } from './errors.ts';

const now = () => new Date().toISOString();
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_PROJECTS = 20;
export const MAX_CASES = 100;
export const MAX_ACTIVE_TOKENS = 20;
/** Uploaded files are kept for the newest runs of a test case; older runs keep their report but not the file. */
export const KEEP_FILES_PER_CASE = 10;
export const KEEP_RUNS_PER_CASE = 200;
const KINDS: FileKind[] = ['xlsx', 'docx', 'pptx'];

type UserRow = { id: string; username: string; password_salt: string; password_hash: string };
type CaseRow = { id: string; project_id: string; name: string; kind: string; rules_json: string; disable_json: string; phrases_json: string;
  reference_name: string | null; reference_sha256: string | null; reference_size: number | null; reference_at: string | null; created_at: string };
type RunRow = { id: string; project_id: string; case_id: string; case_name: string; seq: number; file_name: string; file_kind: string; file_sha256: string;
  file_size: number; has_file: number | boolean; verdict: string; result_json: string; source: string; ci_json: string | null; diff_json: string | null;
  previous_seq: number | null; ai_json: string | null; created_at: string };

const RUN_SELECT = `SELECT r.id, r.project_id, r.case_id, c.name AS case_name, r.seq, r.file_name, r.file_kind, r.file_sha256, r.file_size,
  CASE WHEN r.file_bytes IS NULL THEN 0 ELSE 1 END AS has_file, r.verdict, r.result_json, r.source, r.ci_json, r.diff_json, r.previous_seq, r.ai_json, r.created_at
  FROM runs r JOIN cases c ON c.id = r.case_id`;

function cleanName(value: unknown, what: string, max = 80): string {
  const name = typeof value === 'string' ? value.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (name.length < 1 || name.length > max) throw new StoreError('invalid', `${what} must be 1 to ${max} characters`);
  return name;
}

function runSummary(row: RunRow): RunSummary {
  const result = parse<RunResult | null>(row.result_json, null);
  const ai = parse<AiResult | null>(row.ai_json, null);
  return { id: row.id, seq: row.seq, caseId: row.case_id, caseName: row.case_name, kind: row.file_kind as FileKind, fileName: row.file_name,
    verdict: row.verdict as RunSummary['verdict'], summary: result?.summary ?? { fail: 0, warn: 0, info: 0, visual: 0, ai: 0, checksRun: 0, checksPassed: 0, checksSkipped: 0 },
    source: row.source === 'ci' ? 'ci' : 'upload', ci: parse<CiInfo | null>(row.ci_json, null), createdAt: row.created_at,
    diff: parse<DiffCounts | null>(row.diff_json, null), previousSeq: row.previous_seq, aiCount: ai?.findings.length ?? 0 };
}

export type NewRun = { fileName: string; bytes: Buffer | null; fileSize: number; fileSha256: string; result: RunResult; source: 'upload' | 'ci'; ci?: CiInfo | null; tokenId?: string | null };

export class OfficeProofStore {
  readonly db: Db;
  constructor(db: Db) { this.db = db; }

  // ---------- accounts ----------

  async createUser(username: string, salt: string, passwordHash: string) {
    const id = randomUUID();
    const timestamp = now();
    try {
      await this.db.tx(async db => {
        await db.run('INSERT INTO users VALUES (?,?,?,?,?,?)', [id, username, username.toLowerCase(), salt, passwordHash, timestamp]);
        await db.run('INSERT INTO projects VALUES (?,?,?,?,?)', [randomUUID(), id, 'My first project', 1, timestamp]);
      });
    } catch (error) {
      if (/unique|constraint/i.test(error instanceof Error ? error.message : '')) throw new StoreError('conflict', 'That username is unavailable');
      throw error;
    }
    return { id, username };
  }

  findUser(username: string) {
    return this.db.get<UserRow>('SELECT id, username, password_salt, password_hash FROM users WHERE username_lower = ?', [username.toLowerCase()]);
  }

  async assertLoginAllowed(username: string) {
    const row = await this.db.get<{ locked_until: string | null }>('SELECT locked_until FROM login_attempts WHERE username_lower = ?', [username.toLowerCase()]);
    if (row?.locked_until && row.locked_until > now()) throw new StoreError('rate_limited', 'Too many attempts. Try again later.');
  }

  async recordLoginFailure(username: string) {
    const key = username.toLowerCase();
    const row = await this.db.get<{ failures: number; first_at: string }>('SELECT failures, first_at FROM login_attempts WHERE username_lower = ?', [key]);
    const recent = row && Date.now() - Date.parse(row.first_at) < 15 * 60_000;
    const failures = recent ? row.failures + 1 : 1;
    const firstAt = recent ? row.first_at : now();
    const lockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    await this.db.run(`INSERT INTO login_attempts VALUES (?,?,?,?) ON CONFLICT (username_lower)
      DO UPDATE SET failures = excluded.failures, first_at = excluded.first_at, locked_until = excluded.locked_until`, [key, failures, firstAt, lockedUntil]);
  }

  async recordLoginSuccess(username: string) {
    await this.db.run('DELETE FROM login_attempts WHERE username_lower = ?', [username.toLowerCase()]);
  }

  async createSession(userId: string, tokenHash: string, expiresAt: string) {
    await this.db.run('DELETE FROM sessions WHERE expires_at < ?', [now()]);
    await this.db.run('INSERT INTO sessions VALUES (?,?,?,?)', [tokenHash, userId, expiresAt, now()]);
  }

  async sessionUser(tokenHash: string) {
    return (await this.db.get<{ id: string; username: string }>(`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`, [tokenHash, now()])) ?? null;
  }

  async deleteSession(tokenHash: string) {
    await this.db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
  }

  // ---------- projects ----------

  /** Every project-scoped query goes through this: a project that is not the caller's does not exist for them. */
  private async project(db: Db, userId: string, projectId: string) {
    const row = await db.get<{ id: string; name: string; created_at: string }>('SELECT id, name, created_at FROM projects WHERE id = ? AND owner_id = ?', [projectId, userId]);
    if (!row) throw new StoreError('not_found', 'Project not found');
    return row;
  }

  async listProjects(userId: string): Promise<ProjectSummary[]> {
    const rows = await this.db.all<{ id: string; name: string; created_at: string; case_count: number }>(`SELECT p.id, p.name, p.created_at,
      (SELECT COUNT(*) FROM cases c WHERE c.project_id = p.id) AS case_count FROM projects p WHERE p.owner_id = ? ORDER BY p.created_at`, [userId]);
    return rows.map(row => ({ id: row.id, name: row.name, caseCount: Number(row.case_count), createdAt: row.created_at }));
  }

  async createProject(userId: string, name: unknown) {
    const clean = cleanName(name, 'A project name');
    return this.db.tx(async db => {
      const count = await db.get<{ project_count: number }>('SELECT COUNT(*) AS project_count FROM projects WHERE owner_id = ?', [userId]);
      if (Number(count?.project_count ?? 0) >= MAX_PROJECTS) throw new StoreError('invalid', `An account can have up to ${MAX_PROJECTS} projects`);
      const id = randomUUID();
      await db.run('INSERT INTO projects VALUES (?,?,?,?,?)', [id, userId, clean, 1, now()]);
      return id;
    });
  }

  async renameProject(userId: string, projectId: string, name: unknown) {
    const clean = cleanName(name, 'A project name');
    const changed = await this.db.run('UPDATE projects SET name = ? WHERE id = ? AND owner_id = ?', [clean, projectId, userId]);
    if (!changed) throw new StoreError('not_found', 'Project not found');
  }

  async overview(userId: string, projectId: string): Promise<Overview> {
    const project = await this.project(this.db, userId, projectId);
    const cases = await this.db.all<CaseRow>('SELECT id, project_id, name, kind, rules_json, disable_json, phrases_json, reference_name, reference_sha256, reference_size, reference_at, created_at FROM cases WHERE project_id = ? ORDER BY name_lower', [projectId]);
    const latest = await this.db.all<RunRow>(`${RUN_SELECT} WHERE r.project_id = ? AND r.seq = (SELECT MAX(x.seq) FROM runs x WHERE x.case_id = r.case_id)`, [projectId]);
    const byCase = new Map(latest.map(row => [row.case_id, runSummary(row)]));
    const recent = await this.db.all<RunRow>(`${RUN_SELECT} WHERE r.project_id = ? ORDER BY r.seq DESC LIMIT 8`, [projectId]);
    const rank = { fail: 0, warn: 1, pass: 2 } as const;
    const list: CaseSummary[] = cases.map(row => ({ id: row.id, name: row.name, kind: row.kind as FileKind, hasReference: Boolean(row.reference_sha256),
      ruleCount: parse<unknown[]>(row.rules_json, []).length, lastRun: byCase.get(row.id) ?? null }));
    list.sort((a, b) => (a.lastRun ? rank[a.lastRun.verdict] : 3) - (b.lastRun ? rank[b.lastRun.verdict] : 3) || a.name.localeCompare(b.name));
    return { project: { id: project.id, name: project.name, caseCount: cases.length, createdAt: project.created_at }, cases: list, recent: recent.map(runSummary) };
  }

  // ---------- test cases ----------

  async createCase(userId: string, projectId: string, input: { name: unknown; kind: unknown }): Promise<string> {
    const name = cleanName(input.name, 'A test case name', 120);
    if (!KINDS.includes(input.kind as FileKind)) throw new StoreError('invalid', 'Choose spreadsheet, document or slides');
    return this.db.tx(async db => {
      await this.project(db, userId, projectId);
      return this.insertCase(db, projectId, name, input.kind as FileKind);
    });
  }

  private async insertCase(db: Db, projectId: string, name: string, kind: FileKind) {
    const count = await db.get<{ case_count: number }>('SELECT COUNT(*) AS case_count FROM cases WHERE project_id = ?', [projectId]);
    if (Number(count?.case_count ?? 0) >= MAX_CASES) throw new StoreError('invalid', `A project can have up to ${MAX_CASES} test cases`);
    if (await db.get('SELECT id FROM cases WHERE project_id = ? AND name_lower = ?', [projectId, name.toLowerCase()])) throw new StoreError('conflict', 'A test case with that name already exists');
    const id = randomUUID(), timestamp = now();
    await db.run('INSERT INTO cases (id, project_id, name, name_lower, kind, rules_json, disable_json, phrases_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, projectId, name, name.toLowerCase(), kind, '[]', '[]', '[]', timestamp, timestamp]);
    return id;
  }

  private async caseRow(db: Db, projectId: string, caseId: string) {
    const row = await db.get<CaseRow>('SELECT id, project_id, name, kind, rules_json, disable_json, phrases_json, reference_name, reference_sha256, reference_size, reference_at, created_at FROM cases WHERE id = ? AND project_id = ?', [caseId, projectId]);
    if (!row) throw new StoreError('not_found', 'Test case not found');
    return row;
  }

  async getCase(userId: string, projectId: string, caseId: string): Promise<CaseDetail> {
    await this.project(this.db, userId, projectId);
    const row = await this.caseRow(this.db, projectId, caseId);
    const runs = await this.db.all<RunRow>(`${RUN_SELECT} WHERE r.case_id = ? ORDER BY r.seq DESC LIMIT 30`, [caseId]);
    return { id: row.id, name: row.name, kind: row.kind as FileKind, rules: parse<Rule[]>(row.rules_json, []), disable: parse<string[]>(row.disable_json, []), phrases: parse<string[]>(row.phrases_json, []),
      reference: row.reference_sha256 ? { name: row.reference_name ?? 'reference', sha256: row.reference_sha256, size: Number(row.reference_size ?? 0), updatedAt: row.reference_at ?? row.created_at } : null,
      runs: runs.map(runSummary), createdAt: row.created_at };
  }

  /** What a run needs from its test case, including the reference file. */
  async caseForRun(userId: string, projectId: string, caseId: string) {
    await this.project(this.db, userId, projectId);
    const row = await this.caseRow(this.db, projectId, caseId);
    const reference = row.reference_sha256 ? await this.db.get<{ reference_bytes: Buffer | null }>('SELECT reference_bytes FROM cases WHERE id = ?', [caseId]) : null;
    return { id: row.id, name: row.name, kind: row.kind as FileKind, rules: parse<Rule[]>(row.rules_json, []), disable: parse<string[]>(row.disable_json, []), phrases: parse<string[]>(row.phrases_json, []),
      reference: reference?.reference_bytes ? { name: row.reference_name ?? 'reference', bytes: reference.reference_bytes } : null };
  }

  async updateCase(userId: string, projectId: string, caseId: string, patch: { name?: unknown; rules?: unknown; disable?: unknown; phrases?: unknown }) {
    await this.db.tx(async db => {
      await this.project(db, userId, projectId);
      const row = await this.caseRow(db, projectId, caseId);
      const sets: string[] = [], params: (string | null)[] = [];
      if (patch.name !== undefined) {
        const name = cleanName(patch.name, 'A test case name', 120);
        if (await db.get('SELECT id FROM cases WHERE project_id = ? AND name_lower = ? AND id <> ?', [projectId, name.toLowerCase(), caseId])) throw new StoreError('conflict', 'A test case with that name already exists');
        sets.push('name = ?', 'name_lower = ?'); params.push(name, name.toLowerCase());
      }
      if (patch.rules !== undefined) {
        let rules: Rule[];
        try { rules = validateRules(row.kind as FileKind, patch.rules); } catch (error) { throw new StoreError('invalid', error instanceof Error ? error.message : 'The rules are not valid'); }
        sets.push('rules_json = ?'); params.push(json(rules));
      }
      if (patch.disable !== undefined) {
        if (!Array.isArray(patch.disable) || patch.disable.some(id => typeof id !== 'string' || CHECKS.get(id)?.kind !== row.kind)) throw new StoreError('invalid', 'Unknown check');
        sets.push('disable_json = ?'); params.push(json([...new Set(patch.disable as string[])]));
      }
      if (patch.phrases !== undefined) {
        if (!Array.isArray(patch.phrases) || patch.phrases.length > 50 || patch.phrases.some(item => typeof item !== 'string' || item.trim().length < 2 || item.length > 120)) throw new StoreError('invalid', 'Phrases must be 2 to 120 characters, up to 50 of them');
        sets.push('phrases_json = ?'); params.push(json((patch.phrases as string[]).map(item => item.trim())));
      }
      if (!sets.length) return;
      sets.push('updated_at = ?'); params.push(now());
      await db.run(`UPDATE cases SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`, [...params, caseId, projectId]);
    });
  }

  async setReference(userId: string, projectId: string, caseId: string, file: { name: string; bytes: Buffer } | null) {
    await this.db.tx(async db => {
      await this.project(db, userId, projectId);
      await this.caseRow(db, projectId, caseId);
      if (file && file.bytes.length > MAX_FILE_BYTES) throw new StoreError('invalid', 'Reference files can be up to 4 MB');
      await db.run('UPDATE cases SET reference_name = ?, reference_sha256 = ?, reference_bytes = ?, reference_size = ?, reference_at = ?, updated_at = ? WHERE id = ? AND project_id = ?',
        file ? [file.name, sha256(file.bytes), file.bytes, file.bytes.length, now(), now(), caseId, projectId] : [null, null, null, null, null, now(), caseId, projectId]);
    });
  }

  async deleteCase(userId: string, projectId: string, caseId: string) {
    await this.db.tx(async db => {
      await this.project(db, userId, projectId);
      await this.caseRow(db, projectId, caseId);
      await db.run('DELETE FROM runs WHERE case_id = ? AND project_id = ?', [caseId, projectId]);
      await db.run('DELETE FROM cases WHERE id = ? AND project_id = ?', [caseId, projectId]);
    });
  }

  /** Finds a test case by name, or creates it: a dropped file or a CI upload names its test case rather than picking an id. */
  async ensureCase(userId: string, projectId: string, name: unknown, kind: FileKind): Promise<string> {
    const clean = cleanName(name, 'A test case name', 120);
    return this.db.tx(async db => {
      await this.project(db, userId, projectId);
      return this.ensureCaseIn(db, projectId, clean, kind);
    });
  }

  private async ensureCaseIn(db: Db, projectId: string, name: string, kind: FileKind) {
    const existing = await db.get<{ id: string; kind: string }>('SELECT id, kind FROM cases WHERE project_id = ? AND name_lower = ?', [projectId, name.toLowerCase()]);
    if (existing && existing.kind !== kind) throw new StoreError('conflict', `The test case "${name}" is for ${existing.kind} files, but this file is ${kind}`);
    return existing?.id ?? this.insertCase(db, projectId, name, kind);
  }

  // ---------- runs ----------

  private async insertRun(db: Db, projectId: string, caseId: string, run: NewRun, createdBy: string | null) {
    const testCase = await this.caseRow(db, projectId, caseId);
    if (testCase.kind !== run.result.file.kind) throw new StoreError('invalid', `This test case is for ${testCase.kind} files, but the file is ${run.result.file.kind}`);
    await db.run('UPDATE projects SET next_run = next_run + 1 WHERE id = ?', [projectId]);
    const counter = await db.get<{ next_run: number }>('SELECT next_run FROM projects WHERE id = ?', [projectId]);
    const seq = Number(counter!.next_run) - 1;
    const previous = await db.get<{ seq: number; result_json: string }>('SELECT seq, result_json FROM runs WHERE case_id = ? ORDER BY seq DESC LIMIT 1', [caseId]);
    const before = previous ? parse<RunResult | null>(previous.result_json, null) : null;
    const diff = before ? diffCounts(compareRuns(before.findings, run.result.findings)) : null;
    const id = randomUUID();
    await db.run(`INSERT INTO runs (id, project_id, case_id, seq, file_name, file_kind, file_sha256, file_size, file_bytes, verdict, result_json, source, ci_json, diff_json, previous_seq, created_by, token_id, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, projectId, caseId, seq, run.fileName, run.result.file.kind, run.fileSha256, run.fileSize, run.bytes, run.result.verdict, json(run.result),
      run.source, run.ci ? json(run.ci) : null, diff ? json(diff) : null, previous?.seq ?? null, createdBy, run.tokenId ?? null, now()]);
    // Keep the newest files and a bounded history.
    const keepFile = await db.all<{ seq: number }>('SELECT seq FROM runs WHERE case_id = ? AND file_bytes IS NOT NULL ORDER BY seq DESC LIMIT 1 OFFSET ?', [caseId, KEEP_FILES_PER_CASE]);
    if (keepFile[0]) await db.run('UPDATE runs SET file_bytes = NULL WHERE case_id = ? AND seq <= ?', [caseId, keepFile[0].seq]);
    const keepRun = await db.all<{ seq: number }>('SELECT seq FROM runs WHERE case_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?', [caseId, KEEP_RUNS_PER_CASE]);
    if (keepRun[0]) await db.run('DELETE FROM runs WHERE case_id = ? AND seq <= ?', [caseId, keepRun[0].seq]);
    return { id, seq };
  }

  async createRun(userId: string, projectId: string, caseId: string, run: NewRun) {
    return this.db.tx(async db => {
      await this.project(db, userId, projectId);
      return this.insertRun(db, projectId, caseId, run, userId);
    });
  }

  /** A run reported by a pipeline. The project comes from the token, never from the request. */
  async createCiRun(token: { id: string; projectId: string }, caseName: unknown, run: NewRun) {
    const name = cleanName(caseName, 'A test case name', 120);
    return this.db.tx(async db => {
      const caseId = await this.ensureCaseIn(db, token.projectId, name, run.result.file.kind);
      return this.insertRun(db, token.projectId, caseId, { ...run, source: 'ci', tokenId: token.id }, null);
    });
  }

  async listRuns(userId: string, projectId: string, limit = 60): Promise<RunSummary[]> {
    await this.project(this.db, userId, projectId);
    const rows = await this.db.all<RunRow>(`${RUN_SELECT} WHERE r.project_id = ? ORDER BY r.seq DESC LIMIT ?`, [projectId, Math.min(Math.max(1, limit), 200)]);
    return rows.map(runSummary);
  }

  async getRun(userId: string, projectId: string, runId: string): Promise<RunDetail> {
    await this.project(this.db, userId, projectId);
    const row = await this.db.get<RunRow>(`${RUN_SELECT} WHERE r.id = ? AND r.project_id = ?`, [runId, projectId]);
    if (!row) throw new StoreError('not_found', 'Run not found');
    const result = parse<RunResult | null>(row.result_json, null);
    if (!result) throw new StoreError('not_found', 'This run has no stored report');
    const testCase = await this.caseRow(this.db, projectId, row.case_id);
    let diff: RunDetail['diff'] = null;
    if (row.previous_seq !== null) {
      const previous = await this.db.get<{ result_json: string }>('SELECT result_json FROM runs WHERE case_id = ? AND seq = ?', [row.case_id, row.previous_seq]);
      const before = previous ? parse<RunResult | null>(previous.result_json, null) : null;
      if (before) { const full = compareRuns(before.findings, result.findings); diff = { fixed: full.fixed, still: full.still.map(item => item.id), added: full.added.map(item => item.id) }; }
    }
    return { run: { ...runSummary(row), fileSha256: row.file_sha256, fileSize: Number(row.file_size), hasFile: Boolean(Number(row.has_file)) }, result, diff, ai: parse<AiResult | null>(row.ai_json, null),
      testCase: { id: testCase.id, name: testCase.name, kind: testCase.kind as FileKind, hasReference: Boolean(testCase.reference_sha256), rules: parse<Rule[]>(testCase.rules_json, []),
        disable: parse<string[]>(testCase.disable_json, []), phrases: parse<string[]>(testCase.phrases_json, []) } };
  }

  async runFile(userId: string, projectId: string, runId: string) {
    await this.project(this.db, userId, projectId);
    const row = await this.db.get<{ file_bytes: Buffer | null; file_name: string; case_id: string }>('SELECT file_bytes, file_name, case_id FROM runs WHERE id = ? AND project_id = ?', [runId, projectId]);
    if (!row) throw new StoreError('not_found', 'Run not found');
    const reference = await this.db.get<{ reference_bytes: Buffer | null }>('SELECT reference_bytes FROM cases WHERE id = ? AND project_id = ?', [row.case_id, projectId]);
    return { bytes: row.file_bytes, fileName: row.file_name, reference: reference?.reference_bytes ?? null };
  }

  async saveObservations(userId: string, projectId: string, runId: string, ai: AiResult) {
    await this.project(this.db, userId, projectId);
    const changed = await this.db.run('UPDATE runs SET ai_json = ? WHERE id = ? AND project_id = ?', [json(ai), runId, projectId]);
    if (!changed) throw new StoreError('not_found', 'Run not found');
  }

  // ---------- CI tokens ----------

  async listTokens(userId: string, projectId: string): Promise<TokenInfo[]> {
    await this.project(this.db, userId, projectId);
    const rows = await this.db.all<{ id: string; name: string; hint: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>(
      'SELECT id, name, hint, created_at, last_used_at, revoked_at FROM tokens WHERE project_id = ? ORDER BY created_at DESC LIMIT 60', [projectId]);
    return rows.map(row => ({ id: row.id, name: row.name, hint: row.hint, createdAt: row.created_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at }));
  }

  /** Returns the token once. Only its hash and its last four characters are stored. */
  async createToken(userId: string, projectId: string, name: unknown) {
    const clean = cleanName(name, 'A token name', 60);
    const token = `opl_${randomBytes(30).toString('base64url')}`;
    await this.db.tx(async db => {
      await this.project(db, userId, projectId);
      const count = await db.get<{ token_count: number }>('SELECT COUNT(*) AS token_count FROM tokens WHERE project_id = ? AND revoked_at IS NULL', [projectId]);
      if (Number(count?.token_count ?? 0) >= MAX_ACTIVE_TOKENS) throw new StoreError('invalid', `A project can have up to ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`);
      await db.run('INSERT INTO tokens (id, project_id, name, token_hash, hint, created_by, created_at) VALUES (?,?,?,?,?,?,?)', [randomUUID(), projectId, clean, sha256(token), token.slice(-4), userId, now()]);
    });
    return token;
  }

  async revokeToken(userId: string, projectId: string, tokenId: string) {
    await this.project(this.db, userId, projectId);
    const changed = await this.db.run('UPDATE tokens SET revoked_at = ? WHERE id = ? AND project_id = ? AND revoked_at IS NULL', [now(), tokenId, projectId]);
    if (!changed) throw new StoreError('not_found', 'Token not found');
  }

  async tokenProject(tokenHash: string) {
    const row = await this.db.get<{ id: string; project_id: string }>('SELECT id, project_id FROM tokens WHERE token_hash = ? AND revoked_at IS NULL', [tokenHash]);
    if (!row) return null;
    await this.db.run('UPDATE tokens SET last_used_at = ? WHERE id = ?', [now(), row.id]);
    return { id: row.id, projectId: row.project_id };
  }
}

let singleton: Promise<OfficeProofStore> | null = null;

/** The application store: Postgres when DATABASE_URL/POSTGRES_URL is set, otherwise a private local SQLite file. */
export function getStore(): Promise<OfficeProofStore> {
  if (!singleton) {
    singleton = (async () => {
      const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
      let db: Db;
      if (url) db = openPostgres(url).db;
      else {
        if (process.env.VERCEL) throw new Error('Hosted OfficeProof Lab requires DATABASE_URL or POSTGRES_URL');
        const dir = process.env.OFFICEPROOF_DATA_DIR || path.join(process.cwd(), '.officeproof-data');
        db = (await openSqlite(path.join(dir, 'officeproof.sqlite'))).db;
      }
      await migrate(db);
      return new OfficeProofStore(db);
    })();
    singleton.catch(() => { singleton = null; });
  }
  return singleton;
}
