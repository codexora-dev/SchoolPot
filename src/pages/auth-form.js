import { el, field, button, link, toast } from '../lib/dom.js';
import { auth, client, authStorage } from '../services/api.js';
import { register, recover, signIn } from '../services/accounts.js';
import { password } from '../lib/validation.js';
import { icon } from '../components/icons.js';
export function authPage(mode, refresh) {
  const signup = mode === 'signup',
    reset = mode === 'reset',
    update = mode === 'password';
  const title = signup
    ? '우리 학교 이야기, 함께해요'
    : reset
      ? '복구 코드로 비밀번호 재설정'
      : update
        ? '비밀번호 변경'
        : '다시 만나서 반가워요';
  const status = el('p', { role: 'status', class: 'form-status' });
  const showRecovery = (code, message) => {
    form.replaceChildren(
      el('h2', {}, message),
      el(
        'p',
        { class: 'muted' },
        '이메일을 수집하지 않으므로 이 코드가 있어야 비밀번호를 재설정할 수 있어요. 코드는 지금 한 번만 표시됩니다. 안전한 곳에 보관해 주세요.',
      ),
      el('code', { class: 'recovery-code', tabindex: 0 }, code.match(/.{1,8}/g).join('-')),
      button('복구 코드 복사', async () => {
        try {
          await navigator.clipboard.writeText(code);
          toast('복구 코드를 복사했어요.');
        } catch {
          toast('코드를 직접 선택해서 복사해 주세요.');
        }
      }),
      link('코드를 보관했어요 · 로그인하기', '#/login', 'button primary'),
    );
  };
  const form = el(
    'form',
    {
      class: 'auth-card form-stack',
      onSubmit: async (e) => {
        e.preventDefault();
        const submit = form.querySelector('[type=submit]');
        submit.disabled = true;
        status.textContent = '처리 중이에요…';
        try {
          const values = Object.fromEntries(new FormData(form));
          if (signup) {
            const result = await register(values.username, values.password);
            form.reset();
            showRecovery(result.recovery_code, '가입이 완료되었어요');
          } else if (reset) {
            const result = await recover(values.username, values.recovery_code, values.password);
            form.reset();
            showRecovery(result.recovery_code, '비밀번호를 재설정했어요');
          } else if (update) {
            const { data, error } = await client.auth.getUser();
            if (error || !data.user) throw new Error('다시 로그인해 주세요.');
            await auth('signInWithPassword', {
              email: data.user.email,
              password: values.current_password,
            });
            await auth('updateUser', { password: password(values.password) });
            toast('비밀번호를 변경했어요.');
            location.hash = '/profile';
          } else {
            await signIn(values.username, values.password);
            const remembered = authStorage.setRemember(Boolean(values.remember));
            form.querySelector('[name=password]').value = '';
            if (values.remember && !remembered)
              toast('이 브라우저에서는 자동로그인을 유지할 수 없어요.');
            await refresh();
            location.hash = '/';
          }
        } catch (error) {
          status.textContent = error.message;
        } finally {
          submit.disabled = false;
        }
      },
    },
    el('div', { class: 'auth-mark' }, icon('cap', 27)),
    el('h2', {}, title),
    el(
      'p',
      { class: 'muted' },
      signup
        ? '아이디와 비밀번호만으로 시작하세요. 이메일 인증은 없어요.'
        : reset
          ? '가입할 때 보관한 복구 코드를 입력해 주세요.'
          : '학교의 작은 순간들을 스쿨팟에서 만나보세요.',
    ),
    !update
      ? field('아이디', 'username', 'text', {
          required: true,
          minlength: 3,
          maxlength: 20,
          pattern: '[A-Za-z][A-Za-z0-9_]{2,19}',
          autocomplete: 'username',
          autocapitalize: 'none',
          spellcheck: 'false',
          placeholder: '영문자로 시작 · 영문, 숫자, _ 3~20자',
        })
      : field('현재 비밀번호', 'current_password', 'password', {
          required: true,
          maxlength: 128,
          autocomplete: 'current-password',
        }),
    reset
      ? field('복구 코드', 'recovery_code', 'text', {
          required: true,
          maxlength: 100,
          autocomplete: 'off',
          spellcheck: 'false',
        })
      : null,
    field(reset || update ? '새 비밀번호' : '비밀번호', 'password', 'password', {
      required: true,
      minlength: signup || reset || update ? 8 : 1,
      maxlength: 128,
      autocomplete: signup || reset || update ? 'new-password' : 'current-password',
      placeholder: signup || reset || update ? '8자 이상' : null,
    }),
    signup
      ? el(
          'p',
          { class: 'hint' },
          '대소문자를 구분하지 않는 아이디예요. 실명·학번은 사용하지 마세요. 재학생 여부는 확인하지 않습니다.',
        )
      : null,
    !signup && !reset && !update
      ? el(
          'div',
          { class: 'login-options' },
          el(
            'label',
            { class: 'checkbox' },
            el('input', {
              type: 'checkbox',
              name: 'remember',
              checked: authStorage.isRemembered(),
            }),
            '자동로그인',
          ),
          el(
            'p',
            { class: 'hint' },
            '개인 기기에서만 선택해 주세요. 선택하지 않으면 현재 탭에서만 로그인을 유지해요.',
          ),
        )
      : null,
    el(
      'button',
      { type: 'submit', class: 'button primary' },
      signup ? '회원가입' : reset ? '비밀번호 재설정' : update ? '비밀번호 변경' : '로그인',
    ),
    status,
    el(
      'div',
      { class: 'auth-links' },
      link(
        signup || reset ? '로그인으로 돌아가기' : '처음 오셨나요? 회원가입',
        signup || reset ? '#/login' : '#/signup',
      ),
      !signup && !reset && !update ? link('비밀번호를 잊으셨나요?', '#/reset') : null,
    ),
  );
  return el('section', { class: 'auth-wrap' }, form);
}
