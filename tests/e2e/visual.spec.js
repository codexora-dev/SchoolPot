import { test, expect } from './test.js';
test('데스크톱·모바일 화면 캡처와 콘솔 오류 확인', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.locator('.hero')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/home-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/screenshots/home-mobile.png', fullPage: true });
  await page.goto('/#/signup');
  await page.screenshot({ path: 'docs/screenshots/signup-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
