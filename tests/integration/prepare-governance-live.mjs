// Explicit deployment QA only. Never log the password, session or recovery code.
import { readFile, writeFile, mkdir, unlink, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
if (process.env.SCHOOLPOT_GOVERNANCE_LIVE_TEST !== '1')
  throw Error('Explicit live QA opt-in required');
const path = new URL('../.local/governance-live-qa.json', import.meta.url);
const env = Object.fromEntries(
  (await readFile('.env.local', 'utf8'))
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).replace(/^\uFEFF/, ''), l.slice(i + 1)];
    }),
);
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Origin: 'https://codexora-dev.github.io' } },
});
if (process.argv[2] === 'cleanup') {
  const qa = JSON.parse(await readFile(path, 'utf8'));
  const { error } = await client.auth.signInWithPassword({
    email: qa.username + '@accounts.schoolpot.invalid',
    password: qa.password,
  });
  if (error) throw Error('QA authentication failed; preserve local state for operator cleanup.');
  if (!error) {
    const deleted = await client.functions.invoke('delete-account', {
      body: { password: qa.password },
    });
    assert.equal(deleted.error, null);
    assert.equal(deleted.data.ok, true);
  }
  await unlink(path);
  console.log('Temporary governance QA account cleanup completed.');
} else {
  await access(path).then(
    () => {
      throw Error('An existing QA state must be cleaned up first.');
    },
    (error) => {
      if (error.code !== 'ENOENT') throw error;
    },
  );
  const setup = await client.rpc('school_setup');
  assert.equal(setup.error, null);
  const grade = setup.data.counts.findIndex((n) => n > 0) + 1;
  assert.ok(grade);
  const username = 'deployqa' + randomBytes(6).toString('hex'),
    password = randomBytes(24).toString('base64url');
  await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
  await writeFile(path, JSON.stringify({ username, password }), { flag: 'wx' });
  const created = await client.functions.invoke('accounts', {
    body: {
      action: 'signup',
      username,
      password,
      school_year: setup.data.school_year,
      grade,
      class_number: 1,
    },
  });
  assert.equal(created.error, null);
  const login = await client.auth.signInWithPassword({
    email: username + '@accounts.schoolpot.invalid',
    password,
  });
  assert.equal(login.error, null);
  await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ username, password, uid: login.data.user.id, session: login.data.session }),
  );
  const me = await client.rpc('community', { p_action: 'me' });
  assert.equal(me.error, null);
  assert.equal(me.data.role, 'member');
  assert.equal(me.data.restricted, false);
  for (const [name, action] of [
    ['community', 'admin_stats'],
    ['governance', 'roles'],
    ['governance', 'apply'],
    ['governance', 'release'],
    ['manage_notices', 'list'],
  ]) {
    const denied = await client.rpc(name, {
      p_action: action,
      p_payload: { role: 'owner', is_admin: true },
    });
    assert.match(denied.error?.message || '', /FORBIDDEN/);
  }
  console.log(
    JSON.stringify({ username, uid: login.data.user.id, actualAuthAndMemberDenialsPassed: true }),
  );
}
