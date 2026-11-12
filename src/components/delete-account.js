import { el, field, button, toast } from '../lib/dom.js';
import { client, edge, authStorage } from '../services/api.js';
export function deleteAccountDialog(state, refresh) {
  let busy = false;
  const status = el('p', { role: 'status', class: 'form-status' });
  const cancel = button('취소', () => dialog.close());
  const submit = el('button', { type: 'submit', class: 'button danger' }, '계정 삭제');
  const form = el(
    'form',
    {
      class: 'form-stack',
      onSubmit: async (event) => {
        event.preventDefault();
        if (busy) return;
        if (form.querySelector('[name=confirm]').value !== '탈퇴') {
          status.textContent = '탈퇴를 정확히 입력해 주세요.';
          return;
        }
        busy = true;
        submit.disabled = true;
        cancel.disabled = true;
        form.setAttribute('aria-busy', 'true');
        status.textContent = '계정을 삭제하고 있어요…';
        try {
          const result = await edge('delete-account', {
            password: form.querySelector('[name=current-password]').value,
          });
          if (result?.ok !== true)
            throw new Error('탈퇴 완료 응답을 확인하지 못했어요. 다시 시도해 주세요.');
        } catch (err) {
          status.textContent = err.message;
          busy = false;
          submit.disabled = false;
          cancel.disabled = false;
          form.setAttribute('aria-busy', 'false');
          return;
        }
        form.querySelector('[name=current-password]').value = '';
        try {
          if (state.user?.id) localStorage.removeItem(`schoolpot-draft:${state.user.id}`);
        } catch {
          /* Cleanup cannot undo deletion. */
        }
        try {
          await client.auth.signOut({ scope: 'local' });
        } catch {
          /* The server has already revoked all sessions. */
        }
        authStorage.clear();
        busy = false;
        dialog.close();
        await refresh();
        location.hash = '/';
        toast('회원탈퇴가 완료되었어요.');
      },
    },
    el('h2', {}, '정말 탈퇴하시겠어요?'),
    el(
      'p',
      {},
      '계정·프로필과 로그인 세션이 삭제되며 되돌릴 수 없어요. 게시글·댓글·문의 본문은 계정 연결 없이 남습니다. 지우고 싶은 게시글과 댓글은 먼저 삭제해 주세요.',
    ),
    field('탈퇴 확인', 'confirm', 'text', {
      required: true,
      autocomplete: 'off',
      placeholder: '탈퇴를 입력해 주세요.',
    }),
    field('현재 비밀번호', 'current-password', 'password', {
      required: true,
      maxlength: 128,
      autocomplete: 'current-password',
    }),
    status,
    el('div', { class: 'actions' }, cancel, submit),
  );
  const dialog = el('dialog', { 'aria-label': '회원탈퇴 확인' }, form);
  document.body.append(dialog);
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}
