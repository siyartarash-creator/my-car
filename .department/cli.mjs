import fs from 'node:fs';
import { contract, readJson, run, safePath, scan, registries, validatePolicy } from './engine.mjs';

const root = process.cwd();
try {
  const [command, name, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('unexpected-arguments');
  if (command === 'validate' && !name) {
    const registry = registries(root);
    const dir = safePath(root, '.department/tasks');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const task = contract('task', readJson(safePath(root, `.department/tasks/${file}`)));
      scan(JSON.stringify(task));
      validatePolicy(task, registry);
    }
    console.log(`PASS: ${files.length} task contract(s)`);
  } else if (command === 'run' && /^[a-z][a-z0-9-]{2,63}$/.test(name ?? '')) {
    const task = readJson(safePath(root, `.department/tasks/${name}.json`));
    if (task.id !== name) throw new Error('task-id-mismatch');
    const report = run(root, task);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'completed') process.exitCode = 1;
  } else throw new Error('usage-validate-or-run-task-id');
} catch (error) {
  console.error(/^[a-z-]+$/.test(error.message) ? error.message : 'department-command-failed');
  process.exitCode = 1;
}
