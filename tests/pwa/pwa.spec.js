import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
async function setup(page) {
  await page.route('**/*.supabase.co/**', (route) =>
    route.fulfill({ status: 400, json: { code: 'PGRST202', message: 'test fixture' } }),
  );
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
}
test('하위 경로 manifest·아이콘·Service Worker 설치 및 민감 데이터 미캐시', async ({
  page,
  request,
}) => {
  await setup(page);
  const manifest = await (await request.get('manifest.webmanifest')).json();
  expect(manifest.name).toBe('SchoolPot');
  expect(manifest.short_name).toBe('스쿨팟');
  expect(manifest.scope).toBe('./');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  const cache = await page.evaluate(async () =>
    (
      await Promise.all(
        (await window.caches.keys()).map(async (key) =>
          (await (await window.caches.open(key)).keys()).map((req) => req.url),
        ),
      )
    ).flat(),
  );
  expect(cache.some((url) => url.includes('/assets/'))).toBe(true);
  expect(
    cache.some(
      (url) => /supabase|token|auth|rpc/.test(new URL(url).pathname) && !url.includes('/assets/'),
    ),
  ).toBe(false);
  await page.goto('./#/app-install');
  await expect(page.getByRole('heading', { name: '앱 설치 안내', exact: true })).toBeVisible();
});
test('오프라인 새로고침·복구 안내·모바일 폭', async ({ page, context }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '인터넷 연결을 기다리고 있어요' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mkdir('tests/.local/v2', { recursive: true });
  await page.screenshot({ path: 'tests/.local/v2/offline-mobile.png', fullPage: true });
  await context.setOffline(false);
  await expect(page.getByRole('status')).toHaveText('연결이 복구됐어요. 다시 시도를 눌러 주세요.');
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('heading', { name: '인터넷 연결을 기다리고 있어요' })).toHaveCount(0);
});
test('새 worker 감지·업데이트 보류·입력 확인·명시적 적용·저장 상태 보존', async ({ page }) => {
  await setup(page);
  const original = await readFile('dist/sw.js', 'utf8');
  try {
    await page.evaluate(() => {
      localStorage.setItem('v2-update-test', 'preserved');
      window.updateSentinel = true;
      const input = document.createElement('textarea');
      input.value = '작성 중인 글';
      input.id = 'draft-fixture';
      document.body.append(input);
    });
    await writeFile(
      'dist/sw.js',
      original.replace(/const VERSION = '([^']+)'/, "const VERSION = '$1-test-update'"),
    );
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration()).update();
    });
    await expect(page.getByText('새 버전이 준비됐어요')).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => window.updateSentinel)).toBe(true);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: '업데이트 적용', exact: true }).click();
    expect(await page.evaluate(() => window.updateSentinel)).toBe(true);
    await expect(page.locator('#draft-fixture')).toHaveValue('작성 중인 글');
    page.once('dialog', (dialog) => dialog.accept());
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: '업데이트 적용', exact: true }).click(),
    ]);
    expect(await page.evaluate(() => window.updateSentinel)).toBeUndefined();
    expect(await page.evaluate(() => localStorage.getItem('v2-update-test'))).toBe('preserved');
    const names = await page.evaluate(() => window.caches.keys());
    expect(names.length).toBeLessThanOrEqual(2);
  } finally {
    await writeFile('dist/sw.js', original);
  }
});
