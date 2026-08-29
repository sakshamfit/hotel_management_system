// Test harness: runs the REAL migration script against the in-memory Firestore
// mock seeded from scripts/__mocks__/seed.json.
//
//   node scripts/__mocks__/run-mock.mjs [args...] [-- <extra env>]
//     env: MOCK_DUMP=/path/dump.json   (write final store state)
//
// Example:
//   node scripts/__mocks__/run-mock.mjs --report-values
//   node scripts/__mocks__/run-mock.mjs --apply
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const dumpArgIdx = args.indexOf('--dump');
let dumpPath;
if (dumpArgIdx !== -1) {
  dumpPath = resolve(repoRoot, args[dumpArgIdx + 1]);
  args.splice(dumpArgIdx, 2);
}

const env = {
  ...process.env,
  MOCK_FIRESTORE_SEED: resolve(__dirname, 'seed.json'),
};
if (dumpPath) env.MOCK_FIRESTORE_DUMP = dumpPath;

const result = spawnSync(
  process.execPath,
  [
    '--import',
    './scripts/__mocks__/register-hooks.mjs',
    '--import',
    'tsx',
    './scripts/migrate-reservations.ts',
    ...args,
  ],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
process.exit(result.status ?? 1);
