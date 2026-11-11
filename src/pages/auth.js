import { el, field, button, link, toast } from '../lib/dom.js';
import { auth, client } from '../services/api.js';
import { call } from '../services/community.js';
import { nickname, password } from '../lib/validation.js';
import { pageTitle } from '../components/layout.js';
export function authPage(mode, refresh) {
  const signup = mode === 'signup',
    reset = mode === 'reset',
    update = mode === 'password';
  const title = signup
    ? '우리 학교 이야기, 함께해요'
    : reset
      ? '비밀번호를 잊으셨나요?'
      : update
        ? '새 비밀번호 설정'
        : '다시 만나서 반가워요';
  const status = el('p', { role: 'status', class: 'form-status' });
  const form = el(
    'form',
    {
      class: 'auth-card form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        const submit = e.target.querySelector('[type=submit]');
        submit.disabled = true;
        status.textContent = '처리 중이에요…';
        try {
          const values = Object.fromEntries(new FormData(e.target));
          const redirectTo = `${location.origin}/`;
          if (signup) {
            await auth('signUp', {
              email: values.email,
              password: password(values.password),
              options: {
                emailRedirectTo: redirectTo,
                data: { nickname: nickname(values.nickname) },
              },
            });
            status.textContent =
              '가입 요청을 받았어요. 이메일의 인증 링크를 확인한 뒤 로그인해 주세요.';
            e.target.reset();
          } else if (reset) {
            await auth('resetPasswordForEmail', values.email, { redirectTo });
            status.textContent = '등록된 이메일이라면 재설정 안내가 전송됩니다.';
          } else if (update) {
            await auth('updateUser', { password: password(values.password) });
            toast('비밀번호를 변경했어요.');
            location.hash = '/profile';
          } else {
            await auth('signInWithPassword', { email: values.email, password: values.password });
            await refresh();
            location.hash = '/';
          }
        } catch (err) {
          status.textContent = err.message;
        } finally {
          submit.disabled = false;
        }
      },
    },
    el('div', { class: 'auth-mark' }, '▱'),
    el('h2', {}, title),
    el(
      'p',
      { class: 'muted' },
      signup
        ? '재학생 인증 신청 없이 가입할 수 있어요. 이메일 인증은 필요해요.'
        : '학교의 작은 순간들을 스쿨팟에서 만나보세요.',
    ),
    signup
      ? field('닉네임', 'nickname', 'text', {
          required: true,
          minlength: 2,
          maxlength: 20,
          autocomplete: 'nickname',
        })
      : null,
    !update
      ? field('이메일', 'email', 'email', { required: true, autocomplete: 'email', maxlength: 254 })
      : null,
    !reset
      ? field(update ? '새 비밀번호' : '비밀번호', 'password', 'password', {
          required: true,
          minlength: signup || update ? 12 : 1,
          maxlength: 128,
          autocomplete: signup || update ? 'new-password' : 'current-password',
        })
      : null,
    signup
      ? el(
          'p',
          { class: 'hint' },
          '재학생 여부는 확인하지 않아요. 실명·학번 등 개인정보는 게시하지 마세요.',
        )
      : null,
    el(
      'button',
      { type: 'submit', class: 'button primary' },
      signup ? '회원가입' : reset ? '재설정 이메일 받기' : update ? '비밀번호 변경' : '로그인',
    ),
    status,
    el(
      'div',
      { class: 'auth-links' },
      link(
        signup ? '이미 계정이 있나요? 로그인' : '처음 오셨나요? 회원가입',
        signup ? '#/login' : '#/signup',
      ),
      !reset && !signup ? link('비밀번호 찾기', '#/reset') : null,
    ),
  );
  return el('section', { class: 'auth-wrap' }, form);
}
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
                          if (dialog.querySelector('[name=confirm]').value !== '탈퇴')
                            throw new Error('탈퇴를 정확히 입력해 주세요.');
                          const { edge } = await import('../services/api.js');
                          await edge('delete-account', {
                            password: dialog.querySelector('[name=current-password]').value,
                          });
                          await client.auth.signOut({ scope: 'local' });
                          localStorage.removeItem(`schoolpot-draft:${state.user.id}`);
                          dialog.close();
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
