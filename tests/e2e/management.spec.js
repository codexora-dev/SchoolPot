import { test, expect } from './test.js';
import { boards } from './boards.js';
const id = '88888888-8888-4888-8888-888888888888';
const now = new Date().toISOString();
async function member(page, admin = false) {
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
          user: { id, app_metadata: {}, user_metadata: {} },
        }),
      );
    },
    { id },
  );
  await page.route('**/auth/v1/user', (route) =>
    route.fulfill({ json: { id, app_metadata: {}, user_metadata: {} } }),
  );
  await page.route('**/rest/v1/rpc/community', (route) =>
    route.fulfill({
      json:
        route.request().postDataJSON().p_action === 'me'
          ? { profile: { nickname: '테스트친구', notifications_enabled: true }, is_admin: admin }
          : [],
    }),
  );
}
test('관리자 게시판 생성·메뉴 반영·읽기 전용·숨김·삭제', async ({ page }) => {
  await member(page, true);
  let items = boards.map((board) => ({ ...board }));
  await page.route('**/rest/v1/rpc/manage_boards', (route) => {
    const { p_action, p_payload } = route.request().postDataJSON();
    if (p_action === 'list') return route.fulfill({ json: items });
    if (p_action === 'create') items.push({ ...p_payload, revision: 1, posts: 0 });
    if (p_action === 'save')
      items = items.map((b) =>
        b.id === p_payload.id ? { ...b, ...p_payload, revision: b.revision + 1 } : b,
      );
    if (p_action === 'delete') items = items.filter((b) => b.id !== p_payload.id);
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/#/admin?tab=boards');
  await page.getByRole('button', { name: '＋ 새 게시판', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '새 게시판', exact: true });
  await dialog.getByLabel('게시판 주소', { exact: false }).fill('new-board');
  await dialog.getByLabel('게시판 이름', { exact: true }).fill('새 소식 게시판');
  await dialog.getByLabel('설명', { exact: true }).fill('새로운 설명');
  await dialog.getByLabel('게시판 유형', { exact: true }).selectOption('anonymous');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  const card = page
    .locator('.management-card')
    .filter({ has: page.getByRole('heading', { name: '새 소식 게시판', exact: true }) });
  await expect(card).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: '주 메뉴' })
      .getByRole('link', { name: '새 소식 게시판', exact: true }),
  ).toBeVisible();
  await card.getByRole('button', { name: '수정', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '게시판 수정', exact: true });
  await expect(dialog.getByLabel('게시판 유형')).toHaveCount(0);
  await dialog.getByLabel('운영 상태', { exact: true }).selectOption('readonly');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(card).toContainText('읽기 전용');
  await card.getByRole('button', { name: '수정', exact: true }).click();
  await dialog.getByLabel('운영 상태', { exact: true }).selectOption('hidden');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(card).toContainText('숨김');
  await expect(
    page
      .getByRole('navigation', { name: '주 메뉴' })
      .getByRole('link', { name: '새 소식 게시판', exact: true }),
  ).toHaveCount(0);
  await card.getByRole('button', { name: '삭제', exact: true }).click();
  await page
    .getByRole('dialog', { name: '게시판 삭제', exact: true })
    .getByRole('button', { name: '삭제', exact: true })
    .click();
  await expect(card).toHaveCount(0);
});
test('회원 문의 접수·내 문의 표시와 HTML 본문 보호', async ({ page }) => {
  await member(page);
  let items = [];
  await page.route('**/rest/v1/rpc/feedback', (route) => {
    const { p_action, p_payload } = route.request().postDataJSON();
    if (p_action === 'mine') return route.fulfill({ json: items });
    expect(p_action).toBe('create');
    expect(Object.keys(p_payload).sort()).toEqual(['body', 'kind', 'title']);
    items.push({
      ...p_payload,
      id,
      status: 'new',
      revision: 1,
      created_at: now,
      updated_at: now,
      admin_reply: '',
    });
    return route.fulfill({ json: { id } });
  });
  await page.goto('/#/feedback');
  await page.getByLabel('문의 유형', { exact: true }).selectOption('bug');
  await page.getByLabel('제목', { exact: true }).fill('화면 오류 제보');
  await page.getByLabel('내용', { exact: true }).fill('<img src=x onerror="window.feedbackXss=1">');
  await page.getByRole('button', { name: '보내기', exact: true }).click();
  await expect(page.locator('.feedback-card')).toContainText('화면 오류 제보');
  await expect(page.locator('.feedback-card img')).toHaveCount(0);
  expect(await page.evaluate(() => window.feedbackXss)).toBeUndefined();
});
test('관리자 문의 필터·상태 변경·답변 및 작은 화면', async ({ page }) => {
  await member(page, true);
  let item = {
    id,
    kind: 'bug',
    title: '긴 문의 제목'.repeat(10),
    body: '작은 화면에서 오류가 발생했어요.\n' + 'x'.repeat(250),
    status: 'new',
    revision: 1,
    admin_reply: '',
    nickname: '테스트친구',
    created_at: now,
    updated_at: now,
  };
  await page.route('**/rest/v1/rpc/feedback', (route) => {
    const { p_action, p_payload } = route.request().postDataJSON();
    if (p_action === 'admin_list')
      return route.fulfill({
        json: !p_payload.status || p_payload.status === item.status ? [item] : [],
      });
    expect(p_action).toBe('admin_update');
    expect(p_payload.revision).toBe(1);
    item = { ...item, ...p_payload, revision: 2 };
    return route.fulfill({ json: { ok: true } });
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/#/admin?tab=feedback');
  await page.getByRole('button', { name: '확인·답변', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '문의 처리', exact: true });
  await dialog.getByLabel('처리 상태', { exact: true }).selectOption('resolved');
  await dialog.getByLabel('관리자 답변', { exact: true }).fill('확인 후 수정했어요.');
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
  await page.screenshot({ path: 'docs/screenshots/feedback-admin-mobile.png' });
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('.feedback-reply')).toContainText('확인 후 수정했어요.');
  await page.locator('main').getByLabel('처리 상태', { exact: true }).selectOption('new');
  await page.getByRole('button', { name: '조회', exact: true }).click();
  await expect(page.getByRole('heading', { name: '접수된 문의가 없어요' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('회원에게 읽기 전용 게시판의 글쓰기·댓글 수정 UI를 표시하지 않는다', async ({ page }) => {
  await member(page);
  await page.route('**/rest/v1/rpc/board_catalog', (route) =>
    route.fulfill({ json: boards.map((b) => ({ ...b, can_post: false })) }),
  );
  await page.goto('/#/board/free');
  await expect(page.getByText('읽기 전용 게시판이에요.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: '＋ 글쓰기', exact: true })).toHaveCount(0);
  await page.goto('/#/write');
  await expect(page.getByRole('heading', { name: '지금은 글을 쓸 수 없어요' })).toBeVisible();
  await page.route('**/rest/v1/rpc/community', (route) => {
    if (route.request().postDataJSON().p_action !== 'get_post') return route.fallback();
    return route.fulfill({
      json: {
        id,
        board_id: 'free',
        title: '읽기 전용 글',
        body: '본문',
        author: '테스트친구',
        anonymous: false,
        is_mine: true,
        can_interact: false,
        created_at: now,
        updated_at: now,
        views: 1,
        likes: 0,
        comments: 1,
        replies: [
          {
            id,
            parent_id: null,
            body: '내 댓글',
            author: '테스트친구',
            is_mine: true,
            created_at: now,
            likes: 0,
          },
        ],
        poll: { voted: false, options: [{ id, label: '선택 항목', votes: 0 }] },
      },
    });
  });
  await page.goto('/#/post/' + id);
  await expect(page.getByRole('heading', { name: '읽기 전용 글', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '♡ 공감 0', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '♡ 0', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '선택 항목　0표', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: '수정', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '수정', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('댓글', { exact: true })).toHaveCount(0);
});
test('게시판 API 실패 시 가짜 게시판 목록을 표시하지 않고 재시도한다', async ({ page }) => {
  await page.route('**/rest/v1/rpc/board_catalog', (route) =>
    route.fulfill({ status: 500, json: { message: 'Connection unavailable' } }),
  );
  await page.goto('/#/boards');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.board-tile')).toHaveCount(0);
  await page.route('**/rest/v1/rpc/board_catalog', (route) => route.fulfill({ json: boards }));
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.locator('.board-tile')).toHaveCount(boards.length);
});
