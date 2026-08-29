// Runners: node --import scripts/__mocks__/register-hooks.mjs --import tsx scripts/migrate-reservations.ts ...
// Node runs register hooks LIFO: tsx transpiles TS, our hook intercepts firebase-admin.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
