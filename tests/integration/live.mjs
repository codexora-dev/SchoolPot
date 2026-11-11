import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
if (process.env.SCHOOLPOT_LIVE_TEST !== '1')
  throw new Error(
    'Set SCHOOLPOT_LIVE_TEST=1 to create and clean up temporary QA accounts in the configured project.',
  );
let env = { ...process.env };
try {
  for (const line of (await readFile('.env.local', 'utf8')).split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).replace(/^\uFEFF/, '')] = line.slice(i + 1);
  }
} catch {
  /* CI may supply environment variables */
}
const url = env.VITE_SUPABASE_URL,
  key = env.VITE_SUPABASE_PUBLISHABLE_KEY,
  origin = 'http://127.0.0.1:5173';
assert.ok(url && key, 'Missing public configuration');
const accounts = [];
const resources = [];
let passed = 0;
const client = () =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Origin: origin },
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  });
const code = () => randomBytes(6).toString('base64url');
async function request(action, payload) {
  const response = await fetch(url + '/functions/v1/accounts', {
    method: 'POST',
    headers: { Origin: origin, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  return { status: response.status, body };
}
async function login(account) {
  account.client = client();
  const { data, error } = await account.client.auth.signInWithPassword({
    email: account.username + '@accounts.schoolpot.invalid',
    password: account.password,
  });
  assert.equal(error, null, 'Auth sign-in failed');
  account.id = data.user.id;
  return data.session.access_token;
}
async function rpc(account, action, payload = {}) {
  const { data, error } = await account.client.rpc('community', {
    p_action: action,
    p_payload: payload,
  });
  assert.equal(error, null, `RPC ${action} failed: ${error?.code || ''} ${error?.message || ''}`);
  return data;
}
async function check(name, action) {
  await action();
  passed++;
  console.log('PASS', name);
}
try {
  for (let i = 0; i < 2; i++) {
    const account = { username: 'qa' + randomBytes(6).toString('hex'), password: code() };
    await check('실제 8자리 비밀번호 회원가입 ' + (i + 1), async () => {
      const r = await request('signup', { username: account.username, password: account.password });
      assert.equal(r.status, 201, 'Signup failed: ' + r.body.error);
      assert.match(r.body.recovery_code, /^[a-f0-9]{64}$/);
      account.recovery = r.body.recovery_code;
      accounts.push(account);
    });
    await check('이메일 인증 없이 실제 로그인 ' + (i + 1), () => login(account));
  }
  const [a, b] = accounts;
  await check('가입 즉시 프로필 자동 생성 및 일반 권한', async () => {
    const me = await rpc(a, 'me');
    assert.equal(me.profile.nickname, a.username);
    assert.equal(me.is_admin, false);
  });
  let post;
  await check('익명 글 작성·조회 및 작성자 ID 비노출', async () => {
    post = (
      await rpc(a, 'save_post', {
        board: 'anonymous',
        title: 'QA 자동 검증 글',
        body: '자동 테스트가 끝나면 삭제되는 글입니다.',
      })
    ).id;
    resources.push({ owner: a, action: 'delete_post', id: post });
    const detail = await rpc(b, 'get_post', { id: post });
    assert.equal(detail.author, '익명');
    assert.equal(JSON.stringify(detail).includes(a.id), false);
  });
  await check('타인 글 수정·관리자 권한 우회 거절', async () => {
    for (const [action, payload] of [
      ['save_post', { id: post, title: '변조 시도', body: '거절되어야 합니다' }],
      ['admin_stats', {}],
    ]) {
      const r = await b.client.rpc('community', { p_action: action, p_payload: payload });
      assert.match(r.error?.message || '', /FORBIDDEN/);
    }
  });
  await check('공감 중복 방지 및 익명 댓글', async () => {
    for (let i = 0; i < 2; i++) await rpc(b, 'like', { kind: 'post', id: post, liked: true });
    await rpc(b, 'save_comment', { post_id: post, body: 'QA 익명 댓글' });
    const detail = await rpc(a, 'get_post', { id: post });
    assert.equal(detail.likes, 1);
    assert.equal(detail.replies.length, 1);
    assert.equal(JSON.stringify(detail).includes(b.id), false);
  });
  await check('댓글 알림 실제 생성', async () => {
    const items = await rpc(a, 'notifications');
    assert.ok(items.some((item) => item.post_id === post));
  });
  await check('투표 생성·참여·중복 거절', async () => {
    const poll = (
      await rpc(a, 'save_post', {
        board: 'polls',
        title: 'QA 자동 검증 투표',
        body: '검증 종료 후 삭제됩니다.',
        options: ['첫 번째', '두 번째'],
      })
    ).id;
    resources.push({ owner: a, action: 'delete_post', id: poll });
    const detail = await rpc(b, 'get_post', { id: poll });
    await rpc(b, 'vote', { post_id: poll, option_id: detail.poll.options[0].id });
    const duplicate = await b.client.rpc('community', {
      p_action: 'vote',
      p_payload: { post_id: poll, option_id: detail.poll.options[1].id },
    });
    assert.match(duplicate.error?.message || '', /ALREADY_VOTED/);
  });
  await check('학년별 수행평가 실제 등록·조회', async () => {
    const id = (
      await rpc(a, 'save_assessment', {
        title: 'QA 일정 검증',
        subject: '국어',
        grade: 1,
        due_date: new Date().toISOString().slice(0, 10),
      })
    ).id;
    resources.push({ owner: a, action: 'delete_assessment', id });
    assert.ok((await rpc(b, 'assessments', { grade: 1 })).some((item) => item.id === id));
  });
  await check('안남중학교 NEIS 실제 급식 응답', async () => {
    const { data, error } = await a.client.functions.invoke('neis', {
      body: { kind: 'meals', day: '2026-11-11' },
    });
    assert.equal(error, null, 'NEIS edge request failed');
    assert.ok(data.items.length > 0, 'Expected known published meal day');
    assert.ok(data.items[0].description.includes('강황쌀밥'));
  });
  await check('복구 코드 재설정·이전 세션 및 코드 재사용 차단', async () => {
    const oldClient = a.client;
    const nextPassword = code();
    const r = await request('recover', {
      username: a.username,
      password: nextPassword,
      recovery_code: a.recovery,
    });
    assert.equal(r.status, 200, 'Recovery failed: ' + r.body.error);
    const old = await oldClient.rpc('community', { p_action: 'me', p_payload: {} });
    assert.match(old.error?.message || '', /AUTH_REQUIRED/);
    a.password = nextPassword;
    await login(a);
    const reused = await request('recover', {
      username: a.username,
      password: code(),
      recovery_code: a.recovery,
    });
    assert.equal(reused.status, 400);
    assert.equal(reused.body.error, 'RECOVERY_FAILED');
    a.recovery = r.body.recovery_code;
  });
} finally {
  for (const r of resources.reverse()) {
    try {
      await rpc(r.owner, r.action, { id: r.id });
    } catch {
      console.error('QA resource cleanup requires review:', r.action, r.id);
    }
  }
  for (const account of accounts) {
    try {
      await login(account);
      const { error } = await account.client.functions.invoke('delete-account', {
        body: { password: account.password },
      });
      assert.equal(error, null, 'Delete account failed');
      const r = await account.client.rpc('community', { p_action: 'me', p_payload: {} });
      assert.match(r.error?.message || '', /AUTH_REQUIRED/);
      passed++;
      console.log('PASS 실제 테스트 계정 탈퇴·기존 토큰 거절');
    } catch (error) {
      console.error('QA account cleanup requires review:', account.username, error.message);
      process.exitCode = 1;
    }
  }
}
console.log(
  passed + ' live integration checks passed. Temporary QA accounts and content were cleaned up.',
);
