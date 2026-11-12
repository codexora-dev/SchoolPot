import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
if (process.env.SCHOOLPOT_LIVE_TEST !== '1') throw Error('Explicit live QA opt-in required.');
const env = Object.fromEntries(
  (await readFile('.env.local', 'utf8'))
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).replace(/^\uFEFF/, ''), l.slice(i + 1)];
    }),
);
const make = () =>
  createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Origin: 'http://127.0.0.1:5173' } },
  });
const rpc = (client, name, action, payload = {}) =>
  client.rpc(name, { p_action: action, p_payload: payload });
const accounts = [];
try {
  const { data: setup, error } = await make().rpc('school_setup');
  assert.equal(error, null);
  const grade = setup.counts.findIndex((n) => n >= 2) + 1;
  assert.ok(grade, 'At least two actual classes required');
  for (let i = 1; i <= 2; i++) {
    const a = {
      client: make(),
      username: 'cqa' + randomBytes(6).toString('hex'),
      password: randomBytes(12).toString('base64url'),
    };
    const result = await a.client.functions.invoke('accounts', {
      body: {
        action: 'signup',
        username: a.username,
        password: a.password,
        school_year: setup.school_year,
        grade,
        class_number: i,
        age_14_confirmed: true,
      },
    });
    assert.equal(result.error, null);
    accounts.push(a);
    const signed = await a.client.auth.signInWithPassword({
      email: a.username + '@accounts.schoolpot.invalid',
      password: a.password,
    });
    assert.equal(signed.error, null);
    a.id = signed.data.user.id;
    const me = await rpc(a.client, 'community', 'me');
    assert.equal(me.error, null);
    assert.equal(me.data.enrollment_current, true);
    assert.equal(me.data.membership.class_number, i);
    assert.equal(me.data.membership.collection_basis, 'service_contract');
    const schedules = await rpc(a.client, 'community', 'assessments', {
      grade: 3,
      class_number: 99,
    });
    assert.equal(schedules.error, null);
    assert.ok(
      schedules.data.every(
        (s) => s.school_year === setup.school_year && s.grade === grade && s.class_number === i,
      ),
    );
    for (const action of ['admin_settings', 'admin_correct_member']) {
      const denied = await rpc(a.client, 'school_membership', action, {
        is_admin: true,
        id: a.id,
        grade,
        class_number: i,
      });
      assert.match(denied.error?.message || '', /FORBIDDEN/);
    }
    const changed = await rpc(a.client, 'school_membership', 'enroll', {
      school_year: setup.school_year,
      grade,
      class_number: i === 1 ? 2 : 1,
    });
    assert.match(changed.error?.message || '', /MEMBERSHIP_LOCKED/);
    const direct = await a.client.schema('private').from('memberships').select('*');
    assert.ok(direct.error);
  }
  const publicSetup = await make().rpc('school_setup');
  assert.equal(publicSetup.error, null);
  assert.equal(publicSetup.data.policy.contact_email, 'kminjae803@naver.com');
  for (const a of accounts) assert.equal(JSON.stringify(publicSetup.data).includes(a.id), false);
  console.log(
    'PASS actual signup without consent/policy-version, Auth login, own class, class-switch denial, forged-admin denial, private table denial, public privacy email.',
  );
} finally {
  for (const a of accounts) {
    const signed = await a.client.auth.signInWithPassword({
      email: a.username + '@accounts.schoolpot.invalid',
      password: a.password,
    });
    assert.equal(signed.error, null);
    const result = await a.client.functions.invoke('delete-account', {
      body: { password: a.password },
    });
    assert.equal(result.error, null, 'QA cleanup failed');
  }
  console.log('Temporary QA accounts deleted; no community content created.');
}
