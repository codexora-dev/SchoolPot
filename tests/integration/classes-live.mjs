import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
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
const accounts = [];
let passed = 0;
const rpc = (c, name, action, payload = {}) =>
  c.rpc(name, { p_action: action, p_payload: payload });
async function check(name, fn) {
  await fn();
  passed++;
  console.log('PASS ' + name);
}
try {
  const initial = await make().rpc('school_setup');
  let enrollment = {};
  if (!initial.error) {
    const s = initial.data;
    const g = s.counts.findIndex((n) => n > 0) + 1;
    if (!s.policy.is_ready || !g)
      throw Error(
        'Actual enrollment must be configured before creating new live QA accounts. No policy bypass is provided.',
      );
    enrollment = {
      school_year: s.school_year,
      grade: g,
      class_number: 1,
      policy_version: s.policy.version,
      age_14_confirmed: true,
      privacy_consent: true,
      overseas_consent: true,
    };
  } else assert.equal(initial.error.code, 'PGRST202');
  for (let i = 0; i < 2; i++) {
    const a = {
      client: make(),
      username: 'cqa' + randomBytes(6).toString('hex'),
      password: randomBytes(12).toString('base64url'),
    };
    const created = await a.client.functions.invoke('accounts', {
      body: { action: 'signup', username: a.username, password: a.password, ...enrollment },
    });
    assert.equal(created.error, null);
    accounts.push(a);
    const signed = await a.client.auth.signInWithPassword({
      email: a.username + '@accounts.schoolpot.invalid',
      password: a.password,
    });
    assert.equal(signed.error, null);
    a.id = signed.data.user.id;
    a.session_id = JSON.parse(
      Buffer.from(signed.data.session.access_token.split('.')[1], 'base64url').toString(),
    ).session_id;
  }
  console.log(
    'QA_CLASS_READY ' +
      JSON.stringify(
        accounts.map((a) => ({ username: a.username, user_id: a.id, session_id: a.session_id })),
      ),
  );
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    assert.equal(
      (
        await input.question(
          'Apply migration/functions and rollback SQL verification, then enter READY: ',
        )
      ).trim(),
      'READY',
    );
  } finally {
    input.close();
  }
  const [a] = accounts;
  await check(
    '실제 공개 설정은 개인정보·반 수 준비 상태이며 회원 소속을 노출하지 않는다',
    async () => {
      const r = await make().rpc('school_setup');
      assert.equal(r.error, null);
      assert.equal(r.data.policy.is_ready, false);
      assert.deepEqual(r.data.counts, [0, 0, 0]);
      assert.equal(JSON.stringify(r.data).includes(a.id), false);
    },
  );
  await check('실제 기존 계정의 미등록 소속 수행평가 접근 거절', async () => {
    const me = await rpc(a.client, 'community', 'me');
    assert.equal(me.error, null);
    assert.equal(me.data.enrollment_current, false);
    const r = await rpc(a.client, 'community', 'assessments', { grade: 1, class_number: 1 });
    assert.match(r.error?.message || '', /MEMBERSHIP_REQUIRED/);
  });
  await check('실제 일반 회원의 관리자 학급 설정·소속 정정 거절', async () => {
    for (const action of ['admin_settings', 'admin_correct_member']) {
      const r = await rpc(a.client, 'school_membership', action, {
        is_admin: true,
        id: a.id,
        grade: 1,
        class_number: 1,
      });
      assert.match(r.error?.message || '', /FORBIDDEN/);
    }
  });
  await check('실제 준비되지 않은 정책으로 동의·소속 등록 거절', async () => {
    const r = await rpc(a.client, 'school_membership', 'enroll', {
      school_year: 2026,
      grade: 1,
      class_number: 1,
      policy_version: 1,
      age_14_confirmed: true,
      privacy_consent: true,
      overseas_consent: true,
    });
    assert.match(r.error?.message || '', /POLICY_NOT_READY/);
  });
  await check('실제 가입 서버는 준비되지 않은 정책에서 Auth 생성 전 거절', async () => {
    const r = await make().functions.invoke('accounts', {
      body: {
        action: 'signup',
        username: 'cqanew' + randomBytes(4).toString('hex'),
        password: randomBytes(12).toString('base64url'),
        school_year: 2026,
        grade: 1,
        class_number: 1,
        policy_version: 1,
        age_14_confirmed: true,
        privacy_consent: true,
        overseas_consent: true,
      },
    });
    assert.ok(r.error);
    const detail = await r.error.context.json();
    assert.equal(detail.error, 'POLICY_NOT_READY');
  });
} finally {
  for (const a of accounts) {
    const result = await a.client.functions.invoke('delete-account', {
      body: { password: a.password },
    });
    assert.equal(result.error, null, 'QA cleanup ' + a.username);
  }
  console.log('Temporary QA accounts removed.');
}
console.log(
  passed +
    ' actual Auth/PostgREST/Edge class/privacy checks passed. Positive class routing is verified separately in a rollback transaction.',
);
