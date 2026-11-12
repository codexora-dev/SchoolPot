import { enrolled } from './school.js';
import { test, expect } from './test.js';
const id = '11111111-1111-4111-8111-111111111111';
const postId = '22222222-2222-4222-8222-222222222222';
const now = new Date().toISOString();
const post = {
  id: postId,
  board_id: 'anonymous',
  title: '테스트 전용 익명 이야기',
  body: '<img src=x onerror="window.xss=1">',
  author: '익명',
  anonymous: true,
  is_mine: true,
  created_at: now,
  updated_at: now,
  likes: 0,
  comments: 0,
  views: 1,
  replies: [],
};
// These fixtures exist exclusively in tests; production never receives mock content.
async function setup(page, isAdmin = false) {
  await page.addInitScript(
    ({ id }) => {
      localStorage.setItem('schoolpot-remember-login', 'true');
      localStorage.setItem(
        'sb-hlglstdtgcodblynicmh-auth-token',
        JSON.stringify({
          access_token: 'test-session',
          refresh_token: 'test-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
          user: {
            id,
            email: 'test@example.invalid',
            email_confirmed_at: new Date().toISOString(),
            app_metadata: { provider: 'email' },
            user_metadata: {},
          },
        }),
      );
    },
    { id },
  );
  await page.route('https://hlglstdtgcodblynicmh.supabase.co/auth/v1/user', (route) =>
    route.fulfill({
      json: {
        id,
        email: 'test@example.invalid',
        email_confirmed_at: now,
        app_metadata: { provider: 'email' },
        user_metadata: {},
      },
    }),
  );
  await page.route(
    'https://hlglstdtgcodblynicmh.supabase.co/rest/v1/rpc/community',
    async (route) => {
      const { p_action, p_payload } = route.request().postDataJSON();
      let data;
      if (p_action === 'me')
        data = {
          profile: { nickname: '테스트친구', grade: 1, notifications_enabled: true },
          ...enrolled,
          is_admin: isAdmin,
        };
      else if (p_action === 'list_posts') data = [post];
      else if (p_action === 'get_post') data = post;
      else if (p_action === 'save_post') data = { id: postId };
      else if (p_action === 'admin_stats') data = { members: 2, posts: 1, comments: 0, reports: 0 };
      else if (p_action === 'save_profile') data = { ok: true };
      else if (p_action === 'assessments')
        data = [
          {
            id: postId,
            title: '테스트 발표',
            subject: '국어',
            grade: 1,
            due_date: now.slice(0, 10),
            body: '테스트 일정 메모',
            is_mine: true,
          },
        ];
      else data = [];
      if (p_action === 'save_post') expect(p_payload.title.length).toBeGreaterThan(1);
      await route.fulfill({ json: data });
    },
  );
}
test('회원 게시글 상세에서 XSS 원문은 텍스트로 렌더링', async ({ page }) => {
  await setup(page);
  await page.goto('/#/post/' + postId);
  await expect(page.getByRole('heading', { name: post.title })).toBeVisible();
  await expect(page.locator('.post-body')).toHaveText(post.body);
  await expect(page.locator('.post-body img')).toHaveCount(0);
  expect(await page.evaluate(() => window.xss)).toBeUndefined();
});
test('글쓰기와 임시 저장 및 게시', async ({ page }) => {
  await setup(page);
  await page.goto('/#/write?board=free');
  await page.getByLabel('제목', { exact: true }).fill('테스트 제목입니다');
  await page.getByLabel('내용', { exact: true }).fill('테스트 본문입니다.');
  await page.getByRole('button', { name: '임시 저장', exact: true }).click();
  await expect(
    page.getByText('이 기기에 임시 저장했어요. 공용 기기에서는 로그아웃해 주세요.'),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue('테스트 제목입니다');
  await page.getByRole('button', { name: '게시하기', exact: true }).click();
  await expect(page.getByRole('heading', { name: post.title })).toBeVisible();
});

test('게시 중 중복 제출과 저장소 오류가 추가 게시를 만들지 않는다', async ({ page }) => {
  await setup(page);
  let saves = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/rest/v1/rpc/community', async (route) => {
    if (route.request().postDataJSON().p_action !== 'save_post') return route.fallback();
    saves++;
    await pending;
    await route.fulfill({ json: { id: postId } });
  });
  await page.goto('/#/write?board=free');
  await page.getByLabel('제목', { exact: true }).fill('중복 방지 테스트');
  await page.getByLabel('내용', { exact: true }).fill('저장소가 차단되어도 게시 완료');
  await page.evaluate(() => {
    window.Storage.prototype.removeItem = function () {
      throw new window.DOMException('Blocked', 'SecurityError');
    };
    const form = document.querySelector('main form');
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect.poll(() => saves).toBe(1);
  await expect(page.getByRole('button', { name: '게시하기', exact: true })).toBeDisabled();
  release();
  await expect(page).toHaveURL(new RegExp('/#/post/' + postId + '$'));
  expect(saves).toBe(1);
});
test('일반 회원 관리자 화면 차단, 관리자만 통계 표시', async ({ page }) => {
  await setup(page);
  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: '관리자 전용 화면이에요' })).toBeVisible();
});
test('관리자 통계와 회원 수행평가 달력', async ({ page }) => {
  await setup(page, true);
  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: '관리자 대시보드' })).toBeVisible();
  await expect(page.getByText('미처리 신고', { exact: true })).toBeVisible();
  await page.goto('/#/assessments');
  await expect(page.getByRole('heading', { name: '테스트 발표' })).toBeVisible();
  await page.getByRole('button', { name: '＋ 일정 등록' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('본인 게시글 수정 폼과 모바일 가로폭', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/write?id=' + postId);
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue(post.title);
  await expect(page.getByLabel('내용', { exact: true })).toHaveValue(post.body);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel('제목', { exact: true }).fill('수정한 테스트 제목');
  await page.getByRole('button', { name: '수정 완료', exact: true }).click();
  await expect(page.getByRole('heading', { name: post.title })).toBeVisible();
});
