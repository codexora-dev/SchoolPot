import { rpc } from './api.js';
export const v2 = (action, payload = {}) =>
  rpc('schoolpot_v2', { p_action: action, p_payload: payload });

let currentUser = null;
let inFlight = false;
let lastFetch = 0;
let lastUnread = null;
let lastVersion = null;
export function setNotificationAccount(state) {
  const next =
    state.user && state.me?.enrollment_current && !state.me?.restricted ? state.user.id : null;
  if (currentUser !== next) {
    currentUser = next;
    lastUnread = null;
    lastVersion = null;
    lastFetch = 0;
  }
  paintUnread();
}
function paintUnread() {
  for (const node of document.querySelectorAll('.notification-link')) {
    node.querySelector('.notification-count')?.remove();
    node.setAttribute(
      'aria-label',
      lastUnread ? `내 알림 · 읽지 않은 알림 ${lastUnread}개` : '내 알림',
    );
    if (currentUser && lastUnread > 0) {
      const badge = document.createElement('span');
      badge.className = 'notification-count';
      badge.textContent = lastUnread > 99 ? '99+' : String(lastUnread);
      node.append(badge);
    }
  }
}
export async function syncUnread(force = false) {
  paintUnread();
  if (
    !currentUser ||
    document.hidden ||
    !navigator.onLine ||
    inFlight ||
    (!force && Date.now() - lastFetch < 30000)
  )
    return;
  const user = currentUser;
  inFlight = true;
  try {
    const result = await v2('unread');
    if (currentUser === user) {
      const changed = lastVersion !== null && lastVersion !== result.version;
      lastUnread = result.unread;
      lastVersion = result.version;
      lastFetch = Date.now();
      paintUnread();
      if (changed) window.dispatchEvent(new window.Event('schoolpot-notifications-change'));
    }
  } catch {
    /* Keep the last server count; the notification page exposes retryable errors. */
  } finally {
    inFlight = false;
  }
}
export function startNotificationSync() {
  window.setInterval(() => syncUnread(), 30000);
  window.addEventListener('focus', () => syncUnread());
  window.addEventListener('online', () => syncUnread(true));
  document.addEventListener('visibilitychange', () => syncUnread());
  window.addEventListener('schoolpot-notifications-written', () => syncUnread(true));
}
export function notificationsWritten() {
  lastFetch = 0;
  window.dispatchEvent(new window.Event('schoolpot-notifications-written'));
}
