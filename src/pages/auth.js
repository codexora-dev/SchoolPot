import { el, field, button, link, toast } from '../lib/dom.js';
import { client } from '../services/api.js';
import { call } from '../services/community.js';
import { nickname } from '../lib/validation.js';
import { pageTitle } from '../components/layout.js';
export { authPage } from './auth-form.js';
export function profilePage(state, refresh) {
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
    pageTitle('MY SCHOOLPOT', '나의 스쿨팟', '나에게 맞는 학교생활을 만들어가요.'),
    form,
    p
      ? el(
          'div',
          { class: 'panel danger-zone' },
          el('h2', {}, '계정 관리'),
          link('비밀번호 변경', '#/password', 'button secondary'),
          el(
            'p',
            { class: 'muted' },
            '탈퇴하면 프로필과 활동 기록 연결이 삭제되고, 게시글과 댓글은 탈퇴한 사용자로 남아요. 익명 번호와 좋아요, 투표, 알림은 삭제돼요.',
          ),
          button(
            '회원 탈퇴',
            () => {
              const dialog = el(
                'dialog',
                {},
                el(
                  'form',
                  { method: 'dialog', class: 'form-stack' },
                  el('h2', {}, '정말 탈퇴하시겠어요?'),
                  el(
                    'p',
                    {},
                    '삭제할 게시글과 댓글은 탈퇴 전에 직접 삭제해 주세요. 계속하려면 탈퇴를 입력해 주세요.',
                  ),
                  field('탈퇴 확인', 'confirm', 'text', { required: true }),
                  field('현재 비밀번호', 'current-password', 'password', {
                    required: true,
                    autocomplete: 'current-password',
                  }),
                  el(
                    'div',
                    { class: 'actions' },
                    button('취소', () => dialog.close()),
                    button(
                      '계정 삭제',
                      async () => {
                        try {
                          const userId = state.user?.id;
                          if (dialog.querySelector('[name=confirm]').value !== '탈퇴')
                            throw new Error('탈퇴를 정확히 입력해 주세요.');
                          const { edge } = await import('../services/api.js');
                          await edge('delete-account', {
                            password: dialog.querySelector('[name=current-password]').value,
                          });
                          dialog.close();
                          try {
                            if (userId) localStorage.removeItem(`schoolpot-draft:${userId}`);
                          } catch {
                            /* Storage cleanup cannot undo a completed deletion. */
                          }
                          await client.auth.signOut({ scope: 'local' });
                          await refresh();
                          location.hash = '/';
                          toast('탈퇴 처리가 완료되었어요.');
                        } catch (err) {
                          toast(err.message);
                        }
                      },
                      'button danger',
                    ),
                  ),
                ),
              );
              document.body.append(dialog);
              dialog.addEventListener('close', () => dialog.remove());
              dialog.showModal();
            },
            'button danger',
          ),
        )
      : null,
  );
}
