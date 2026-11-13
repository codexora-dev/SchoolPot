import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function governanceTests({ db, as, call, ok, denied, users }) {
  const rpc = async (name, action, payload = {}) =>
    (
      await db.query(`select public.${name}($1,$2::jsonb) result`, [
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].result;
  const gov = (action, payload = {}) => rpc('governance', action, payload);
  const base = {
    target_id: users.a,
    level: '3',
    rule: '이용 규정',
    reason: '규정 위반 내용 확인',
    operation_id: randomUUID(),
  };
  let req, sanction, appeal, general, important;
  const revision = async (id, key) => {
    await db.exec('reset role');
    const v = (await db.query(`select ${key} v from private.profiles where id=$1`, [id])).rows[0].v;
    await as('admin');
    return v;
  };
  await ok('일반 회원은 역할 위조·제재·요청·회원 검색·감사·설정 접근 불가', async () => {
    await as('a');
    for (const table of [
      'sanctions',
      'sanction_requests',
      'sanction_appeals',
      'role_history',
      'rules_versions',
      'service_configuration',
    ])
      await denied(() => db.query(`select * from private.${table}`), /permission denied/);
    for (const action of [
      'apply',
      'release',
      'request',
      'targets',
      'members',
      'roles',
      'role_history',
      'requests',
      'appeals',
      'security',
      'sanctions',
    ])
      await denied(() => gov(action, { ...base, role: 'owner', is_admin: true }), /FORBIDDEN/);
    await denied(() => rpc('service_configuration', 'save', { role: 'owner' }), /FORBIDDEN/);
    await denied(
      () => db.query('select private.community_legacy($1,$2)', ['admin_stats', '{}']),
      /permission denied/,
    );
    await denied(
      () => db.query('select private.apply_sanction($1)', [JSON.stringify(base)]),
      /permission denied/,
    );
  });
  await ok('최고 관리자만 부관리자 임명·해임 및 현재 세션 권한 검사', async () => {
    const rev = await revision(users.b, 'role_revision');
    await gov('role_set', {
      target_id: users.b,
      role: 'moderator',
      revision: rev,
      reason: '운영 업무 위임',
    });
    await denied(
      () =>
        gov('role_set', { target_id: users.b, role: 'member', revision: rev, reason: '중복 변경' }),
      /STALE_CHANGE/,
    );
    await as('b');
    assert.equal((await call('me')).role, 'moderator');
    for (const action of ['admin_members', 'admin_audit', 'admin_suspend'])
      await denied(() => call(action, { id: users.a, suspend: false }), /FORBIDDEN/);
    for (const [name, action] of [
      ['manage_boards', 'list'],
      ['manage_popups', 'list'],
      ['school_membership', 'admin_settings'],
      ['service_configuration', 'history'],
    ])
      await denied(() => rpc(name, action), /FORBIDDEN/);
    for (const action of [
      'apply',
      'release',
      'members',
      'roles',
      'role_set',
      'security',
      'sanctions',
    ])
      await denied(() => gov(action, base), /FORBIDDEN/);
    assert.ok('members' in (await call('admin_stats')));
    const matches = await gov('targets', { query: users.a });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].role, 'member');
    assert.equal(matches[0].id, users.a);
    await as('admin');
    const members = await gov('members', { query: users.a });
    assert.equal(members.length, 1);
    assert.equal(members[0].role, 'member');
    await as('b');
  });
  await ok('일반 공지 위임·중요 공지 보호·타인 공지 삭제와 구 API 우회 차단', async () => {
    await as('admin');
    general = await rpc('manage_notices', 'save', {
      title: '일반 운영 안내',
      body: '일반 안내',
      content_format: 'text',
    });
    important = await rpc('manage_notices', 'save', {
      title: '중요 정책 안내',
      body: '중요 안내',
      owner_only: true,
    });
    await as('b');
    const notices = await rpc('manage_notices', 'list');
    assert.equal(notices.find((n) => n.id === important.id).can_edit, false);
    const n = await rpc('manage_notices', 'get', { id: general.id });
    await rpc('manage_notices', 'save', { ...n, title: '부관리자 수정' });
    await denied(
      () => rpc('manage_notices', 'delete', { id: general.id, revision: 2 }),
      /FORBIDDEN/,
    );
    await denied(
      () =>
        rpc('manage_notices', 'save', {
          id: important.id,
          revision: 1,
          title: '변조',
          body: '본문',
        }),
      /FORBIDDEN/,
    );
    await denied(
      () => call('admin_notice', { title: '중요 공지 위조', body: '내용', owner_only: true }),
      /FORBIDDEN/,
    );
    await denied(
      () => call('admin_delete', { id: important.id, kind: 'notice', reason: '우회 시도' }),
      /FORBIDDEN/,
    );
    const mine = await rpc('manage_notices', 'save', { title: '부관리자 공지', body: '일반 공지' });
    await rpc('manage_notices', 'delete', { id: mine.id, revision: 1 });
  });
  await ok('민감한 문의는 최고 관리자 전용·일반 문의 이관 즉시 권한 회수', async () => {
    await as('a');
    const sensitive = await rpc('feedback', 'create', {
      kind: 'other',
      title: '계정 문의',
      body: '계정 관련 문의',
    });
    const normal = await rpc('feedback', 'create', {
      kind: 'bug',
      title: '화면 오류',
      body: '목록 오류',
    });
    await as('b');
    const list = await rpc('feedback', 'admin_list');
    assert.ok(!list.some((f) => f.id === sensitive.id));
    assert.ok(list.some((f) => f.id === normal.id));
    await denied(
      () =>
        rpc('feedback', 'admin_update', {
          id: sensitive.id,
          revision: 1,
          status: 'resolved',
          admin_reply: '답변',
        }),
      /NOT_FOUND/,
    );
    await rpc('feedback', 'admin_escalate', { id: normal.id, revision: 1 });
    assert.ok(!(await rpc('feedback', 'admin_list')).some((f) => f.id === normal.id));
    await denied(
      () => rpc('feedback', 'admin_update', { id: normal.id, revision: 2, status: 'closed' }),
      /NOT_FOUND/,
    );
  });
  await ok('제재 요청 증거의 존재·실제 작성자 검사 및 본인 요청 격리', async () => {
    await as('b');
    await denied(() => gov('targets', { query: 'a' }), /INVALID_INPUT/);
    await denied(
      () => gov('request', { ...base, category: '욕설', post_id: randomUUID() }),
      /INVALID_EVIDENCE/,
    );
    await db.exec('reset role');
    const post = (
      await db.query(
        "insert into private.posts(board_id,author_id,title,body) values('free',$1,'증거 검사','검사 본문') returning id",
        [users.b],
      )
    ).rows[0].id;
    const comment = (
      await db.query(
        "insert into private.comments(post_id,author_id,body) values($1,$2,'검사 댓글') returning id",
        [post, users.a],
      )
    ).rows[0].id;
    await as('b');
    await denied(
      () => gov('request', { ...base, category: '욕설', post_id: post }),
      /INVALID_EVIDENCE/,
    );
    await gov('request', { ...base, category: '욕설', post_id: post, comment_id: comment });
    await as('admin');
    const ownersRequest = await gov('request', { ...base, category: '기타' });
    await as('b');
    assert.ok(!(await gov('requests')).some((r) => r.id === ownersRequest.id));
    req = await gov('request', { ...base, category: '욕설' });
    assert.ok((await gov('requests')).some((r) => r.id === req.id));
    await as('admin');
    await gov('decide', {
      id: req.id,
      revision: 1,
      status: 'needs_info',
      decision_reason: '상황을 보완해 주세요',
    });
    await as('b');
    await denied(
      () => gov('request', { ...base, id: req.id, revision: 1, category: '욕설' }),
      /STALE_CHANGE/,
    );
    await gov('request', {
      ...base,
      id: req.id,
      revision: 2,
      category: '욕설',
      reason: '추가 내용을 확인했습니다',
    });
    await denied(
      () =>
        gov('decide', {
          id: req.id,
          revision: 3,
          status: 'approved',
          decision_reason: '권한 위조',
          ...base,
        }),
      /FORBIDDEN/,
    );
  });
  await ok('승인 원자성·재시도 중복 제재 방지·서버 시각 제한과 me 예외', async () => {
    await as('admin');
    await denied(
      () =>
        gov('decide', {
          id: req.id,
          revision: 1,
          status: 'approved',
          decision_reason: '검토 완료',
          ...base,
        }),
      /STALE_CHANGE/,
    );
    sanction = await gov('decide', {
      id: req.id,
      revision: 3,
      status: 'approved',
      decision_reason: '검토 완료',
      ...base,
    });
    assert.ok(
      (
        await gov('decide', {
          id: req.id,
          revision: 3,
          status: 'approved',
          decision_reason: '검토 완료',
          ...base,
        })
      ).already_applied,
    );
    await db.exec('reset role');
    assert.equal(
      (await db.query('select count(*) n from private.sanctions where request_id=$1', [req.id]))
        .rows[0].n,
      1,
    );
    await as('a');
    const me = await call('me');
    assert.equal(me.restricted, true);
    assert.equal(me.account_status.sanctions[0].kind, 'suspend');
    await denied(() => call('list_posts'), /SUSPENDED/);
    await denied(() => rpc('feedback', 'mine'), /SUSPENDED/);
    assert.ok((await call('delete_account_access')).ok);
  });
  await ok('제한 계정의 이의 제기·권리 문의 허용, 타인 자료와 해제 우회 차단', async () => {
    await as('a');
    await denied(
      () => gov('appeal', { sanction_id: randomUUID(), body: '타인 제재' }),
      /NOT_FOUND/,
    );
    appeal = await gov('appeal', {
      sanction_id: sanction.id,
      body: '제재 내용 재검토 부탁드립니다',
    });
    await denied(
      () => gov('appeal', { sanction_id: sanction.id, body: '중복 제출' }),
      /duplicate key/,
    );
    await gov('rights', { body: '계정 연결 정보에 관한 요청입니다' });
    assert.ok((await gov('rights_mine')).length);
    await as('b');
    const items = await gov('appeals');
    assert.ok(items.some((a) => a.id === appeal.id));
    await gov('reply_appeal', {
      id: appeal.id,
      revision: 1,
      status: 'reviewing',
      reply: '최고 관리자에게 검토 요청했습니다',
    });
    await denied(
      () => gov('release', { target_id: users.a, revision: 1, reason: '권한 우회' }),
      /FORBIDDEN/,
    );
    await as('a');
    assert.equal((await call('me')).restricted, true);
    assert.equal((await gov('mine')).appeals[0].reply, '최고 관리자에게 검토 요청했습니다');
  });
  await ok('최고 관리자 해제 충돌 방지·일수 범위·영구 제한 확인·검토 제재 의미', async () => {
    let rev = await revision(users.a, 'sanction_revision');
    await denied(
      () => gov('release', { target_id: users.a, revision: rev - 1, reason: '검토 후 해제' }),
      /STALE_CHANGE/,
    );
    await gov('release', { target_id: users.a, revision: rev, reason: '재검토 후 해제' });
    await denied(
      () => gov('apply', { ...base, operation_id: randomUUID(), level: 'range', days: 31 }),
      /INVALID_INPUT/,
    );
    await denied(
      () => gov('apply', { ...base, operation_id: randomUUID(), level: 'permanent' }),
      /CONFIRM_REQUIRED/,
    );
    const review = await gov('apply', { ...base, operation_id: randomUUID(), level: 'review' });
    await gov('apply', { ...base, operation_id: randomUUID(), level: '1' });
    await as('a');
    const stillRestricted = await call('me');
    assert.equal(stillRestricted.restricted, true);
    await as('admin');
    const record = (await gov('sanctions')).find((s) => s.id === review.id);
    assert.equal(record.kind, 'review');
    assert.ok(record.ends_at);
    await db.exec('reset role');
    assert.equal(
      new Date(
        (await db.query('select suspended_until from private.profiles where id=$1', [users.a]))
          .rows[0].suspended_until,
      ).getTime(),
      new Date(record.ends_at).getTime(),
    );
    await as('admin');
    rev = await revision(users.a, 'sanction_revision');
    await gov('release', { target_id: users.a, revision: rev, reason: '검토 후 해제' });
    await gov('apply', {
      ...base,
      operation_id: randomUUID(),
      level: 'permanent',
      confirmation: '영구 제한',
    });
    await as('a');
    assert.equal((await call('me')).restricted, true);
    rev = await revision(users.a, 'sanction_revision');
    await gov('release', { target_id: users.a, revision: rev, reason: '영구 제한 해제' });
  });
  await ok('안내·경고 비차단·기간 만료는 다음 서버 요청부터 자동 허용', async () => {
    await as('admin');
    await gov('apply', { ...base, operation_id: randomUUID(), level: 'warning' });
    await as('a');
    assert.equal((await call('me')).restricted, false);
    assert.ok(Array.isArray(await call('list_posts')));
    await db.exec('reset role');
    await db.query(
      "update private.profiles set suspended_until=now()-interval '1 second' where id=$1",
      [users.a],
    );
    await as('a');
    assert.ok(Array.isArray(await call('list_posts')));
  });
  await ok('부관리자 해임은 기존 로그인 세션에도 즉시 반영', async () => {
    const rev = await revision(users.b, 'role_revision');
    await gov('role_set', {
      target_id: users.b,
      revision: rev,
      role: 'member',
      reason: '위임 종료',
    });
    await as('b');
    assert.equal((await call('me')).role, 'member');
    await denied(() => gov('requests'), /FORBIDDEN/);
    await denied(() => call('admin_reports'), /FORBIDDEN/);
    await as('admin');
    assert.ok((await gov('role_history')).length >= 2);
  });
  await ok('최고 관리자 승격 API 부재·마지막 최고 관리자 해임·탈퇴 보호', async () => {
    const rev = await revision(users.a, 'role_revision');
    await denied(
      () =>
        gov('role_set', {
          target_id: users.a,
          revision: rev,
          role: 'owner',
          reason: '최고 권한 위조',
        }),
      /OWNER_TRANSFER_REQUIRED/,
    );
    await denied(() => call('delete_account_access'), /OWNER_TRANSFER_REQUIRED/);
    await db.exec('reset role');
    await denied(
      () => db.query('delete from private.user_roles where user_id=$1', [users.admin]),
      /LAST_OWNER/,
    );
    await denied(
      () => db.query('delete from auth.users where id=$1', [users.admin]),
      /OWNER_TRANSFER_REQUIRED/,
    );
  });
  await ok('공개 설정에는 회원·이전 정책·관리자 정보 비노출, 규정 버전 충돌 방지', async () => {
    await as('', 'anon');
    const cfg = await rpc('service_configuration', 'public');
    assert.equal(cfg.school_name, '안남중학교');
    const rules = await rpc('service_configuration', 'rules');
    assert.ok(rules.full_text.includes('스쿨팟'));
    assert.ok(!JSON.stringify(cfg).includes(users.admin));
    await denied(() => rpc('service_configuration', 'history'), /AUTH_REQUIRED/);
    await as('admin');
    await rpc('service_configuration', 'save', { ...cfg, reason: '표시 정보 검토' });
    await denied(
      () => rpc('service_configuration', 'save', { ...cfg, reason: '이전 버전 덮어쓰기' }),
      /STALE_CHANGE/,
    );
    await rpc('service_configuration', 'publish_rules', {
      ...rules,
      reason: '규정 검토',
      confirmation: '규정 게시',
    });
    await denied(
      () =>
        rpc('service_configuration', 'publish_rules', {
          ...rules,
          reason: '오래된 버전',
          confirmation: '규정 게시',
        }),
      /STALE_CHANGE/,
    );
    assert.equal((await rpc('service_configuration', 'rules')).version, 2);
  });
  await db.exec('reset role');
  await db.exec('delete from private.rate_limits');
}
