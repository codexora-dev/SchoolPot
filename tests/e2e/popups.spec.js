import { enrolled } from './school.js';
import { test, expect } from './test.js';
const id = '77777777-7777-4777-8777-777777777777';
const popup = {
  id,
  revision: 1,
  title: '학교 안내 팝업',
  body: '첫 번째 안내입니다.\n<img src=x onerror="window.popupXss=1">',
  close_options: ['once', 'today', 'forever'],
};
async function published(page, items = [popup]) {
  await page.route('**/rest/v1/rpc/site_popups', (route) =>
    route.fulfill({ json: typeof items === 'function' ? items() : items }),
  );
}
test('비회원 첫 진입 시 표시하고 본문 HTML은 실행하지 않는다', async ({ page }) => {
  await published(page);
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: popup.title, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.site-popup-body')).toHaveText(popup.body);
  await expect(dialog.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.popupXss)).toBeUndefined();
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto('/#/boards');
  await expect(page.getByRole('heading', { name: '우리 학교 게시판' })).toBeVisible();
  await expect(page.locator('.site-popup')).toHaveCount(0);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('dialog', { name: popup.title, exact: true })).toBeVisible();
});
test('오늘 하루 보지 않기는 새로고침 후에도 유지된다', async ({ page }) => {
  await published(page);
  await page.goto('/');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '오늘 하루 보지 않기', exact: true })
    .click();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.site-popup')).toHaveCount(0);
});
test('다시 보지 않기는 유지되며 내용 버전이 바뀌면 다시 표시된다', async ({ page }) => {
  let version = 1;
  await published(page, () => [{ ...popup, revision: version }]);
  await page.goto('/');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '다시 보지 않기', exact: true })
    .click();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.site-popup')).toHaveCount(0);
  version = 2;
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('dialog', { name: popup.title, exact: true })).toBeVisible();
});
test('허용된 닫기 옵션만 제공하고 Escape로 닫을 수 있다', async ({ page }) => {
  await published(page, [{ ...popup, close_options: ['once'] }]);
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: popup.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '오늘 하루 보지 않기', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: '다시 보지 않기', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.site-popup')).toHaveCount(0);
});
test('여러 팝업은 겹치지 않고 순서대로 표시된다', async ({ page }) => {
  await published(page, [
    popup,
    { ...popup, id: '88888888-8888-4888-8888-888888888888', title: '두 번째 안내' },
  ]);
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: popup.title, exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '팝업 닫기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '두 번째 안내', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
});
test('모바일의 긴 팝업도 화면 안에 표시되고 닫힌다', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await published(page, [{ ...popup, body: '긴 학교 안내입니다.\n'.repeat(150) }]);
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: popup.title, exact: true });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.height).toBeLessThanOrEqual(667);
  await page.screenshot({ path: 'docs/screenshots/popup-mobile.png' });
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
async function admin(page) {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'test@accounts.schoolpot.invalid',
    app_metadata: {},
    user_metadata: {},
  };
  await page.addInitScript(
    ({ user }) => {
      localStorage.setItem('schoolpot-remember-login', 'true');
      localStorage.setItem(
        'sb-hlglstdtgcodblynicmh-auth-token',
        JSON.stringify({
          user,
          access_token: 'test-session',
          refresh_token: 'test-refresh',
          token_type: 'bearer',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
        }),
      );
    },
    { user },
  );
  await page.route('**/auth/v1/user', (route) => route.fulfill({ json: user }));
  await page.route('**/rest/v1/rpc/community', (route) =>
    route.fulfill({
      json:
        route.request().postDataJSON().p_action === 'me'
          ? {
              profile: { nickname: '관리자', notifications_enabled: true },
              ...enrolled,
              is_admin: true,
            }
          : {},
    }),
  );
}
test('관리자 등록·미리보기·중지·수정·삭제와 방문자 표시', async ({ page }) => {
  await admin(page);
  let items = [];
  await page.route('**/rest/v1/rpc/manage_popups', async (route) => {
    const { p_action, p_payload } = route.request().postDataJSON();
    if (p_action === 'list') return route.fulfill({ json: items });
    if (p_action === 'save') {
      expect(p_payload.close_options).toContain('once');
      const existing = items.find((item) => item.id === p_payload.id);
      const item = {
        ...p_payload,
        id: existing?.id || id,
        revision: (existing?.revision || 0) + 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      items = items.filter((row) => row.id !== item.id).concat(item);
      return route.fulfill({ json: { ok: true, id: item.id } });
    }
    if (p_action === 'delete') {
      items = items.filter((item) => item.id !== p_payload.id);
      return route.fulfill({ json: { ok: true } });
    }
  });
  await published(page, () => items.filter((item) => item.is_active));
  await page.goto('/#/admin?tab=popups');
  await expect(page.getByRole('heading', { name: '방문 안내 팝업', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '＋ 팝업 등록', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '새 팝업 등록', exact: true });
  await editor.getByLabel('팝업 제목', { exact: true }).fill('테스트 팝업 등록');
  await editor.getByLabel('팝업 본문', { exact: true }).fill('방문 안내 본문입니다.');
  await editor.getByRole('button', { name: '미리보기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '테스트 팝업 등록', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/popup-preview-desktop.png' });
  await page.locator('.site-popup').getByRole('button', { name: '닫기', exact: true }).click();
  await expect(editor).toBeVisible();
  expect(items.length).toBe(0);
  await editor.getByRole('button', { name: '팝업 등록', exact: true }).click();
  await expect(page.locator('.popup-admin-card')).toContainText('테스트 팝업 등록');
  await page
    .locator('.popup-admin-card')
    .getByRole('button', { name: '게시 중지', exact: true })
    .click();
  await expect(page.locator('.popup-admin-card .board-chip')).toHaveText('게시 중지');
  await page
    .locator('.popup-admin-card')
    .getByRole('button', { name: '게시하기', exact: true })
    .click();
  await page.goto('/#/');
  await expect(page.getByRole('dialog', { name: '테스트 팝업 등록', exact: true })).toBeVisible();
  await page.locator('.site-popup').getByRole('button', { name: '닫기', exact: true }).click();
  await page.goto('/#/admin?tab=popups');
  await page
    .locator('.popup-admin-card')
    .getByRole('button', { name: '수정', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '팝업 수정', exact: true })
    .getByLabel('팝업 제목', { exact: true })
    .fill('수정한 팝업');
  await page.getByRole('button', { name: '수정 저장', exact: true }).click();
  await expect(page.locator('.popup-admin-card')).toContainText('수정한 팝업');
  await page
    .locator('.popup-admin-card')
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '팝업 삭제 확인', exact: true })
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '등록된 팝업이 없어요' })).toBeVisible();
});
