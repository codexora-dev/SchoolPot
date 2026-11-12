import { test, expect } from './test.js';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
test.skip(process.env.SCHOOLPOT_LIVE_TEST !== '1', 'Requires explicit live QA account opt-in.');
test('실제 자동로그인 선택·해제 복원과 비밀번호 재확인 회원탈퇴', async ({ page, browser }) => {
  test.setTimeout(120000);
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
    global: { headers: { Origin: 'http://127.0.0.1:5173' } },
  });
  const username = 'aqa' + randomBytes(6).toString('hex'),
    password = randomBytes(12).toString('base64url');
  const base = process.env.SCHOOLPOT_ACCOUNT_TEST_URL || 'http://127.0.0.1:4173/';
  const { data: setup, error: setupError } = await client.rpc('school_setup');
  expect(setupError).toBe(null);
  const grade = setup.counts.findIndex((n) => n > 0) + 1;
  test.skip(!grade, '운영자가 실제 반 수를 설정한 뒤 실행합니다.');
  let created = false,
    deleted = false;
  const login = async (remember) => {
    await page.goto(base + '#/login');
    await page.getByLabel('아이디', { exact: true }).fill(username);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByLabel('자동로그인', { exact: true }).setChecked(remember);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: username + '님, 오늘도 반가워요.' }),
    ).toBeVisible({ timeout: 20000 });
  };
  const logout = async () => {
    await page.getByLabel('계정 메뉴', { exact: true }).click();
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '우리 학교의 이야기가 모이는 곳' }),
    ).toBeVisible();
  };
  try {
    const registered = await client.functions.invoke('accounts', {
      body: {
        action: 'signup',
        username,
        password,
        school_year: setup.school_year,
        grade,
        class_number: 1,
        policy_version: setup.policy.version,
        age_14_confirmed: true,
      },
    });
    expect(registered.error).toBe(null);
    created = true;
    console.log('Temporary QA account: ' + username);
    await login(true);
    const persistent = await browser.newContext({
      storageState: await page.context().storageState(),
    });
    try {
      const p = await persistent.newPage();
      await p.goto(base + '#/profile');
      await expect(p.getByRole('heading', { name: '나의 스쿨팟', exact: true })).toBeVisible({
        timeout: 15000,
      });
    } finally {
      await persistent.close();
    }
    await logout();
    await login(false);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: username + '님, 오늘도 반가워요.' }),
    ).toBeVisible({ timeout: 15000 });
    const temporary = await browser.newContext({
      storageState: await page.context().storageState(),
    });
    try {
      const p = await temporary.newPage();
      await p.goto(base + '#/profile');
      await expect(
        p.getByRole('heading', { name: '로그인하고 함께해요', exact: true }),
      ).toBeVisible({ timeout: 15000 });
    } finally {
      await temporary.close();
    }
    await page.goto(base + '#/profile?section=account');
    await page.getByRole('button', { name: '회원 탈퇴', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '회원탈퇴 확인', exact: true });
    await dialog.getByLabel('탈퇴 확인', { exact: true }).fill('탈퇴');
    await dialog.getByLabel('현재 비밀번호', { exact: true }).fill('invalid-password');
    await dialog.getByRole('button', { name: '계정 삭제', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('현재 비밀번호가 올바르지', {
      timeout: 15000,
    });
    await dialog.getByLabel('현재 비밀번호', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: '계정 삭제', exact: true }).click();
    await expect(page.getByRole('heading', { name: '우리 학교의 이야기가 모이는 곳' })).toBeVisible(
      { timeout: 20000 },
    );
    deleted = true;
    await page.goto(base + '#/profile');
    await expect(
      page.getByRole('heading', { name: '로그인하고 함께해요', exact: true }),
    ).toBeVisible();
    const loginAfterDelete = await client.auth.signInWithPassword({
      email: username + '@accounts.schoolpot.invalid',
      password,
    });
    expect(loginAfterDelete.error).not.toBe(null);
  } finally {
    if (created && !deleted) {
      const login = await client.auth.signInWithPassword({
        email: username + '@accounts.schoolpot.invalid',
        password,
      });
      if (!login.error) {
        const cleanup = await client.functions.invoke('delete-account', { body: { password } });
        expect(cleanup.error).toBe(null);
      }
    }
  }
});
