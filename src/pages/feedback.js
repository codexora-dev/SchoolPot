import { el, field, button, link, empty, toast, date } from '../lib/dom.js';
import { pageTitle } from '../components/layout.js';
import { feedback } from '../services/management.js';
const kinds = { suggestion: '건의사항', bug: '오류 제보', other: '기타 문의' };
const states = { new: '접수', reviewing: '확인 중', resolved: '해결 완료', closed: '종료' };
function select(label, name, values, selected = '', all = false) {
  return el(
    'label',
    { class: 'field' },
    el('span', {}, label),
    el(
      'select',
      { name, 'aria-label': label },
      all ? el('option', { value: '' }, '전체') : null,
      ...Object.entries(values).map(([value, text]) =>
        el('option', { value, selected: value === selected }, text),
      ),
    ),
  );
}
function ticket(item) {
  return el(
    'article',
    { class: 'panel feedback-card', id: `feedback-${item.id}` },
    el(
      'div',
      { class: 'actions' },
      el('span', { class: 'board-chip' }, kinds[item.kind]),
      el('span', { class: 'status-chip' }, states[item.status]),
    ),
    el('h3', {}, item.title),
    el('p', { class: 'preserve' }, item.body),
    el(
      'p',
      { class: 'meta' },
      `${date(item.created_at)}${item.nickname ? ` · ${item.nickname}` : ''}`,
    ),
    item.admin_reply
      ? el(
          'div',
          { class: 'feedback-reply' },
          el('strong', {}, '관리자 답변'),
          el('p', { class: 'preserve' }, item.admin_reply),
          el('small', { class: 'meta' }, date(item.updated_at)),
        )
      : null,
  );
}
export async function feedbackPage(params, reload) {
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const items = await feedback('mine', { offset });
  const status = el('p', { role: 'status', class: 'hint' });
  const form = el(
    'form',
    {
      class: 'panel form-stack',
      onSubmit: async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type=submit]');
        submit.disabled = true;
        try {
          await feedback('create', Object.fromEntries(new FormData(form)));
          toast('접수했어요. 내 문의에서 답변을 확인해 주세요.');
          if (offset) location.hash = '/feedback';
          else await reload();
        } catch (err) {
          status.textContent = err.message;
        } finally {
          submit.disabled = false;
        }
      },
    },
    el('h2', {}, '관리자에게 보내기'),
    select('문의 유형', 'kind', kinds, 'suggestion'),
    field('제목', 'title', 'text', { required: true, minlength: 2, maxlength: 120 }),
    field('내용', 'body', 'textarea', {
      required: true,
      maxlength: 8000,
      rows: 6,
      placeholder: '오류라면 발생한 화면과 상황, 재현 순서를 적어주세요.',
    }),
    el(
      'p',
      { class: 'hint' },
      '작성자와 관리자만 볼 수 있어요. 실명·학번·비밀번호·복구 코드 등 개인정보는 적지 마세요. 시간당 최대 5건을 보낼 수 있어요.',
    ),
    status,
    el('button', { class: 'button primary', type: 'submit' }, '보내기'),
  );
  return el(
    'section',
    {},
    pageTitle('FEEDBACK', '건의·오류 제보', '더 편한 스쿨팟을 함께 만들어요.'),
    form,
    el('h2', { class: 'section-heading' }, '내 문의'),
    el(
      'div',
      { class: 'management-list' },
      items.length
        ? items.map(ticket)
        : empty('아직 보낸 문의가 없어요', '접수 상태와 관리자 답변을 이곳에서 확인할 수 있어요.'),
    ),
    pagination(items, offset, '#/feedback?'),
  );
}
function pagination(items, offset, prefix) {
  return el(
    'div',
    { class: 'pagination' },
    offset
      ? link('← 이전', `${prefix}offset=${Math.max(0, offset - 20)}`, 'button secondary')
      : null,
    items.length === 20
      ? link('다음 →', `${prefix}offset=${offset + 20}`, 'button secondary')
      : null,
  );
}
export async function feedbackManager(params, reload) {
  const status = params.get('status') || '';
  const kind = params.get('kind') || '';
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const items = await feedback('admin_list', { status, kind, offset });
  const review = (item) => {
    const message = el('p', { role: 'status' });
    const form = el(
      'form',
      {
        class: 'form-stack',
        onSubmit: async (event) => {
          event.preventDefault();
          const submit = form.querySelector('[type=submit]');
          submit.disabled = true;
          try {
            await feedback('admin_update', {
              ...Object.fromEntries(new FormData(form)),
              id: item.id,
              revision: item.revision,
            });
            dialog.close();
            toast('답변과 상태를 저장했어요.');
            await reload();
          } catch (err) {
            message.textContent = err.message;
          } finally {
            submit.disabled = false;
          }
        },
      },
      el('h2', {}, '문의 처리'),
      el('h3', {}, item.title),
      el('p', { class: 'preserve' }, item.body),
      select('처리 상태', 'status', states, item.status),
      field('관리자 답변', 'admin_reply', 'textarea', { maxlength: 4000, rows: 6 }),
      message,
      el(
        'div',
        { class: 'actions' },
        button('취소', () => dialog.close()),
        el('button', { class: 'button primary', type: 'submit' }, '저장'),
      ),
    );
    form.querySelector('textarea').value = item.admin_reply;
    const dialog = el('dialog', { 'aria-label': '문의 처리' }, form);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  };
  return el(
    'section',
    {},
    el('h2', {}, '건의·오류 관리'),
    el(
      'form',
      {
        class: 'filters',
        onSubmit: (event) => {
          event.preventDefault();
          location.hash = `/admin?tab=feedback&${new URLSearchParams(new FormData(event.target))}`;
        },
      },
      select('처리 상태', 'status', states, status, true),
      select('문의 유형', 'kind', kinds, kind, true),
      el('button', { type: 'submit', class: 'button secondary' }, '조회'),
    ),
    el(
      'div',
      { class: 'management-list' },
      items.length
        ? items.map((item) => {
            const card = ticket(item);
            card.append(button('확인·답변', () => review(item), 'button secondary'));
            return card;
          })
        : empty('접수된 문의가 없어요', '선택한 조건에 해당하는 문의를 표시합니다.'),
    ),
    pagination(
      items,
      offset,
      `#/admin?tab=feedback&status=${encodeURIComponent(status)}&kind=${encodeURIComponent(kind)}&`,
    ),
  );
}
