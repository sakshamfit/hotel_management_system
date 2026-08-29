// Test harness: runs a REAL script (migration or source-cleanup) against the
// in-memory Firestore mock seeded from scripts/__mocks__/seed.json.
//
//   node scripts/__mocks__/run-mock.mjs [--script migrate|fix] [args...]
//     --dump <path>   (write final store state to a JSON file)
//
// Examples:
//   node scripts/__mocks__/run-mock.mjs --report-values
//   node scripts/__mocks__/run-mock.mjs --apply
//   node scripts/__mocks__/run-mock.mjs --script fix
//   node scripts/__mocks__/run-mock.mjs --script fix --apply --dump out.json
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const args = process.argv.slice(2);

const scriptIdx = args.indexOf('--script');
let script = 'migrate';
if (scriptIdx !== -1) {
  script = args[scriptIdx + 1];
  args.splice(scriptIdx, 2);
}
const scriptFile =
  script === 'fix' ? './scripts/fix-room-source-values.ts' : './scripts/migrate-reservations.ts';

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
    scriptFile,
    ...args,
  ],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
process.exit(result.status ?? 1);
