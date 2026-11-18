import { test, expect } from './test.js';
import { enrolled } from './school.js';
const uid = '10000000-0000-4000-8000-000000000001';
const postId = '20000000-0000-4000-8000-000000000001';
const memberId = '30000000-0000-4000-8000-000000000001';
async function setup(page) {
  const now = new Date().toISOString();
  const store = {
    version: 1,
    calls: [],
    bookmarked: false,
    subscribed: false,
    items: [
      {
        id: 'notification-1',
        message: '작성하신 게시글에 새로운 댓글이 달렸습니다.',
        type: 'comment',
        post_id: postId,
        created_at: now,
        read_at: null,
      },
    ],
    pref: {
      revision: 1,
      push_enabled: false,
      comment_enabled: true,
      reply_enabled: true,
      mention_enabled: true,
      notice_enabled: true,
      subscription_enabled: true,
      report_enabled: true,
      quiet_hours_enabled: false,
      quiet_hours_start: '22:00:00',
      quiet_hours_end: '07:00:00',
      timezone: 'Asia/Seoul',
      mention_discoverable: false,
    },
  };
  const post = {
    id: postId,
    title: 'V2 테스트 이야기',
    body: '안전한 본문',
    board_id: 'free',
    author: '친구',
    is_mine: true,
    likes: 0,
    comments: 0,
    replies: [],
    created_at: now,
    updated_at: now,
    mentions: [],
  };
  await page.addInitScript(
    ({ uid }) => {
      localStorage.setItem('schoolpot-remember-login', 'true');
      localStorage.setItem(
        'sb-hlglstdtgcodblynicmh-auth-token',
        JSON.stringify({
          user: { id: uid },
          access_token: 'test-session',
          refresh_token: 'test-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
        }),
      );
    },
    { uid },
  );
  await page.route('**/auth/v1/user', (route) => route.fulfill({ json: { id: uid } }));
  await page.route('**/auth/v1/logout*', (route) => route.fulfill({ status: 204 }));
  await page.route('**/rest/v1/rpc/community', (route) => {
    const { p_action, p_payload } = route.request().postDataJSON();
    store.calls.push({ action: p_action, payload: p_payload });
    const data =
      p_action === 'me'
        ? { profile: { nickname: '테스트회원' }, ...enrolled, role: 'member', is_admin: false }
        : p_action === 'get_post'
          ? {
              ...post,
              bookmarked: store.bookmarked,
              subscribed: store.subscribed,
              notification_comment_deleted: Boolean(p_payload.comment_id),
            }
          : p_action === 'save_post'
            ? { id: postId }
            : [];
    return route.fulfill({ json: data });
  });
  await page.route('**/rest/v1/rpc/schoolpot_v2', (route) => {
    const { p_action: action, p_payload: payload } = route.request().postDataJSON();
    store.calls.push({ action, payload });
    if (['read', 'unread_one'].includes(action)) {
      for (const item of store.items)
        if (!payload.id || item.id === payload.id) item.read_at = action === 'read' ? now : null;
      store.version++;
    }
    if (action === 'delete') {
      store.items = store.items.filter((item) => item.id !== payload.id);
      store.version++;
    }
    if (action === 'save_preferences')
      store.pref = { ...store.pref, ...payload, revision: store.pref.revision + 1 };
    if (action === 'bookmark') store.bookmarked = payload.enabled;
    if (action === 'subscribe') store.subscribed = payload.enabled;
    const data = ['unread', 'notifications'].includes(action)
      ? {
          version: store.version,
          unread: store.items.filter((item) => !item.read_at).length,
          items: store.items,
        }
      : ['preferences', 'save_preferences'].includes(action)
        ? store.pref
        : action === 'mention_search'
          ? [{ id: memberId, nickname: '멘션친구' }]
          : ['bookmark', 'subscribe'].includes(action)
            ? { bookmarked: store.bookmarked, subscribed: store.subscribed }
            : action === 'activity'
              ? payload.kind === 'bookmarks' && store.bookmarked
                ? [post]
                : []
              : action === 'push_devices'
                ? []
                : { ok: true };
    return route.fulfill({ json: data });
  });
  return store;
}
test('알림 센터·배지·읽음·읽지 않음·타 기기 변경 동기화·삭제', async ({ page }) => {
  const store = await setup(page);
  await page.goto('/#/notifications');
  await expect(page.getByText('읽지 않은 알림 1개', { exact: true })).toBeVisible();
  await expect(page.locator('.notification-count')).toHaveText('1');
  await page.getByRole('button', { name: '읽음', exact: true }).click();
  await expect(page.getByText('읽지 않은 알림 0개', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '읽지 않음', exact: true }).click();
  await expect(page.locator('.notification-count')).toHaveText('1');
  store.items[0].read_at = new Date().toISOString();
  store.version++;
  await page.evaluate(() => window.dispatchEvent(new window.Event('online')));
  await expect(page.getByText('읽지 않은 알림 0개', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('heading', { name: '아직 도착한 알림이 없어요' })).toBeVisible();
});
test('알림 설정 저장·거부 권한에서 재요청 없음·모바일 화면', async ({ page }) => {
  const store = await setup(page);
  await page.addInitScript(() => {
    Object.defineProperty(window.Notification, 'permission', { get: () => 'denied' });
    window.notificationPrompts = 0;
    window.Notification.requestPermission = async () => {
      window.notificationPrompts++;
      return 'denied';
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/notification-settings');
  await page.getByLabel('멘션', { exact: true }).uncheck();
  await page.getByLabel('닉네임으로 멘션 검색 허용', { exact: true }).check();
  await page.getByRole('button', { name: '설정 저장' }).click();
  await expect.poll(() => store.pref.mention_discoverable).toBe(true);
  expect(store.pref.mention_enabled).toBe(false);
  await page.getByRole('button', { name: '이 기기 알림 연결' }).click();
  expect(await page.evaluate(() => window.notificationPrompts)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: 'tests/.local/v2/notification-settings-mobile.png',
    fullPage: true,
  });
});
test('구독·저장 상태와 내 활동 연결은 댓글 입력을 보존한다', async ({ page }) => {
  const store = await setup(page);
  await page.goto(`/#/post/${postId}`);
  await page.getByLabel('댓글', { exact: true }).fill('작성 중인 댓글');
  await page.getByRole('button', { name: '저장하기', exact: true }).click();
  await page.getByRole('button', { name: '댓글 구독', exact: true }).click();
  await expect(page.getByLabel('댓글', { exact: true })).toHaveValue('작성 중인 댓글');
  expect(store.bookmarked && store.subscribed).toBe(true);
  await page.goto('/#/activity?kind=bookmarks');
  await expect(page.getByRole('link', { name: 'V2 테스트 이야기', exact: true })).toBeVisible();
  await page.goto(`/#/post/${postId}?comment=${memberId}`);
  await expect(
    page.getByText(
      '이 알림의 댓글은 삭제되어 더 이상 볼 수 없어요. 남아 있는 게시글과 댓글을 확인할 수 있어요.',
    ),
  ).toBeVisible();
});
test('멘션 선택은 실제 ID로 전송하고 자동 초안은 복원·삭제한다', async ({ page }) => {
  const store = await setup(page);
  await page.goto('/#/write?board=free');
  await page.getByLabel('제목', { exact: true }).fill('자동으로 저장하는 이야기');
  await page.getByLabel('내용', { exact: true }).fill('자동 저장 본문');
  await page.reload();
  await expect(page.getByLabel('내용', { exact: true })).toHaveValue('자동 저장 본문');
  await page.getByText('@ 멘션 추가', { exact: true }).click();
  await page.getByLabel('멘션할 닉네임').fill('@멘션');
  await page.getByRole('button', { name: '회원 검색', exact: true }).click();
  await page.getByRole('button', { name: '@멘션친구', exact: true }).click();
  await page.getByRole('button', { name: '게시하기', exact: true }).click();
  await expect
    .poll(() => store.calls.find((call) => call.action === 'save_post')?.payload.mentions)
    .toEqual([memberId]);
  await expect(page).toHaveURL(new RegExp('/#/post/' + postId + '$'));
  expect(
    await page.evaluate(({ uid }) => localStorage.getItem(`schoolpot-draft:${uid}`), { uid }),
  ).toBeNull();
  await page.goto('/#/write?board=free');
  await page.getByLabel('내용', { exact: true }).fill('삭제할 초안');
  await page.getByRole('button', { name: '임시 저장 삭제', exact: true }).click();
  expect(
    await page.evaluate(({ uid }) => localStorage.getItem(`schoolpot-draft:${uid}`), { uid }),
  ).toBeNull();
});
