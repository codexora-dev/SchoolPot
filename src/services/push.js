import { v2 } from './v2.js';
export function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    window.isSecureContext
  );
}
export async function enablePush() {
  if (!pushSupported())
    throw new Error(
      '이 환경에서는 푸시 알림을 지원하지 않아요. iOS에서는 홈 화면에 설치한 앱에서 확인해 주세요.',
    );
  if (window.Notification.permission === 'denied')
    throw new Error('알림 권한이 차단되어 있어요. 브라우저 설정에서 직접 변경해 주세요.');
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!key || !/^[A-Za-z0-9_-]{87}$/.test(key))
    throw new Error('운영자의 푸시 서버 설정이 필요해요. 앱 내부 알림은 계속 사용할 수 있어요.');
  const registration = await navigator.serviceWorker.getRegistration(
    new URL('./', document.baseURI),
  );
  if (!registration?.active)
    throw new Error('앱 기능을 준비하고 있어요. 배포된 사이트에서 다시 시도해 주세요.');
  const permission = await window.Notification.requestPermission();
  if (permission !== 'granted')
    throw new Error('알림을 허용하지 않았어요. 앱 내부 알림을 이용할 수 있어요.');
  const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) =>
    c.charCodeAt(0),
  );
  let subscription = await registration.pushManager.getSubscription();
  const created = !subscription;
  subscription ||= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytes,
  });
  try {
    const data = subscription.toJSON();
    await v2('push_save', {
      endpoint: data.endpoint,
      ...data.keys,
      device_name: /Mobile|Android|iPhone/.test(navigator.userAgent)
        ? '모바일 브라우저'
        : 'PC 브라우저',
    });
  } catch (error) {
    if (created) await subscription.unsubscribe();
    throw error;
  }
}
export async function disablePush() {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration(
    new URL('./', document.baseURI),
  );
  const sub = await registration?.pushManager.getSubscription();
  if (sub) {
    await v2('push_delete', { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
}
export async function detachLocalPush() {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration(
    new URL('./', document.baseURI),
  );
  const sub = await registration?.pushManager.getSubscription();
  await sub?.unsubscribe();
}
