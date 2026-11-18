import { el, link, empty, date } from '../lib/dom.js';
import { pageTitle } from '../components/layout.js';
import { postCard } from '../components/post-card.js';
import { v2 } from '../services/v2.js';
export async function activityPage(params) {
  const kinds = {
    posts: '내가 쓴 글',
    comments: '내가 쓴 댓글',
    subscriptions: '구독한 글',
    bookmarks: '저장한 글',
    reports: '내 신고 결과',
  };
  const kind = Object.hasOwn(kinds, params.get('kind')) ? params.get('kind') : 'posts';
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const items = await v2('activity', { kind, offset });
  return el(
    'section',
    {},
    pageTitle('MY SCHOOLPOT', '내 활동', '내가 나눈 이야기와 다시 보고 싶은 글'),
    el(
      'nav',
      { class: 'actions', 'aria-label': '내 활동 종류' },
      ...Object.entries(kinds).map(([key, text]) =>
        link(text, `#/activity?kind=${key}`, `button ${kind === key ? 'primary' : 'secondary'}`),
      ),
    ),
    el(
      'div',
      { class: 'post-list' },
      items.length
        ? items.map((item) =>
            kind === 'comments'
              ? el(
                  'article',
                  { class: 'panel' },
                  link(item.body, `#/post/${item.post_id}`),
                  el('small', { class: 'meta' }, date(item.created_at)),
                )
              : kind === 'reports'
                ? el(
                    'article',
                    { class: 'panel' },
                    el(
                      'strong',
                      {},
                      {
                        pending: '접수 완료',
                        reviewing: '검토 중',
                        resolved: '처리 완료',
                        dismissed: '반려 · 조치 불필요',
                      }[item.status],
                    ),
                    el('p', {}, item.resolution_reason || '처리 결과를 기다려 주세요.'),
                    el('small', { class: 'meta' }, date(item.created_at)),
                  )
                : postCard(item),
          )
        : empty('아직 활동이 없어요', '삭제되거나 접근할 수 없는 게시글은 목록에 표시하지 않아요.'),
    ),
    el(
      'nav',
      { class: 'pagination', 'aria-label': '활동 페이지' },
      offset
        ? link(
            '← 이전',
            `#/activity?kind=${kind}&offset=${Math.max(0, offset - 20)}`,
            'button secondary',
          )
        : null,
      items.length === 20
        ? link('다음 →', `#/activity?kind=${kind}&offset=${offset + 20}`, 'button secondary')
        : null,
    ),
  );
}
export async function memberProfilePage(id) {
  const data = await v2('member_profile', { id });
  return el(
    'section',
    {},
    pageTitle('SCHOOLPOT MEMBER', data.nickname, '이 회원의 공개 작성 글'),
    data.posts.length
      ? data.posts.map(postCard)
      : empty('공개 작성 글이 없어요', '익명 작성 내역은 표시하지 않아요.'),
  );
}
