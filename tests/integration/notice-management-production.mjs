import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
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
const username = 'mqa' + randomBytes(6).toString('hex'),
  password = randomBytes(12).toString('base64url');
const browser = await chromium.launch();
let created = false;
try {
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
  const denied = await client.rpc('manage_notices', {
    p_action: 'list',
    p_payload: { is_admin: true },
  });
  assert.match(denied.error?.message || '', /FORBIDDEN/);
  const me = await client.rpc('community', { p_action: 'me', p_payload: {} });
  assert.equal(me.error, null);
  assert.equal(me.data.is_admin, false);
  console.log('PASS hosted Auth/PostgREST rejects non-admin notice management');
  // Browser-only administrator/read/write fixtures. The real account stays non-admin.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/rest/v1/rpc/site_popups', (r) => r.fulfill({ json: [] }));
  await page.route('**/rest/v1/rpc/manage_boards', (r) => r.fulfill({ json: [] }));
  let item = {
    id: '88000000-0000-4000-8000-000000000001',
    title: '관리 화면 확인',
    body: '**기존 공지**',
    content_format: 'markdown',
    revision: 1,
    created_at: '2026-11-13T05:00:00Z',
    updated_at: '2026-11-13T05:00:00Z',
  };
  await page.route('**/rest/v1/rpc/community', (r) => {
    const p = r.request().postDataJSON();
    if (p.p_action === 'me') return r.fulfill({ json: { ...me.data, is_admin: true } });
    if (p.p_action === 'get_notice') return r.fulfill({ json: item });
    return ['list_posts', 'notice_list'].includes(p.p_action) ? r.fulfill({ json: [] }) : r.abort();
  });
  await page.route('**/rest/v1/rpc/manage_notices', (r) => {
    const { p_action, p_payload } = r.request().postDataJSON();
    if (p_action === 'list') {
      const { body, ...meta } = item;
      void body;
      return r.fulfill({ json: [meta] });
    }
    if (p_action === 'get') return r.fulfill({ json: item });
    if (p_action === 'save') {
      assert.equal(p_payload.revision, item.revision);
      item = {
        ...item,
        ...p_payload,
        revision: item.revision + 1,
        updated_at: new Date().toISOString(),
      };
      return r.fulfill({ json: { ok: true, id: item.id } });
    }
    return r.abort();
  });
  await page.goto(
    base + (process.env.EXPECTED_BUILD ? '?build=' + process.env.EXPECTED_BUILD : '') + '#/login',
  );
  if (process.env.EXPECTED_BUILD)
    assert.equal(
      await page.locator('meta[name=schoolpot-build]').getAttribute('content'),
      process.env.EXPECTED_BUILD,
    );
  await page.getByLabel('아이디', { exact: true }).fill(username);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: username + '님, 오늘도 반가워요.' }),
  ).toBeVisible();
  await page.goto(base + '#/admin?tab=notice');
  await page.getByRole('button', { name: '수정', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '공지 수정', exact: true });
  await expect(editor.getByLabel('작성 형식', { exact: true })).toHaveValue('markdown');
  await editor.getByLabel('제목', { exact: true }).fill('수정 확인 완료');
  await editor.getByLabel('내용', { exact: true }).fill('**새 공지 내용**');
  await editor.getByRole('button', { name: '수정 저장', exact: true }).click();
  await expect(page.locator('.notice-admin-card')).toContainText('수정 확인 완료');
  assert.equal(item.revision, 2);
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '공지 미리보기', exact: true }).locator('strong'),
  ).toHaveText('새 공지 내용');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(errors, []);
  console.log(
    'PASS published administrator notice edit/list/preview and Markdown (browser fixtures only; no real notice writes)',
  );
} finally {
  await browser.close();
  if (created) {
    await client.auth.signInWithPassword({
      email: username + '@accounts.schoolpot.invalid',
      password,
    });
    const cleanup = await client.functions.invoke('delete-account', { body: { password } });
    assert.equal(cleanup.error, null, 'QA cleanup failed');
    console.log('Temporary non-admin QA account removed');
  }
}
