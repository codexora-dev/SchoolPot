import { enrolled, schoolSetup } from './school.js';
import { test, expect } from './test.js';
import { boards } from './boards.js';
const id = '99999999-9999-4999-8999-999999999999';
const key = 'sb-hlglstdtgcodblynicmh-auth-token';
const user = {
  id,
  email: 'sessionqa@accounts.schoolpot.invalid',
  app_metadata: {},
  user_metadata: {},
};
async function mock(context) {
  await context.route('**/rest/v1/rpc/school_setup', (r) => r.fulfill({ json: schoolSetup }));
  await context.route('**/rest/v1/rpc/site_popups', (r) => r.fulfill({ json: [] }));
  await context.route('**/rest/v1/rpc/board_catalog', (r) => r.fulfill({ json: boards }));
  await context.route('**/auth/v1/user', (r) => r.fulfill({ json: user }));
  await context.route('**/auth/v1/token?grant_type=password', (r) =>
    r.fulfill({
      json: {
        user,
        access_token: 'test-session',
        refresh_token: 'test-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    }),
  );
  await context.route('**/auth/v1/logout*', (r) => r.fulfill({ status: 204 }));
  await context.route('**/rest/v1/rpc/community', (r) =>
    r.fulfill({
      json:
        r.request().postDataJSON().p_action === 'me'
          ? {
              profile: { nickname: '자동로그인친구', notifications_enabled: true },
              ...enrolled,
              is_admin: false,
            }
          : [],
    }),
  );
}
async function login(page, remember) {
  await page.goto('/#/login');
  await page.getByLabel('자동로그인', { exact: true }).setChecked(remember);
  await page.getByLabel('아이디', { exact: true }).fill('sessionqa');
  await page.getByLabel('비밀번호', { exact: true }).fill('strong88888');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '자동로그인친구님, 오늘도 반가워요.' }),
  ).toBeVisible();
}
async function stored(page) {
  return page.evaluate(
    (key) => ({
      local: localStorage.getItem(key),
      session: sessionStorage.getItem(key),
      remember: localStorage.getItem('schoolpot-remember-login'),
      raw: JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
    }),
    key,
  );
}
for (const remember of [false, true])
  test(`자동로그인 ${remember ? '선택' : '해제'} 시 새 브라우저 세션 복원과 로그아웃 정리`, async ({
    page,
    browser,
  }) => {
    await mock(page.context());
    await login(page, remember);
    const data = await stored(page);
    expect(Boolean(data.local)).toBe(remember);
    expect(Boolean(data.session)).toBe(!remember);
    expect(data.raw).not.toContain('strong88888');
    await page.reload();
    await expect(
      page.getByRole('heading', { name: '자동로그인친구님, 오늘도 반가워요.' }),
    ).toBeVisible();
    const next = await browser.newContext({
      storageState: await page.context().storageState(),
      baseURL: 'http://127.0.0.1:4173',
    });
    try {
      await mock(next);
      const other = await next.newPage();
      await other.goto('/#/profile');
      await expect(
        other.getByRole('heading', {
          name: remember ? '나의 스쿨팟' : '로그인하고 함께해요',
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      await next.close();
    }
    await page.getByLabel('계정 메뉴', { exact: true }).click();
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '우리 학교의 이야기가 모이는 곳' }),
    ).toBeVisible();
    const out = await stored(page);
    expect(out.local).toBe(null);
    expect(out.session).toBe(null);
    expect(out.remember).toBe(null);
  });
test('계정 메뉴에서 탈퇴 확인·잘못된 비밀번호·처리 중 중복 요청 방지·탈퇴 후 정리', async ({
  page,
}) => {
  await mock(page.context());
  await login(page, true);
  await page.evaluate((id) => localStorage.setItem(`schoolpot-draft:${id}`, 'temporary draft'), id);
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/functions/v1/delete-account', async (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      });
    calls++;
    const body = route.request().postDataJSON();
    if (body.password === 'wrong-pass')
      return route.fulfill({
        status: 403,
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: { error: 'REAUTHENTICATION_FAILED' },
      });
    expect(body).toEqual({ password: 'strong88888' });
    await pending;
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { ok: true } });
  });
  await page.getByLabel('계정 메뉴', { exact: true }).click();
  await page.getByRole('link', { name: '계정 관리 · 회원탈퇴', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole('button', { name: '회원 탈퇴', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '회원탈퇴 확인', exact: true });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/account-delete-mobile.png' });
  await dialog.getByLabel('현재 비밀번호', { exact: true }).fill('wrong-pass');
  await dialog.getByLabel('탈퇴 확인', { exact: true }).fill('잘못된 확인');
  await dialog.getByRole('button', { name: '계정 삭제', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('탈퇴를 정확히');
  expect(calls).toBe(0);
  await dialog.getByLabel('탈퇴 확인', { exact: true }).fill('탈퇴');
  await dialog.getByRole('button', { name: '계정 삭제', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('현재 비밀번호가 올바르지');
  expect(calls).toBe(1);
  await dialog.getByLabel('현재 비밀번호', { exact: true }).fill('strong88888');
  await dialog.getByRole('button', { name: '계정 삭제', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '계정 삭제', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(page.getByRole('heading', { name: '우리 학교의 이야기가 모이는 곳' })).toBeVisible();
  expect(calls).toBe(2);
  const out = await stored(page);
  expect(out.local).toBe(null);
  expect(out.session).toBe(null);
  expect(out.remember).toBe(null);
  expect(await page.evaluate((id) => localStorage.getItem(`schoolpot-draft:${id}`), id)).toBe(null);
  await page.goto('/#/profile');
  await expect(page.getByRole('heading', { name: '로그인하고 함께해요' })).toBeVisible();
});
test('모바일 로그인 눈 아이콘은 입력창 오른쪽에 표시되고 키보드로 토글한다', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/#/login');
  const input = page.getByLabel('비밀번호', { exact: true });
  const toggle = page.getByRole('button', { name: '비밀번호 표시', exact: true });
  await expect(toggle.locator('svg')).toHaveCount(1);
  expect(await toggle.getAttribute('aria-controls')).toBe(await input.getAttribute('id'));
  const b = await toggle.boundingBox(),
    i = await input.boundingBox();
  expect(b.x + b.width).toBeLessThanOrEqual(i.x + i.width);
  expect(b.width).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: 'docs/screenshots/login-options-mobile.png' });
  await input.fill('strong88888');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(input).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: '비밀번호 숨기기', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Space');
  await expect(input).toHaveAttribute('type', 'password');
  await expect(input).toHaveValue('strong88888');
});
