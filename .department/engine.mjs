import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const schemaRoot = fileURLToPath(new URL('./contracts/', import.meta.url));
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const digest = text => createHash('sha256').update(text).digest('hex');
function requireThat(ok, code) { if (!ok) throw new Error(code); }

// Deliberately small, closed JSON Schema subset; no runtime dependency.
export function validate(value, schema) {
  const known = new Set(['type','const','enum','required','properties','additionalProperties','items','minItems','maxItems','minLength','maxLength','pattern','minimum','maximum']);
  requireThat(Object.keys(schema).every(k => known.has(k)), 'unsupported-schema-keyword');
  requireThat(!schema.type || ['object','array','string','integer','boolean'].includes(schema.type), 'unsupported-schema-type');
  if ('const' in schema) requireThat(value === schema.const, 'contract-constant');
  if (schema.enum) requireThat(schema.enum.includes(value), 'contract-enum');
  if (schema.type === 'object') {
    requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'contract-object');
    for (const k of schema.required ?? []) requireThat(Object.hasOwn(value, k), 'contract-required');
    for (const [k, v] of Object.entries(value)) {
      requireThat(Object.hasOwn(schema.properties ?? {}, k) || schema.additionalProperties !== false, 'contract-unknown-key');
      if (Object.hasOwn(schema.properties ?? {}, k)) validate(v, schema.properties[k]);
    }
  } else if (schema.type === 'array') {
    requireThat(Array.isArray(value), 'contract-array');
    requireThat(value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? Infinity), 'contract-array-length');
    for (const item of value) validate(item, schema.items);
  } else if (schema.type === 'string') {
    requireThat(typeof value === 'string', 'contract-string');
    requireThat(value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity), 'contract-string-length');
    if (schema.pattern) requireThat(new RegExp(schema.pattern).test(value), 'contract-pattern');
  } else if (schema.type === 'integer') {
    requireThat(Number.isSafeInteger(value) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity), 'contract-integer');
  } else if (schema.type === 'boolean') requireThat(typeof value === 'boolean', 'contract-boolean');
}
export function contract(name, value) { validate(value, readJson(path.join(schemaRoot, `${name}.schema.json`))); return value; }

export function safePath(root, relative) {
  requireThat(typeof relative === 'string' && relative.length > 0 && !relative.includes('\\') && !relative.includes(':') && !relative.startsWith('/'), 'unsafe-path');
  const parts = relative.split('/');
  requireThat(parts.every(p => p && p !== '.' && p !== '..'), 'unsafe-path');
  let current = fs.realpathSync(root);
  for (const part of parts) {
    current = path.join(current, part);
    try { requireThat(!fs.lstatSync(current).isSymbolicLink(), 'symlink-denied'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return current;
}
export function scan(text) {
  const patterns = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/, /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/, /\bAKIA[A-Z0-9]{16}\b/, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/];
  requireThat(!patterns.some(p => p.test(text)), 'possible-secret-blocked');
}
export function git(root, args, allowedExit = [0], timeout = 10000) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE)$/i.test(k)));
  Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' });
  const result = spawnSync('git', ['-c','core.fsmonitor=false', ...args], { cwd: root, env, encoding:'utf8', timeout, maxBuffer:1024 * 1024, windowsHide:true, shell:false });
  requireThat(!result.error && allowedExit.includes(result.status), 'git-check-failed');
  return { text:result.stdout, status:result.status };
}
export function changedPaths(root) {
  return [...new Set([
    ...git(root, ['diff','--no-ext-diff','--no-textconv','--name-only','-z','HEAD']).text.split('\0'),
    ...git(root, ['ls-files','--others','--exclude-standard','-z']).text.split('\0')
  ].filter(Boolean))].sort();
}
export function scopeGate(root, scope) {
  const changed = changedPaths(root);
  requireThat(changed.every(p => scope.includes(p)), 'out-of-scope-change');
  for (const p of changed) scan(fs.readFileSync(safePath(root, p), 'utf8'));
  return changed;
}
export function registries(root) {
  return Object.fromEntries(['workers','tools','gates','routing'].map(name => [name, readJson(safePath(root, `.department/registries/${name}.json`))]));
}
export function validatePolicy(task, registry) {
  contract('task', task);
  scan(JSON.stringify(task));
  const route = registry.routing[task.kind];
  requireThat(route?.risk === 'low' && route.worker === 'local-hygiene', 'route-denied');
  const worker = registry.workers[route.worker];
  requireThat(worker?.enabled === true && worker.adapter === 'builtin-ignore-supabase-temp' && worker.newCostUsd === 0 && worker.maxAttempts === 1, 'worker-denied');
  requireThat(JSON.stringify(task.scope) === JSON.stringify(['.gitignore']) && JSON.stringify(route.scope) === JSON.stringify(task.scope), 'scope-denied');
  requireThat(task.context.every(p => ['AGENTS.md','CLAUDE.md','.gitignore'].includes(p)), 'context-denied');
  requireThat(new Set(task.context).size === task.context.length, 'duplicate-context');
  requireThat(JSON.stringify(route.gates) === JSON.stringify(['scope','secret-scan','whitespace','supabase-temp-ignore']), 'gate-policy-denied');
  requireThat(route.gates.every(id => registry.gates[id]?.required === true), 'gate-missing');
  requireThat(registry.tools.node.major === 22 && Number(process.versions.node.split('.')[0]) >= 22, 'node-version-denied');
  requireThat(registry.tools.node.network === false && registry.tools.git.network === false, 'network-denied');
  requireThat(worker.model === 'none' && JSON.stringify(worker.permissions) === JSON.stringify(['write:.gitignore']), 'worker-permissions-denied');
  requireThat(registry.tools.node.newCostUsd === 0 && registry.tools.git.newCostUsd === 0, 'cost-denied');
  return route;
}
export function preflight(root, task, registry = registries(root)) {
  const route = validatePolicy(task, registry);
  const branch = git(root, ['rev-parse','--abbrev-ref','HEAD']).text.trim();
  requireThat(/^department\/[a-z0-9-]+$/.test(branch), 'branch-denied');
  requireThat(path.resolve(git(root, ['rev-parse','--show-toplevel']).text.trim()) === path.resolve(root), 'repo-root-mismatch');
  requireThat(changedPaths(root).length === 0, 'dirty-checkout');
  const baseCommit = git(root, ['rev-parse','HEAD']).text.trim();
  const files = task.context.map(p => {
    requireThat(git(root, ['ls-files','--error-unmatch','--',p]).status === 0, 'context-untracked');
    const filename = safePath(root, p);
    requireThat(fs.statSync(filename).size <= 50000, 'context-too-large');
    const text = fs.readFileSync(filename, 'utf8');
    scan(text);
    return { path:p, sha256:digest(text), text };
  });
  return { route, context:contract('context', { version:1, taskId:task.id, baseCommit, files }) };
}

