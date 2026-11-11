import { auth, edge } from './api.js';
import { accountEmail, username } from '../lib/identity.js';
import { password } from '../lib/validation.js';
export async function signIn(handle, secret) {
  return auth('signInWithPassword', { email: accountEmail(handle), password: secret });
}
export async function register(handle, secret) {
  return edge('accounts', {
    action: 'signup',
    username: username(handle),
    password: password(secret),
  });
}
export async function recover(handle, code, secret) {
  return edge('accounts', {
    action: 'recover',
    username: username(handle),
    recovery_code: String(code).trim(),
    password: password(secret),
  });
}
