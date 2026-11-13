import { el, link, button, field, empty, toast, date } from '../lib/dom.js';
import { boards } from '../config/site.js';
import { pageTitle } from '../components/layout.js';
import { call } from '../services/community.js';
import { required } from '../lib/validation.js';
import { postCard } from '../components/post-card.js';
export async function boardPage(route, params, state = {}) {
  const board = route.startsWith('/board/') ? route.split('/')[2] : '';
  const popular = route === '/popular';
  const query = params.get('q') || '';
  const requestedSort = params.get('sort');
  const sort = ['latest', 'popular'].includes(requestedSort)
    ? requestedSort
    : popular
      ? 'popular'
      : 'latest';
  const requestedPeriod = params.get('period');
  const period = ['day', 'week'].includes(requestedPeriod) ? requestedPeriod : '';
  const offset = Math.min(10000, Math.max(0, Number.parseInt(params.get('offset'), 10) || 0));
  const b = boards.find((b) => b.id === board);
  const writable = !b || b.can_post || state.me?.is_admin;
  if (board && !b) throw new Error('존재하지 않는 게시판이에요.');
  const filters = el(
    'form',
    {
      class: 'filters',
      onSubmit: (e) => {
        e.preventDefault();
        const data = new URLSearchParams(new FormData(e.target));
        location.hash = `${route}?${data}`;
      },
    },
    el('input', {
      name: 'q',
      value: query,
      placeholder: '제목과 본문 검색',
      'aria-label': '제목과 본문 검색',
      maxlength: 120,
    }),
    el(
      'select',
      { name: 'sort', 'aria-label': '정렬' },
      el('option', { value: 'latest', selected: sort === 'latest' }, '최신순'),
      el('option', { value: 'popular', selected: sort === 'popular' }, '인기순'),
    ),
    el(
      'select',
      { name: 'period', 'aria-label': '기간' },
      el('option', { value: '' }, '전체 기간'),
      el('option', { value: 'day', selected: period === 'day' }, '오늘'),
      el('option', { value: 'week', selected: period === 'week' }, '이번 주'),
    ),
    el('button', { class: 'button secondary', type: 'submit' }, '검색'),
  );
  const posts = await call('list_posts', { board, query, sort, period, offset });
  const next = new URLSearchParams(params);
  next.set('offset', offset + 20);
  const prev = new URLSearchParams(params);
  prev.set('offset', Math.max(0, offset - 20));
  return el(
    'section',
    {},
    pageTitle(
      'COMMUNITY',
      b?.name || (popular ? '지금 인기 있는 이야기' : '이야기 검색'),
      b?.description || (query ? `“${query}” 검색 결과` : '친구들의 관심이 모이는 이야기'),
      writable ? link('＋ 글쓰기', `#/write?board=${board || ''}`, 'button primary') : null,
    ),
    b && !b.can_post
      ? el(
          'p',
          { class: 'panel hint', role: 'status' },
          '읽기 전용 게시판이에요. 기존 이야기를 읽을 수 있어요.',
        )
      : null,
    filters,
    el(
      'div',
      { class: 'post-list' },
      posts.length
        ? posts.map(postCard)
        : empty(
            query ? '검색 결과가 없어요' : '아직 이야기가 없어요',
            query
              ? '다른 검색어를 입력하거나 필터를 초기화해 보세요.'
              : '첫 번째 이야기를 남겨보세요.',
            query
              ? link('검색 초기화', `#${route}`, 'button secondary')
              : writable
                ? link('글 쓰러 가기', `#/write?board=${board || ''}`, 'button primary')
                : null,
          ),
    ),
    el(
      'nav',
      { class: 'pagination', 'aria-label': '게시글 페이지' },
      offset ? link('← 이전', `#${route}?${prev}`, 'button secondary') : null,
      offset || posts.length === 20
        ? el('span', { class: 'page-indicator' }, `${Math.floor(offset / 20) + 1} 페이지`)
        : null,
      posts.length === 20 ? link('다음 →', `#${route}?${next}`, 'button secondary') : null,
    ),
  );
}
export function reportDialog(kind, id) {
  const dialog = el(
    'dialog',
    {},
    el(
      'form',
      {
        class: 'form-stack',
        onSubmit: async (e) => {
          e.preventDefault();
          try {
            const reason = required(new FormData(e.target).get('reason'), 2, 1000);
            await call(kind === 'assessment' ? 'report_assessment' : 'report', {
              kind,
              id,
              reason,
            });
            dialog.close();
            toast('신고를 접수했어요. 관리자가 확인할게요.');
          } catch (err) {
            toast(err.message);
          }
        },
      },
      el('h2', {}, kind === 'assessment' ? '일정 수정 요청' : '신고하기'),
      field('사유', 'reason', 'textarea', {
        required: true,
        minlength: 2,
        maxlength: 1000,
        rows: 4,
      }),
      el(
        'div',
        { class: 'actions' },
        button('취소', () => dialog.close()),
        el('button', { type: 'submit', class: 'button primary' }, '보내기'),
      ),
    ),
  );
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}
export function confirmDialog(title, action) {
  const dialog = el(
    'dialog',
    {},
    el('h2', {}, title),
    el('p', {}, '삭제한 내용은 복구할 수 없어요.'),
    el(
      'div',
      { class: 'actions' },
      button('취소', () => dialog.close()),
      button(
        '삭제',
        async () => {
          try {
            await action();
            dialog.close();
          } catch (err) {
            toast(err.message);
          }
        },
        'button danger',
      ),
    ),
  );
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}
export async function postPage(id, state, reload, params) {
  const p = await call('get_post', {
    id,
    comments_offset: Number(params.get('comments_offset')) || 0,
  });
  const b = boards.find((b) => b.id === p.board_id) || { name: p.board_name || '게시판' };
  const interactive = p.can_interact !== false;
  const interactionButton = (text, action, cls) => {
    const node = button(text, action, cls);
    node.disabled = !interactive;
    return node;
  };
  let parent = '';
  const act = async (action, payload) => {
    try {
      if (!interactive && ['like', 'vote'].includes(action))
        throw new Error('읽기 전용 게시판이에요.');
      await call(action, payload);
      await reload();
    } catch (err) {
      toast(err.message);
    }
  };
  const commentForm = el(
    'form',
    {
      class: 'form-stack comment-form',
      onSubmit: async (e) => {
        e.preventDefault();
        try {
          await call('save_comment', {
            post_id: id,
            parent_id: parent || null,
            body: required(new FormData(e.target).get('body'), 1, 2000),
            anonymous: p.anonymous || new FormData(e.target).has('anonymous'),
          });
          await reload();
        } catch (err) {
          toast(err.message);
        }
      },
    },
    el('h3', {}, '댓글 남기기'),
    field('댓글', 'body', 'textarea', {
      required: true,
      maxlength: 2000,
      rows: 3,
      placeholder: '서로를 존중하는 따뜻한 말을 남겨주세요.',
    }),
    !p.anonymous
      ? el(
          'label',
          { class: 'checkbox' },
          el('input', { type: 'checkbox', name: 'anonymous' }),
          '익명으로 작성',
        )
      : null,
    el(
      'div',
      { class: 'actions' },
      el('span', { class: 'reply-label' }),
      el('button', { type: 'submit', class: 'button primary' }, '댓글 등록'),
    ),
  );
  const editComment = (c) => {
    const dialog = el(
      'dialog',
      {},
      el(
        'form',
        {
          class: 'form-stack',
          onSubmit: async (e) => {
            e.preventDefault();
            try {
              await call('save_comment', {
                id: c.id,
                body: required(new FormData(e.target).get('body'), 1, 2000),
              });
              dialog.close();
              await reload();
            } catch (err) {
              toast(err.message);
            }
          },
        },
        el('h2', {}, '댓글 수정'),
        field('내용', 'body', 'textarea', { required: true, maxlength: 2000, rows: 4 }),
        el(
          'div',
          { class: 'actions' },
          button('취소', () => dialog.close()),
          el('button', { class: 'button primary', type: 'submit' }, '저장'),
        ),
      ),
    );
    dialog.querySelector('textarea').value = c.body;
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  };
  const renderComment = (c) =>
    el(
      'article',
      { class: `comment ${c.parent_id ? 'reply' : ''}` },
      el(
        'div',
        { class: 'comment-heading' },
        el('strong', {}, c.author),
        el('span', { class: 'meta' }, date(c.created_at)),
      ),
      el('p', { class: 'preserve' }, c.body),
      el(
        'div',
        { class: 'comment-actions' },
        interactionButton(
          `${c.liked ? '♥' : '♡'} ${c.likes}`,
          () => act('like', { kind: 'comment', id: c.id, liked: !c.liked }),
          'text-button',
        ),
        interactive && !c.parent_id
          ? button(
              '답글',
              () => {
                parent = c.id;
                commentForm.querySelector('.reply-label').replaceChildren(
                  '답글 작성 중 ',
                  button(
                    '취소',
                    () => {
                      parent = '';
                      commentForm.querySelector('.reply-label').textContent = '';
                    },
                    'text-button',
                  ),
                );
                commentForm.querySelector('textarea').focus();
              },
              'text-button',
            )
          : null,
        c.is_mine && interactive ? button('수정', () => editComment(c), 'text-button') : null,
        c.is_mine
          ? button(
              '삭제',
              () => confirmDialog('댓글을 삭제할까요?', () => act('delete_comment', { id: c.id })),
              'text-button',
            )
          : button('신고', () => reportDialog('comment', c.id), 'text-button'),
        state.me?.is_admin
          ? button(
              '관리자 삭제',
              () =>
                confirmDialog('관리자 권한으로 댓글을 삭제할까요?', () =>
                  act('admin_delete', { kind: 'comment', id: c.id }),
                ),
              'text-button',
            )
          : null,
      ),
    );
  const ordered = p.replies
    .filter((c) => !c.parent_id || !p.replies.some((parent) => parent.id === c.parent_id))
    .flatMap((c) => [c, ...p.replies.filter((r) => r.parent_id === c.id)]);
  return el(
    'section',
    { class: 'detail-wrap' },
    link(`← ${b?.name}`, `#/board/${p.board_id}`, 'back-link'),
    el(
      'article',
      { class: 'panel post-detail' },
      el('span', { class: 'board-chip' }, b?.name),
      el('h1', {}, p.title),
      el(
        'div',
        { class: 'post-meta' },
        el('span', {}, p.author),
        el(
          'span',
          {},
          `${date(p.created_at)}${p.updated_at !== p.created_at ? ' · 수정됨' : ''} · 조회 ${p.views}`,
        ),
      ),
      el('div', { class: 'post-body preserve' }, p.body),
      p.poll
        ? el(
            'section',
            { class: 'poll' },
            el('h3', {}, '친구들의 생각은?'),
            ...p.poll.options.map((o) =>
              interactionButton(
                `${o.label}　${o.votes}표`,
                () => act('vote', { post_id: id, option_id: o.id }),
                `poll-option ${p.poll.voted ? 'voted' : ''}`,
              ),
            ),
            el(
              'p',
              { class: 'hint' },
              p.poll.voted ? '투표에 참여했어요.' : '한 번 투표하면 변경할 수 없어요.',
            ),
          )
        : null,
      el(
        'div',
        { class: 'actions' },
        interactionButton(
          `${p.liked ? '♥' : '♡'} 공감 ${p.likes}`,
          () => act('like', { kind: 'post', id, liked: !p.liked }),
          'button secondary',
        ),
        p.is_mine && interactive ? link('수정', `#/write?id=${id}`, 'button secondary') : null,
        p.is_mine
          ? button('삭제', () =>
              confirmDialog('게시글을 삭제할까요?', async () => {
                await call('delete_post', { id });
                location.hash = `/board/${p.board_id}`;
              }),
            )
          : button('신고', () => reportDialog('post', id), 'text-button'),
        state.me?.is_admin
          ? button(
              '관리자 삭제',
              () =>
                confirmDialog('관리자 권한으로 삭제할까요?', async () => {
                  await call('admin_delete', { kind: 'post', id });
                  location.hash = '/';
                }),
              'text-button',
            )
          : null,
      ),
    ),
    el(
      'section',
      { class: 'panel' },
      el('h2', {}, `댓글 ${p.comments}`),
      ordered.length
        ? ordered.map(renderComment)
        : el('p', { class: 'muted' }, '첫 댓글을 남겨보세요.'),
      el(
        'div',
        { class: 'pagination' },
        Number(params.get('comments_offset')) > 0
          ? link(
              '← 이전 댓글',
              `#/post/${id}?comments_offset=${Math.max(0, Number(params.get('comments_offset')) - 50)}`,
              'button secondary',
            )
          : null,
        p.replies.length === 50
          ? link(
              '다음 댓글 →',
              `#/post/${id}?comments_offset=${(Number(params.get('comments_offset')) || 0) + 50}`,
              'button secondary',
            )
          : null,
      ),
      interactive
        ? commentForm
        : el('p', { class: 'hint' }, '읽기 전용 게시판에서는 댓글·공감·투표를 사용할 수 없어요.'),
    ),
  );
}
export async function writePage(params, state) {
  const id = params.get('id');
  const p = id ? await call('get_post', { id }) : null;
  if (p && !p.is_mine) throw new Error('본인의 글만 수정할 수 있어요.');
  const writable = boards.filter((b) => b.can_post || state.me?.is_admin);
  if (p?.can_interact === false || (!p && !writable.length))
    return empty(
      '지금은 글을 쓸 수 없어요',
      '운영 중인 게시판을 확인해 주세요.',
      link('게시판 보기', '#/boards', 'button primary'),
    );
  const draftKey = `schoolpot-draft:${state.user.id}`;
  let draft = {};
  try {
    draft = JSON.parse(localStorage.getItem(draftKey) || '{}');
  } catch {
    /* malformed local draft */
  }
  const source = p || draft;
  const status = el('p', { role: 'status', class: 'muted' });
  const form = el(
    'form',
    {
      class: 'panel form-stack editor',
      onSubmit: async (e) => {
        e.preventDefault();
        const submit = form.querySelector('[type=submit]');
        submit.disabled = true;
        try {
          const data = Object.fromEntries(new FormData(form));
          const payload = {
            ...data,
            id: id || null,
            title: required(data.title, 2, 120),
            body: required(data.body, 1, 20000),
            anonymous: form.querySelector('[name=anonymous]').checked,
            options: String(data.options || '')
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean),
          };
          if (
            !id &&
            boards.find((b) => b.id === data.board)?.kind === 'poll' &&
            (payload.options.length < 2 || payload.options.length > 6)
          )
            throw new Error('투표 항목은 2~6개 입력해 주세요.');
          const saved = await call('save_post', payload);
          try {
            localStorage.removeItem(draftKey);
          } catch {
            /* A saved post must still open when storage is blocked. */
          }
          location.hash = `/post/${saved.id}`;
        } catch (err) {
          status.textContent = err.message;
        } finally {
          submit.disabled = false;
        }
      },
    },
    el(
      'label',
      { class: 'field' },
      el('span', {}, '게시판'),
      el(
        'select',
        { name: 'board', disabled: Boolean(id), 'aria-label': '게시판' },
        ...(p
          ? [
              {
                id: p.board_id,
                name: p.board_name || boards.find((b) => b.id === p.board_id)?.name || '게시판',
              },
            ]
          : writable
        ).map((b) =>
          el(
            'option',
            {
              value: b.id,
              selected:
                b.id ===
                (source.board_id || source.board || params.get('board') || writable[0]?.id),
            },
            b.name,
          ),
        ),
      ),
    ),
    field('제목', 'title', 'text', {
      required: true,
      minlength: 2,
      maxlength: 120,
      value: source.title || '',
      placeholder: '어떤 이야기를 나누고 싶나요?',
    }),
    field('내용', 'body', 'textarea', {
      required: true,
      maxlength: 20000,
      rows: 14,
      placeholder: '개인정보를 포함하지 않도록 주의해 주세요.',
    }),
    field('투표 항목 (투표게시판에서만 사용, 한 줄에 하나)', 'options', 'textarea', {
      rows: 4,
      maxlength: 600,
      placeholder: '2~6개 항목을 작성해 주세요.',
      disabled: Boolean(id),
    }),
    el(
      'label',
      { class: 'checkbox' },
      el('input', {
        name: 'anonymous',
        type: 'checkbox',
        checked: Boolean(source.anonymous),
        disabled: Boolean(id),
      }),
      '익명으로 작성',
    ),
    el(
      'p',
      { class: 'hint' },
      '익명게시판에서는 항상 익명으로 표시됩니다. 작성 후 게시판과 익명 설정은 바꿀 수 없어요.',
    ),
    el(
      'div',
      { class: 'actions' },
      button('임시 저장', () => {
        try {
          const data = Object.fromEntries(new FormData(form));
          localStorage.setItem(
            draftKey,
            JSON.stringify({ ...data, anonymous: form.querySelector('[name=anonymous]').checked }),
          );
          status.textContent = '이 기기에 임시 저장했어요. 공용 기기에서는 로그아웃해 주세요.';
        } catch {
          status.textContent = '이 기기에서는 임시 저장을 사용할 수 없어요.';
        }
      }),
      el('button', { type: 'submit', class: 'button primary' }, id ? '수정 완료' : '게시하기'),
    ),
    status,
  );
  form.querySelector('[name=body]').value = source.body || '';
  form.querySelector('[name=options]').value = Array.isArray(source.options)
    ? source.options.join('\n')
    : source.options || p?.poll?.options?.map((option) => option.label).join('\n') || '';
  const boardSelect = form.querySelector('[name=board]');
  const updateBoardFields = () => {
    const options = form.querySelector('[name=options]');
    const isPoll =
      boards.find((b) => b.id === boardSelect.value)?.kind === 'poll' || Boolean(p?.poll);
    options.closest('.field').hidden = !isPoll;
    options.disabled = !isPoll || Boolean(id);
    const anonymous = form.querySelector('[name=anonymous]');
    anonymous.disabled =
      Boolean(id) || boards.find((b) => b.id === boardSelect.value)?.kind === 'anonymous';
    if (boards.find((b) => b.id === boardSelect.value)?.kind === 'anonymous')
      anonymous.checked = true;
  };
  boardSelect.addEventListener('change', updateBoardFields);
  updateBoardFields();
  return el(
    'section',
    {},
    pageTitle(
      'YOUR STORY',
      id ? '이야기 수정하기' : '새로운 이야기',
      '작은 이야기 하나가 우리 학교를 더 가깝게 만들어요.',
    ),
    form,
  );
}
