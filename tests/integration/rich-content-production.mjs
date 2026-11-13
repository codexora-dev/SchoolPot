import { chromium, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
const base = process.env.DEPLOYMENT_URL || 'https://codexora-dev.github.io/SchoolPot/';
const browser = await chromium.launch();
const imageUrl = 'https://images.example.test/announcement.png';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIeEAAAAASUVORK5CYII=',
  'base64',
);
try {
  for (const format of ['html', 'markdown']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route(imageUrl, (r) => r.fulfill({ contentType: 'image/png', body: png }));
    const body =
      format === 'html'
        ? `<h2>서식 확인</h2><strong>중요</strong><img src="${imageUrl}" alt="안내 이미지" onerror="window.richXss=1"><script>window.richXss=1</script>`
        : `## 서식 확인\n\n**중요**\n\n![안내 이미지](${imageUrl})`;
    // Browser-local read fixtures; nothing is written or published to the service.
    await page.route('**/rest/v1/rpc/site_popups', (r) =>
      r.fulfill({
        json: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            title: '배포 확인',
            revision: 1,
            body,
            content_format: format,
            close_options: ['once'],
          },
        ],
      }),
    );
    await page.goto(
      base + (process.env.EXPECTED_BUILD ? '?build=' + process.env.EXPECTED_BUILD : ''),
    );
    if (process.env.EXPECTED_BUILD)
      assert.equal(
        await page.locator('meta[name=schoolpot-build]').getAttribute('content'),
        process.env.EXPECTED_BUILD,
      );
    const dialog = page.getByRole('dialog', { name: '배포 확인', exact: true });
    await expect(dialog.getByRole('heading', { name: '서식 확인', exact: true })).toBeVisible();
    await expect(dialog.locator('strong')).toHaveText('중요');
    const img = dialog.getByRole('img', { name: '안내 이미지', exact: true });
    await expect.poll(() => img.evaluate((n) => n.naturalWidth)).toBe(1);
    await expect(dialog.locator('.content-body script,.content-body [onerror]')).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.richXss), undefined);
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.close();
    console.log(
      'PASS published CSP + lazy renderer + HTTPS image + safe ' +
        format +
        ' (browser read fixtures only)',
    );
  }
} finally {
  await browser.close();
}
