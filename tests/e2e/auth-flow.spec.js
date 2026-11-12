import { test, expect } from './test.js';
import { agreeSignup } from './school.js';
test('가입 성공 시 복구 코드를 한 번 표시하고 이메일 인증을 요구하지 않는다', async ({ page }) => {
  await page.route('**/functions/v1/accounts', async (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      });
    const body = route.request().postDataJSON();
    expect(body.action).toBe('signup');
    expect(body.username).toBe('schoolfriend');
    expect(body.password).toBe('eight888');
    expect('email' in body).toBe(false);
    return route.fulfill({
      status: 201,
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: { ok: true, recovery_code: 'a'.repeat(64) },
    });
  });
  await page.goto('/#/signup');
  await page.getByLabel('아이디', { exact: true }).fill('SchoolFriend');
  await page.getByLabel('비밀번호', { exact: true }).fill('eight888');
  await agreeSignup(page);
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  await expect(page.getByRole('heading', { name: '가입이 완료되었어요' })).toBeVisible();
  await expect(page.locator('.recovery-code')).toHaveText(Array(8).fill('aaaaaaaa').join('-'));
  await expect(page.getByRole('link', { name: '코드를 보관했어요 · 로그인하기' })).toBeVisible();
});
test('아이디 로그인은 내부 식별자로 전달하고 입력한 비밀번호를 사용한다', async ({ page }) => {
  let requested = false;
  await page.route('**/auth/v1/token?grant_type=password', async (route) => {
    requested = true;
    const body = route.request().postDataJSON();
    expect(body.email).toBe('schoolfriend@accounts.schoolpot.invalid');
    expect(body.password).toBe('eight888');
    await route.fulfill({
      status: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
  });
  await page.goto('/#/login');
  await page.getByLabel('아이디', { exact: true }).fill('SchoolFriend');
  await page.getByLabel('비밀번호', { exact: true }).fill('eight888');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.locator('.form-status')).toContainText('아이디와 비밀번호');
  expect(requested).toBe(true);
});
