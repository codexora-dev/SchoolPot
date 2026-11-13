import { test, expect } from '@playwright/test';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
test.skip(
  process.env.SCHOOLPOT_GOVERNANCE_LIVE_TEST !== '1',
  'Explicit deployment QA only; uses a temporary restricted QA account.',
);
test('실제 배포의 제한 계정·이의 제기·권리 문의·탈퇴와 Auth 접근 회수', async ({ page }) => {
  test.setTimeout(120000);
  const statePath = new URL('../.local/governance-live-qa.json', import.meta.url);
  const qa = JSON.parse(await readFile(statePath, 'utf8'));
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
  let deleted = false;
  try {
    await client.auth.setSession(qa.session);
    const blocked = await client.rpc('community', { p_action: 'list_posts' });
    expect(blocked.error?.message).toContain('SUSPENDED');
    const state = await client.rpc('community', { p_action: 'me' });
    expect(state.error).toBe(null);
    expect(state.data.restricted).toBe(true);
    const account = await client.rpc('governance', { p_action: 'mine' });
    expect(account.error).toBe(null);
    expect(account.data.sanctions).toHaveLength(1);
    await page.addInitScript(
      ({ session, key }) => {
        localStorage.setItem('schoolpot-remember-login', 'true');
        localStorage.setItem(key, JSON.stringify(session));
      },
      { session: qa.session, key: 'sb-hlglstdtgcodblynicmh-auth-token' },
    );
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('https://codexora-dev.github.io/SchoolPot/#/board/free');
    let dialog = page.getByRole('dialog', { name: '계정 이용이 제한되어 있어요' });
    await expect(dialog).toBeVisible({ timeout: 20000 });
    await expect(dialog).toContainText('배포 검증용 임시 계정');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '이의 제기', exact: true }).click();
    await dialog
      .getByLabel('이의 제기 내용', { exact: true })
      .fill('배포 검증용 임시 계정의 이의 제기입니다. 계정 삭제 시 함께 정리합니다.');
    await dialog.getByRole('button', { name: '보내기', exact: true }).first().click();
    await expect(page.getByText('이의 제기를 접수했습니다. 답변을 기다려 주세요.')).toBeVisible({
      timeout: 15000,
    });
    await page.getByText('계정·개인정보 문의', { exact: true }).click();
    await page
      .getByLabel('문의 내용', { exact: true })
      .fill('배포 검증용 임시 문의입니다. 계정 삭제 시 함께 정리합니다.');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(page.getByText('답변을 기다리는 중입니다.')).toHaveCount(1, { timeout: 15000 });
    await page.getByText('계정·개인정보 문의', { exact: true }).click();
    await expect(page.getByText('답변을 기다리는 중입니다.')).toBeVisible();
    await page.goto('https://codexora-dev.github.io/SchoolPot/#/admin');
    dialog = page.getByRole('dialog', { name: '계정 이용이 제한되어 있어요' });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
    // The deployment operator verifies both real administrator dispatchers and
    // captures only notifications belonging to these QA transactions for cleanup.
    await writeFile(
      new URL('../.local/governance-ready.json', import.meta.url),
      JSON.stringify({ uid: qa.uid }),
    );
    let verified = false;
    for (let i = 0; i < 120; i++) {
      try {
        const ack = JSON.parse(
          await readFile(
            new URL('../.local/governance-admin-checked.json', import.meta.url),
            'utf8',
          ),
        );
        verified = ack.uid === qa.uid;
      } catch {
        /* awaiting the bounded administrator check */
      }
      if (verified) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(verified, 'Run the approved administrator DB check before QA deletion.').toBe(true);
    await dialog.getByRole('button', { name: '회원탈퇴', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: '회원탈퇴 확인' });
    await confirm.getByLabel('탈퇴 확인', { exact: true }).fill('탈퇴');
    await confirm.getByLabel('현재 비밀번호', { exact: true }).fill(qa.password);
    await confirm.getByRole('button', { name: '계정 삭제', exact: true }).click();
    await expect(page.getByRole('heading', { name: '우리 학교의 이야기가 모이는 곳' })).toBeVisible(
      { timeout: 20000 },
    );
    deleted = true;
    const stale = await client.rpc('community', { p_action: 'me' });
    expect(stale.error).not.toBe(null);
    await unlink(statePath);
  } finally {
    if (!deleted) {
      const login = await client.auth.signInWithPassword({
        email: qa.username + '@accounts.schoolpot.invalid',
        password: qa.password,
      });
      if (!login.error) {
        const cleanup = await client.functions.invoke('delete-account', {
          body: { password: qa.password },
        });
        expect(cleanup.error).toBe(null);
        await unlink(statePath);
      }
    }
  }
});
