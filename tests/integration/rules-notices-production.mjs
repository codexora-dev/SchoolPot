import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
if (process.env.SCHOOLPOT_LIVE_TEST !== '1') throw Error('Explicit live QA opt-in required');
const env = Object.fromEntries(
  (await readFile('.env.local', 'utf8'))
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).replace(/^\uFEFF/, ''), l.slice(i + 1)];
    }),
);
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Origin: 'https://codexora-dev.github.io' } },
});
const base = process.env.DEPLOYMENT_URL || 'https://codexora-dev.github.io/SchoolPot/';
const username = 'nqa' + randomBytes(6).toString('hex'),
  password = randomBytes(12).toString('base64url');
const browser = await chromium.launch();
let created = false;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Unrelated operator popups are isolated only in this temporary test browser.
  await page.route('**/rest/v1/rpc/site_popups', (r) => r.fulfill({ json: [] }));
  await page.goto(
    base +
      (process.env.EXPECTED_BUILD ? '?build=' + process.env.EXPECTED_BUILD : '') +
      '#/rules?view=full',
  );
  if (process.env.EXPECTED_BUILD)
    assert.equal(
      await page.locator('meta[name=schoolpot-build]').getAttribute('content'),
      process.env.EXPECTED_BUILD,
    );
  await expect(page.getByRole('article', { name: '운영 규정 전문', exact: true })).toContainText(
    '모두가 안전하고 즐겁게 소통할 수 있는 공간을 함께 만들어 갑니다.',
  );
  await page
    .getByRole('navigation', { name: '운영 규정 보기' })
    .getByRole('link', { name: '요약본', exact: true })
    .click();
  await expect(page.getByRole('article', { name: '운영 규정 요약본', exact: true })).toContainText(
    '스쿨팟 운영자 드림',
  );
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const { data: setup, error } = await client.rpc('school_setup');
  assert.equal(error, null);
  const grade = setup.counts.findIndex((n) => n > 0) + 1;
  assert.ok(grade);
  const registration = await client.functions.invoke('accounts', {
    body: {
      action: 'signup',
      username,
      password,
      school_year: setup.school_year,
      grade,
      class_number: 1,
    },
  });
  assert.equal(registration.error, null);
  created = true;
  const login = await client.auth.signInWithPassword({
    email: username + '@accounts.schoolpot.invalid',
    password,
  });
  assert.equal(login.error, null);
  const liveList = await client.rpc('community', { p_action: 'notice_list', p_payload: {} });
  assert.equal(liveList.error, null);
  assert.ok(liveList.data.every((n) => !('body' in n) && !('author_id' in n)));
  const missing = await client.rpc('community', {
    p_action: 'get_notice',
    p_payload: { id: randomUUID() },
  });
  assert.match(missing.error?.message || '', /NOT_FOUND/);
  console.log('PASS actual Auth + hosted PostgREST notice metadata and missing-detail guard');
  // Local browser read fixtures exercise UI without publishing test notices or notifications.
  const id = '88000000-0000-4000-8000-000000000001',
    imageUrl = 'https://images.example.test/announcement.png';
  const item = {
    id,
    title: '공지 화면 확인',
    created_at: '2026-11-13T05:00:00Z',
    body: `## 상세 내용\n\n**확인 완료**\n\n![안내 이미지](${imageUrl})`,
    content_format: 'markdown',
  };
  await page.route(imageUrl, (r) =>
    r.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIeEAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await page.route('**/rest/v1/rpc/community', (r) => {
    const p = r.request().postDataJSON();
    if (p.p_action === 'notice_list')
      return r.fulfill({ json: [{ id, title: item.title, created_at: item.created_at }] });
    if (p.p_action === 'get_notice') return r.fulfill({ json: item });
    return r.fallback();
  });
  await page.goto(base + '#/login');
  await page.getByLabel('아이디', { exact: true }).fill(username);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: username + '님, 오늘도 반가워요.' }),
  ).toBeVisible();
  await page.goto(base + '#/notices');
  await expect(page.locator('.notice-list-item')).toHaveCount(1);
  await page.getByRole('link', { name: /공지 화면 확인/ }).click();
  await expect(page.locator('.notice-detail strong')).toHaveText('확인 완료');
  await expect
    .poll(() => page.locator('.notice-detail img').evaluate((n) => n.naturalWidth))
    .toBe(1);
  await page.reload();
  await expect(page.locator('.notice-detail h1')).toHaveText('공지 화면 확인');
  await page.getByRole('link', { name: '← 공지 목록으로', exact: true }).click();
  await expect(page.locator('.notice-list-item')).toHaveCount(1);
  assert.deepEqual(errors, []);
  console.log(
    'PASS published full/summary rules and authenticated notice list/detail/reload/back/HTTPS image UI (notice read fixtures only)',
  );
} finally {
  await browser.close();
  if (created) {
    await client.auth.signInWithPassword({
      email: username + '@accounts.schoolpot.invalid',
      password,
    });
    const cleanup = await client.functions.invoke('delete-account', { body: { password } });
    assert.equal(cleanup.error, null, 'Temporary QA cleanup failed');
    console.log('Temporary QA account removed');
  }
}
