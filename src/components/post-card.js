import { el, link, date } from '../lib/dom.js';
import { boards } from '../config/site.js';
import { icon } from './icons.js';
export function postCard(p) {
  const b = boards.find((b) => b.id === p.board_id);
  return el(
    'article',
    { class: 'post-card' },
    el(
      'div',
      { class: 'post-card-top' },
      link(b?.name || '게시판', `#/board/${p.board_id}`, 'board-chip'),
      el('span', { class: 'meta' }, date(p.created_at)),
    ),
    link(p.title, `#/post/${p.id}`, 'post-title'),
    el('p', { class: 'post-excerpt' }, p.body.slice(0, 130)),
    el(
      'div',
      { class: 'post-meta' },
      el(
        'span',
        { class: 'post-author' },
        el(
          'span',
          { class: 'mini-avatar', 'aria-hidden': 'true' },
          p.anonymous ? '익' : p.author.slice(0, 1),
        ),
        p.author,
      ),
      el(
        'span',
        { class: 'post-metrics' },
        ...[
          ['heart', '공감', p.likes],
          ['chat', '댓글', p.comments],
          ['eye', '조회', p.views],
        ].map(([name, label, value]) =>
          el(
            'span',
            { class: 'metric' },
            icon(name, 14),
            el('span', { class: 'sr-only' }, label + ' '),
            value,
          ),
        ),
      ),
    ),
  );
}
