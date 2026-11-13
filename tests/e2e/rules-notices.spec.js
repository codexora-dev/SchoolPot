import { test, expect } from './test.js';
import { enrolled } from './school.js';
const userId = '11111111-1111-4111-8111-111111111111';
const noticeId = (i) => `88000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
async function member(page, isAdmin = false) {
  await page.addInitScript(
    ({ id }) => {
      localStorage.setItem('schoolpot-remember-login', 'true');
      localStorage.setItem(
        'sb-hlglstdtgcodblynicmh-auth-token',
        JSON.stringify({
          user: { id },
          access_token: 'test-session',
          refresh_token: 'test-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
        }),
      );
    },
    { id: userId },
  );
  await page.route('**/auth/v1/user', (r) =>
    r.fulfill({ json: { id: userId, app_metadata: {}, user_metadata: {} } }),
  );
  let items = Array.from({ length: 25 }, (_, i) => ({
    id: noticeId(i + 1),
    title: `공지 ${String(i + 1).padStart(2, '0')}`,
    created_at: '2026-11-13T05:00:00Z',
    body: '## 안내 본문\n\n**필독 사항**',
    content_format: 'markdown',
  }));
  const calls = [];
  await page.route('**/rest/v1/rpc/community', (r) => {
    const { p_action, p_payload } = r.request().postDataJSON();
    calls.push({ action: p_action, payload: p_payload });
    if (p_action === 'me')
      return r.fulfill({
        json: { profile: { nickname: '공지 이용자' }, ...enrolled, is_admin: isAdmin },
      });
    if (p_action === 'notice_list')
      return r.fulfill({
        json: items
          .filter((n) => n.title.includes(p_payload.query || ''))
          .slice(p_payload.offset || 0, (p_payload.offset || 0) + 20)
          .map(({ id, title, created_at }) => ({ id, title, created_at })),
      });
    if (p_action === 'get_notice') {
      const found = items.find((n) => n.id === p_payload.id);
      return found
        ? r.fulfill({ json: found })
        : r.fulfill({ status: 400, json: { code: 'P0001', message: 'NOT_FOUND' } });
    }
    if (p_action === 'admin_delete') {
      items = items.filter((n) => n.id !== p_payload.id);
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: [] });
  });
  return calls;
}
test('비회원도 요약본·전체 규정을 전환하고 전문 마지막까지 읽을 수 있다', async ({ page }) => {
  await page.goto('/#/rules');
  const summary = page.getByRole('article', { name: '운영 규정 요약본', exact: true });
  await expect(
    summary.getByRole('heading', { name: '스쿨팟(SchoolPot) 이용 규정 — 핵심 안내', exact: true }),
  ).toBeVisible();
  await expect(summary).toContainText('스쿨팟 운영자 드림');
  const choices = page.getByRole('navigation', { name: '운영 규정 보기', exact: true });
  await choices.getByRole('link', { name: '전체 글', exact: true }).click();
  const full = page.getByRole('article', { name: '운영 규정 전문', exact: true });
  await expect(full.getByRole('heading', { name: '제53조 (최종 원칙)', exact: true })).toHaveCount(
    1,
  );
  await expect(full).toContainText(
    '모두가 안전하고 즐겁게 소통할 수 있는 공간을 함께 만들어 갑니다.',
  );
  await expect(choices.getByRole('link', { name: '전체 글', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.locator('.rules-toc summary').click();
  await page.getByRole('button', { name: '제10장. 개인정보 및 정보 보호', exact: true }).click();
  await expect(
    full.getByRole('heading', { name: '제10장. 개인정보 및 정보 보호', exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL(/#\/rules\?view=full$/);
});
test('모바일에서 전문 직접 주소와 요약 전환이 가로 넘침 없이 작동한다', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto('/#/rules?view=full');
  await expect(page.getByRole('article', { name: '운영 규정 전문', exact: true })).toContainText(
    '모두가 안전하고 즐겁게 소통할 수 있는 공간을 함께 만들어 갑니다.',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'docs/screenshots/rules-full-mobile.png' });
  await page
    .getByRole('navigation', { name: '운영 규정 보기' })
    .getByRole('link', { name: '요약본', exact: true })
    .click();
  await expect(page.getByRole('article', { name: '운영 규정 요약본', exact: true })).toContainText(
    '스쿨팟 운영자 드림',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('공지 목록은 본문 없이 표시하고 다음 페이지 글을 선택·새로고침·목록 복귀한다', async ({
  page,
}) => {
  const calls = await member(page);
  await page.goto('/#/notices');
  await expect(page.locator('.notice-list-item')).toHaveCount(20);
  expect(calls.some((c) => c.action === 'get_notice')).toBe(false);
  await expect(page.getByText('필독 사항', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '다음 →', exact: true }).click();
  await expect(page.locator('.notice-list-item')).toHaveCount(5);
  await page.getByRole('link', { name: /공지 21/ }).click();
  await expect(page.locator('.notice-detail h1')).toHaveText('공지 21');
  await expect(page.locator('.notice-detail strong')).toHaveText('필독 사항');
  await page.reload();
  await expect(page.locator('.notice-detail h1')).toHaveText('공지 21');
  await page.getByRole('link', { name: '← 공지 목록으로', exact: true }).click();
  await expect(page).toHaveURL(/offset=20/);
  await expect(page.locator('.notice-list-item')).toHaveCount(5);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'docs/screenshots/notice-list-mobile.png', fullPage: true });
});
test('공지 검색·빈 결과·없는 공지 복구와 일반 회원 삭제 UI 차단', async ({ page }) => {
  await member(page);
  await page.goto('/#/notices');
  await page.getByLabel('공지 검색', { exact: true }).fill('공지 25');
  await page.locator('.notice-filters').getByRole('button', { name: '검색', exact: true }).click();
  await expect(page.locator('.notice-list-item')).toHaveCount(1);
  await page.getByRole('link', { name: /공지 25/ }).click();
  await expect(page.getByRole('button', { name: '공지 삭제', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '← 공지 목록으로', exact: true }).click();
  await expect(page.getByLabel('공지 검색', { exact: true })).toHaveValue('공지 25');
  await page.getByLabel('공지 검색', { exact: true }).fill('없는 공지');
  await page.locator('.notice-filters').getByRole('button', { name: '검색', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '검색 결과가 없어요', exact: true }),
  ).toBeVisible();
  await page.goto('/#/notice/' + noticeId(99));
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('link', { name: '← 공지 목록으로', exact: true })).toBeVisible();
});
test('관리자는 상세에서 확인 후 공지를 삭제하고 목록으로 돌아간다', async ({ page }) => {
  await member(page, true);
  await page.goto('/#/notice/' + noticeId(1));
  await page.getByRole('button', { name: '공지 삭제', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page).toHaveURL(/#\/notices$/);
  await expect(page.locator('.notice-list')).not.toContainText('공지 01');
});
test('개별 공지 URL도 비회원 접근 제한을 유지한다', async ({ page }) => {
  let requested = false;
  await page.route('**/rest/v1/rpc/community', (r) => {
    requested = true;
    return r.fulfill({ json: [] });
  });
  await page.goto('/#/notice/' + noticeId(1));
  await expect(
    page.getByRole('heading', { name: '로그인하고 함께해요', exact: true }),
  ).toBeVisible();
  expect(requested).toBe(false);
});
