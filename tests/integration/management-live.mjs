import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
if (process.env.SCHOOLPOT_LIVE_TEST !== '1') throw new Error('Explicit live test opt-in required.');
const env = Object.fromEntries(
  (await readFile('.env.local', 'utf8'))
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).replace(/^\uFEFF/, ''), l.slice(i + 1)];
    }),
);
const qa = [];
let board, post;
let passed = 0;
const makeClient = () =>
  createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Origin: 'http://127.0.0.1:5173' } },
  });
const rpc = async (client, name, action, payload = {}) =>
  client.rpc(name, { p_action: action, p_payload: payload });
async function check(name, fn) {
  await fn();
  passed++;
  console.log('PASS ' + name);
}
async function prompt(text, expected) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    assert.equal((await input.question(text)).trim(), expected);
  } finally {
    input.close();
  }
}
const guest = makeClient();
try {
  for (let i = 0; i < 2; i++) {
    const account = {
      username: 'mqa' + randomBytes(6).toString('hex'),
      password: randomBytes(12).toString('base64url'),
      client: makeClient(),
    };
    const signup = await account.client.functions.invoke('accounts', {
      body: { action: 'signup', username: account.username, password: account.password },
    });
    assert.equal(signup.error, null, 'QA signup');
    qa.push(account);
    const login = await account.client.auth.signInWithPassword({
      email: account.username + '@accounts.schoolpot.invalid',
      password: account.password,
    });
    assert.equal(login.error, null);
    account.id = login.data.user.id;
    assert.equal(
      (
        await rpc(account.client, 'community', 'save_profile', {
          nickname: 'QA' + randomBytes(4).toString('hex'),
        })
      ).error,
      null,
    );
  }
  const [a, b] = qa;
  await check('실제 공개 게시판 메타데이터 조회 및 비회원 관리 거절', async () => {
    const r = await guest.rpc('board_catalog');
    assert.equal(r.error, null);
    assert.ok(r.data.every((b) => b.is_active));
    assert.ok((await rpc(guest, 'manage_boards', 'list')).error);
  });
  await check('실제 일반 회원의 관리자 게시판·문의 접근 거절', async () => {
    assert.match((await rpc(a.client, 'manage_boards', 'list')).error?.message || '', /FORBIDDEN/);
    assert.match((await rpc(a.client, 'feedback', 'admin_list')).error?.message || '', /FORBIDDEN/);
  });
  let ticket;
  await check('실제 문의 접수 및 다른 계정으로부터 격리', async () => {
    const r = await rpc(a.client, 'feedback', 'create', {
      kind: 'bug',
      title: 'QA 비공개 제보',
      body: '실제 서버 권한 검증용 임시 문의',
      author_id: b.id,
      status: 'resolved',
    });
    assert.equal(r.error, null);
    ticket = r.data.id;
    const mine = await rpc(a.client, 'feedback', 'mine');
    assert.equal(mine.error, null);
    assert.equal(mine.data[0].status, 'new');
    assert.equal(mine.data[0].author_id, undefined);
    const other = await rpc(b.client, 'feedback', 'mine', { id: ticket, user_id: a.id });
    assert.equal(other.error, null);
    assert.deepEqual(other.data, []);
  });
  console.log('QA_ROLE_READY ' + JSON.stringify({ username: b.username, user_id: b.id }));
  await prompt('Grant temporary QA role, then enter READY: ', 'READY');
  await check('실제 관리자 문의 답변·상태 변경·오래된 수정 거절', async () => {
    const r = await rpc(b.client, 'feedback', 'admin_list', { status: 'new', kind: 'bug' });
    assert.equal(r.error, null);
    const f = r.data.find((f) => f.id === ticket);
    assert.ok(f);
    assert.equal(f.author_id, undefined);
    const payload = {
      id: ticket,
      revision: f.revision,
      status: 'resolved',
      admin_reply: 'QA 처리 완료',
    };
    assert.equal((await rpc(b.client, 'feedback', 'admin_update', payload)).error, null);
    assert.match(
      (await rpc(b.client, 'feedback', 'admin_update', payload)).error?.message || '',
      /STALE_FEEDBACK/,
    );
    const mine = await rpc(a.client, 'feedback', 'mine');
    assert.equal(mine.data[0].admin_reply, 'QA 처리 완료');
    const notifications = await rpc(a.client, 'community', 'notifications');
    assert.ok(notifications.data.some((n) => n.feedback_id === ticket));
  });
  await check('실제 관리자 숨김 게시판 생성 및 공개 목록 제외', async () => {
    board = {
      id: 'qa-' + randomBytes(6).toString('hex'),
      name: 'QA 비공개 게시판',
      description: '자동 검증',
      kind: 'anonymous',
      position: 999,
      is_active: false,
      can_post: false,
      revision: 1,
    };
    assert.equal((await rpc(b.client, 'manage_boards', 'create', board)).error, null);
    const r = await guest.rpc('board_catalog');
    assert.equal(
      r.data.some((b) => b.id === board.id),
      false,
    );
  });
  await check('실제 숨김 게시판 글쓰기·조회 우회 차단 및 기존 글 삭제 보호', async () => {
    const r = await rpc(b.client, 'community', 'save_post', {
      board: board.id,
      title: 'QA 숨김 글',
      body: '비공개 서버 검증',
    });
    assert.equal(r.error, null);
    post = r.data.id;
    assert.match(
      (
        await rpc(a.client, 'community', 'save_post', {
          board: board.id,
          title: '우회 검증',
          body: '본문',
        })
      ).error?.message || '',
      /BOARD_CLOSED/,
    );
    assert.match(
      (await rpc(a.client, 'community', 'get_post', { id: post })).error?.message || '',
      /NOT_FOUND/,
    );
    assert.match(
      (await rpc(b.client, 'manage_boards', 'delete', { id: board.id, revision: board.revision }))
        .error?.message || '',
      /BOARD_HAS_POSTS/,
    );
  });
  await check('실제 게시판 수정·버전 검증·빈 게시판 삭제', async () => {
    assert.equal(
      (await rpc(b.client, 'manage_boards', 'save', { ...board, name: 'QA 수정 게시판' })).error,
      null,
    );
    board.revision++;
    assert.match(
      (await rpc(b.client, 'manage_boards', 'save', { ...board, revision: 1 })).error?.message ||
        '',
      /STALE_BOARD/,
    );
    assert.equal((await rpc(b.client, 'community', 'delete_post', { id: post })).error, null);
    post = null;
    assert.equal(
      (await rpc(b.client, 'manage_boards', 'delete', { id: board.id, revision: board.revision }))
        .error,
      null,
    );
    board = null;
  });
} finally {
  const admin = qa[1]?.client;
  if (post && admin)
    assert.equal((await rpc(admin, 'community', 'delete_post', { id: post })).error, null);
  if (board && admin)
    assert.equal(
      (await rpc(admin, 'manage_boards', 'delete', { id: board.id, revision: board.revision }))
        .error,
      null,
    );
  if (qa.length) {
    console.log(
      'QA_CLEANUP_READY ' +
        JSON.stringify({ user_ids: qa.map((a) => a.id), usernames: qa.map((a) => a.username) }),
    );
    await prompt('Delete QA-only feedback, then enter CLEANED: ', 'CLEANED');
  }
  for (const account of qa) {
    const r = await account.client.functions.invoke('delete-account', {
      body: { password: account.password },
    });
    assert.equal(r.error, null, 'QA account cleanup');
  }
  console.log('Temporary QA accounts removed.');
}
console.log(
  passed + ' actual Supabase management checks passed. No public test board was published.',
);