const transitions = { queued:['validated','blocked'], validated:['running','blocked'], running:['checking','failed'], checking:['completed','failed'] };
export function transition(report, next) {
  const from = report.events.at(-1)?.to ?? 'queued';
  requireThat(transitions[from]?.includes(next), 'invalid-transition');
  report.events.push({ from, to:next, at:new Date().toISOString() });
}
export function ignoreSupabaseTemp(root) {
  const file = safePath(root, '.gitignore');
  const before = fs.readFileSync(file, 'utf8');
  if (before.split(/\r?\n/).includes('/supabase/.temp/')) return;
  const nl = before.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(file, before + (before.endsWith('\n') ? '' : nl) + `${nl}# Supabase CLI generated local metadata${nl}/supabase/.temp/${nl}`);
}
export function ignoreGate(root) {
  requireThat(git(root, ['check-ignore','--no-index','--','supabase/.temp/department-probe']).status === 0, 'temp-not-ignored');
  requireThat(git(root, ['check-ignore','--no-index','--','supabase/migrations/department-probe.sql'], [0,1]).status === 1, 'migration-ignored');
}
export function run(root, task) {
  // Validate before using task-controlled paths or creating state.
  contract('task', task);
  const local = safePath(root, '.department/local');
  fs.mkdirSync(local, {recursive:true});
  const stateFile = safePath(root, `.department/local/${task.id}.report.json`);
  const baseCommit = git(root, ['rev-parse','HEAD']).text.trim();
  const lock = safePath(root, '.department/local/run.lock');
  let lockFd;
  try { lockFd = fs.openSync(lock, 'wx'); } catch { throw new Error('active-or-stale-lock'); }
  const report = { version:1, taskId:task.id, status:'blocked', baseCommit, worker:'local-hygiene', attempts:0, newCostUsd:0, changedFiles:[], gates:[], events:[], summary:'' };
  const save = () => {
    const temporary = safePath(root, `.department/local/${task.id}.report.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n');
    fs.renameSync(temporary, stateFile);
  };
  try {
    requireThat(!fs.existsSync(stateFile), 'task-already-attempted');
    const {route, context} = preflight(root, task);
    const start = Date.now();
    const withinBudget = () => requireThat(Date.now() - start < task.budget.timeoutSeconds * 1000, 'time-budget-exhausted');
    transition(report, 'validated'); save();
    fs.writeFileSync(safePath(root, `.department/local/${task.id}.context.json`), JSON.stringify(context, null, 2) + '\n');
    withinBudget();
    transition(report, 'running'); report.attempts = 1; save();
    ignoreSupabaseTemp(root);
    transition(report, 'checking'); save();
    for (const id of route.gates) {
      withinBudget();
      let passed = false;
      try {
        if (id === 'scope') report.changedFiles = scopeGate(root, task.scope);
        if (id === 'secret-scan') for (const p of report.changedFiles) scan(fs.readFileSync(safePath(root, p), 'utf8'));
        if (id === 'whitespace') git(root, ['diff','--no-ext-diff','--check','HEAD']);
        if (id === 'supabase-temp-ignore') ignoreGate(root);
        passed = true;
      } finally { report.gates.push({id, passed}); save(); }
    }
    withinBudget();
    transition(report, 'completed'); report.status = 'completed';
    report.summary = 'Supabase CLI temporary metadata is ignored; migrations remain tracked. No network, database, deployment or new spend.';
  } catch (error) {
    if (error.message === 'task-already-attempted') throw error;
    const current = report.events.at(-1)?.to ?? 'queued';
    report.status = ['queued','validated'].includes(current) ? 'blocked' : 'failed';
    transition(report, report.status);
    // Errors are deliberately coded: never echo source text, credentials or subprocess logs.
    report.summary = /^[a-z-]+$/.test(error.message) ? error.message : 'execution-failed';
  } finally {
    try { if (report.events.length) save(); }
    finally { fs.closeSync(lockFd); fs.unlinkSync(lock); }
  }
  contract('report', report);
  return report;
}
