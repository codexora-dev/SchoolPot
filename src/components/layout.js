import { el, link, button, localDate } from '../lib/dom.js';
import { boards, schoolName } from '../config/site.js';
import { icon } from './icons.js';
const boardIcons = {
  free: 'chat',
  anonymous: 'anonymous',
  questions: 'question',
  study: 'book',
  lost: 'search',
  clubs: 'club',
  polls: 'poll',
};
export function layout(state, onTheme, onLogout) {
  const path = (location.hash.slice(1) || '/').split('?')[0];
  const nickname = state.me?.profile?.nickname || '내 계정';
  const nav = (label, href, name, active = path === href) => {
    const node = link('', '#' + href, 'nav-item' + (active ? ' active' : ''));
    node.setAttribute('aria-label', label);
    node.setAttribute('title', label);
    node.append(icon(name), el('span', {}, label));
    if (active) node.setAttribute('aria-current', 'page');
    return node;
  };
  const brand = () => {
    const node = link('', '#/', 'brand');
    node.append(el('span', { class: 'brand-mark' }, icon('cap', 23)), el('span', {}, '스쿨팟'));
    return node;
  };
  const sidebar = el(
    'aside',
    { class: 'sidebar' },
    brand(),
    el(
      'div',
      { class: 'school-tag' },
      el('span', { class: 'school-avatar' }, schoolName.slice(0, 1)),
      el('div', {}, el('strong', {}, schoolName), el('small', {}, '우리의 학교생활을 한곳에')),
    ),
    el(
      'nav',
      { 'aria-label': '주 메뉴' },
      nav('홈', '/', 'home'),
      nav('인기글', '/popular', 'trend'),
      el('p', { class: 'nav-label' }, '커뮤니티'),
      ...boards.map((b) => nav(b.name, '/board/' + b.id, boardIcons[b.id])),
      el('p', { class: 'nav-label' }, '학교생활'),
      nav('급식', '/meals', 'meal'),
      nav('학사일정', '/schedule', 'calendar'),
      nav('수행평가', '/assessments', 'check'),
      nav('공지사항', '/notices', 'bell'),
      state.me?.is_admin ? nav('관리자', '/admin', 'shield') : null,
    ),
    el(
      'div',
      { class: 'sidebar-bottom' },
      link('커뮤니티 이용 안내', '#/guide'),
      el('small', {}, '© 스쿨팟 · 함께 만드는 학교생활'),
    ),
  );
  const searchForm = (compact = false) =>
    el(
      'form',
      {
        class: compact ? 'search-sheet-form' : 'global-search',
        role: 'search',
        onSubmit: (e) => {
          e.preventDefault();
          const query = new FormData(e.target).get('q');
          e.target.closest('dialog')?.close();
          location.hash = '/search?q=' + encodeURIComponent(query);
        },
      },
      icon('search'),
      el('input', {
        name: 'q',
        placeholder: '궁금한 학교 이야기를 검색하세요',
        'aria-label': '게시글 검색',
        maxlength: 120,
        autocomplete: 'off',
      }),
      el('button', { class: compact ? 'button primary' : 'search-submit', type: 'submit' }, '검색'),
    );
  const openSearch = () => {
    const dialog = el(
      'dialog',
      { class: 'search-dialog', 'aria-label': '게시글 검색' },
      el(
        'div',
        { class: 'dialog-heading' },
        el('h2', {}, '어떤 이야기를 찾으세요?'),
        el(
          'button',
          {
            class: 'icon-button',
            type: 'button',
            'aria-label': '검색 닫기',
            onClick: () => dialog.close(),
          },
          icon('close'),
        ),
      ),
      searchForm(true),
      el('p', { class: 'hint' }, '제목과 본문에 담긴 이야기를 찾아보세요.'),
    );
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
    dialog.querySelector('input').focus();
  };
  const theme = el(
    'button',
    {
      type: 'button',
      class: 'icon-button',
      'aria-label': state.dark ? '라이트 모드로 전환' : '다크 모드로 전환',
      onClick: onTheme,
    },
    icon(state.dark ? 'sun' : 'moon'),
  );
  const notifications = link('', '#/notifications', 'icon-button notification-link');
  notifications.setAttribute('aria-label', '내 알림');
  notifications.append(icon('bell'));
  const account = state.user
    ? el(
        'details',
        { class: 'account-menu' },
        el(
          'summary',
          { 'aria-label': '계정 메뉴' },
          el('span', { class: 'avatar', 'aria-hidden': 'true' }, nickname.slice(0, 1)),
          el('span', { class: 'account-name' }, nickname),
          icon('chevron', 15),
        ),
        el(
          'div',
          { class: 'account-popover' },
          el(
            'div',
            { class: 'account-popover-heading' },
            el('strong', {}, nickname),
            el('small', {}, schoolName + ' · 나의 스쿨팟'),
          ),
          link('프로필 설정', '#/profile', 'account-item'),
          state.me?.is_admin ? link('관리자 대시보드', '#/admin', 'account-item') : null,
          button('로그아웃', onLogout, 'account-item logout-item'),
        ),
      )
    : link('로그인', '#/login', 'button secondary small');
  const mobileBrand = brand();
  mobileBrand.classList.add('mobile-brand');
  const header = el(
    'header',
    { class: 'header' },
    mobileBrand,
    searchForm(),
    el(
      'div',
      { class: 'header-actions' },
      el(
        'button',
        {
          type: 'button',
          class: 'icon-button mobile-search-trigger',
          'aria-label': '검색 열기',
          onClick: openSearch,
        },
        icon('search'),
      ),
      theme,
      notifications,
      account,
    ),
  );
  const main = el('main', { id: 'main', tabindex: '-1' });
  const mobile = el(
    'nav',
    { class: 'mobile-nav', 'aria-label': '모바일 메뉴' },
    nav('홈', '/', 'home'),
    nav(
      '게시판',
      '/boards',
      'chat',
      /^\/(boards|board|post|write|search|popular)(\/|$)/.test(path),
    ),
    nav('급식', '/meals', 'meal'),
    nav('일정', '/assessments', 'calendar', ['/schedule', '/assessments'].includes(path)),
    nav('내 정보', '/profile', 'user', ['/profile', '/password', '/admin'].includes(path)),
  );
  const root = el(
    'div',
    { class: 'shell' },
    sidebar,
    el('div', { class: 'workspace' }, header, main),
    mobile,
  );
  root.addEventListener('click', (e) => {
    if (account.tagName === 'DETAILS' && !account.contains(e.target)) account.open = false;
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && account.tagName === 'DETAILS') {
      account.open = false;
      account.querySelector('summary').focus();
    }
  });
  if (
    state.user &&
    state.me?.profile &&
    (/^\/(board|boards|search|popular)(\/|$)/.test(path) || path === '/')
  ) {
    const compose = link('', '#/write', 'mobile-compose');
    compose.append(icon('plus', 18), el('span', {}, '글쓰기'));
    root.append(compose);
  }
  return { root, main };
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
