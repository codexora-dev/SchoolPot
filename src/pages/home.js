import { el, link, empty } from '../lib/dom.js';
import { boards } from '../config/site.js';
import { welcome } from '../components/layout.js';
import { call } from '../services/community.js';
import { postCard } from './community.js';
import { icon as uiIcon } from '../components/icons.js';
export async function homePage(state) {
  const enabled = state.user && state.me?.profile && state.me?.enrollment_current === true;
  let posts = [],
    popular = [],
    notices = [];
  if (enabled)
    [posts, popular, notices] = await Promise.all([
      call('list_posts'),
      call('list_posts', { sort: 'popular', period: 'week' }),
      call('notices'),
    ]);
  return el(
    'section',
    {},
    el(
      'div',
      { class: 'home-intro' },
      el('p', { class: 'eyebrow' }, welcome()),
      el(
        'h1',
        {},
        state.me?.profile
          ? `${state.me.profile.nickname}님, 오늘도 반가워요.`
          : '우리 학교의 이야기가 모이는 곳',
      ),
      el('p', { class: 'muted' }, '평범한 하루도, 함께 나누면 특별해지니까.'),
    ),
    el(
      'div',
      { class: 'home-columns' },
      el(
        'div',
        { class: 'home-primary' },
        el(
          'section',
          { class: 'hero' },
          el(
            'div',
            { class: 'hero-copy' },
            el('span', { class: 'hero-label' }, 'OUR LITTLE CAMPUS'),
            el('h2', {}, '너의 학교생활에,', el('br'), '조금 더 가까이.'),
            el(
              'p',
              {},
              '궁금한 것도, 나누고 싶은 이야기도.',
              el('br'),
              '우리의 작은 광장, 스쿨팟에서 만나요.',
            ),
            link(
              enabled ? '이야기 남기기 ↗' : '스쿨팟 시작하기 ↗',
              enabled ? '#/write' : '#/signup',
              'button hero-button',
            ),
          ),
          el(
            'div',
            { class: 'hero-art', 'aria-hidden': 'true' },
            el('div', { class: 'orbit orbit-one' }),
            el('div', { class: 'orbit orbit-two' }),
            el(
              'div',
              { class: 'floating-note note-one' },
              el('span', {}, '오늘도'),
              el('strong', {}, '좋은 하루!'),
              el('span', { class: 'note-spark' }, '✳'),
            ),
            el(
              'div',
              { class: 'floating-note note-two' },
              '우리들의',
              el('br'),
              el('strong', {}, 'SCHOOL LIFE'),
            ),
            el('span', { class: 'hero-star' }, '✳'),
          ),
        ),
        el(
          'div',
          { class: 'quick-links' },
          ...[
            ['meal', '오늘의 급식', '점심시간이 기다려져요', '/meals'],
            ['calendar', '학사일정', '중요한 날을 한눈에', '/schedule'],
            ['check', '수행평가', '미리 챙기는 우리 일정', '/assessments'],
          ].map(
            ([icon, title, desc, href]) =>
              link('', `#${href}`, 'quick-card').appendChild(
                el(
                  'div',
                  {},
                  el('span', { class: 'quick-icon' }, uiIcon(icon, 20)),
                  el('strong', {}, title),
                  el('small', {}, desc),
                ),
              ).parentNode,
          ),
        ),
        el(
          'section',
          { class: 'feed-section' },
          el(
            'div',
            { class: 'section-heading' },
            el('h2', {}, '방금 올라온 이야기', el('span', { class: 'accent-dot' }, '·')),
            link('전체 보기 ↗', '#/search', 'subtle-link'),
          ),
          el(
            'div',
            { class: 'feed-tabs' },
            link('전체', '#/search', 'feed-tab selected'),
            ...boards
              .filter((b) => b.is_active !== false)
              .slice(0, 4)
              .map((b) => link(b.name, `#/board/${b.id}`, 'feed-tab')),
          ),
          el(
            'div',
            { class: 'post-list home-feed' },
            enabled
              ? posts.length
                ? posts.slice(0, 5).map(postCard)
                : empty(
                    '첫 이야기를 기다리고 있어요',
                    '우리 학교의 첫 번째 이야기를 시작해 보세요.',
                    link('글쓰기', '#/write', 'button primary'),
                  )
              : empty(
                  '우리만의 이야기를 만나보세요',
                  '로그인하면 게시글과 학교생활 정보를 확인할 수 있어요.',
                  link('로그인하기', '#/login', 'button primary'),
                ),
          ),
        ),
      ),
      el(
        'aside',
        { class: 'home-secondary' },
        el(
          'section',
          { class: 'panel popular-panel' },
          el(
            'div',
            { class: 'section-heading' },
            el('h2', {}, '이번 주 인기글'),
            el('span', { class: 'tiny-badge' }, 'HOT'),
          ),
          el('p', { class: 'muted small-text' }, '지금 친구들이 공감하는 이야기'),
          popular.length
            ? popular
                .slice(0, 5)
                .map(
                  (p, i) =>
                    link('', `#/post/${p.id}`, 'ranked-post').appendChild(
                      el(
                        'div',
                        {},
                        el('span', { class: 'rank' }, String(i + 1).padStart(2, '0')),
                        el(
                          'div',
                          {},
                          el('strong', {}, p.title),
                          el('small', { class: 'meta' }, `♡ ${p.likes}　◌ ${p.comments}`),
                        ),
                      ),
                    ).parentNode,
                )
            : el('div', { class: 'small-empty' }, '이야기가 쌓이면 인기글을 알려드릴게요.'),
          link('인기글 더 보기 →', '#/popular', 'panel-link'),
        ),
        el(
          'section',
          { class: 'panel notice-panel' },
          el(
            'div',
            { class: 'section-heading' },
            el('h2', {}, '놓치지 마세요'),
            link('＋', '#/notices', 'subtle-link'),
          ),
          notices.length
            ? notices
                .slice(0, 3)
                .map((n) =>
                  el(
                    'article',
                    { class: 'notice-preview' },
                    el('span', { class: 'board-chip' }, '공지'),
                    link(n.title, '#/notices'),
                  ),
                )
            : el(
                'p',
                { class: 'small-empty' },
                enabled ? '등록된 공지가 없어요.' : '로그인 후 공지를 확인하세요.',
              ),
        ),
        el(
          'section',
          { class: 'kindness-card' },
          el('span', { 'aria-hidden': 'true' }, '♧'),
          el('h3', {}, '따뜻한 말 한마디의 힘'),
          el('p', {}, '화면 너머에도 친구가 있어요.', el('br'), '서로를 존중하며 이야기를 나눠요.'),
        ),
      ),
    ),
    el(
      'footer',
      { class: 'page-footer' },
      el('span', {}, '스쿨팟 · 우리의 하루, 우리의 이야기'),
      link('이용 안내', '#/guide'),
    ),
  );
}
