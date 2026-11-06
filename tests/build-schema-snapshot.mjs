import { fileURLToPath } from 'node:url';
import { ensureSnapshot } from './helpers/schema-snapshot.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

const start = Date.now();
try {
  const { key, path, bytes, reused } = await ensureSnapshot(projectRoot);
  const ms = Date.now() - start;
  console.log(`snapshot: ${reused ? 'reused' : 'built'} ${key} ${path} (${bytes} B) in ${ms} ms`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
