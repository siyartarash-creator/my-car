import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contract, validate, safePath, scan, git, preflight, registries, run, scopeGate, transition } from '../engine.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const task = JSON.parse(fs.readFileSync(path.join(source, 'tasks/pilot-ignore-supabase-temp.json'), 'utf8'));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mycar-department-'));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('mycar-department-'));
    fs.rmSync(resolved, {recursive:true, force:true});
  });
  fs.mkdirSync(path.join(root, '.department'));
  fs.cpSync(path.join(source, 'registries'), path.join(root, '.department/registries'), {recursive:true});
  fs.writeFileSync(path.join(root, '.gitignore'), '/.department/local/\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Local fixture rules.\n');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '@AGENTS.md\n');
  git(root, ['init','-b','department/test']);
  git(root, ['add','.']);
  git(root, ['-c','user.name=Department Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture']);
  return root;
}

test('closed contract denies unknown keys and privilege escalation', () => {
  for (const bad of [{...task, command:'echo injected'}, {...task, budget:{...task.budget,newCostUsd:1}}, {...task, permissions:{...task.permissions,production:true}}, {...task, permissions:{...task.permissions,network:true}}, {...task, budget:{...task.budget,maxAttempts:2}}]) {
    assert.throws(() => contract('task', bad));
  }
  assert.throws(() => contract('task', {...task,id:'../../outside'}));
  assert.throws(() => validate({}, {unsupported:true}));
});
test('unsafe and escaping paths are rejected', t => {
  const root = fixture(t);
  for (const p of ['../outside','/tmp/x','C:/x','a\\b','a/../b','a//b','.']) assert.throws(() => safePath(root, p), /unsafe-path/);
});
test('directory symlinks cannot escape context/state boundaries', t => {
  const root = fixture(t);
  fs.symlinkSync(path.join(root, '.department'), path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => safePath(root, 'link/registries'), /symlink-denied/);
});
test('main cannot execute a worker', t => {
  const root = fixture(t);
  git(root, ['branch','-m','main']);
  assert.throws(() => preflight(root, task), /branch-denied/);
});
test('dirty tracked and untracked files block before writes', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root,'unrelated.txt'), 'preserve me');
  const before = fs.readFileSync(path.join(root,'.gitignore'),'utf8');
  const report = run(root, task);
  assert.equal(report.status, 'blocked');
  assert.equal(report.attempts, 0);
  assert.equal(fs.readFileSync(path.join(root,'.gitignore'),'utf8'), before);
});
test('context must be admitted and scoped', t => {
  const root = fixture(t);
  assert.throws(() => preflight(root, {...task,context:['.env.local']}), /context-denied/);
  assert.throws(() => preflight(root, {...task,scope:['lib/']}), /scope-denied/);
});
test('unknown/disabled workers and missing gates fail closed', t => {
  const root = fixture(t);
  const config = registries(root);
  config.workers['local-hygiene'].enabled = false;
  assert.throws(() => preflight(root,task,config), /worker-denied/);
  config.workers['local-hygiene'].enabled = true;
  config.routing['repository-hygiene'].gates.pop();
  assert.throws(() => preflight(root,task,config), /gate-policy-denied/);
});
test('likely credentials are rejected without echoing their value', () => {
  const secret = 'gh' + 'p_' + 'A'.repeat(36);
  assert.throws(() => scan(secret), e => e.message === 'possible-secret-blocked' && !e.message.includes(secret));
  scan('Only ordinary repository documentation.');
});
test('context credential detection prevents worker execution', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root,'AGENTS.md'), 'gh' + 'p_' + 'B'.repeat(36));
  git(root, ['add','AGENTS.md']);
  git(root, ['-c','user.name=Department Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','synthetic fixture']);
  const report = run(root,task);
  assert.equal(report.status,'blocked');
  assert.equal(report.attempts,0);
  assert.equal(report.summary,'possible-secret-blocked');
});
test('scope gate detects unexpected tracked/untracked edits', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root,'AGENTS.md'),'changed');
  assert.throws(() => scopeGate(root, ['.gitignore']), /out-of-scope-change/);
});
test('state transitions cannot skip checking or leave terminal states', () => {
  const report = {events:[]};
  assert.throws(() => transition(report,'completed'), /invalid-transition/);
  for (const state of ['validated','running','checking','completed']) transition(report,state);
  assert.throws(() => transition(report,'running'), /invalid-transition/);
});
test('pilot produces a real change, context hashes, ordered evidence and zero new cost', t => {
  const root = fixture(t);
  const report = run(root,task);
  assert.equal(report.status,'completed');
  assert.equal(report.attempts,1);
  assert.equal(report.newCostUsd,0);
  assert.deepEqual(report.changedFiles,['.gitignore']);
  assert.deepEqual(report.events.map(e=>e.to),['validated','running','checking','completed']);
  assert.ok(report.gates.length === 4 && report.gates.every(g=>g.passed));
  const context = JSON.parse(fs.readFileSync(path.join(root,`.department/local/${task.id}.context.json`),'utf8'));
  contract('context',context);
  assert.equal(context.baseCommit,report.baseCommit);
  assert.equal(fs.existsSync(path.join(root,'.department/local/run.lock')),false);
});
test('same task cannot rerun or overwrite its audit report', t => {
  const root = fixture(t);
  run(root,task);
  const file = path.join(root,`.department/local/${task.id}.report.json`);
  const original = fs.readFileSync(file,'utf8');
  assert.throws(() => run(root,task), /task-already-attempted/);
  assert.equal(fs.readFileSync(file,'utf8'),original);
  assert.equal(fs.existsSync(path.join(root,'.department/local/run.lock')),false);
});
test('concurrent or crashed runs require operator reconciliation', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root,'.department/local'));
  fs.writeFileSync(path.join(root,'.department/local/run.lock'),'');
  assert.throws(() => run(root,task), /active-or-stale-lock/);
});
test('already ignored directory is an idempotent successful worker result', t => {
  const root = fixture(t);
  fs.appendFileSync(path.join(root,'.gitignore'), '/supabase/.temp/\n');
  git(root,['add','.gitignore']);
  git(root,['-c','user.name=Department Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','ignore fixture']);
  const report = run(root,task);
  assert.equal(report.status,'completed');
  assert.deepEqual(report.changedFiles,[]);
});
test('a failed acceptance gate records failure and never reports delivery', t => {
  const root = fixture(t);
  fs.appendFileSync(path.join(root,'.gitignore'), '/supabase/migrations/\n');
  git(root,['add','.gitignore']);
  git(root,['-c','user.name=Department Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','bad ignore fixture']);
  const report = run(root,task);
  assert.equal(report.status,'failed');
  assert.equal(report.events.at(-1).to,'failed');
  assert.deepEqual(report.gates.at(-1),{id:'supabase-temp-ignore',passed:false});
  assert.ok(fs.readFileSync(path.join(root,'.gitignore'),'utf8').includes('/supabase/.temp/'));
});
test('dangling directory links are also rejected', t => {
  const root = fixture(t);
  fs.symlinkSync(path.join(root,'missing'), path.join(root,'dangling'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => safePath(root,'dangling/new-file'), /symlink-denied/);
});
