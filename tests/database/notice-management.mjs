import assert from 'node:assert/strict';
export async function noticeManagementTests({ db, as, call, ok, denied, users }) {
  const api = async (action, payload = {}) =>
    (
      await db.query('select public.manage_notices($1,$2::jsonb) result', [
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].result;
  await db.exec('reset role;delete from private.rate_limits');
  let saved;
  await ok('공지 관리 전체 작업은 일반 회원·권한 위조·비회원에게 차단', async () => {
    await as('', 'anon');
    await denied(() => api('list'), /permission denied/);
    await as('a');
    for (const action of ['list', 'get', 'save', 'delete'])
      await denied(
        () =>
          api(action, {
            id: users.admin,
            title: '위조 공지',
            body: '본문',
            is_admin: true,
            role: 'admin',
            user_id: users.admin,
          }),
        /FORBIDDEN/,
      );
  });
  await ok('관리자 공지 등록·목록·본문·미리보기 데이터와 새 알림은 기존 흐름 사용', async () => {
    await as('admin');
    saved = await api('save', {
      title: '관리 기능 공지',
      body: '**원래 본문**',
      content_format: 'markdown',
    });
    const list = await api('list', { query: '관리 기능 공지' });
    assert.equal(list.length, 1);
    assert.equal('body' in list[0], false);
    assert.equal('author_id' in list[0], false);
    assert.equal(list[0].revision, 1);
    const item = await api('get', { id: saved.id });
    assert.equal(item.body, '**원래 본문**');
    assert.equal(item.content_format, 'markdown');
    assert.equal('author_id' in item, false);
  });
  await ok(
    '공지 수정은 작성자·작성일을 보존하고 알림을 재발송하지 않으며 버전 충돌을 거부',
    async () => {
      await db.exec('reset role');
      const before = (await db.query('select * from private.notices where id=$1', [saved.id]))
        .rows[0];
      const notifications = (await db.query('select count(*) n from private.notifications')).rows[0]
        .n;
      await as('admin');
      await api('save', {
        id: saved.id,
        revision: 1,
        title: '수정된 관리 기능 공지',
        body: '<h2>새 본문</h2>',
        content_format: 'html',
        author_id: users.a,
      });
      const changed = await api('get', { id: saved.id });
      assert.equal(changed.revision, 2);
      assert.equal(changed.body, '<h2>새 본문</h2>');
      assert.equal(changed.content_format, 'html');
      await denied(
        () =>
          api('save', {
            id: saved.id,
            revision: 1,
            title: '덮어쓰기',
            body: '잘못된 본문',
            content_format: 'text',
          }),
        /STALE_NOTICE/,
      );
      await denied(() => api('delete', { id: saved.id, revision: 1 }), /STALE_NOTICE/);
      await denied(
        () =>
          api('save', {
            id: saved.id,
            revision: 2,
            title: '잘못된 형식',
            body: '내용',
            content_format: 'script',
          }),
        /INVALID_INPUT/,
      );
      await db.exec('reset role');
      const after = (await db.query('select * from private.notices where id=$1', [saved.id]))
        .rows[0];
      assert.equal(after.author_id, before.author_id);
      assert.equal(after.created_at.getTime(), before.created_at.getTime());
      assert.equal(
        (await db.query('select count(*) n from private.notifications')).rows[0].n,
        notifications,
      );
    },
  );
  await ok('공지 관리 삭제·감사와 현재 세션·이용 제한 검사를 유지', async () => {
    await as('admin');
    await api('delete', { id: saved.id, revision: 2 });
    await denied(() => api('get', { id: saved.id }), /NOT_FOUND/);
    const audit = await call('admin_audit');
    assert.ok(audit.some((a) => a.action === 'notice_save'));
    assert.ok(audit.some((a) => a.action === 'notice_delete'));
    await db.exec('reset role');
    await db.query(
      "update private.profiles set suspended_until=now()+interval '1 day' where id=$1",
      [users.admin],
    );
    await as('admin');
    await denied(() => api('list'), /SUSPENDED/);
    await db.exec('reset role');
    await db.query('update private.profiles set suspended_until=null where id=$1', [users.admin]);
    await db.query('delete from auth.sessions where user_id=$1', [users.admin]);
    await as('admin');
    await denied(() => api('list'), /AUTH_REQUIRED/);
    await db.exec('reset role');
    await db.query('insert into auth.sessions values($1,$1)', [users.admin]);
  });
}
