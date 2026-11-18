import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function v2Tests({ db, as, call, ok, denied, users }) {
  const api = async (name, action, payload = {}) =>
    (
      await db.query(`select public.${name}($1,$2::jsonb) result`, [
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].result;
  const v2 = (action, payload) => api('schoolpot_v2', action, payload);
  const delivery = (action, payload) => api('push_delivery', action, payload);
  const reset = async () => {
    await db.exec('reset role;delete from private.rate_limits');
  };
  const identities = ['v2author', 'v2reader', 'v2other'];
  await reset();
  for (const name of identities) {
    users[name] = randomUUID();
    await db.query(
      'insert into auth.users(id,email,raw_app_meta_data) values($1,$2,\'{"account_type":"username"}\')',
      [users[name], `${name}@accounts.schoolpot.invalid`],
    );
    await db.query('insert into auth.sessions values($1,$1)', [users[name]]);
    await db.query(
      'insert into private.memberships(user_id,school_year,grade,class_number,policy_version) select $1,school_year,1,1,1 from private.class_settings',
      [users[name]],
    );
  }
  let post, comment, bookmark, subscriptionId, lease;
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-v2',
    p256dh: 'B'.repeat(87),
    auth: 'a'.repeat(22),
    device_name: '테스트 기기',
  };
  await ok('V2 테이블·내부 함수·발송 RPC는 일반 클라이언트 직접 접근 차단', async () => {
    await as('v2author');
    for (const table of [
      'notification_preferences',
      'bookmarks',
      'post_subscriptions',
      'mentions',
      'push_subscriptions',
      'notification_deliveries',
      'notification_delivery_logs',
    ])
      await denied(() => db.query(`select * from private.${table}`), /permission denied/);
    await denied(() => delivery('claim'), /permission denied/);
    await denied(
      () => v2('send', { recipient_id: users.v2reader, role: 'owner' }),
      /INVALID_INPUT/,
    );
    await denied(
      () => db.query('select private.community_v1($1,$2)', ['admin_stats', '{}']),
      /permission denied/,
    );
  });
  await ok('알림 설정은 본인 계정·revision을 사용하고 타인 user_id와 role을 무시', async () => {
    await as('v2reader');
    const pref = await v2('preferences');
    assert.equal(pref.mention_discoverable, false);
    await v2('save_preferences', {
      ...pref,
      user_id: users.v2author,
      role: 'owner',
      mention_discoverable: true,
      push_enabled: true,
    });
    await denied(() => v2('save_preferences', { ...pref, comment_enabled: false }), /STALE_CHANGE/);
    await as('v2author');
    assert.equal((await v2('preferences')).mention_discoverable, false);
    await denied(() => v2('delivery_stats', { role: 'owner' }), /FORBIDDEN/);
    const mine = await v2('preferences');
    await denied(
      () => v2('save_preferences', { ...mine, timezone: 'not/a/timezone' }),
      /INVALID_INPUT/,
    );
    await denied(
      () =>
        v2('save_preferences', {
          ...mine,
          quiet_hours_enabled: true,
          quiet_hours_start: '22:00',
          quiet_hours_end: '22:00',
        }),
      /check constraint/,
    );
  });
  await ok('푸시 구독은 본인 세션에만 연결되고 주소·키·타인 구독 위조 차단', async () => {
    await as('v2reader');
    subscriptionId = (await v2('push_save', { ...subscription, user_id: users.v2author })).id;
    assert.equal((await v2('push_devices'))[0].current_session, true);
    assert.equal(JSON.stringify(await v2('push_devices')).includes('endpoint'), false);
    await as('v2other');
    await denied(() => v2('push_save', subscription), /FORBIDDEN/);
    await v2('push_delete', { id: subscriptionId });
    assert.deepEqual(await v2('push_devices'), []);
    for (const endpoint of [
      'https://127.0.0.1/private',
      'https://fcm.googleapis.com.evil.invalid/x',
      'https://user@fcm.googleapis.com/x',
    ])
      await denied(() => v2('push_save', { ...subscription, endpoint }), /INVALID_INPUT/);
    await as('v2reader');
    assert.equal((await v2('push_devices')).length, 1);
  });
  await ok('서버 댓글 이벤트는 본인 알림을 제외하고 답글·구독·멘션 조건 중복 제거', async () => {
    await as('v2author');
    post = (await call('save_post', { board: 'free', title: 'V2 알림 검증', body: '본문' })).id;
    await v2('subscribe', { post_id: post, enabled: true });
    await as('v2reader');
    await v2('subscribe', { post_id: post, enabled: true });
    comment = (await call('save_comment', { post_id: post, body: '첫 댓글' })).id;
    assert.equal((await v2('notifications')).items.length, 0);
    await as('v2other');
    await call('save_comment', {
      post_id: post,
      parent_id: comment,
      body: '답글과 멘션',
      mentions: [users.v2reader],
    });
    await as('v2reader');
    const mine = await v2('notifications');
    assert.equal(mine.items.length, 1);
    assert.equal(mine.items[0].type, 'reply');
    assert.equal(JSON.stringify(mine).includes(users.v2other), false);
    await as('v2author');
    assert.equal((await v2('notifications')).items.length, 2);
  });
  await ok('멘션은 선택된 실제 ID만 저장하며 검색 허용·차단·5명·반복 제한 적용', async () => {
    await as('v2author');
    const found = await v2('mention_search', { query: 'v2' });
    assert.equal(
      found.some((u) => u.id === users.v2reader),
      true,
    );
    assert.equal(
      found.some((u) => u.id === users.v2other),
      false,
    );
    await denied(
      () =>
        call('save_post', {
          board: 'free',
          title: '허용되지 않은 멘션',
          body: '본문',
          mentions: [users.v2other],
        }),
      /INVALID_INPUT/,
    );
    await denied(
      () =>
        call('save_post', {
          board: 'free',
          title: '멘션 개수 초과',
          body: '본문',
          mentions: Array(6).fill(users.v2reader),
        }),
      /INVALID_INPUT/,
    );
    const plain = await call('save_post', {
      board: 'anonymous',
      title: '단순 문자열',
      body: '@v2reader',
    });
    await as('v2reader');
    const before = (await v2('notifications')).items.length;
    await as('v2author');
    await call('save_post', {
      id: plain.id,
      title: '수정으로 선택된 멘션',
      body: '본문',
      mentions: [users.v2reader],
    });
    await call('save_post', {
      id: plain.id,
      title: '재수정 멘션',
      body: '본문',
      mentions: [users.v2reader],
    });
    await as('v2reader');
    assert.equal((await v2('notifications')).items.length, before + 1);
    const profile = await v2('member_profile', { id: users.v2reader });
    assert.ok(profile.nickname);
    await denied(() => v2('member_profile', { id: users.v2author }), /NOT_FOUND/);
  });
  await ok(
    '개별 읽음·읽지 않음·전체 읽음·삭제는 타인 알림을 변경하지 않고 서버 개수 동기화',
    async () => {
      await as('v2reader');
      const inbox = await v2('notifications');
      const id = inbox.items[0].id;
      const version = (await v2('unread')).version;
      await as('v2other');
      await v2('read', { id, user_id: users.v2reader });
      await v2('delete', { id });
      await as('v2reader');
      assert.equal((await v2('notifications')).unread, inbox.unread);
      await v2('read', { id });
      assert.equal((await v2('unread')).unread, inbox.unread - 1);
      assert.notEqual((await v2('unread')).version, version);
      await v2('unread_one', { id });
      assert.equal((await v2('unread')).unread, inbox.unread);
      await v2('read');
      assert.equal((await v2('unread')).unread, 0);
      await v2('unread_one', { id });
      await v2('delete', { id });
      assert.equal(
        (await v2('notifications')).items.some((n) => n.id === id),
        false,
      );
    },
  );
  await ok('구독·북마크·내 활동은 본인만 조회하고 원본 삭제 시 연결을 정리', async () => {
    await as('v2reader');
    assert.equal(
      (await v2('bookmark', { post_id: post, enabled: true, user_id: users.v2other })).bookmarked,
      true,
    );
    assert.equal((await v2('activity', { kind: 'bookmarks' })).length, 1);
    await as('v2other');
    assert.deepEqual(await v2('activity', { kind: 'bookmarks' }), []);
    await as('v2author');
    bookmark = (await call('save_post', { board: 'free', title: '삭제할 원본', body: '본문' })).id;
    await as('v2reader');
    await v2('bookmark', { post_id: bookmark, enabled: true });
    await v2('subscribe', { post_id: bookmark, enabled: true });
    await as('v2author');
    await call('delete_post', { id: bookmark });
    await as('v2reader');
    assert.equal((await v2('activity', { kind: 'bookmarks' })).length, 1);
    await denied(() => v2('post_state', { post_id: bookmark }), /NOT_FOUND/);
    await as('v2other');
    const removed = await call('save_comment', { post_id: post, body: '삭제된 알림 댓글 확인' });
    await call('delete_comment', { id: removed.id });
    await as('v2reader');
    assert.equal(
      (await call('get_post', { id: post, comment_id: removed.id })).notification_comment_deleted,
      true,
    );
  });
  await ok(
    '삭제·숨김·양방향 차단 콘텐츠는 알림·개수·구독 목록·푸시에 노출하지 않는다',
    async () => {
      await reset();
      await db.query('insert into private.user_blocks values($1,$2)', [
        users.v2reader,
        users.v2author,
      ]);
      await as('v2reader');
      assert.deepEqual((await v2('notifications')).items, []);
      assert.deepEqual(await v2('activity', { kind: 'bookmarks' }), []);
      await denied(() => call('get_post', { id: post }), /NOT_FOUND/);
      await reset();
      await db.query('delete from private.user_blocks where user_id=$1', [users.v2reader]);
      await db.query("update private.boards set is_active=false,can_post=false where id='free'");
      await as('v2reader');
      assert.equal((await v2('notifications')).items.filter((n) => n.post_id === post).length, 0);
      await reset();
      await db.query("update private.boards set is_active=true,can_post=true where id='free'");
    },
  );
  await ok('공지별 알림 선택·중요도·자기 알림 제외·수정 재발송 방지', async () => {
    await as('admin');
    const quiet = await api('manage_notices', 'save', {
      title: '알림 없는 공지',
      body: '본문',
      notify_members: false,
    });
    const notice = await api('manage_notices', 'save', {
      title: '중요 V2 공지',
      body: '본문',
      owner_only: true,
    });
    await api('manage_notices', 'save', {
      id: notice.id,
      revision: 1,
      title: '수정된 공지',
      body: '수정 본문',
    });
    await as('v2reader');
    const items = (await v2('notifications')).items;
    assert.equal(items.filter((n) => n.notice_id === quiet.id).length, 0);
    assert.equal(items.filter((n) => n.notice_id === notice.id).length, 1);
    assert.equal(items.find((n) => n.notice_id === notice.id).important, true);
    await reset();
    await db.query('delete from private.notices where id=any($1::uuid[])', [[quiet.id, notice.id]]);
  });
  await ok('신고 검토·처리 통지는 비공개 관리자 사유와 대상 식별 정보를 제외', async () => {
    await as('v2reader');
    await call('report', { kind: 'post', id: post, reason: '검토 요청' });
    await reset();
    const report = (
      await db.query('select * from private.reports where reporter_id=$1', [users.v2reader])
    ).rows[0];
    await as('admin');
    await call('admin_resolve', {
      kind: 'content',
      id: report.id,
      revision: report.revision,
      status: 'reviewing',
      reason: '비공개 관리자 메모',
    });
    await call('admin_resolve', {
      kind: 'content',
      id: report.id,
      revision: report.revision + 1,
      status: 'resolved',
      reason: '비공개 대상 개인정보를 포함할 수 있는 메모',
    });
    await as('v2reader');
    const reports = await v2('activity', { kind: 'reports' });
    assert.equal(reports[0].status, 'resolved');
    assert.equal(JSON.stringify(reports).includes('비공개 대상'), false);
    assert.equal(
      (await v2('notifications')).items.some((n) => n.type === 'report'),
      true,
    );
  });
  await ok('서버 claim·lease·제한적 재시도·만료 구독 처리는 앱 내부 알림을 보존', async () => {
    await reset();
    await db.query('delete from private.notification_deliveries');
    await db.query(
      "insert into private.notifications(user_id,message,event_key,type) values($1,'푸시 검증','v2:push','notice')",
      [users.v2reader],
    );
    await db.query(
      "update private.notification_deliveries set available_at=now()-interval '1 second'",
    );
    await as('', 'service_role');
    const jobs = await delivery('claim');
    assert.equal(jobs.length, 1);
    lease = jobs[0];
    assert.deepEqual(await delivery('claim'), []);
    await denied(
      () => delivery('finish', { ...lease, lease_token: randomUUID(), status_code: 201 }),
      /STALE_CHANGE/,
    );
    await delivery('finish', { ...lease, status_code: 503 });
    await reset();
    await db.exec(
      "update private.notification_deliveries set available_at=now()-interval '1 second'",
    );
    await as('', 'service_role');
    lease = (await delivery('claim'))[0];
    await delivery('finish', { ...lease, status_code: 410 });
    await as('v2reader');
    assert.equal((await v2('push_devices'))[0].disabled_at !== null, true);
    assert.equal(
      (await v2('notifications')).items.some((n) => n.message === '푸시 검증'),
      true,
    );
  });
  await ok(
    '같은 기기의 동시 대기열은 한 번만 발송하고 후속 이벤트를 묶되 내부 기록 보존',
    async () => {
      await as('v2reader');
      await v2('push_save', subscription);
      await reset();
      await db.exec('delete from private.notification_deliveries');
      await db.query(
        "insert into private.notifications(user_id,message,event_key,type) values($1,'묶음 하나','v2:group1','notice'),($1,'묶음 둘','v2:group2','notice')",
        [users.v2reader],
      );
      await db.exec(
        "update private.notification_deliveries set available_at=now()-interval '1 second'",
      );
      await as('', 'service_role');
      const batch = await delivery('claim');
      assert.equal(batch.length, 1);
      await delivery('finish', { ...batch[0], status_code: 201 });
      await reset();
      await db.exec(
        "update private.notification_deliveries set available_at=now()-interval '1 second' where status='pending'",
      );
      await as('', 'service_role');
      assert.deepEqual(await delivery('claim'), []);
      await as('v2reader');
      assert.equal(
        (await v2('notifications')).items.filter((n) => n.message.startsWith('묶음')).length,
        2,
      );
    },
  );
  await ok('방해금지 시간·사용자 설정·로그아웃 세션을 발송 직전에 재검사', async () => {
    await as('v2reader');
    await v2('push_save', subscription);
    const pref = await v2('preferences');
    await v2('save_preferences', {
      ...pref,
      quiet_hours_enabled: true,
      quiet_hours_start: '00:00',
      quiet_hours_end: '23:59:59',
    });
    await reset();
    await db.query(
      "insert into private.notifications(user_id,message,event_key,type) values($1,'방해 금지 검증','v2:quiet','notice')",
      [users.v2reader],
    );
    await db.exec(
      "update private.notification_deliveries set available_at=now()-interval '1 second' where status='pending'",
    );
    await as('', 'service_role');
    assert.deepEqual(await delivery('claim'), []);
    await reset();
    assert.ok(
      (
        await db.query(
          "select available_at>now() deferred from private.notification_deliveries where status='pending'",
        )
      ).rows.every((row) => row.deferred),
    );
    await db.query('delete from auth.sessions where user_id=$1', [users.v2reader]);
    assert.equal(
      (
        await db.query('select count(*) n from private.push_subscriptions where user_id=$1', [
          users.v2reader,
        ])
      ).rows[0].n,
      0,
    );
    await as('v2reader');
    await denied(() => v2('notifications'), /AUTH_REQUIRED/);
    await reset();
    await db.query('insert into auth.sessions values($1,$1)', [users.v2reader]);
  });
  await ok(
    '제재·만료 통지는 필수 기록, 제한 중 V2 일반 API 차단, 만료 통지 중복 방지',
    async () => {
      await reset();
      const sid = randomUUID();
      await db.query(
        "insert into private.sanctions(id,target_id,kind,reason,rule,starts_at,ends_at,operation_id) values($1,$2,'suspend','기간 만료 검증','규정',now()-interval '2 days',now()-interval '1 day',$3)",
        [sid, users.v2reader, randomUUID()],
      );
      await as('v2reader');
      const first = (await v2('notifications')).items.filter((n) => n.type === 'release');
      assert.equal(first.length, 1);
      assert.equal((await v2('notifications')).items.filter((n) => n.type === 'release').length, 1);
      const records = await api('governance', 'mine');
      assert.equal(records.sanctions.find((s) => s.id === sid).state, 'expired');
      for (let i = 0; i < 3; i++) {
        await api('governance', 'appeal', { sanction_id: sid, body: '규정 검토를 요청합니다.' });
        await reset();
        await db.query("update private.sanction_appeals set status='closed' where sanction_id=$1", [
          sid,
        ]);
        await as('v2reader');
      }
      await denied(
        () => api('governance', 'appeal', { sanction_id: sid, body: '네 번째 신청' }),
        /RATE_LIMIT/,
      );
      assert.equal(
        (await api('governance', 'mine')).sanctions.find((s) => s.id === sid).can_appeal,
        false,
      );
      await call('save_profile', { nickname: 'v2reader', notifications_enabled: false });
      const pref = await v2('preferences');
      await v2('save_preferences', {
        ...pref,
        comment_enabled: false,
        notice_enabled: false,
        mention_enabled: false,
        subscription_enabled: false,
        report_enabled: false,
      });
      await as('admin');
      const before = await v2('unread');
      const own = await api('governance', 'rights', { body: '관리자 본인의 문의 접수 확인' });
      assert.equal((await v2('unread')).version, before.version);
      await api('governance', 'apply', {
        target_id: users.v2reader,
        level: 'warning',
        reason: '필수 통지 검증',
        rule: '운영 규정',
        operation_id: randomUUID(),
      });
      await as('v2reader');
      assert.equal(
        (await v2('notifications')).items.some((n) => n.type === 'sanction' && n.important),
        true,
      );
      await reset();
      await db.query('delete from private.feedback where id=$1', [own.id]);
      await db.query(
        "update private.profiles set suspended_until=now()+interval '1 day' where id=$1",
        [users.v2reader],
      );
      await as('v2reader');
      for (const action of ['notifications', 'activity', 'preferences', 'push_devices'])
        await denied(() => v2(action), /SUSPENDED/);
      assert.ok((await api('governance', 'mine')).sanctions.length);
    },
  );
  await ok('탈퇴 시 V2 알림·설정·북마크·구독·멘션·기기·전송 로그 정리', async () => {
    await reset();
    for (const name of identities)
      await db.query('delete from auth.users where id=$1', [users[name]]);
    for (const table of [
      'notification_preferences',
      'post_subscriptions',
      'bookmarks',
      'push_subscriptions',
      'notification_deliveries',
    ]) {
      assert.equal(
        (
          await db.query(`select count(*) n from private.${table} where user_id=any($1::uuid[])`, [
            identities.map((name) => users[name]),
          ])
        ).rows[0].n,
        0,
      );
    }
    assert.equal(
      (await db.query('select count(*) n from private.notification_delivery_logs')).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          'select count(*) n from private.mentions where actor_id=any($1::uuid[]) or recipient_id=any($1::uuid[])',
          [identities.map((name) => users[name])],
        )
      ).rows[0].n,
      0,
    );
  });
  await reset();
}
