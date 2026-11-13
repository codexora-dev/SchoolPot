import { el, field, button, link, empty, date, toast } from '../lib/dom.js';
import { required } from '../lib/validation.js';
import { contentEditor } from '../components/content-editor.js';
import { contentBody } from '../components/content-body.js';
import { manageNotices } from '../services/notices.js';

function openDialog(title, ...children) {
  const dialog = el('dialog', { 'aria-label': title, class: 'notice-editor' }, ...children);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
export async function editNotice(id, onSaved, owner = true) {
  const main = document.querySelector('#main');
  let item;
  try {
    item = id ? await manageNotices('get', { id }) : {};
  } catch (e) {
    toast(e.message);
    return;
  }
  if (!main?.isConnected || main !== document.querySelector('#main')) return;
  const editing = Boolean(item.id),
    title = editing ? '공지 수정' : '새 공지 등록';
  const status = el('p', { role: 'status', class: 'form-status' });
  let dialog;
  const form = el(
    'form',
    {
      class: 'form-stack',
      onSubmit: async (event) => {
        const data = Object.fromEntries(new FormData(event.target));
        try {
          const result = await manageNotices('save', {
            id: item.id || null,
            revision: item.revision || null,
            title: required(data.title, 2, 120),
            body: required(data.body, 1, 20000),
            content_format: data.content_format,
            owner_only: owner ? data.owner_only === 'on' : undefined,
          });
          dialog.close();
          toast(editing ? '공지를 수정했어요.' : '공지를 등록했어요.');
          await onSaved(result);
        } catch (e) {
          status.textContent = e.message;
        }
      },
    },
    el('h2', {}, title),
    el(
      'p',
      { class: 'hint' },
      editing
        ? '수정 내용은 바로 반영되며 새 공지 알림을 다시 보내지 않습니다.'
        : '등록하면 회원에게 공지가 표시되고 새 공지 알림을 보냅니다.',
    ),
    field('제목', 'title', 'text', {
      required: true,
      minlength: 2,
      maxlength: 120,
      value: item.title || '',
    }),
    owner
      ? el(
          'label',
          { class: 'checkbox-field' },
          el('input', { type: 'checkbox', name: 'owner_only', checked: item.owner_only }),
          '최고 관리자 전용 중요 공지',
        )
      : null,
    contentEditor({ body: item.body || '', format: item.content_format || 'text' }),
    status,
    el(
      'div',
      { class: 'actions' },
      button('취소', () => dialog.close()),
      el(
        'button',
        { type: 'submit', class: 'button primary' },
        editing ? '수정 저장' : '등록하고 알림 보내기',
      ),
    ),
  );
  dialog = openDialog(title, form);
}
export function deleteNotice(item, onDeleted) {
  const status = el('p', { role: 'status' });
  let dialog;
  dialog = openDialog(
    '공지 삭제 확인',
    el('h2', {}, '공지를 삭제할까요?'),
    el('p', {}, `“${item.title}” 공지를 삭제합니다. 삭제한 내용은 복구할 수 없어요.`),
    status,
    el(
      'div',
      { class: 'actions' },
      button('취소', () => dialog.close()),
      button(
        '삭제',
        async () => {
          try {
            await manageNotices('delete', { id: item.id, revision: item.revision });
            dialog.close();
            toast('공지를 삭제했어요.');
            await onDeleted();
          } catch (e) {
            status.textContent = e.message;
          }
        },
        'button danger',
      ),
    ),
  );
}
async function previewNotice(id) {
  const main = document.querySelector('#main');
  try {
    const item = await manageNotices('get', { id });
    if (!main?.isConnected || main !== document.querySelector('#main')) return;
    let dialog;
    dialog = openDialog(
      '공지 미리보기',
      el('h2', {}, item.title),
      contentBody(item.body, item.content_format),
      button('닫기', () => dialog.close()),
    );
  } catch (e) {
    toast(e.message);
  }
}
export async function noticeManager(params, reload, owner = true) {
  const query = (params.get('q') || '').trim().slice(0, 120),
    offset = Math.min(10000, Math.max(0, Number.parseInt(params.get('offset'), 10) || 0));
  const url = (q, skip) => {
    const p = new URLSearchParams({ tab: 'notice' });
    if (q) p.set('q', q);
    if (skip) p.set('offset', skip);
    return '#/admin?' + p;
  };
  const items = await manageNotices('list', { query, offset });
  return el(
    'section',
    {},
    el(
      'div',
      { class: 'section-heading popup-manager-heading' },
      el(
        'div',
        {},
        el('h2', {}, '공지사항 관리'),
        el('p', { class: 'hint' }, '등록된 공지를 확인하고 내용과 작성 형식을 수정할 수 있어요.'),
      ),
      el(
        'div',
        { class: 'actions' },
        button('새로고침', reload),
        button('＋ 공지 등록', () => editNotice(null, reload, owner), 'button primary'),
      ),
    ),
    el(
      'form',
      {
        class: 'filters notice-filters',
        onSubmit: (event) => {
          location.hash = url(new FormData(event.target).get('q').trim(), 0).slice(1);
        },
      },
      el('input', {
        type: 'search',
        name: 'q',
        value: query,
        maxlength: 120,
        'aria-label': '관리 공지 검색',
        placeholder: '공지 제목 검색',
      }),
      el('button', { type: 'submit', class: 'button secondary' }, '검색'),
      query ? link('초기화', url('', 0), 'button secondary') : null,
    ),
    el(
      'div',
      { class: 'popup-admin-list' },
      items.length
        ? items.map((item) =>
            el(
              'article',
              { class: 'panel notice-admin-card' },
              el(
                'div',
                { class: 'section-heading' },
                el(
                  'span',
                  { class: 'board-chip' },
                  { text: 'Text', markdown: 'Markdown', html: 'HTML' }[item.content_format] ||
                    'Text',
                ),
                el('small', { class: 'meta' }, `등록 ${date(item.created_at)}`),
              ),
              el('h3', {}, item.title),
              item.updated_at && item.updated_at !== item.created_at
                ? el('p', { class: 'hint' }, `수정 ${date(item.updated_at)}`)
                : null,
              el(
                'div',
                { class: 'actions' },
                button('미리보기', () => previewNotice(item.id)),
                item.can_edit !== false
                  ? button('수정', () => editNotice(item.id, reload, owner))
                  : null,
                item.can_delete !== false
                  ? button('삭제', () => deleteNotice(item, reload), 'button danger')
                  : null,
                link('상세 보기', `#/notice/${item.id}`, 'button secondary'),
              ),
            ),
          )
        : empty(
            query ? '검색 결과가 없어요' : '등록된 공지가 없어요',
            '새 공지를 등록하거나 검색어를 확인해 주세요.',
          ),
    ),
    el(
      'nav',
      { class: 'pagination', 'aria-label': '관리 공지 페이지' },
      offset ? link('← 이전', url(query, Math.max(0, offset - 20)), 'button secondary') : null,
      items.length === 20 && offset < 10000
        ? link('다음 →', url(query, offset + 20), 'button secondary')
        : null,
    ),
  );
}
