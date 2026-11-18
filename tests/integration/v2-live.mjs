// Explicit live QA only. Temporary private account data is kept under tests/.local and removed on cleanup.
import { readFile, writeFile, mkdir, unlink, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
const statePath = new URL('../.local/v2/hosted-qa.json', import.meta.url);
const env = Object.fromEntries(
  (await readFile('.env.local', 'utf8'))
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
const makeClient = () =>
  createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Origin: 'https://codexora-dev.github.io' } },
  });
if (process.env.SCHOOLPOT_V2_LIVE_TEST !== '1') throw new Error('Explicit live QA opt-in required');
if (process.argv[2] === 'cleanup') {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  for (const account of state.accounts) {
    if (account.deleted) continue;
    const client = makeClient();
    const login = await client.auth.signInWithPassword({
      email: account.username + '@accounts.schoolpot.invalid',
      password: account.password,
    });
    assert.equal(login.error, null, 'QA cleanup login');
    const deleted = await client.functions.invoke('delete-account', {
      body: { password: account.password },
    });
    assert.equal(deleted.error, null, 'QA cleanup Edge');
    assert.equal(deleted.data.ok, true);
    account.deleted = true;
    await writeFile(statePath, JSON.stringify(state));
  }
  await unlink(statePath);
  console.log('V2 live QA accounts, sessions and associated private data removed.');
} else {
  await access(statePath).then(
    () => {
      throw new Error('Existing QA state must be cleaned up first');
    },
    (error) => {
      if (error.code !== 'ENOENT') throw error;
    },
  );
  const state = { accounts: [] };
  const save = () => writeFile(statePath, JSON.stringify(state));
  await mkdir(new URL('../.local/v2/', import.meta.url), { recursive: true });
  const anon = makeClient();
  const setup = await anon.rpc('school_setup');
  assert.equal(setup.error, null);
  const grade = setup.data.counts.findIndex((count) => count > 0) + 1;
  assert.ok(grade);
  for (let i = 0; i < 2; i++) {
    const account = {
      username: 'v2qa' + randomBytes(6).toString('hex'),
      password: randomBytes(24).toString('base64url'),
    };
    state.accounts.push(account);
    await save();
    const client = makeClient();
    const created = await client.functions.invoke('accounts', {
      body: {
        action: 'signup',
        username: account.username,
        password: account.password,
        school_year: setup.data.school_year,
        grade,
        class_number: 1,
      },
    });
    assert.equal(created.error, null, 'Actual accounts Edge signup');
    const login = await client.auth.signInWithPassword({
      email: account.username + '@accounts.schoolpot.invalid',
      password: account.password,
    });
    assert.equal(login.error, null);
    account.uid = login.data.user.id;
    account.session = login.data.session;
    await save();
  }
  const clients = await Promise.all(
    state.accounts.map(async (account) => {
      const client = makeClient();
      const result = await client.auth.setSession(account.session);
      assert.equal(result.error, null);
      return client;
    }),
  );
  const rpc = async (client, action, payload = {}) => {
    const result = await client.rpc('schoolpot_v2', { p_action: action, p_payload: payload });
    assert.equal(result.error, null, `Hosted V2 ${action}`);
    return result.data;
  };
  const a = clients[0],
    b = clients[1];
  const me = await a.rpc('community', { p_action: 'me' });
  assert.equal(me.error, null);
  assert.equal(me.data.role, 'member');
  assert.equal(me.data.enrollment_current, true);
  const pref = await rpc(a, 'preferences');
  await rpc(a, 'save_preferences', {
    ...pref,
    user_id: state.accounts[1].uid,
    role: 'owner',
    comment_enabled: false,
    push_enabled: true,
  });
  assert.equal((await rpc(a, 'preferences')).comment_enabled, false);
  assert.equal((await rpc(b, 'preferences')).comment_enabled, true);
  for (const [client, name, action] of [
    [a, 'schoolpot_v2', 'delivery_stats'],
    [a, 'push_delivery', 'claim'],
    [a, 'push_worker_configuration', 'get'],
    [anon, 'schoolpot_v2', 'notifications'],
  ]) {
    const result = await client.rpc(name, {
      p_action: action,
      p_payload: { role: 'owner', user_id: state.accounts[1].uid },
    });
    assert.ok(result.error, `Hosted denied: ${name}/${action}`);
  }
  assert.deepEqual((await rpc(a, 'notifications')).items, []);
  assert.equal((await rpc(a, 'unread')).unread, 0);
  assert.deepEqual(await rpc(a, 'activity', { kind: 'bookmarks' }), []);
  const endpoint =
    'https://fcm.googleapis.com/fcm/send/test-only-' + randomBytes(8).toString('hex');
  const subscription = await rpc(a, 'push_save', {
    endpoint,
    p256dh: 'B'.repeat(87),
    auth: 'a'.repeat(22),
    device_name: '삭제 예정 서버 검증 기기',
  });
  await rpc(b, 'push_delete', { id: subscription.id });
  assert.equal((await rpc(a, 'push_devices')).length, 1);
  await rpc(a, 'push_delete', { id: subscription.id });
  assert.equal((await rpc(a, 'push_devices')).length, 0);
  const unauthorized = await fetch(env.VITE_SUPABASE_URL + '/functions/v1/push-dispatch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${state.accounts[0].session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(unauthorized.status, 403);
  state.verified = true;
  await save();
  console.log(
    JSON.stringify({
      actualAuthSignupAndLogin: true,
      currentMembership: true,
      hostedPostgrestOwnershipAndRoleDenials: true,
      actualEdgeSchedulerDenial: true,
      temporaryAccounts: state.accounts.map((account) => account.uid),
    }),
  );
}
