import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { classTests } from './classes.mjs';
const db = new PGlite();
let passed = 0;
const users = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  admin: '33333333-3333-4333-8333-333333333333',
  unverified: '44444444-4444-4444-8444-444444444444',
  anon: '55555555-5555-4555-8555-555555555555',
};
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false,email text,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.sub',true),'role',current_setting('request.jwt.claim.role',true))$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
await db.exec(
  await readFile(
    new URL('../../supabase/migrations/20261111133230_schoolpot_v1.sql', import.meta.url),
    'utf8',
  ),
);
await db.exec(
  await readFile(
    new URL('../../supabase/migrations/20261111135652_username_accounts.sql', import.meta.url),
    'utf8',
  ),
);
await db.exec(
  await readFile(
    new URL('../../supabase/migrations/20261111140438_account_provisioning.sql', import.meta.url),
    'utf8',
  ),
);
await db.exec(
  await readFile(
    new URL('../../supabase/migrations/20261112113812_site_popups.sql', import.meta.url),
    'utf8',
  ),
);
await db.exec(
  await readFile(
    new URL(
      '../../supabase/migrations/20261112121308_board_management_feedback.sql',
      import.meta.url,
    ),
    'utf8',
  ),
);
await db.exec(
  await readFile(
    new URL(
      '../../supabase/migrations/20261112125917_class_memberships_privacy.sql',
      import.meta.url,
    ),
    'utf8',
  ),
);
await db.exec(
  await readFile(
    new URL(
      '../../supabase/migrations/20261112141333_consent_free_class_profiles.sql',
      import.meta.url,
    ),
    'utf8',
  ),
);
await db.exec(
  await readFile(
    new URL(
      '../../supabase/migrations/20261113072018_remove_public_contact_and_age_prompt.sql',
      import.meta.url,
    ),
    'utf8',
  ),
);
// Every regression case uses the final schema; these settings are fixtures only.
await db.exec(
  "update private.class_settings set counts=array[2,3,1];update private.privacy_policy set is_ready=true,overseas_notice='Test fixture only; never publish as an operating policy.'",
);
for (const [name, id] of Object.entries(users))
  await db.query(
    'insert into auth.users(id,email_confirmed_at,deleted_at,is_anonymous,email,raw_app_meta_data) values($1,$2,null,$3,$4,$5)',
    [
      id,
      null,
      name === 'anon',
      'student_' + name + '@accounts.schoolpot.invalid',
      JSON.stringify(['a', 'b', 'admin'].includes(name) ? { account_type: 'username' } : {}),
    ],
  );
await db.query('insert into auth.sessions select id,id from auth.users');
for (const who of ['a', 'b', 'admin'])
  await db.query(
    'insert into private.memberships(user_id,school_year,grade,class_number,policy_version) select $1,school_year,1,1,1 from private.class_settings',
    [users[who]],
  );
