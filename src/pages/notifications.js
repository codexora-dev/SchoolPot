import { icon } from '../components/icons.js';
import { el, button, link, empty, date, toast } from '../lib/dom.js';
import { pageTitle } from '../components/layout.js';
import { v2, notificationsWritten } from '../services/v2.js';
const typeNames = {
  comment: '댓글',
  reply: '답글',
  mention: '멘션',
  notice: '공지',
  subscription: '구독',
  report: '신고',
  sanction: '계정',
  appeal: '이의 제기',
  release: '계정',
  system: '안내',
};
export function notificationTarget(n) {
  if (n.governance_kind)
    return (
      {
        request: '#/admin?tab=requests',
        role: '#/profile',
        rights: '#/admin?tab=feedback',
        appeal: '#/account-status',
        appeal_admin: '#/admin?tab=appeals',
        sanction: '#/account-status',
      }[n.governance_kind] || '#/account-status'
    );
  if (n.type === 'release' || n.type === 'sanction') return '#/account-status';
  if (n.type === 'report') return '#/activity?kind=reports';
  if (n.feedback_id) return '#/feedback';
  if (n.post_id)
    return `#/post/${encodeURIComponent(n.post_id)}${n.comment_id ? '?comment=' + encodeURIComponent(n.comment_id) : ''}`;
  return n.notice_id ? `#/notice/${encodeURIComponent(n.notice_id)}` : '#/notices';
}
export async function notificationsPage(params, reload) {
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const data = await v2('notifications', { offset });
  const mutate = async (action, id) => {
    try {
      await v2(action, id ? { id } : {});
      notificationsWritten();
      await reload();
    } catch (error) {
      toast(error.message);
    }
  };
  return el(
    'section',
    {},
    pageTitle(
      'STAY CONNECTED',
      '내 알림',
      `읽지 않은 알림 ${data.unread}개`,
      link('알림 설정', '#/notification-settings', 'button secondary'),
    ),
    el(
      'div',
      { class: 'actions' },
      button('모두 읽음', () => mutate('read')),
      button('새로고침', reload),
    ),
    el(
      'div',
      { class: 'panel notification-list' },
      data.items.length
        ? data.items.map((n) => {
            const target = link(n.message, notificationTarget(n));
            target.addEventListener('click', (event) => {
              event.preventDefault();
              v2('read', { id: n.id })
                .then(() => {
                  notificationsWritten();
                  location.hash = notificationTarget(n).slice(1);
                })
                .catch((error) => toast(error.message));
            });
            return el(
              'article',
              { class: `notification ${n.read_at ? 'read' : ''}` },
              el(
                'span',
                { class: 'board-chip' },
                icon(
                  {
                    comment: 'chat',
                    reply: 'arrow',
                    mention: 'user',
                    notice: 'bell',
                    subscription: 'book',
                    report: 'check',
                    sanction: 'shield',
                    appeal: 'shield',
                    release: 'shield',
                  }[n.type] || 'bell',
                  15,
                ),
                `${n.important ? '중요 · ' : ''}${typeNames[n.type] || '안내'}`,
              ),
              el('div', {}, target, el('small', { class: 'meta' }, date(n.created_at))),
              el(
                'div',
                { class: 'actions' },
                button(
                  n.read_at ? '읽지 않음' : '읽음',
                  () => mutate(n.read_at ? 'unread_one' : 'read', n.id),
                  'text-button',
                ),
                button('삭제', () => mutate('delete', n.id), 'text-button'),
              ),
            );
          })
        : empty('아직 도착한 알림이 없어요', '새로운 소식을 여기서 확인할 수 있어요.'),
    ),
    el(
      'nav',
      { class: 'pagination', 'aria-label': '알림 페이지' },
      offset
        ? link('← 이전', `#/notifications?offset=${Math.max(0, offset - 20)}`, 'button secondary')
        : null,
      data.items.length === 20
        ? link('다음 →', `#/notifications?offset=${offset + 20}`, 'button secondary')
        : null,
    ),
  );
}
