import { roleOf } from '../services/governance.js';
import { el, link, button, date, empty, errorBox } from '../lib/dom.js';
import { pageTitle } from '../components/layout.js';
import { call } from '../services/community.js';
import { contentBody } from '../components/content-body.js';

function filters(params) {
  const query = (params.get('q') || '').trim().slice(0, 120);
  const offset = Math.min(10000, Math.max(0, Number.parseInt(params.get('offset'), 10) || 0));
  return { query, offset };
}
function listUrl(query, offset) {
  const p = new URLSearchParams();
  if (query) p.set('q', query);
  if (offset) p.set('offset', offset);
  return '#/notices' + (p.size ? '?' + p : '');
}
export async function noticesPage(params) {
  const { query, offset } = filters(params);
  const items = await call('notice_list', { query, offset });
  const search = el(
    'form',
    {
      class: 'filters notice-filters',
      onSubmit: (e) => {
        const q = new FormData(e.target).get('q').trim();
        location.hash = listUrl(q, 0).slice(1);
      },
    },
    el('input', {
      type: 'search',
      name: 'q',
      value: query,
      maxlength: 120,
      'aria-label': '공지 검색',
      placeholder: '공지 제목으로 검색',
    }),
    el('button', { type: 'submit', class: 'button secondary' }, '검색'),
    query ? link('초기화', '#/notices', 'button secondary') : null,
  );
  return el(
    'section',
    { class: 'notices-page' },
    pageTitle(
      'SCHOOL NEWS',
      '공지사항',
      '학교와 스쿨팟의 새로운 소식을 확인하세요.',
      link('이용 규정', '#/rules', 'button secondary'),
    ),
    search,
    el(
      'div',
      { class: 'notice-list' },
      items.length
        ? items.map((n) => {
            const context = new URLSearchParams();
            if (query) context.set('q', query);
            if (offset) context.set('offset', offset);
            return el(
              'a',
              {
                href: `#/notice/${n.id}${context.size ? '?' + context : ''}`,
                class: 'panel notice-list-item',
              },
              el('span', { class: 'board-chip' }, '공지'),
              el(
                'div',
                {},
                el('h2', {}, n.title),
                el('time', { datetime: n.created_at, class: 'meta' }, date(n.created_at)),
              ),
              el('span', { class: 'notice-row-arrow', 'aria-hidden': 'true' }, '→'),
            );
          })
        : el(
            'div',
            { class: 'panel' },
            empty(
              query ? '검색 결과가 없어요' : '등록된 공지가 없어요',
              query ? '다른 제목으로 검색해 보세요.' : '새로운 소식이 올라오면 알려드릴게요.',
              query ? link('전체 공지 보기', '#/notices', 'button secondary') : null,
            ),
          ),
    ),
    el(
      'nav',
      { class: 'pagination', 'aria-label': '공지 페이지' },
      offset ? link('← 이전', listUrl(query, Math.max(0, offset - 20)), 'button secondary') : null,
      offset || items.length === 20
        ? el('span', { class: 'page-indicator' }, `${Math.floor(offset / 20) + 1} 페이지`)
        : null,
      items.length === 20 ? link('다음 →', listUrl(query, offset + 20), 'button secondary') : null,
    ),
  );
}
export async function noticePage(id, params, state, reload) {
  const { query, offset } = filters(params);
  const back = listUrl(query, offset);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || ''))
    return empty(
      '공지를 찾을 수 없어요',
      '주소를 확인해 주세요.',
      link('공지 목록으로', back, 'button secondary'),
    );
  let notice;
  try {
    notice = await call('get_notice', { id });
  } catch (error) {
    return el(
      'section',
      {},
      link('← 공지 목록으로', back, 'back-link'),
      errorBox(error.message, reload),
    );
  }
  return el(
    'section',
    { class: 'detail-wrap' },
    link('← 공지 목록으로', back, 'back-link'),
    el(
      'article',
      { class: 'panel notice notice-detail' },
      el('span', { class: 'board-chip' }, '공지사항'),
      el('h1', {}, notice.title),
      el('time', { datetime: notice.created_at, class: 'meta' }, date(notice.created_at)),
      notice.updated_at && notice.updated_at !== notice.created_at
        ? el('p', { class: 'hint' }, `수정 ${date(notice.updated_at)}`)
        : null,
      contentBody(notice.body, notice.content_format),
      state.me?.is_admin
        ? el(
            'div',
            { class: 'actions' },
            notice.can_edit !== false
              ? button('공지 수정', async () => {
                  const { editNotice } = await import('./admin-notices.js');
                  await editNotice(notice.id, reload, roleOf(state.me) === 'owner');
                })
              : null,
            notice.can_delete !== false
              ? button(
                  '공지 삭제',
                  async () => {
                    const { deleteNotice } = await import('./admin-notices.js');
                    deleteNotice(notice, () => {
                      location.hash = back.slice(1);
                    });
                  },
                  'button danger',
                )
              : null,
          )
        : null,
    ),
    link('목록으로', back, 'button secondary'),
  );
}