async function as(who, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [users[who] || '']);
  await db.query("select set_config('request.jwt.claim.role',$1,false)", [role]);
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
await ok('서버에서 생성하지 않은 일반 Auth 계정 차단', async () => {
  await as('unverified');
  await denied(() => call('me'), /ACCOUNT_REQUIRED/);
});
await ok('익명 Auth 계정 차단', async () => {
  await as('anon');
  await denied(() => call('me'), /AUTH_REQUIRED/);
});
await ok('학생·이메일 인증 없이 아이디 계정 프로필 이용', async () => {
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
    /FORBIDDEN|NOT_FOUND/,
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
await ok('일반 사용자의 복구 API 및 해시 직접 접근 차단', async () => {
  await as('b');
  await denied(
    () => db.query("select public.account_gateway('claim_recovery','{}'::jsonb)"),
    /permission denied/,
  );
  await denied(() => db.query('select * from private.account_handles'), /permission denied/);
});
await ok('복구 코드는 해시로 저장하고 한 번만 교체 가능', async () => {
  await as('', 'service_role');
  const gateway = (action, payload) =>
    db.query('select public.account_gateway($1,$2::jsonb) result', [
      action,
      JSON.stringify(payload),
    ]);
  await gateway('set_recovery', { user_id: users.b, recovery_hash: 'a'.repeat(64) });
  const first = await gateway('claim_recovery', {
    username: 'student_b',
    old_hash: 'a'.repeat(64),
    new_hash: 'b'.repeat(64),
  });
  assert.equal(first.rows[0].result.user_id, users.b);
  const reused = await gateway('claim_recovery', {
    username: 'student_b',
    old_hash: 'a'.repeat(64),
    new_hash: 'c'.repeat(64),
  });
  assert.equal(reused.rows[0].result.user_id, null);
});
await ok('Auth 생성 후 메타데이터가 부착돼도 프로필 생성', async () => {
  const temp = '66666666-6666-4666-8666-666666666666';
  await db.exec('reset role');
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    temp,
    'lateprofile@accounts.schoolpot.invalid',
  ]);
  await db.query('update auth.users set raw_app_meta_data=$1 where id=$2', [
    JSON.stringify({ account_type: 'username' }),
    temp,
  ]);
  await as('', 'service_role');
  await db.query("select public.account_gateway('set_recovery',$1::jsonb)", [
    JSON.stringify({ user_id: temp, recovery_hash: 'e'.repeat(64) }),
  ]);
  await db.exec('reset role');
  const r = await db.query('select nickname from private.profiles where id=$1', [temp]);
  assert.equal(r.rows[0].nickname, 'lateprofile');
  await db.query('delete from auth.users where id=$1', [temp]);
});
await ok('서버 가입 경로의 요청 제한', async () => {
  await as('', 'service_role');
  for (let n = 0; n < 6; n++)
    await db.query("select public.account_gateway('limit',$1::jsonb)", [
      JSON.stringify({ kind: 'signup', username: 'ratetest', ip_hash: 'd'.repeat(64) }),
    ]);
  await denied(
    () =>
      db.query("select public.account_gateway('limit',$1::jsonb)", [
        JSON.stringify({ kind: 'signup', username: 'ratetest', ip_hash: 'd'.repeat(64) }),
      ]),
    /RATE_LIMIT/,
  );
});
await ok('아이디 로그인 식별자 변경 거절', async () => {
  await db.exec('reset role');
  await denied(
    () =>
      db.query('update auth.users set email=$1 where id=$2', [
        'renamed@accounts.schoolpot.invalid',
        users.b,
      ]),
    /USERNAME_IMMUTABLE/,
  );
});

const popupAdmin = async (action, payload = {}) =>
  (
    await db.query('select public.manage_popups($1,$2::jsonb) result', [
      action,
      JSON.stringify(payload),
    ])
  ).rows[0].result;
const publicPopups = async () =>
  (await db.query('select public.site_popups() result')).rows[0].result;
