import { test, expect } from './test.js';
test('홈과 모바일 레이아웃', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '우리 학교의 이야기가 모이는 곳' })).toBeVisible();
  await expect(page.getByRole('link', { name: '스쿨팟 시작하기 ↗' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: '모바일 메뉴' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('회원가입은 이메일 없이 아이디와 8자리 이상 비밀번호로 구성', async ({ page }) => {
  await page.goto('/#/signup');
  await expect(page.getByLabel('아이디', { exact: true })).toBeVisible();
  await expect(page.getByLabel('이메일', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('닉네임', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('비밀번호', { exact: true })).toHaveAttribute('minlength', '8');
  await expect(
    page.getByText('아이디와 비밀번호만으로 시작하세요. 이메일 인증은 없어요.'),
  ).toBeVisible();
});
test('비로그인 글쓰기·관리자 접근 차단', async ({ page }) => {
  for (const route of ['/write', '/admin', '/post/invalid']) {
    await page.goto('/#' + route);
    await expect(page.getByRole('heading', { name: '로그인하고 함께해요' })).toBeVisible();
    await expect(page.getByRole('button', { name: '게시하기' })).toHaveCount(0);
  }
});
test('다크모드와 내비게이션', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '다크 모드로 전환', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: '이용 안내', exact: true }).click();
  await expect(page.getByRole('heading', { name: '스쿨팟 이용 안내' })).toBeVisible();
});
test('검색어에 HTML을 넣어도 실행하지 않는다', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { el } = await import('/src/lib/dom.js');
    document
      .querySelector('#main')
      .append(el('p', { id: 'xss-test' }, '<img src=x onerror="window.xss=1">'));
  });
  await expect(page.locator('#xss-test')).toHaveText('<img src=x onerror="window.xss=1">');
  await expect(page.locator('#xss-test img')).toHaveCount(0);
  expect(await page.evaluate(() => window.xss)).toBeUndefined();
});
