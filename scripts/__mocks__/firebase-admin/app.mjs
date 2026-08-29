// Minimal firebase-admin/app mock — returns a fake app; the real script only
// needs the Admin SDK for Firestore calls, which are mocked separately.
export function initializeApp() {
  const app = { name: '[mock-app]' };
  apps.push(app);
  return app;
}
export function getApps() {
  return apps;
}
export function applicationDefault() {
  return { _mock: 'applicationDefault' };
}
export function cert(sa) {
  return { _mock: 'cert', sa };
}
const apps = [];