let popupId, pausedId;
await ok('비회원 팝업 조회 허용 및 관리 함수 차단', async () => {
  await as('', 'anon');
  assert.deepEqual(await publicPopups(), []);
  await denied(() => popupAdmin('list'), /permission denied/);
  await denied(() => db.query('select * from private.site_popups'), /permission denied/);
});
await ok('일반 회원 팝업 등록·수정·삭제·목록 관리 차단', async () => {
  await as('b');
  for (const action of ['list', 'save', 'delete'])
    await denied(
      () => popupAdmin(action, { title: '권한 위조', body: '차단되어야 합니다', is_admin: true }),
      /FORBIDDEN/,
    );
});
await ok('관리자 팝업 등록 및 공개 응답의 작성자 정보 보호', async () => {
  await as('admin');
  popupId = (
    await popupAdmin('save', {
      title: '학교 안내 팝업',
      body: '알려드립니다',
      close_options: ['once', 'today', 'forever'],
      is_active: true,
    })
  ).id;
  await as('', 'anon');
  const list = await publicPopups();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, popupId);
  assert.equal(list[0].title, '학교 안내 팝업');
  assert.equal(JSON.stringify(list).includes(users.admin), false);
  assert.equal('created_by' in list[0], false);
});
await ok('게시 중지 팝업은 공개하지 않는다', async () => {
  await as('admin');
  pausedId = (
    await popupAdmin('save', {
      title: '비공개 팝업',
      body: '아직 공개하면 안 됩니다',
      close_options: ['once'],
      is_active: false,
    })
  ).id;
  assert.equal((await popupAdmin('list')).length, 2);
  await as('', 'anon');
  assert.equal(
    (await publicPopups()).some((p) => p.id === pausedId),
    false,
  );
});
await ok('수정하면 팝업 버전 증가 및 오래된 수정 차단', async () => {
  await as('admin');
  await popupAdmin('save', {
    id: popupId,
    revision: 1,
    title: '수정된 팝업',
    body: '새 본문',
    close_options: ['once', 'today'],
    is_active: true,
  });
  const p = (await popupAdmin('list')).find((p) => p.id === popupId);
  assert.equal(p.revision, 2);
  await denied(
    () => popupAdmin('save', { ...p, revision: 1, title: '오래된 변경' }),
    /STALE_POPUP/,
  );
  await popupAdmin('save', { ...p, is_active: false });
  assert.equal((await popupAdmin('list')).find((p) => p.id === popupId).revision, 2);
  await popupAdmin('save', { ...p, is_active: true });
});
await ok('기본 닫기 제거·미지원 옵션·빈 본문·길이 초과 거절', async () => {
  await as('admin');
  for (const options of [['forever'], ['once', 'invalid'], []])
    await denied(
      () => popupAdmin('save', { title: '잘못된 안내', body: '본문', close_options: options }),
      /INVALID_INPUT/,
    );
  for (const body of [' ', 'x'.repeat(8001)])
    await denied(
      () => popupAdmin('save', { title: '길이 검증', body, close_options: ['once'] }),
      /check constraint/,
    );
});
await ok('동시 게시 3개 제한 및 중지 후 활성화', async () => {
  await as('admin');
  const paused = (await popupAdmin('list')).find((p) => p.id === pausedId);
  await popupAdmin('save', { ...paused, is_active: true });
  await popupAdmin('save', {
    title: '세 번째 팝업',
    body: '안내',
    close_options: ['once'],
    is_active: true,
  });
  await denied(
    () =>
      popupAdmin('save', {
        title: '네 번째 팝업',
        body: '안내',
        close_options: ['once'],
        is_active: true,
      }),
    /POPUP_LIMIT/,
  );
  assert.equal((await publicPopups()).length, 3);
});
await ok('팝업 작업 감사 기록 및 관리자 삭제', async () => {
  await as('admin');
  const logs = await call('admin_audit');
  assert.ok(logs.some((log) => log.action === 'popup_save'));
  for (const p of await popupAdmin('list'))
    await popupAdmin('delete', { id: p.id, revision: p.revision });
  assert.deepEqual(await publicPopups(), []);
  assert.ok((await call('admin_audit')).some((log) => log.action === 'popup_delete'));
});
async function management(name, action, payload = {}) {
  const queries = {
    manage_boards: 'select public.manage_boards($1,$2::jsonb) result',
    feedback: 'select public.feedback($1,$2::jsonb) result',
  };
  return (await db.query(queries[name], [action, JSON.stringify(payload)])).rows[0].result;
}
const boardAdmin = (action, payload) => management('manage_boards', action, payload);
const feedback = (action, payload) => management('feedback', action, payload);
const catalog = async () => (await db.query('select public.board_catalog() result')).rows[0].result;
let managedPost, feedbackId;
const newBoard = {
  id: 'test-board',
  name: '테스트 게시판',
  description: '설명',
  position: 1,
  kind: 'anonymous',
  is_active: true,
  can_post: true,
};
await ok('공개 게시판 메타데이터와 비회원 관리·문의 차단', async () => {
  await as('', 'anon');
  assert.equal((await catalog()).length, 7);
  await denied(() => boardAdmin('list'), /permission denied/);
  await denied(() => feedback('mine'), /permission denied/);
});
await ok('일반 회원 관리자 게시판·문의 API 차단', async () => {
  await as('b');
  await denied(() => boardAdmin('create', { ...newBoard, is_admin: true }), /FORBIDDEN/);
  await denied(() => feedback('admin_list', { role: 'admin' }), /FORBIDDEN/);
  await denied(() => feedback('admin_update', { is_admin: true }), /FORBIDDEN/);
  await denied(() => db.query('select * from private.feedback'), /permission denied/);
  await denied(
    () => db.query("select private.check_board_write('free',true)"),
    /permission denied/,
  );
});
await ok('관리자 게시판 추가·이름·설명·순서 변경', async () => {
  await as('admin');
  await boardAdmin('create', newBoard);
  assert.equal((await catalog())[0].id, newBoard.id);
  await boardAdmin('save', { ...newBoard, revision: 1, name: '변경한 게시판', kind: 'general' });
  const b = (await boardAdmin('list')).find((b) => b.id === newBoard.id);
  assert.equal(b.revision, 2);
  assert.equal(b.kind, 'anonymous');
  await denied(() => boardAdmin('save', { ...newBoard, revision: 1 }), /STALE_BOARD/);
});
await ok('사용자 정의 익명 게시판도 서버에서 익명 강제', async () => {
  await as('b');
  managedPost = (
    await call('save_post', {
      board: newBoard.id,
      title: '게시판 관리 검증',
      body: '본문',
      anonymous: false,
    })
  ).id;
  const p = await call('get_post', { id: managedPost });
  assert.equal(p.anonymous, true);
  assert.equal(p.author, '익명');
  assert.equal(JSON.stringify(p).includes(users.b), false);
  await call('save_comment', { post_id: managedPost, body: '댓글' });
});
await ok('읽기 전용 게시판의 글·댓글·공감·투표 API 우회 차단', async () => {
  await as('admin');
  await boardAdmin('save', { ...newBoard, revision: 2, can_post: false });
  await as('b');
  assert.equal((await call('get_post', { id: managedPost })).can_interact, false);
  const c = (await call('get_post', { id: managedPost })).replies[0];
  for (const [action, payload] of [
    ['save_post', { board: newBoard.id, title: '우회 시도', body: '본문' }],
    ['save_post', { id: managedPost, board: 'free', title: '수정 우회', body: '본문' }],
    ['save_comment', { post_id: managedPost, body: '댓글 우회' }],
    ['save_comment', { id: c.id, body: '수정 우회' }],
    ['like', { kind: 'post', id: managedPost, liked: true }],
    ['like', { kind: 'comment', id: c.id, liked: true }],
    ['vote', { post_id: managedPost }],
  ])
    await denied(() => call(action, payload), /BOARD_CLOSED/);
});
await ok('숨긴 게시판은 공개 메타데이터·검색·타인 글 조회에서 제외', async () => {
  await as('admin');
  await boardAdmin('save', { ...newBoard, revision: 3, is_active: false, can_post: false });
  await as('', 'anon');
  assert.equal(
    (await catalog()).some((b) => b.id === newBoard.id),
    false,
  );
  await as('a');
  assert.equal((await call('list_posts', { board: newBoard.id })).length, 0);
  await denied(() => call('get_post', { id: managedPost }), /NOT_FOUND/);
  await as('b');
  assert.equal((await call('get_post', { id: managedPost })).is_mine, true);
});
await ok('기존 글이 있는 게시판 삭제 거절 및 본인 글 삭제 후 빈 게시판 삭제', async () => {
  await as('admin');
  await denied(() => boardAdmin('delete', { id: newBoard.id, revision: 4 }), /BOARD_HAS_POSTS/);
  await as('b');
  await call('delete_post', { id: managedPost });
  await as('admin');
  await boardAdmin('delete', { id: newBoard.id, revision: 4 });
  assert.equal(
    (await boardAdmin('list')).some((b) => b.id === newBoard.id),
    false,
  );
});
await ok('사용자 정의 투표 게시판에서 투표 생성 및 참여', async () => {
  await as('admin');
  await boardAdmin('create', { ...newBoard, id: 'test-poll', kind: 'poll' });
  await as('b');
  const p = (
    await call('save_post', {
      board: 'test-poll',
      title: '새 투표',
      body: '내용',
      options: ['하나', '둘'],
    })
  ).id;
  const data = await call('get_post', { id: p });
  assert.equal(data.poll.options.length, 2);
  await call('vote', { post_id: p, option_id: data.poll.options[0].id });
  await call('delete_post', { id: p });
  await as('admin');
  await boardAdmin('delete', { id: 'test-poll', revision: 1 });
});
await ok('문의 접수 시 소유자·처리 상태·답변 위조 무시', async () => {
  await as('a');
  feedbackId = (
    await feedback('create', {
      kind: 'bug',
      title: '오류 제보',
      body: '<img src=x onerror=alert(1)>',
      author_id: users.b,
      status: 'resolved',
      admin_reply: '위조 답변',
    })
  ).id;
  const f = (await feedback('mine', { id: feedbackId }))[0];
  assert.equal(f.status, 'new');
  assert.equal(f.admin_reply, '');
  assert.equal(f.author_id, undefined);
});
await ok('타인의 문의는 ID를 알아도 조회할 수 없다', async () => {
  await as('b');
  assert.deepEqual(await feedback('mine', { id: feedbackId, user_id: users.a }), []);
});
await ok('관리자 문의 필터·답변·상태 처리 및 작성자 알림', async () => {
  await as('admin');
  const f = (await feedback('admin_list', { status: 'new', kind: 'bug' })).find(
    (f) => f.id === feedbackId,
  );
  assert.ok(f);
  assert.equal(f.author_id, undefined);
  assert.ok(f.nickname);
  assert.equal((await call('admin_stats')).feedback, 1);
  await feedback('admin_update', {
    id: f.id,
    revision: f.revision,
    status: 'resolved',
    admin_reply: '해결했습니다.',
  });
  await denied(
    () => feedback('admin_update', { id: f.id, revision: f.revision, status: 'closed' }),
    /STALE_FEEDBACK/,
  );
  await as('a');
  const mine = (await feedback('mine'))[0];
  assert.equal(mine.status, 'resolved');
  assert.equal(mine.admin_reply, '해결했습니다.');
  assert.ok((await call('notifications')).some((n) => n.feedback_id === feedbackId));
});
await ok('문의 본문·유형·답변 길이 및 시간당 접수 제한', async () => {
  await as('b');
  for (const payload of [
    { kind: 'invalid', title: '제보', body: '내용' },
    { kind: 'bug', title: '제보', body: ' ' },
    { kind: 'bug', title: '제보', body: 'x'.repeat(8001) },
  ])
    await denied(() => feedback('create', payload), /check constraint/);
  for (let i = 0; i < 5; i++)
    await feedback('create', { kind: 'suggestion', title: '건의사항', body: '내용' });
  await denied(
    () => feedback('create', { kind: 'suggestion', title: '초과 접수', body: '내용' }),
    /RATE_LIMIT/,
  );
  await as('admin');
  const f = (await feedback('admin_list'))[0];
  await denied(
    () =>
      feedback('admin_update', {
        id: f.id,
        revision: f.revision,
        status: 'resolved',
        admin_reply: 'x'.repeat(4001),
      }),
    /check constraint/,
  );
});
await ok('신규 관리 API도 이용 제한·현재 세션을 검증', async () => {
  await db.exec('reset role');
  await db.query("update private.profiles set suspended_until=now()+interval '1 day' where id=$1", [
    users.admin,
  ]);
  await as('admin');
  await denied(() => boardAdmin('list'), /SUSPENDED/);
  await denied(() => feedback('admin_list'), /SUSPENDED/);
  await db.exec('reset role');
  await db.query('update private.profiles set suspended_until=null where id=$1', [users.admin]);
  await db.query('delete from auth.sessions where user_id=$1', [users.b]);
  await as('b');
  await denied(() => feedback('mine'), /AUTH_REQUIRED/);
  await db.exec('reset role');
  await db.query('insert into auth.sessions values($1,$1)', [users.b]);
});
await db.exec('reset role');
await db.exec(
  "delete from private.memberships;update private.class_settings set counts=array[0,0,0],revision=1;update private.privacy_policy set is_ready=false,overseas_notice=''",
);
await classTests({ db, as, call, ok, denied, users });
await ok('탈퇴 시 작성 내용·소속·동의 삭제, 기존 JWT 접근 차단', async () => {
  await db.exec('reset role');
  await db.query('delete from auth.users where id=$1', [users.a]);
  await as('a');
  await denied(() => call('me'), /AUTH_REQUIRED/);
  await db.exec('reset role');
  assert.equal(
    (await db.query('select count(*) n from private.posts where id=$1', [anonPost])).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query('select count(*) n from private.memberships where user_id=$1', [users.a]))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await db.query('select count(*) n from private.feedback where author_id=$1', [users.a]))
      .rows[0].n,
    0,
  );
});
await db.close();
console.log(
  `\n${passed} database security tests passed (PGlite PostgreSQL). Hosted Auth/PostgREST/Edge tests require actual project access.`,
);
