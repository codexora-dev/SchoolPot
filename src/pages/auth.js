import { el, field, button, link, toast } from '../lib/dom.js';
import { deleteAccountDialog } from '../components/delete-account.js';
import { call } from '../services/community.js';
import { nickname } from '../lib/validation.js';
import { pageTitle } from '../components/layout.js';
export { authPage } from './auth-form.js';
export function profilePage(state, refresh, params = new URLSearchParams()) {
  const accountOnly = params.get('section') === 'account';
  const p = state.me?.profile;
  const status = el('p', { role: 'status' });
  const form = el(
    'form',
    {
      class: 'panel form-stack profile-form',
      onSubmit: async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target));
        try {
          await call('save_profile', {
            nickname: nickname(data.nickname),
            grade: data.grade,
            notifications_enabled: Boolean(data.notifications_enabled),
          });
          await refresh();
          toast('프로필을 저장했어요.');
        } catch (err) {
          status.textContent = err.message;
        }
      },
    },
    el('h2', {}, p ? '내 프로필' : '닉네임을 설정해 주세요'),
    field('닉네임', 'nickname', 'text', {
      value: p?.nickname || state.user?.user_metadata?.nickname || '',
      required: true,
      minlength: 2,
      maxlength: 20,
    }),
    el(
      'label',
      { class: 'field' },
      el('span', {}, '학년 (선택)'),
      el(
        'select',
        { name: 'grade' },
        el('option', { value: '' }, '선택 안 함'),
        ...[1, 2, 3].map((n) => el('option', { value: n, selected: p?.grade === n }, `${n}학년`)),
      ),
    ),
    el(
      'label',
      { class: 'checkbox' },
      el('input', {
        type: 'checkbox',
        name: 'notifications_enabled',
        checked: p?.notifications_enabled !== false,
      }),
      '댓글 · 답글 · 공지 알림 받기',
    ),
    el('button', { class: 'button primary', type: 'submit' }, '프로필 저장'),
    status,
  );
  return el(
    'section',
    {},
    pageTitle(
      'MY SCHOOLPOT',
      accountOnly ? '계정 관리' : '나의 스쿨팟',
      '나에게 맞는 학교생활을 만들어가요.',
    ),
    !accountOnly ? form : null,
    el(
      'div',
      { class: 'panel danger-zone' },
      el('h2', {}, '계정 관리'),
      link('비밀번호 변경', '#/password', 'button secondary'),
      el(
        'p',
        { class: 'muted' },
        '회원탈퇴 시 계정과 프로필, 로그인 세션이 삭제됩니다. 게시글·댓글·문의 본문은 계정 연결 없이 남아요. 지우고 싶은 게시글과 댓글은 탈퇴 전에 삭제해 주세요.',
      ),
      button('회원 탈퇴', () => deleteAccountDialog(state, refresh), 'button danger'),
    ),
  );
}
