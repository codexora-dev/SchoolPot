import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
let passed = 0;
const users = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  admin: '33333333-3333-4333-8333-333333333333',
  unverified: '44444444-4444-4444-8444-444444444444',
  anon: '55555555-5555-4555-8555-555555555555',
};
await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.sub',true))$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
await db.exec(
  await readFile(
    new URL('../../supabase/migrations/20261111133230_schoolpot_v1.sql', import.meta.url),
    'utf8',
  ),
);
for (const [name, id] of Object.entries(users))
  await db.query('insert into auth.users values($1,$2,null,$3)', [
    id,
    name === 'unverified' ? null : new Date(),
    name === 'anon',
  ]);
await db.query('insert into auth.sessions select id,id from auth.users');
async function as(who, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [users[who] || '']);
  await db.exec(`set role ${role}`);
}
async function call(action, payload = {}) {
  const r = await db.query('select public.community($1,$2::jsonb) result', [
    action,
    JSON.stringify(payload),
  ]);
  return r.rows[0].result;
}
async function ok(name, fn) {
  try {
    await fn();
    passed++;
    console.log('PASS', name);
  } catch (error) {
    console.error('FAIL', name, error);
    throw error;
  }
}
async function denied(fn, pattern) {
  await assert.rejects(fn, pattern);
}
await ok('비로그인 RPC 차단', async () => {
  await as('', 'anon');
  await denied(() => call('list_posts'), /permission denied/);
});
await ok('uid 없는 authenticated 차단', async () => {
  await as('');
  await denied(() => call('me'), /AUTH_REQUIRED/);
});
await ok('이메일 미인증 차단', async () => {
  await as('unverified');
  await denied(() => call('me'), /EMAIL_REQUIRED/);
});
await ok('익명 Auth 계정 차단', async () => {
  await as('anon');
  await denied(() => call('me'), /AUTH_REQUIRED/);
});
await ok('별도 학생 신청 없이 이메일 인증 후 프로필 생성', async () => {
  for (const who of ['a', 'b', 'admin']) {
    await as(who);
    await call('save_profile', { nickname: `학생_${who}`, grade: 1 });
    assert.equal((await call('me')).profile.nickname, `학생_${who}`);
  }
});
await ok('타인 프로필 ID를 넣어도 본인 프로필만 수정', async () => {
  await as('a');
  await call('save_profile', { id: users.b, nickname: '내닉네임', grade: 2, role: 'admin' });
  await as('b');
  assert.equal((await call('me')).profile.nickname, '학생_b');
});
await ok('메타데이터와 요청으로 관리자 승격 불가', async () => {
  await as('a');
  assert.equal((await call('me')).is_admin, false);
  await denied(() => call('admin_stats', { is_admin: true }), /FORBIDDEN/);
});
await ok('모든 테이블 RLS 활성화', async () => {
  await db.exec('reset role');
  const r = await db.query(
    "select relname from pg_class join pg_namespace on pg_namespace.oid=relnamespace where nspname='private' and relkind='r' and not relrowsecurity",
  );
  assert.equal(r.rows.length, 0);
});
await ok('테이블 직접 조회 및 역할 변경 차단', async () => {
  await as('a');
  for (const name of [
    'posts',
    'comments',
    'profiles',
    'user_roles',
    'anonymous_labels',
    'reports',
    'notifications',
  ]) {
    await denied(() => db.query(`select * from private.${name}`), /permission denied/);
  }
  await denied(
    () => db.query("insert into private.user_roles values($1,'admin')", [users.a]),
    /permission denied/,
  );
});
await ok('내부 helper RPC 직접 실행 차단', async () => {
  await as('a');
  await denied(
    () => db.query("select private.consume_rate($1,'posts',9999,1)", [users.a]),
    /permission denied/,
  );
});
let post, anonPost, comment, reply, poll;
await ok('게시글 생성 및 본인 수정', async () => {
  await as('a');
  post = (await call('save_post', { board: 'free', title: '자유 이야기', body: '첫 번째 본문' }))
    .id;
  await call('save_post', { id: post, title: '수정한 제목', body: '수정한 본문' });
  assert.equal((await call('get_post', { id: post })).title, '수정한 제목');
});
await ok('타인 게시글 수정 및 삭제 차단', async () => {
  await as('b');
  await denied(
    () => call('save_post', { id: post, title: '해킹 제목', body: '해킹' }),
    /FORBIDDEN/,
  );
  await denied(() => call('delete_post', { id: post }), /FORBIDDEN/);
});
await ok('익명 게시판 강제 익명 및 author ID 비노출', async () => {
  await as('a');
  anonPost = (
    await call('save_post', {
      board: 'anonymous',
      title: '익명 글이에요',
      body: '비밀 본문',
      anonymous: false,
    })
  ).id;
  await as('b');
  const p = await call('get_post', { id: anonPost });
  assert.equal(p.anonymous, true);
  assert.equal(p.author, '익명');
  assert.equal(JSON.stringify(p).includes(users.a), false);
  assert.equal('author_id' in p, false);
  const list = await call('list_posts', { board: 'anonymous' });
  assert.equal(JSON.stringify(list).includes(users.a), false);
});
await ok('SQL Injection 문자열은 일반 검색어로 취급', async () => {
  await as('b');
  assert.deepEqual(await call('list_posts', { query: "' OR 1=1;--" }), []);
});
await ok('빈 제목과 과도한 본문 거절', async () => {
  await as('a');
  await denied(
    () => call('save_post', { board: 'free', title: ' ', body: 'x' }),
    /check constraint/,
  );
  await denied(
    () => call('save_post', { board: 'free', title: '긴 본문', body: 'x'.repeat(20001) }),
    /check constraint/,
  );
});
await ok('XSS 문자열을 실행 가능한 HTML이 아닌 원문으로 저장', async () => {
  await as('a');
  const x = '<img src=x onerror=alert(1)>';
  const id = (await call('save_post', { board: 'free', title: 'XSS 검증', body: x })).id;
  assert.equal((await call('get_post', { id })).body, x);
});
await ok('댓글 및 같은 글 안의 대댓글 생성', async () => {
  await as('b');
  comment = (await call('save_comment', { post_id: anonPost, body: '익명 댓글' })).id;
  await as('a');
  reply = (
    await call('save_comment', { post_id: anonPost, parent_id: comment, body: '글쓴이 답글' })
  ).id;
  const p = await call('get_post', { id: anonPost });
  assert.equal(p.replies.find((c) => c.id === reply).author, '익명 · 글쓴이');
  assert.match(p.replies.find((c) => c.id === comment).author, /익명 \d/);
  assert.equal(JSON.stringify(p).includes(users.b), false);
});
await ok('다른 게시글의 댓글에 답글 달기 차단', async () => {
  await as('a');
  await denied(
    () => call('save_comment', { post_id: post, parent_id: comment, body: '잘못된 답글' }),
    /INVALID_INPUT/,
  );
});
await ok('타인 댓글 수정과 삭제 차단', async () => {
  await as('a');
  await denied(() => call('save_comment', { id: comment, body: '해킹 댓글' }), /FORBIDDEN/);
  await denied(() => call('delete_comment', { id: comment }), /FORBIDDEN/);
});
await ok('본인 댓글 수정 가능', async () => {
  await as('b');
  await call('save_comment', { id: comment, body: '수정한 댓글' });
  assert.equal(
    (await call('get_post', { id: anonPost })).replies.find((c) => c.id === comment).body,
    '수정한 댓글',
  );
});
await ok('게시글 중복 좋아요 방지 및 취소', async () => {
  await as('b');
  for (let i = 0; i < 2; i++) await call('like', { kind: 'post', id: post, liked: true });
  assert.equal((await call('get_post', { id: post })).likes, 1);
  await call('like', { kind: 'post', id: post, liked: false });
  assert.equal((await call('get_post', { id: post })).likes, 0);
});
await ok('댓글 중복 좋아요 방지', async () => {
  await as('a');
  for (let i = 0; i < 2; i++) await call('like', { kind: 'comment', id: comment, liked: true });
  assert.equal(
    (await call('get_post', { id: anonPost })).replies.find((c) => c.id === comment).likes,
    1,
  );
});
await ok('일간 조회 중복 집계 방지', async () => {
  await as('b');
  const before = (await call('get_post', { id: post })).views;
  await call('get_post', { id: post });
  assert.equal((await call('get_post', { id: post })).views, before);
});
await ok('댓글 및 답글 알림 생성, 사용자 간 알림 격리', async () => {
  await as('a');
  const list = await call('notifications');
  assert.equal(
    list.some((n) => n.post_id === anonPost),
    true,
  );
  assert.equal(JSON.stringify(list).includes(users.b), false);
  await call('read_notifications');
  assert.equal(
    (await call('notifications')).every((n) => n.read_at !== null),
    true,
  );
});
await ok('투표 생성 및 중복 투표 차단', async () => {
  await as('a');
  poll = (
    await call('save_post', {
      board: 'polls',
      title: '점심 메뉴 투표',
      body: '골라주세요',
      options: ['밥', '빵'],
    })
  ).id;
  await as('b');
  const p = await call('get_post', { id: poll });
  await call('vote', { post_id: poll, option_id: p.poll.options[0].id });
  await denied(
    () => call('vote', { post_id: poll, option_id: p.poll.options[1].id }),
    /ALREADY_VOTED/,
  );
  assert.equal((await call('get_post', { id: poll })).poll.options[0].votes, 1);
});
await ok('투표 항목 누락 및 타 투표 항목 선택 차단', async () => {
  await as('a');
  await denied(
    () => call('save_post', { board: 'polls', title: '잘못된 투표', body: '본문' }),
    /INVALID_INPUT/,
  );
  await denied(() => call('vote', { post_id: poll, option_id: post }), /foreign key constraint/);
});
await ok('신고 접수 및 일반 사용자 관리자 신고 조회 차단', async () => {
  await as('b');
  await call('report', { kind: 'post', id: anonPost, reason: '검토 부탁합니다' });
  await call('report', { kind: 'comment', id: comment, reason: '댓글 검토 요청' });
  await denied(() => call('admin_reports'), /FORBIDDEN/);
});
let assessment;
await ok('수행평가 등록, 타인 수정 차단, 수정 요청', async () => {
  await as('a');
  assessment = (
    await call('save_assessment', {
      title: '국어 발표 평가',
      subject: '국어',
      grade: 1,
      due_date: new Date().toISOString().slice(0, 10),
    })
  ).id;
  await as('b');
  assert.equal((await call('assessments', { grade: 1 })).length, 1);
  await denied(
    () =>
      call('save_assessment', {
        id: assessment,
        title: '변조 일정',
        grade: 2,
        due_date: '2026-11-11',
        subject: '국어',
      }),
    /FORBIDDEN/,
  );
  await call('report_assessment', { id: assessment, reason: '날짜를 확인해 주세요' });
});
await ok('관리자 권한 부여는 서버에서만 가능', async () => {
  await db.exec('reset role');
  await db.query("insert into private.user_roles values($1,'admin')", [users.admin]);
  await as('admin');
  assert.equal((await call('me')).is_admin, true);
  assert.equal((await call('admin_stats')).members, 3);
});
await ok('신고 처리, 공지 등록, 관리자 감사 기록', async () => {
  await as('admin');
  const r = await call('admin_reports');
  assert.equal(r.content.length, 2);
  assert.equal(r.assessments.length, 1);
  await call('admin_resolve', { id: r.content[0].id, status: 'resolved' });
  await call('admin_notice', { title: '운영 공지', body: '서로 존중해 주세요.' });
  assert.equal((await call('notices')).length, 1);
  assert.equal((await call('admin_audit')).length, 3);
});
await ok('이용 제한은 다음 요청부터 즉시 적용', async () => {
  await as('admin');
  await call('admin_suspend', { id: users.b, suspend: true });
  await as('b');
  await denied(() => call('list_posts'), /SUSPENDED/);
  await as('admin');
  await call('admin_suspend', { id: users.b, suspend: false });
  await as('b');
  assert.ok(Array.isArray(await call('list_posts')));
});
await ok('서버 요청 횟수 제한', async () => {
  await db.exec('reset role');
  await db.query(
    "insert into private.rate_limits values($1,'neis',now(),30) on conflict(user_id,bucket) do update set hits=30,window_start=now()",
    [users.b],
  );
  await as('b');
  await denied(() => call('neis_access'), /RATE_LIMIT/);
});
await ok('본인 댓글 및 게시글 삭제 가능', async () => {
  await as('b');
  await call('delete_comment', { id: comment });
  await as('a');
  await call('delete_post', { id: post });
  await denied(() => call('get_post', { id: post }), /NOT_FOUND/);
});
await ok('로그아웃으로 세션이 제거된 토큰의 재사용 차단', async () => {
  await db.exec('reset role');
  await db.query('delete from auth.sessions where user_id=$1', [users.b]);
  await as('b');
  await denied(() => call('me'), /AUTH_REQUIRED/);
  await db.exec('reset role');
  await db.query('insert into auth.sessions values($1,$1)', [users.b]);
});
await ok('탈퇴 후 작성자 연결 제거, 기존 JWT 접근 차단', async () => {
  await db.exec('reset role');
  await db.query('delete from auth.users where id=$1', [users.a]);
  await as('a');
  await denied(() => call('me'), /AUTH_REQUIRED/);
  await as('b');
  const p = await call('get_post', { id: anonPost });
  assert.equal(p.author, '익명');
  assert.equal(JSON.stringify(p).includes(users.a), false);
});
await db.close();
console.log(
  `\n${passed} database security tests passed (PGlite PostgreSQL). Hosted Auth/PostgREST/Edge tests require actual project access.`,
);
