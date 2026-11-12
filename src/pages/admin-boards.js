import { el, field, button, link, empty, toast } from '../lib/dom.js';
import { manageBoards, refreshBoards } from '../services/management.js';
const kinds = { general: '일반', anonymous: '항상 익명', poll: '투표' };
const states = { open: '운영 중', readonly: '읽기 전용', hidden: '숨김' };
export async function boardManager(reload) {
  const boards = await manageBoards('list');
  const edit = (board) => {
    const status = el('p', { role: 'status', class: 'hint' });
    const form = el(
      'form',
      {
        class: 'form-stack',
        onSubmit: async (event) => {
          event.preventDefault();
          const submit = form.querySelector('[type=submit]');
          submit.disabled = true;
          const data = Object.fromEntries(new FormData(form));
          try {
            await manageBoards(board ? 'save' : 'create', {
              ...data,
              id: board?.id || data.id,
              revision: board?.revision,
              position: Number(data.position),
              is_active: data.state !== 'hidden',
              can_post: data.state === 'open',
            });
            await refreshBoards();
            dialog.close();
            toast('게시판 설정을 저장했어요.');
            await reload();
          } catch (err) {
            status.textContent = err.message;
          } finally {
            submit.disabled = false;
          }
        },
      },
      el('h2', {}, board ? '게시판 수정' : '새 게시판'),
      board
        ? el(
            'p',
            { class: 'hint' },
            `${board.id} · ${kinds[board.kind]} · 주소와 유형은 변경할 수 없어요.`,
          )
        : field('게시판 주소 (영문 소문자·숫자·하이픈, 3~32자)', 'id', 'text', {
            required: true,
            pattern: '[a-z][a-z0-9-]{2,31}',
            maxlength: 32,
          }),
      field('게시판 이름', 'name', 'text', {
        value: board?.name || '',
        required: true,
        minlength: 2,
        maxlength: 40,
      }),
      field('설명', 'description', 'textarea', { maxlength: 160, rows: 2 }),
      !board
        ? el(
            'label',
            { class: 'field' },
            el('span', {}, '게시판 유형'),
            el(
              'select',
              { name: 'kind', 'aria-label': '게시판 유형' },
              ...Object.entries(kinds).map(([value, label]) => el('option', { value }, label)),
            ),
          )
        : null,
      field('표시 순서 (작은 숫자부터)', 'position', 'number', {
        value: board?.position ?? 100,
        required: true,
        min: 0,
        max: 999,
      }),
      el(
        'label',
        { class: 'field' },
        el('span', {}, '운영 상태'),
        el(
          'select',
          { name: 'state', 'aria-label': '운영 상태' },
          ...Object.entries(states).map(([value, label]) =>
            el(
              'option',
              {
                value,
                selected:
                  value ===
                  (board
                    ? !board.is_active
                      ? 'hidden'
                      : board.can_post
                        ? 'open'
                        : 'readonly'
                    : 'open'),
              },
              label,
            ),
          ),
        ),
      ),
      el(
        'p',
        { class: 'hint' },
        '읽기 전용에서는 글·댓글·공감·투표를 멈춥니다. 숨기면 일반 사용자 목록에서도 사라져요. 기존 글은 보존되며, 관리자는 계속 관리할 수 있어요.',
      ),
      status,
      el(
        'div',
        { class: 'actions' },
        button('취소', () => dialog.close(), 'button secondary'),
        el('button', { class: 'button primary', type: 'submit' }, '저장'),
      ),
    );
    form.querySelector('[name=description]').value = board?.description || '';
    const dialog = el('dialog', { 'aria-label': board ? '게시판 수정' : '새 게시판' }, form);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  };
  const remove = (board) => {
    const status = el('p', { role: 'status' });
    const dialog = el(
      'dialog',
      { 'aria-label': '게시판 삭제' },
      el('h2', {}, '빈 게시판을 삭제할까요?'),
      el(
        'p',
        {},
        `${board.name}의 주소와 설정이 삭제됩니다. 기존 글이 있는 게시판은 삭제할 수 없어요.`,
      ),
      status,
      el(
        'div',
        { class: 'actions' },
        button('취소', () => dialog.close()),
        button(
          '삭제',
          async (event) => {
            const submit = event.currentTarget;
            submit.disabled = true;
            try {
              await manageBoards('delete', { id: board.id, revision: board.revision });
              await refreshBoards();
              dialog.close();
              await reload();
            } catch (err) {
              status.textContent = err.message;
              submit.disabled = false;
            }
          },
          'button danger',
        ),
      ),
    );
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  };
  return el(
    'section',
    {},
    el(
      'div',
      { class: 'section-heading' },
      el('h2', {}, '게시판 관리'),
      button('＋ 새 게시판', () => edit(), 'button primary'),
    ),
    el(
      'p',
      { class: 'hint' },
      '이름·설명·순서·운영 상태를 관리하세요. 글이 있는 게시판은 숨김 또는 읽기 전용으로 보관할 수 있어요.',
    ),
    el(
      'div',
      { class: 'management-list' },
      boards.length
        ? boards.map((b) =>
            el(
              'article',
              { class: 'panel management-card' },
              el(
                'div',
                {},
                el(
                  'span',
                  { class: 'board-chip' },
                  states[!b.is_active ? 'hidden' : b.can_post ? 'open' : 'readonly'],
                ),
                el('h3', {}, b.name),
                el('p', { class: 'muted' }, b.description),
                el(
                  'small',
                  { class: 'meta' },
                  `${kinds[b.kind]} · 글 ${b.posts}개 · 순서 ${b.position} · /${b.id}`,
                ),
              ),
              el(
                'div',
                { class: 'actions' },
                link('게시판 열기', `#/board/${b.id}`, 'button secondary'),
                button('수정', () => edit(b), 'button secondary'),
                Number(b.posts) === 0 ? button('삭제', () => remove(b), 'button danger') : null,
              ),
            ),
          )
        : empty('게시판이 없어요', '새 게시판을 만들어 주세요.'),
    ),
  );
}
