import { el, link, empty, errorBox } from '../lib/dom.js';
import { boards } from '../config/site.js';
import { pageTitle } from '../components/layout.js';
import { icon } from '../components/icons.js';
export function boardsPage(state, retry) {
  if (state.boardError) return errorBox(state.boardError, retry);
  const active = boards.filter((b) => b.is_active !== false);
  return el(
    'section',
    { class: 'directory-page' },
    pageTitle('COMMUNITY', '우리 학교 게시판', '오늘은 어떤 이야기를 나눌까요?'),
    el(
      'div',
      { class: 'directory-toolbar' },
      el('span', { class: 'meta' }, `${active.length}개의 공간에서 함께해요`),
      link('건의·오류 제보', '#/feedback', 'button secondary small'),
    ),
    active.length
      ? el(
          'div',
          { class: 'boards-grid' },
          ...active.map((b, index) => {
            const tile = link('', `#/board/${b.id}`, 'panel board-tile');
            tile.append(
              el(
                'div',
                { class: 'board-tile-top' },
                el(
                  'span',
                  { class: 'quick-icon' },
                  icon(
                    b.kind === 'anonymous'
                      ? 'anonymous'
                      : b.kind === 'poll'
                        ? 'poll'
                        : { questions: 'question', study: 'book', lost: 'search', clubs: 'club' }[
                            b.id
                          ] || 'chat',
                    24,
                  ),
                ),
                el('span', { class: 'board-number' }, String(index + 1).padStart(2, '0')),
              ),
              el('h2', {}, b.name),
              el('p', { class: 'muted' }, b.description),
              el(
                'div',
                { class: 'board-tile-bottom' },
                el('span', { class: 'board-chip' }, b.can_post ? '이야기 나누기' : '읽기 전용'),
                icon('arrow', 18),
              ),
            );
            return tile;
          }),
        )
      : empty('운영 중인 게시판이 없어요', '잠시 후 다시 확인해 주세요.'),
  );
}
