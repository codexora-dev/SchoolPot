import { el, link, empty, errorBox } from '../lib/dom.js';
import { boards } from '../config/site.js';
import { welcome } from '../components/layout.js';
import { call } from '../services/community.js';
import { postCard } from '../components/post-card.js';
import { icon as uiIcon } from '../components/icons.js';
export async function homePage(state, reload) {
  const enabled = state.user && state.me?.profile && state.me?.enrollment_current === true;
  let posts = [],
    popular = [],
    notices = [];
  let failures = [];
  if (enabled) {
    const results = await Promise.allSettled([
      call('list_posts'),
      call('list_posts', { sort: 'popular', period: 'week' }),
      call('notice_list'),
    ]);
    failures = results.map((r) => (r.status === 'rejected' ? r.reason.message : null));
    [posts, popular, notices] = results.map((r) => (r.status === 'fulfilled' ? r.value : []));
  }
  return el(
    'section',
    { class: enabled ? 'home-page member-home' : 'home-page' },
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
              enabled ? '이야기 남기기 ↗' : state.user ? '우리 반 선택하기 ↗' : '스쿨팟 시작하기 ↗',
              enabled ? '#/write' : state.user ? '#/enrollment' : '#/signup',
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
              ? failures[0]
                ? errorBox(failures[0], reload)
                : posts.length
                  ? posts.slice(0, 5).map(postCard)
                  : empty(
                      '첫 이야기를 기다리고 있어요',
                      '우리 학교의 첫 번째 이야기를 시작해 보세요.',
                      link('글쓰기', '#/write', 'button primary'),
                    )
              : empty(
                  state.user ? '우리 반 선택만 하면 준비 끝' : '우리만의 이야기를 만나보세요',
                  state.user
                    ? '학년과 반을 선택하고 친구들의 이야기를 만나보세요.'
                    : '로그인하면 게시글과 학교생활 정보를 확인할 수 있어요.',
                  link(
                    state.user ? '학년·반 선택' : '로그인하기',
                    state.user ? '#/enrollment' : '#/login',
                    'button primary',
                  ),
                ),
          ),
        ),
      ),
      el(
        'aside',
        { class: 'home-secondary' },
        enabled
          ? el(
              'section',
              { class: 'panel popular-panel' },
              el(
                'div',
                { class: 'section-heading' },
                el('h2', {}, '이번 주 인기글'),
                el('span', { class: 'tiny-badge' }, 'HOT'),
              ),
              el('p', { class: 'muted small-text' }, '지금 친구들이 공감하는 이야기'),
              failures[1]
                ? errorBox(failures[1], reload)
                : popular.length
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
            )
          : null,
        enabled
          ? el(
              'section',
              { class: 'panel notice-panel' },
              el(
                'div',
                { class: 'section-heading' },
                el('h2', {}, '놓치지 마세요'),
                link('＋', '#/notices', 'subtle-link'),
              ),
              failures[2]
                ? errorBox(failures[2], reload)
                : notices.length
                  ? notices
                      .slice(0, 3)
                      .map((n) =>
                        el(
                          'article',
                          { class: 'notice-preview' },
                          el('span', { class: 'board-chip' }, '공지'),
                          link(n.title, `#/notice/${n.id}`),
                        ),
                      )
                  : el('p', { class: 'small-empty' }, '등록된 공지가 없어요.'),
            )
          : null,
        el(
          'section',
          { class: 'panel start-card' },
          el('span', { class: 'eyebrow' }, enabled ? 'MY CLASS' : 'START HERE'),
          el(
            'h2',
            {},
            enabled
              ? `${state.me.membership.grade}학년 ${state.me.membership.class_number}반의 공간`
              : '학교생활을 더 편하게',
          ),
          el(
            'p',
            { class: 'muted' },
            enabled
              ? '내 반의 수행평가와 중요한 일정을 한곳에서 확인해 보세요.'
              : '이야기를 나누고, 급식을 확인하고, 우리 반의 일정을 챙겨보세요.',
          ),
          link(
            enabled ? '우리 반 일정 확인' : '이용 방법 알아보기',
            enabled ? '#/assessments' : '#/guide',
            'button secondary',
          ),
          !enabled
            ? el('p', { class: 'hint' }, '가입 후 한 번 표시되는 복구 코드를 꼭 보관해 주세요.')
            : null,
        ),
      ),
    ),
    el(
      'footer',
      { class: 'page-footer' },
      el('span', {}, '스쿨팟 · 우리의 하루, 우리의 이야기'),
      el(
        'div',
        { class: 'footer-links' },
        link('이용 안내', '#/guide'),
        link('운영 규정', '#/rules'),
      ),
    ),
  );
}
