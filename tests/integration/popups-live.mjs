import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
if (process.env.SCHOOLPOT_LIVE_TEST !== '1')
  throw new Error('Explicit SCHOOLPOT_LIVE_TEST=1 is required.');
const env = Object.fromEntries(
  (await readFile('.env.local', 'utf8'))
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).replace(/^\uFEFF/, ''), l.slice(i + 1)];
    }),
);
const username = 'pqa' + randomBytes(6).toString('hex'),
  password = randomBytes(6).toString('base64url');
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Origin: 'http://127.0.0.1:5173' } },
});
let accountCreated = false,
  id,
  resource = null,
  passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log('PASS', name);
}
const rpc = async (action, payload = {}) =>
  client.rpc('manage_popups', { p_action: action, p_payload: payload });
try {
  const registered = await client.functions.invoke('accounts', {
    body: { action: 'signup', username, password },
  });
  assert.equal(registered.error, null, 'Temporary account creation failed');
  accountCreated = true;
  const signedIn = await client.auth.signInWithPassword({
    email: username + '@accounts.schoolpot.invalid',
    password,
  });
  assert.equal(signedIn.error, null);
  id = signedIn.data.user.id;
  await check('실제 일반 회원의 팝업 관리 차단', async () => {
    const r = await rpc('list');
    assert.match(r.error?.message || '', /FORBIDDEN/);
  });
  console.log('QA_ACCOUNT_READY ' + JSON.stringify({ username, user_id: id }));
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question('Grant temporary QA role, then enter READY: ');
    if (answer.trim() !== 'READY') throw new Error('Test not authorized to continue');
  } finally {
    prompt.close();
  }
  await check('실제 관리자 비공개 팝업 생성', async () => {
    const r = await rpc('save', {
      title: 'QA 비공개 팝업 검증',
      body: '자동 검증용 비공개 데이터입니다.',
      close_options: ['once', 'today', 'forever'],
      is_active: false,
    });
    assert.equal(r.error, null);
    resource = { id: r.data.id, revision: 1 };
  });
  await check('실제 공개 조회에서 비공개 팝업 제외', async () => {
    const r = await client.rpc('site_popups');
    assert.equal(r.error, null);
    assert.equal(
      r.data.some((p) => p.id === resource.id),
      false,
    );
  });
  await check('실제 관리자 팝업 수정 및 버전 증가', async () => {
    const r = await rpc('save', {
      ...resource,
      title: 'QA 수정 팝업 검증',
      body: '변경된 비공개 본문',
      close_options: ['once', 'today'],
      is_active: false,
    });
    assert.equal(r.error, null);
    const list = await rpc('list');
    assert.equal(list.error, null);
    const item = list.data.find((p) => p.id === resource.id);
    assert.equal(item.revision, 2);
    resource = item;
  });
  await check('실제 서버의 오래된 수정 차단', async () => {
    const r = await rpc('save', { ...resource, revision: 1 });
    assert.match(r.error?.message || '', /STALE_POPUP/);
  });
  await check('실제 서버의 기본 닫기 제거 차단', async () => {
    const r = await rpc('save', { ...resource, close_options: ['forever'] });
    assert.match(r.error?.message || '', /INVALID_INPUT/);
  });
  await check('실제 관리자 팝업 삭제', async () => {
    const r = await rpc('delete', { id: resource.id, revision: resource.revision });
    assert.equal(r.error, null);
    resource = null;
  });
} finally {
  if (resource) {
    const r = await rpc('delete', { id: resource.id, revision: resource.revision });
    if (r.error) {
      process.exitCode = 1;
      console.error('Temporary popup cleanup requires review:', resource.id);
    }
  }
  if (accountCreated) {
    const login = await client.auth.signInWithPassword({
      email: username + '@accounts.schoolpot.invalid',
      password,
    });
    if (login.error) {
      process.exitCode = 1;
      console.error('QA login failed during cleanup:', username);
    } else {
      const r = await client.functions.invoke('delete-account', { body: { password } });
      if (r.error) {
        process.exitCode = 1;
        console.error('Temporary account cleanup requires review:', username);
      } else console.log('Temporary QA account removed.');
    }
  }
}
console.log(passed + ' live popup checks passed; no public test popup was published.');
