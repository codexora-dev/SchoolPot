import { test, expect } from './test.js';
for (const width of [320, 390, 768, 1024, 1440])
  test(`주요 화면은 ${width}px에서 가로 넘침 없이 표시`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/signup', '/boards']) {
      await page.goto('/#' + route);
      await expect(page.locator('main h1,main h2').first()).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    if (width <= 760) {
      for (const item of await page.locator('.mobile-nav a').all()) {
        const size = await item.boundingBox();
        expect(size.width).toBeGreaterThanOrEqual(44);
        expect(size.height).toBeGreaterThanOrEqual(44);
      }
    }
  });
test('모바일 검색창은 검색과 Escape 닫기를 지원한다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '검색 열기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '게시글 검색' })).toBeVisible();
  await page.getByRole('textbox', { name: '게시글 검색', exact: true }).fill('급식 이야기');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '검색 열기', exact: true }).click();
  await page.getByRole('textbox', { name: '게시글 검색', exact: true }).fill('급식 이야기');
  await page.getByRole('dialog').getByRole('button', { name: '검색', exact: true }).click();
  await expect(page).toHaveURL(/search\?q=/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('비밀번호 보기 버튼은 값을 유지하고 폼을 제출하지 않는다', async ({ page }) => {
  await page.goto('/#/signup');
  const input = page.getByLabel('비밀번호', { exact: true });
  await input.fill('testing888');
  await page.getByRole('button', { name: '비밀번호 표시', exact: true }).click();
  await expect(input).toHaveAttribute('type', 'text');
  await expect(input).toHaveValue('testing888');
  await page.getByRole('button', { name: '비밀번호 숨기기', exact: true }).click();
  await expect(input).toHaveAttribute('type', 'password');
  await expect(page.getByRole('heading', { name: '우리 학교 이야기, 함께해요' })).toBeVisible();
});
test('본문 바로가기는 라우터를 변경하지 않고 본문에 포커스를 둔다', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await expect(page.getByRole('heading', { name: '우리 학교의 이야기가 모이는 곳' })).toBeVisible();
});
async function member(page) {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'test@accounts.schoolpot.invalid',
    user_metadata: {},
    app_metadata: {},
    email_confirmed_at: new Date().toISOString(),
  };
  await page.addInitScript(
    ({ user }) =>
      localStorage.setItem(
        'sb-hlglstdtgcodblynicmh-auth-token',
        JSON.stringify({
          user,
          access_token: 'test-session',
          refresh_token: 'test-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
        }),
      ),
    { user },
  );
  await page.route('**/auth/v1/user', (r) => r.fulfill({ json: user }));
  await page.route('**/rest/v1/rpc/community', (r) =>
    r.fulfill({
      json:
        r.request().postDataJSON().p_action === 'me'
          ? {
              profile: {
                nickname: '아주긴닉네임도자연스럽게표시',
                grade: 1,
                notifications_enabled: true,
              },
              is_admin: false,
            }
          : [],
    }),
  );
}
test('계정 드롭다운은 레이아웃을 밀지 않고 화면 안에서 닫힌다', async ({ page }) => {
  await member(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.account-menu')).toBeVisible();
  const before = await page.locator('.header').boundingBox();
  await page.getByLabel('계정 메뉴', { exact: true }).click();
  await expect(page.getByRole('link', { name: '프로필 설정', exact: true })).toBeVisible();
  const menu = await page.locator('.account-popover').boundingBox();
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(390);
  expect((await page.locator('.header').boundingBox()).height).toBe(before.height);
  await page.keyboard.press('Escape');
  await expect(page.locator('.account-menu')).not.toHaveAttribute('open', '');
});
test('글쓰기 선택 메뉴는 필요한 입력만 표시한다', async ({ page }) => {
  await member(page);
  await page.goto('/#/write?board=free');
  const options = page.getByLabel('투표 항목 (투표게시판에서만 사용, 한 줄에 하나)', {
    exact: true,
  });
  await expect(options).toBeHidden();
  await page.getByRole('combobox', { name: '게시판', exact: true }).selectOption('polls');
  await expect(options).toBeVisible();
  await page.getByRole('combobox', { name: '게시판', exact: true }).selectOption('anonymous');
  await expect(options).toBeHidden();
  await expect(page.getByLabel('익명으로 작성', { exact: true })).toBeChecked();
  await expect(page.getByLabel('익명으로 작성', { exact: true })).toBeDisabled();
});
