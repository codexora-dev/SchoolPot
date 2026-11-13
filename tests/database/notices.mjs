import assert from 'node:assert/strict';
export async function noticeTests({ db, as, call, ok, denied, users }) {
  await db.exec('reset role;delete from private.rate_limits');
  await db.query(
    `insert into private.notices(author_id,title,body,content_format,created_at)
    select $1,'목록 검증 '||lpad(i::text,2,'0'),'<strong>본문 비공개 목록</strong>','html',now()-i*interval '1 minute' from generate_series(1,26)i`,
    [users.admin],
  );
  await ok('공지 목록은 제목·날짜만 제공하고 검색·페이지를 일관되게 나눈다', async () => {
    await as('a');
    const first = await call('notice_list', { query: '목록 검증' });
    const next = await call('notice_list', { query: '목록 검증', offset: 20 });
    assert.equal(first.length, 20);
    assert.equal(next.length, 6);
    assert.deepEqual(Object.keys(first[0]).sort(), ['created_at', 'id', 'title']);
    assert.equal(first[0].title, '목록 검증 01');
    assert.equal(next[0].title, '목록 검증 21');
    assert.equal(new Set([...first, ...next].map((n) => n.id)).size, 26);
    assert.equal((await call('notice_list', { query: '목록 검증 26' })).length, 1);
    assert.equal((await call('notice_list', { query: "' OR true --" })).length, 0);
  });
  await ok('개별 공지는 첫 페이지 밖의 ID도 조회하되 작성자 정보는 반환하지 않는다', async () => {
    await as('a');
    const item = (await call('notice_list', { query: '목록 검증', offset: 20 }))[5];
    const detail = await call('get_notice', { id: item.id });
    assert.equal(detail.title, '목록 검증 26');
    assert.equal(detail.content_format, 'html');
    assert.equal(detail.body, '<strong>본문 비공개 목록</strong>');
    assert.equal('author_id' in detail, false);
    await denied(
      () => call('get_notice', { id: '99999999-9999-4999-8999-999999999999' }),
      /NOT_FOUND/,
    );
  });
  await ok('공지 목록·개별 API도 비회원·없는 세션·미등록 소속을 차단한다', async () => {
    await as('', 'anon');
    await denied(() => call('notice_list'), /permission denied/);
    await denied(() => call('get_notice', { id: users.a }), /permission denied/);
    await db.exec('reset role');
    await db.query('delete from auth.sessions where user_id=$1', [users.b]);
    await as('b');
    await denied(() => call('notice_list'), /AUTH_REQUIRED/);
    await denied(() => call('get_notice', { id: users.a }), /AUTH_REQUIRED/);
    await db.exec('reset role');
    await db.query('insert into auth.sessions values($1,$1)', [users.b]);
    await db.query('delete from private.memberships where user_id=$1', [users.b]);
    await as('b');
    await denied(() => call('notice_list'), /MEMBERSHIP_REQUIRED/);
    await denied(() => call('get_notice', { id: users.a }), /MEMBERSHIP_REQUIRED/);
    await db.exec('reset role');
  });
}
