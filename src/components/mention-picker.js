import { el, button, field, toast, link } from '../lib/dom.js';
import { v2 } from '../services/v2.js';
export function mentionPicker(initial = []) {
  const selected = new Map(initial.map((item) => [item.id, item]));
  const results = el('div', { class: 'form-stack', 'aria-live': 'polite' });
  const chips = el('div', { class: 'actions' });
  const search = field('멘션할 닉네임', 'mention_query', 'search', {
    maxlength: 40,
    placeholder: '@닉네임 · 두 글자 이상',
  });
  const draw = () =>
    chips.replaceChildren(
      ...[...selected.values()].map((item) =>
        button(
          `@${item.nickname} ×`,
          () => {
            selected.delete(item.id);
            draw();
          },
          'button secondary',
        ),
      ),
    );
  draw();
  const node = el(
    'details',
    { class: 'mention-picker' },
    el('summary', {}, '@ 멘션 추가'),
    el(
      'p',
      { class: 'hint' },
      '검색을 허용한 회원만 선택할 수 있어요. 한 번에 최대 5명이며 닉네임 문자열만 입력하면 알림을 보내지 않습니다.',
    ),
    search,
    button('회원 검색', async () => {
      try {
        const items = await v2('mention_search', {
          query: search.querySelector('input').value.replace(/^@/, ''),
        });
        results.replaceChildren(
          ...(items.length
            ? items.map((item) =>
                button(`@${item.nickname}`, () => {
                  if (selected.size >= 5 && !selected.has(item.id)) {
                    toast('멘션은 최대 5명이에요.');
                    return;
                  }
                  selected.set(item.id, item);
                  draw();
                  results.replaceChildren();
                }),
              )
            : [el('p', {}, '검색 가능한 회원이 없어요.')]),
        );
      } catch (error) {
        toast(error.message);
      }
    }),
    results,
    chips,
  );
  return { node, ids: () => [...selected.keys()] };
}
export function mentionLinks(items = []) {
  return el(
    'div',
    { class: 'actions mention-links' },
    ...items.map((item) =>
      link(`@${item.nickname}`, `#/member/${encodeURIComponent(item.id)}`, 'board-chip'),
    ),
  );
}
