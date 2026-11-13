import { el, button, field, date, empty, link, errorBox } from '../lib/dom.js';
import { governance } from '../services/governance.js';
import { deleteAccountDialog } from '../components/delete-account.js';

export async function accountStatus(state, reload, logout, blocked = false) {
  const [records, rights] = await Promise.all([governance('mine'), governance('rights_mine')]);
  const content = el(
    'div',
    { class: 'form-stack' },
    el(
      'h1',
      { id: 'account-state-title' },
      blocked ? '계정 이용이 제한되어 있어요' : '계정 운영 안내',
    ),
    el(
      'p',
      {},
      blocked
        ? '이 계정은 제한이 해제될 때까지 커뮤니티와 학교 정보를 이용할 수 없습니다. 아래에서 사유를 확인하고 이의를 제기할 수 있어요.'
        : '안내·경고와 이용 제한, 이의 제기 처리 결과를 확인하세요.',
    ),
    ...records.sanctions.map((s) => {
      const appeal = records.appeals.find((a) => a.sanction_id === s.id && a.status !== 'closed');
      const card = el(
        'article',
        { class: 'panel form-stack' },
        el(
          'span',
          { class: 'status-chip' },
          {
            advice: '안내',
            warning: '경고',
            suspend: '이용 제한',
            review: '30일 제한 · 영구 제한 검토',
            permanent: '영구 이용 제한',
          }[s.kind],
        ),
        el('h2', {}, s.rule),
        el('p', { class: 'preserve' }, s.reason),
        el(
          'p',
          { class: 'meta' },
          `시작: ${date(s.starts_at)}${s.ends_at ? ` · 종료: ${date(s.ends_at)}` : s.kind === 'permanent' ? ' · 최고 관리자 해제 시까지' : ''}${s.revoked_at ? ' · 해제됨' : ''}`,
        ),
      );
      if (!appeal) {
        const target = el('div');
        card.append(
          button('이의 제기', () => {
            target.replaceChildren(
              submitForm(
                '이의 제기 내용',
                (data) => governance('appeal', { ...data, sanction_id: s.id }),
                reload,
              ),
            );
            target.querySelector('textarea').focus();
          }),
          target,
        );
      } else
        card.append(el('p', { class: 'hint' }, '이의 제기를 접수했습니다. 답변을 기다려 주세요.'));
      return card;
    }),
    records.sanctions.length
      ? null
      : empty('계정 운영 안내가 없어요', '새 안내가 있으면 이곳에서 확인할 수 있어요.'),
    el('h2', {}, '내 이의 제기'),
    ...records.appeals.map((a) =>
      el(
        'article',
        { class: 'panel' },
        el(
          'span',
          { class: 'status-chip' },
          { new: '접수', reviewing: '검토 중', closed: '종료' }[a.status],
        ),
        el('p', { class: 'preserve' }, a.body),
        a.reply ? el('p', { class: 'feedback-reply preserve' }, a.reply) : null,
      ),
    ),
    el(
      'details',
      {},
      el('summary', {}, '계정·개인정보 문의'),
      el(
        'p',
        { class: 'hint' },
        '로그인 문제나 개인정보 관련 요청은 최고 관리자에게 전달합니다. 비밀번호·복구 코드는 적지 마세요.',
      ),
      submitForm('문의 내용', (data) => governance('rights', data), reload),
      ...rights.map((f) =>
        el(
          'article',
          { class: 'panel' },
          el('p', { class: 'preserve' }, f.body),
          el('p', { class: 'preserve' }, f.admin_reply || '답변을 기다리는 중입니다.'),
        ),
      ),
    ),
    el(
      'div',
      { class: 'actions' },
      button('상태 새로고침', reload),
      button('로그아웃', logout),
      button('회원탈퇴', () => deleteAccountDialog(state, reload), 'button danger'),
    ),
  );
  if (!blocked) return el('section', {}, link('← 프로필', '#/profile', 'back-link'), content);
  const dialog = el(
    'dialog',
    { class: 'restriction-dialog', 'aria-labelledby': 'account-state-title' },
    content,
  );
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.addEventListener('close', () => {
    if (dialog.isConnected) dialog.showModal();
  });
  const root = el(
    'main',
    { id: 'main', tabindex: '-1', class: 'restriction-screen' },
    el('strong', { class: 'restriction-brand' }, 'SchoolPot · 계정 상태'),
    dialog,
  );
  window.requestAnimationFrame(() => {
    if (dialog.isConnected) dialog.showModal();
  });
  return root;
}
function submitForm(label, submit, reload) {
  const status = el('p', { role: 'status' });
  return el(
    'form',
    {
      class: 'form-stack',
      onSubmit: async (event) => {
        try {
          await submit(Object.fromEntries(new FormData(event.target)));
          await reload();
        } catch (e) {
          status.replaceChildren(errorBox(e.message));
        }
      },
    },
    field(label, 'body', 'textarea', { required: true, minlength: 2, maxlength: 4000, rows: 5 }),
    status,
    el('button', { type: 'submit', class: 'button primary' }, '보내기'),
  );
}
