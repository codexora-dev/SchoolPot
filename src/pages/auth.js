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
      'div',
      { class: 'panel' },
      el('strong', {}, '내 소속'),
      state.me?.membership
        ? el(
            'p',
            {},
            `${state.me.membership.school_year}학년도 ${state.me.membership.grade}학년 ${state.me.membership.class_number}반`,
          )
        : el('p', {}, '소속을 등록해 주세요.'),
      el(
        'p',
        { class: 'hint' },
        '학년·반을 임의 변경할 수 없어요. 잘못 등록했으면 관리자에게 정정을 요청해 주세요.',
      ),
      state.me?.enrollment_current !== true
        ? link('학년·반 선택', '#/enrollment', 'button secondary')
        : null,
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
        '회원탈퇴 시 계정·프로필·소속·동의·로그인 세션과 계정에 연결된 작성 내용을 삭제합니다. 본인 게시글에 달린 답글도 함께 삭제될 수 있으며 되돌릴 수 없어요.',
      ),
      button('회원 탈퇴', () => deleteAccountDialog(state, refresh), 'button danger'),
    ),
  );
}
