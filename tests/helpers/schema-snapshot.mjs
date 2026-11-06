import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Bump when the shim SQL or the tarball layout changes, so old caches miss.
const FORMAT_VERSION = 1;

const SHIM_SQL = `create role anon; create role authenticated; create schema auth; create schema storage;
create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security; grant usage on schema storage to anon,authenticated;
grant select,insert,update,delete on storage.objects to anon,authenticated;`;

function migrationsDir(projectRoot) {
  return path.join(projectRoot, 'supabase/migrations');
}

function migrationFiles(projectRoot) {
  return fs.readdirSync(migrationsDir(projectRoot)).sort();
}

function pgliteVersion(projectRoot) {
  const pkg = JSON.parse(fs.readFileSync(
    path.join(projectRoot, 'node_modules/@electric-sql/pglite/package.json'), 'utf8'));
  return pkg.version;
}

function computeKey(projectRoot) {
  const hash = crypto.createHash('sha256');
  hash.update(`format:${FORMAT_VERSION}\n`);
  hash.update(`pglite:${pgliteVersion(projectRoot)}\n`);
  for (const f of migrationFiles(projectRoot)) {
    hash.update(`file:${f}\n`);
    hash.update(fs.readFileSync(path.join(migrationsDir(projectRoot), f)));
  }
  return hash.digest('hex').slice(0, 16);
}

function paths(projectRoot) {
  const key = computeKey(projectRoot);
  const cacheDir = path.join(projectRoot, 'node_modules/.cache/mycar');
  const tarPath = path.join(cacheDir, `pglite-schema-${key}.tar.gz`);
  const sidecarPath = `${tarPath}.json`;
  return { key, cacheDir, tarPath, sidecarPath };
}

function readSidecarKey(sidecarPath) {
  try {
    return JSON.parse(fs.readFileSync(sidecarPath, 'utf8')).key;
  } catch {
    return null;
  }
}

export function snapshotPath(projectRoot) {
  return paths(projectRoot).tarPath;
}

export async function buildSnapshot(projectRoot) {
  const { key, cacheDir, tarPath, sidecarPath } = paths(projectRoot);
  const db = new PGlite();
  await db.exec(SHIM_SQL);
  for (const f of migrationFiles(projectRoot)) {
    await db.exec(fs.readFileSync(path.join(migrationsDir(projectRoot), f), 'utf8'));
  }
  const blob = await db.dumpDataDir('gzip');
  const buffer = Buffer.from(await blob.arrayBuffer());
  await db.close();
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(tarPath, buffer);
  fs.writeFileSync(sidecarPath, JSON.stringify({ key }) + '\n');
  return { key, path: tarPath, bytes: buffer.length };
}

export async function ensureSnapshot(projectRoot) {
  const { key, tarPath, sidecarPath } = paths(projectRoot);
  if (readSidecarKey(sidecarPath) === key && fs.existsSync(tarPath)) {
    return { key, path: tarPath, bytes: fs.statSync(tarPath).size, reused: true };
  }
  const built = await buildSnapshot(projectRoot);
  return { ...built, reused: false };
}

export async function openSchemaDb(projectRoot) {
  const { key, tarPath, sidecarPath } = paths(projectRoot);
  if (readSidecarKey(sidecarPath) !== key || !fs.existsSync(tarPath)) {
    throw new Error(
      'schema snapshot missing or stale for the current migrations -- run: node tests/build-schema-snapshot.mjs'
    );
  }
  const buffer = fs.readFileSync(tarPath);
  return new PGlite({ loadDataDir: new Blob([buffer]) });
}

// Replays every migration file except the ones named in `exclude` into a
// FRESH in-memory PGlite -- no cache read, no cache write (the cache keyed
// by computeKey() is for the full, unfiltered migration set only; writing a
// sidecar for a filtered build would let a later openSchemaDb() mistake a
// partial schema for the real one). Used by rollback-fidelity tests that
// need a "one migration earlier" database to diff against the real one.
export async function buildSchemaDb(projectRoot, { exclude = [] } = {}) {
  const db = new PGlite();
  await db.exec(SHIM_SQL);
  for (const f of migrationFiles(projectRoot)) {
    if (exclude.includes(f)) continue;
    await db.exec(fs.readFileSync(path.join(migrationsDir(projectRoot), f), 'utf8'));
  }
  return db;
}
