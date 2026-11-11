import { el, link, button, localDate } from '../lib/dom.js';
import { boards, schoolName } from '../config/site.js';
export function layout(state, onTheme, onLogout) {
  const path = location.hash.slice(1) || '/';
  const nav = (label, href, icon) =>
    link([icon, label].join('  '), `#${href}`, `nav-item ${path === href ? 'active' : ''}`);
  const sidebar = el(
    'aside',
    { class: 'sidebar' },
    link('▱  스쿨팟', '#/', 'brand'),
    el('div', { class: 'school-tag' }, el('span', { class: 'live-dot' }), schoolName),
    el(
      'nav',
      { 'aria-label': '주 메뉴' },
      nav('홈', '/', '⌂'),
      nav('인기글', '/popular', '↗'),
      el('p', { class: 'nav-label' }, '커뮤니티'),
      ...boards.map((b) => nav(b.name, `/board/${b.id}`, b.icon)),
      el('p', { class: 'nav-label' }, '학교생활'),
      nav('급식', '/meals', '◒'),
      nav('학사일정', '/schedule', '▦'),
      nav('수행평가', '/assessments', '✓'),
      nav('공지사항', '/notices', '♧'),
      state.me?.is_admin ? nav('관리자', '/admin', '⚙') : null,
    ),
    el(
      'div',
      { class: 'sidebar-bottom' },
      el('p', {}, '우리의 하루가 모이는 곳'),
      el('small', {}, '© 스쿨팟'),
    ),
  );
  const theme = button(state.dark ? '☀' : '☾', onTheme, 'icon-button');
  theme.setAttribute('aria-label', state.dark ? '라이트 모드로 전환' : '다크 모드로 전환');
  const notifications = link('♧', '#/notifications', 'icon-button notification-link');
  notifications.setAttribute('aria-label', '내 알림');
  const header = el(
    'header',
    { class: 'header' },
    link('스쿨팟', '#/', 'mobile-brand'),
    el(
      'form',
      {
        class: 'global-search',
        role: 'search',
        onSubmit: (e) => {
          e.preventDefault();
          const q = new FormData(e.target).get('q');
          location.hash = `/search?q=${encodeURIComponent(q)}`;
        },
      },
      el('span', { 'aria-hidden': 'true' }, '⌕'),
      el('input', {
        name: 'q',
        placeholder: '우리 학교의 이야기를 찾아보세요',
        'aria-label': '게시글 검색',
        maxlength: 120,
      }),
      el('button', { class: 'search-submit', 'aria-label': '검색' }, '검색'),
    ),
    el(
      'div',
      { class: 'header-actions' },
      theme,
      notifications,
      state.user
        ? el(
            'details',
            { class: 'account-menu' },
            el('summary', {}, state.me?.profile?.nickname || '내 계정'),
            link('프로필 설정', '#/profile'),
            button('로그아웃', onLogout, 'text-button'),
          )
        : link('로그인', '#/login', 'button secondary small'),
    ),
  );
  const main = el('main', { id: 'main', tabindex: '-1' });
  const mobile = el(
    'nav',
    { class: 'mobile-nav', 'aria-label': '모바일 메뉴' },
    nav('홈', '/', '⌂'),
    nav('게시판', '/boards', '▤'),
    nav('급식', '/meals', '◒'),
    nav('일정', '/assessments', '▦'),
    nav('내 정보', '/profile', '◌'),
  );
  return {
    root: el(
      'div',
      { class: 'shell' },
      sidebar,
      el('div', { class: 'workspace' }, header, main),
      mobile,
    ),
    main,
  };
}
export function pageTitle(eyebrow, title, description, action) {
  return el(
    'div',
    { class: 'page-heading' },
    el(
      'div',
      {},
      el('p', { class: 'eyebrow' }, eyebrow),
      el('h1', {}, title),
      description ? el('p', { class: 'muted' }, description) : null,
    ),
    action,
  );
}
export function welcome() {
  const d = new Date(`${localDate()}T12:00:00+09:00`);
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'Asia/Seoul',
  }).format(d);
}
