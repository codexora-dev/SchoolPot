import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
async function worker(overrides = {}) {
  const handlers = {};
  const source = (await readFile(new URL('../../src/worker.js', import.meta.url), 'utf8')).replace(
    "'__PRECACHE_FILES__'",
    '["assets/app.js","offline.html"]',
  );
  runInNewContext(source, {
    URL,
    self: {
      location: { href: 'https://school.invalid/SchoolPot/sw.js' },
      addEventListener: (name, fn) => {
        handlers[name] = fn;
      },
      ...overrides,
    },
    caches: { match: async () => 'offline-static' },
    fetch: async () => {
      throw new Error('offline');
    },
  });
  return handlers;
}
it('Service Worker는 외부 API·POST·인증 경로·알 수 없는 파일을 캐시하지 않는다', async () => {
  const handlers = await worker();
  for (const [url, method] of [
    ['https://api.supabase.co/rest/v1/rpc/community', 'POST'],
    ['https://school.invalid/SchoolPot/token', 'GET'],
    ['https://school.invalid/other/assets/app.js', 'GET'],
    ['https://school.invalid/SchoolPot/assets/app.js', 'POST'],
  ]) {
    let intercepted = false;
    handlers.fetch({
      request: { url, method, mode: 'cors' },
      respondWith: () => {
        intercepted = true;
      },
    });
    expect(intercepted).toBe(false);
  }
});
it('오프라인 탐색은 개인별 내용이 없는 전용 안내로 응답한다', async () => {
  const handlers = await worker();
  let response;
  handlers.fetch({
    request: { url: 'https://school.invalid/SchoolPot/', method: 'GET', mode: 'navigate' },
    respondWith: (promise) => {
      response = promise;
    },
  });
  expect(await response).toBe('offline-static');
});
it('푸시는 일반 안내만 표시하고 클릭은 허용된 내부 목적지로만 이동한다', async () => {
  for (const [path, expected] of [
    ['#/post/11111111-1111-4111-8111-111111111111', '#/post/11111111-1111-4111-8111-111111111111'],
    [
      '#/post/11111111-1111-4111-8111-111111111111?comment=22222222-2222-4222-8222-222222222222',
      '#/post/11111111-1111-4111-8111-111111111111?comment=22222222-2222-4222-8222-222222222222',
    ],
    ['https://attacker.invalid/private', '#/notifications'],
    ['#/admin?tab=roles', '#/notifications'],
  ]) {
    let options, target, pending;
    const handlers = await worker({
      registration: {
        showNotification: async (_title, value) => {
          options = value;
        },
      },
      clients: {
        matchAll: async () => [],
        openWindow: async (value) => {
          target = value;
        },
      },
    });
    handlers.push({
      data: { json: () => ({ path, body: '비공개 제재 사유' }) },
      waitUntil: (promise) => {
        pending = promise;
      },
    });
    await pending;
    expect(options.body).not.toContain('비공개');
    handlers.notificationclick({
      notification: { data: options.data, close: () => {} },
      waitUntil: (promise) => {
        pending = promise;
      },
    });
    await pending;
    expect(target).toBe('https://school.invalid/SchoolPot/' + expected);
  }
});
