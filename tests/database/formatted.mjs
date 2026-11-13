import assert from 'node:assert/strict';
export async function formattedTests({ db, as, call, ok, denied }) {
  const popup = async (action, payload = {}) =>
    (
      await db.query('select public.manage_popups($1,$2::jsonb) result', [
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].result;
  await db.exec('reset role; delete from private.rate_limits;');
  await ok('서식 작성도 일반 회원의 관리자 위조를 허용하지 않는다', async () => {
    await as('a');
    await denied(
      () =>
        call('admin_notice', {
          title: '위조 공지',
          body: '<b>내용</b>',
          content_format: 'html',
          is_admin: true,
        }),
      /FORBIDDEN/,
    );
    await denied(
      () =>
        popup('save', {
          title: '위조 팝업',
          body: '<b>내용</b>',
          content_format: 'html',
          close_options: ['once'],
          is_admin: true,
        }),
      /FORBIDDEN/,
    );
  });
  await ok('공지 Text·Markdown·HTML 저장·응답과 미지원 형식 차단', async () => {
    await as('admin');
    for (const format of ['text', 'markdown', 'html']) {
      const saved = await call('admin_notice', {
        title: '서식 ' + format,
        body: '**본문** <b>안내</b>',
        content_format: format,
      });
      const item = (await call('notices')).find((n) => n.id === saved.id);
      assert.equal(item.content_format, format);
      assert.equal(item.body, '**본문** <b>안내</b>');
      assert.equal('author_id' in item, false);
    }
    await denied(
      () => call('admin_notice', { title: '지원 안 됨', body: '내용', content_format: 'script' }),
      /INVALID_INPUT/,
    );
    const saved = await call('admin_notice', {
      title: '기존 입력 호환',
      body: '<b>문자 그대로</b>',
    });
    assert.equal((await call('notices')).find((n) => n.id === saved.id).content_format, 'text');
  });
  await ok('팝업 공개 서식 projection·형식 변경 버전 증가·잘못된 형식 거부', async () => {
    await as('admin');
    const value = {
      title: '서식 팝업',
      body: '**안내**',
      close_options: ['once'],
      is_active: true,
      content_format: 'markdown',
    };
    const saved = await popup('save', value);
    await as('', 'anon');
    const items = (await db.query('select public.site_popups() result')).rows[0].result;
    assert.equal(items.find((p) => p.id === saved.id).content_format, 'markdown');
    assert.equal('created_by' in items[0], false);
    await as('admin');
    const original = (await popup('list')).find((p) => p.id === saved.id);
    await popup('save', { ...original, content_format: 'html' });
    const changed = (await popup('list')).find((p) => p.id === saved.id);
    assert.equal(changed.revision, original.revision + 1);
    await denied(() => popup('save', { ...original, content_format: 'text' }), /STALE_POPUP/);
    await denied(() => popup('save', { ...changed, content_format: 'invalid' }), /INVALID_INPUT/);
    await popup('delete', { id: changed.id, revision: changed.revision });
  });
}
