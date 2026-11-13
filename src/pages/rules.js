import { el, link, button } from '../lib/dom.js';
import { pageTitle } from '../components/layout.js';

const documents = {
  summary: () => import('../content/rules/summary.md?raw'),
  full: () => import('../content/rules/full.md?raw'),
};
export async function rulesPage(params) {
  const view = params.get('view') === 'full' ? 'full' : 'summary';
  const [{ default: source }, { richText }] = await Promise.all([
    documents[view](),
    import('../lib/rich-text.js'),
  ]);
  const body = richText(source, 'markdown');
  const toc = [];
  for (const [index, heading] of [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].entries()) {
    const level = Number(heading.tagName.slice(1));
    const section = el('h' + Math.min(level + 1, 6), { tabindex: '-1' }, ...heading.childNodes);
    heading.replaceWith(section);
    if ((view === 'full' && level === 1 && index > 0) || (view === 'summary' && level === 2)) {
      section.id = `rules-${view}-${toc.length + 1}`;
      toc.push(
        button(
          section.textContent,
          () => {
            section.scrollIntoView({
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'instant'
                : 'smooth',
              block: 'start',
            });
            section.focus({ preventScroll: true });
          },
          'rules-toc-link',
        ),
      );
    }
  }
  return el(
    'section',
    { class: 'rules-page' },
    pageTitle('COMMUNITY RULES', '커뮤니티 이용 규정', '요약본과 전체 규정을 선택해 읽어보세요.'),
    el(
      'nav',
      { class: 'tabs', 'aria-label': '운영 규정 보기' },
      ...[
        ['summary', '요약본'],
        ['full', '전체 글'],
      ].map(([key, title]) =>
        el(
          'a',
          {
            href: `#/rules?view=${key}`,
            class: `tab ${key === view ? 'selected' : ''}`,
            'aria-current': key === view ? 'page' : null,
          },
          title,
        ),
      ),
    ),
    el(
      'div',
      { class: 'rules-toolbar' },
      el('span', { class: 'meta' }, '시행일 2026.11.13 · 운영자 제공 문서'),
      link('학년·반 관리', '#/enrollment', 'button secondary small'),
    ),
    el(
      'details',
      { class: 'panel rules-toc' },
      el('summary', {}, view === 'full' ? '장별 목차' : '주요 내용 바로가기'),
      el('nav', { 'aria-label': '규정 목차' }, ...toc),
    ),
    el(
      'article',
      {
        class: 'panel content-body rules-document',
        'aria-label': view === 'full' ? '운영 규정 전문' : '운영 규정 요약본',
      },
      body,
    ),
    el(
      'div',
      { class: 'rules-bottom actions' },
      link(
        view === 'full' ? '요약본 읽기' : '전체 글 읽기',
        `#/rules?view=${view === 'full' ? 'summary' : 'full'}`,
        'button secondary',
      ),
      link('이용 안내', '#/guide', 'button secondary'),
    ),
  );
}
