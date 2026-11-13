import { test, expect } from './test.js';
import { enrolled } from './school.js';
const id = '88000000-0000-4000-8000-000000000001';
async function setup(page) {
  const uid = '11111111-1111-4111-8111-111111111111';
  await page.addInitScript(
    ({ uid }) => {
      localStorage.setItem('schoolpot-remember-login', 'true');
      localStorage.setItem(
        'sb-hlglstdtgcodblynicmh-auth-token',
        JSON.stringify({
          user: { id: uid },
          access_token: 'test-session',
          refresh_token: 'test-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
        }),
      );
    },
    { uid },
  );
  await page.route('**/auth/v1/user', (r) =>
    r.fulfill({ json: { id: uid, app_metadata: {}, user_metadata: {} } }),
  );
  const store = {
    items: [
      {
        id,
        title: '기존 공지',
        body: '## 기존 내용\n\n**중요 안내**',
        content_format: 'markdown',
        revision: 1,
        created_at: '2026-11-13T05:00:00Z',
        updated_at: '2026-11-13T05:00:00Z',
      },
    ],
    saved: [],
    deleted: [],
  };
  await page.route('**/rest/v1/rpc/community', (r) => {
    const { p_action, p_payload } = r.request().postDataJSON();
    return r.fulfill({
      json:
        p_action === 'me'
          ? { profile: { nickname: '공지 관리자' }, ...enrolled, is_admin: true }
          : p_action === 'get_notice'
            ? store.items.find((n) => n.id === p_payload.id)
            : [],
    });
  });
  await page.route('**/rest/v1/rpc/manage_notices', (r) => {
    const { p_action, p_payload } = r.request().postDataJSON();
    if (p_action === 'list')
      return r.fulfill({
        json: store.items
          .filter((n) => n.title.includes(p_payload.query || ''))
          .map(({ body, ...meta }) => {
            void body;
            return meta;
          }),
      });
    const item = store.items.find((n) => n.id === p_payload.id);
    if (p_action === 'get') return r.fulfill({ json: item });
    if (item && item.revision !== p_payload.revision)
      return r.fulfill({ status: 400, json: { code: 'P0001', message: 'STALE_NOTICE' } });
    if (p_action === 'delete') {
      store.deleted.push(p_payload);
      store.items = store.items.filter((n) => n.id !== p_payload.id);
      return r.fulfill({ json: { ok: true } });
    }
    store.saved.push(p_payload);
    store.items = [
      {
        ...p_payload,
        id,
        revision: (item?.revision || 0) + 1,
        created_at: item?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    return r.fulfill({ json: { ok: true, id } });
  });
  return store;
}
test('관리 목록에서 공지를 미리보고 기존 서식·본문을 수정한 후 확인 삭제한다', async ({ page }) => {
  const store = await setup(page);
  await page.goto('/#/admin?tab=notice');
  await expect(page.getByRole('heading', { name: '공지사항 관리', exact: true })).toBeVisible();
  await expect(page.locator('.notice-admin-card')).toContainText('기존 공지');
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '공지 미리보기', exact: true });
  await expect(dialog.locator('strong')).toHaveText('중요 안내');
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '수정', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '공지 수정', exact: true });
  await expect(dialog.getByLabel('작성 형식', { exact: true })).toHaveValue('markdown');
  await expect(dialog.getByLabel('내용', { exact: true })).toHaveValue(
    '## 기존 내용\n\n**중요 안내**',
  );
  await dialog.getByLabel('제목', { exact: true }).fill('수정한 공지');
  await dialog.getByLabel('작성 형식', { exact: true }).selectOption('html');
  await dialog
    .getByLabel('내용', { exact: true })
    .fill('<h2>수정 내용</h2><strong>새 안내</strong>');
  await dialog.getByRole('button', { name: '수정 저장', exact: true }).click();
  await expect(page.locator('.notice-admin-card')).toContainText('수정한 공지');
  expect(store.saved[0]).toMatchObject({ id, revision: 1, content_format: 'html' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'docs/screenshots/notice-manager-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '공지 삭제 확인', exact: true });
  expect(store.deleted).toHaveLength(0);
  await dialog.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '등록된 공지가 없어요', exact: true }),
  ).toBeVisible();
  expect(store.deleted[0]).toMatchObject({ id, revision: 2 });
});
test('다른 관리자가 먼저 수정한 공지는 덮어쓰지 않고 입력을 유지한다', async ({ page }) => {
  const store = await setup(page);
  await page.goto('/#/admin?tab=notice');
  await page.getByRole('button', { name: '수정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '공지 수정', exact: true });
  await dialog.getByLabel('제목', { exact: true }).fill('아직 저장하지 않은 제목');
  store.items[0] = { ...store.items[0], revision: 2, title: '다른 관리자가 저장한 제목' };
  await dialog.getByRole('button', { name: '수정 저장', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('다른 관리자가 공지를 변경');
  await expect(dialog.getByLabel('제목', { exact: true })).toHaveValue('아직 저장하지 않은 제목');
  expect(store.saved).toHaveLength(0);
});
test('공지 상세의 수정 버튼도 같은 편집기를 열고 수정 결과를 표시한다', async ({ page }) => {
  await setup(page);
  await page.goto('/#/notice/' + id);
  await page.getByRole('button', { name: '공지 수정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '공지 수정', exact: true });
  await dialog.getByLabel('제목', { exact: true }).fill('상세에서 수정한 공지');
  await dialog.getByRole('button', { name: '수정 저장', exact: true }).click();
  await expect(page.locator('.notice-detail h1')).toHaveText('상세에서 수정한 공지');
});
