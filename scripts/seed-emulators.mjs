// This script has no production endpoint or credentials.
const base = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/';
const email = 'suryansh@gmail.com';
const password = 'local-dev-password';
async function request(method, body, admin = false) {
  const response = await fetch(base + method + '?key=demo-coco-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer owner' } : {}) },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Emulator setup failed');
  return data;
}
let account;
try { account = await request('accounts:signUp', { email, password, displayName: 'Local Teammate', returnSecureToken: true }); }
catch (error) {
  if (!error.message.includes('EMAIL_EXISTS')) throw error;
  account = await request('accounts:signInWithPassword', { email, password, returnSecureToken: true });
}
await request('accounts:update', { localId: account.localId, emailVerified: true, displayName: 'Local Teammate' }, true);
console.log('Local emulator member ready: suryansh@gmail.com / local-dev-password');
