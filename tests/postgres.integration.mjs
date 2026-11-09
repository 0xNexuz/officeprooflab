// Runs the store against a real Postgres database, in a schema that is created for the test and dropped afterwards.
// usage: OFFICEPROOF_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/db npm run test:postgres
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { runChecks } from '../lib/engine/index.ts';
import { openPostgres } from '../lib/server/db.ts';
import { rebuildCiResult } from '../lib/server/execute.ts';
import { migrate } from '../lib/server/schema.ts';
import { OfficeProofStore } from '../lib/server/store.ts';

const base = process.env.OFFICEPROOF_TEST_DATABASE_URL;
if (!base) { console.error('Set OFFICEPROOF_TEST_DATABASE_URL to a Postgres database that is safe to test against.'); process.exit(2); }

const sample = (name) => readFileSync(new URL(`../samples/${name}`, import.meta.url));
const resultFor = async (bytes, name) => (await runChecks({ name, bytes: new Uint8Array(bytes) })).result;
const newRun = (bytes, result, extra = {}) => ({ fileName: result.file.name, bytes, fileSize: bytes.length, fileSha256: result.file.sha256, result, source: 'upload', ...extra });

const schema = `opl_test_${Date.now().toString(36)}`;
const admin = new pg.Client({ connectionString: base });
await admin.connect();
await admin.query(`CREATE SCHEMA ${schema}`);
const url = new URL(base);
url.searchParams.set('options', `-c search_path=${schema}`);
const { db, close } = openPostgres(url.toString());
let step = '';
const done = (text) => console.log(`ok  ${text}`);

try {
  step = 'the schema is created once, even when two instances start together';
  await Promise.all([migrate(db), migrate(db)]);
  await migrate(db);
  done(step);
  const store = new OfficeProofStore(db);

  step = 'accounts and isolation';
  const amara = await store.createUser('amara', 'aa', 'bb'), tobi = await store.createUser('tobi', 'aa', 'bb');
  await assert.rejects(store.createUser('AMARA', 'aa', 'bb'), /unavailable/);
  const [project] = await store.listProjects(amara.id);
  const caseId = await store.createCase(amara.id, project.id, { name: 'Workbook', kind: 'xlsx' });
  await assert.rejects(store.getCase(tobi.id, project.id, caseId), /not found/i);
  await assert.rejects(store.overview(tobi.id, project.id), /not found/i);
  done(step);

  step = 'runs: numbering, the file kept byte for byte, and the comparison with the run before';
  const broken = sample('generated/revenue-summary.xlsx'), fixed = sample('fixed/revenue-summary.xlsx');
  const first = await store.createRun(amara.id, project.id, caseId, newRun(broken, await resultFor(broken, 'revenue-summary.xlsx')));
  const second = await store.createRun(amara.id, project.id, caseId, newRun(fixed, await resultFor(fixed, 'revenue-summary.xlsx')));
  assert.deepEqual([first.seq, second.seq], [1, 2]);
  const detail = await store.getRun(amara.id, project.id, second.id);
  assert.equal(detail.run.verdict, 'pass');
  assert.equal(detail.run.diff.fixed, 7);
  const kept = await store.runFile(amara.id, project.id, first.id);
  assert.equal(createHash('sha256').update(kept.bytes).digest('hex'), createHash('sha256').update(broken).digest('hex'));
  await assert.rejects(store.runFile(tobi.id, project.id, first.id), /not found/i);
  done(step);

  step = 'runs that arrive at the same moment get different numbers';
  const result = await resultFor(fixed, 'revenue-summary.xlsx');
  const burst = await Promise.all(Array.from({ length: 6 }, () => store.createRun(amara.id, project.id, caseId, newRun(fixed, result))));
  assert.deepEqual(burst.map(run => run.seq).sort((a, b) => a - b), [3, 4, 5, 6, 7, 8]);
  done(step);

  step = 'pipeline tokens: stored hashed, a run arrives through one, and a revoked token is dead';
  const token = await store.createToken(amara.id, project.id, 'github-actions');
  const stored = await db.all('SELECT token_hash, hint FROM tokens');
  assert.equal(JSON.stringify(stored).includes(token), false);
  const hash = createHash('sha256').update(token).digest('hex');
  const owner = await store.tokenProject(hash);
  assert.equal(owner.projectId, project.id);
  const letter = sample('generated/client-statement.docx');
  const rebuilt = rebuildCiResult(await resultFor(letter, 'client-statement.docx'), 'client-statement.docx');
  const ciRun = await store.createCiRun(owner, 'Client statement letter', { fileName: 'client-statement.docx', bytes: letter, fileSize: letter.length, fileSha256: rebuilt.file.sha256, result: rebuilt, source: 'ci', ci: { provider: 'CI', commit: 'a1b2c3d', branch: 'main', runUrl: '' } });
  assert.equal((await store.getRun(amara.id, project.id, ciRun.id)).run.verdict, 'fail');
  const [listed] = await store.listTokens(amara.id, project.id);
  await store.revokeToken(amara.id, project.id, listed.id);
  assert.equal(await store.tokenProject(hash), null);
  done(step);

  step = 'the overview lists both test cases with their latest run';
  const overview = await store.overview(amara.id, project.id);
  assert.equal(overview.cases.length, 2);
  assert.equal(overview.cases.find(item => item.name === 'Workbook').lastRun.seq, 8);
  done(step);
  console.log('\nPostgres: all steps passed');
} catch (error) {
  console.error(`FAILED at: ${step}\n`, error);
  process.exitCode = 1;
} finally {
  await close();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
