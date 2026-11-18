import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
if (process.env.SCHOOLPOT_V2_LIVE_TEST !== '1') throw new Error('Explicit live QA opt-in required');
const qa = JSON.parse(await readFile('tests/.local/v2/hosted-qa.json', 'utf8'));
const root = 'https://codexora-dev.github.io/SchoolPot/';
const html = await (await fetch(root + '?verify=' + Date.now(), { cache: 'no-store' })).text();
assert.ok(
  html.includes('name="schoolpot-version" content="2.0.0"'),
  'Production V2 build required',
);
const context = await chromium.launchPersistentContext('tests/.local/v2/push-browser', {
  channel: 'chrome',
  headless: true,
  ignoreDefaultArgs: ['--disable-background-networking'],
  viewport: { width: 390, height: 844 },
});
const report = {
  productionV2: true,
  authenticatedSettings: false,
  serviceWorker: false,
  subscription: false,
  received: false,
};
try {
  await context.grantPermissions(['notifications'], { origin: new URL(root).origin });
  await context.addInitScript((session) => {
    localStorage.setItem('schoolpot-remember-login', 'true');
    localStorage.setItem('sb-hlglstdtgcodblynicmh-auth-token', JSON.stringify(session));
  }, qa.accounts[0].session);
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(root + '#/notification-settings');
  await page.getByRole('heading', { name: '알림 설정', exact: true }).waitFor();
  report.authenticatedSettings = true;
  for (let i = 0; i < 3 && (await page.locator('dialog[open]').count()); i++)
    await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  report.serviceWorker = true;
  await page.getByRole('button', { name: '이 기기 알림 연결', exact: true }).click();
  for (let i = 0; i < 30; i++) {
    report.subscription = await page.evaluate(async () =>
      Boolean(await (await navigator.serviceWorker.ready).pushManager.getSubscription()),
    );
    if (report.subscription) break;
    const toast = await page.locator('#toast').textContent();
    if (/push service|Registration failed|not supported|not allowed/i.test(toast || '')) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await mkdir('tests/.local/v2', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'tests/.local/v2/production-settings-mobile.png', fullPage: true });
  if (report.subscription) {
    await writeFile('tests/.local/v2/push-ready.json', JSON.stringify({ uid: qa.accounts[0].uid }));
    console.log('Production Chrome subscribed; ready for private QA push event.');
    for (let i = 0; i < 90; i++) {
      report.received = await page.evaluate(
        async () => (await (await navigator.serviceWorker.ready).getNotifications()).length > 0,
      );
      if (report.received) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await page.getByRole('button', { name: '이 기기 알림 해제', exact: true }).click();
  } else report.reason = 'PUSH_SERVICE_REGISTRATION_UNAVAILABLE_IN_AUTOMATED_CHROME';
  await writeFile('tests/.local/v2/production-browser-report.json', JSON.stringify(report));
  console.log(JSON.stringify(report));
} finally {
  await context.close();
}
