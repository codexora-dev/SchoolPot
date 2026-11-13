import './styles/main.css';
import { el, link, empty, errorBox, toast } from './lib/dom.js';
import { client, configured, authStorage } from './services/api.js';
import { call } from './services/community.js';
import { layout, pageTitle } from './components/layout.js';
import { loadBoards } from './services/management.js';
import { setBoards } from './config/site.js';
import { homePage } from './pages/home.js';
import { boardsPage } from './pages/boards.js';
import { icon } from './components/icons.js';
import { connectionStatus } from './components/connection-status.js';
import { showSitePopups } from './components/site-popups.js';
const feedbackPage = (...args) =>
  import('./pages/feedback.js').then((m) => m.feedbackPage(...args));
const authPage = (...args) => import('./pages/auth.js').then((m) => m.authPage(...args));
const profilePage = (...args) => import('./pages/auth.js').then((m) => m.profilePage(...args));
const boardPage = (...args) => import('./pages/community.js').then((m) => m.boardPage(...args));
const postPage = (...args) => import('./pages/community.js').then((m) => m.postPage(...args));
const writePage = (...args) => import('./pages/community.js').then((m) => m.writePage(...args));
const notificationsPage = (...args) =>
  import('./pages/school.js').then((m) => m.notificationsPage(...args));
const noticesPage = (...args) => import('./pages/notices.js').then((m) => m.noticesPage(...args));
const noticePage = (...args) => import('./pages/notices.js').then((m) => m.noticePage(...args));
const rulesPage = (...args) => import('./pages/rules.js').then((m) => m.rulesPage(...args));
const neisPage = (...args) => import('./pages/school.js').then((m) => m.neisPage(...args));
const assessmentsPage = (...args) =>
  import('./pages/school.js').then((m) => m.assessmentsPage(...args));
const adminPage = (...args) => import('./pages/admin.js').then((m) => m.adminPage(...args));
const enrollmentPage = (...args) =>
  import('./pages/enrollment.js').then((m) => m.enrollmentPage(...args));
const privacyPage = (...args) =>
  import('./pages/enrollment.js').then((m) => m.privacyPage(...args));
let storedTheme;
try {
  storedTheme = localStorage.getItem('schoolpot-theme');
} catch {
  /* Storage may be blocked */
}
const state = { user: null, me: null, dark: storedTheme === 'dark' };
let renderId = 0;
let recovery = false;
let sessionVersion = 0;
function applyTheme() {
  document.documentElement.dataset.theme = state.dark ? 'dark' : 'light';
  document
    .querySelector('meta[name=theme-color]')
    ?.setAttribute('content', state.dark ? '#101d18' : '#176449');
}
function toggleTheme(event) {
  state.dark = !state.dark;
  applyTheme();
  try {
    localStorage.setItem('schoolpot-theme', state.dark ? 'dark' : 'light');
  } catch {
    /* theme remains in memory */
  }
  const toggle = event.currentTarget;
  toggle.replaceChildren(icon(state.dark ? 'sun' : 'moon'));
  toggle.setAttribute('aria-label', state.dark ? '라이트 모드로 전환' : '다크 모드로 전환');
}
applyTheme();
async function refresh() {
  const version = ++sessionVersion;
  let user = null,
    me = null,
    authError = null;
  try {
    if (client) {
      const { data, error } = await client.auth.getUser();
      if (error && (!error.status || error.status >= 500))
        throw new Error('로그인 상태를 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
      user = data?.user || null;
      if (user) me = await call('me');
    }
  } catch (err) {
    authError = err.message;
  }
  let catalog = [];
  let boardError = null;
  try {
    if (client) catalog = await loadBoards(Boolean(me?.is_admin));
  } catch (err) {
    boardError = err.message;
  }
  if (version !== sessionVersion) return;
  setBoards(catalog);
  state.boardError = boardError;
  Object.assign(state, { user, me, authError });
}
async function logout() {
  if (client) {
    const id = state.user?.id;
    const { error } = await client.auth.signOut();
    if (error) {
      toast('로그아웃에 실패했어요. 다시 시도해 주세요.');
      return;
    }
    try {
      if (id) localStorage.removeItem(`schoolpot-draft:${id}`);
    } catch {
      /* Session still signs out when storage is blocked. */
    }
  }
  state.user = null;
  authStorage.clear();
  state.me = null;
  state.authError = null;
  await refresh();
  location.hash = '/';
  await render();
}
function gate() {
  if (!configured)
    return empty(
      '서비스 연결을 준비하고 있어요',
      '잠시 후 다시 접속해 주세요.',
      link('홈으로', '#/', 'button primary'),
    );
  if (state.authError)
    return errorBox(state.authError, async () => {
      await refresh();
      await render();
    });
  if (!state.user)
    return empty(
      '로그인하고 함께해요',
      '게시글과 학교 정보는 로그인한 회원에게만 보여요.',
      link('로그인', '#/login', 'button primary'),
    );
  if (!state.me?.profile)
    return empty(
      '마지막으로 닉네임을 정해주세요',
      '다른 친구들에게 보여줄 닉네임과 학년을 설정할 수 있어요.',
      link('프로필 설정', '#/profile', 'button primary'),
    );
  if (state.me?.enrollment_current !== true)
    return empty(
      '우리 반을 선택해 주세요',
      '학년과 반만 선택하면 학교생활을 시작할 수 있어요.',
      link('학년·반 선택', '#/enrollment', 'button primary'),
    );
  return null;
}
async function render() {
  const current = ++renderId;
  const [route = '/', search = ''] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(search);
  const { root, main } = layout(state, toggleTheme, logout);
  document.querySelector('#app').replaceChildren(root);
  main.append(
    el(
      'div',
      { class: 'loading', role: 'status' },
      el('span', { class: 'spinner' }),
      '학교의 이야기를 불러오는 중…',
    ),
  );
  try {
    let page;
    const publicRoutes = [
      '/',
      '/login',
      '/signup',
      '/reset',
      '/guide',
      '/rules',
      '/boards',
      '/privacy',
    ];
    if (route === '/') page = await homePage(state, render);
    else if (['/login', '/signup', '/reset', '/password'].includes(route)) {
      if (route === '/password' && !state.user) page = gate();
      else page = await authPage(route.slice(1), refresh);
    } else if (route === '/privacy') page = await privacyPage();
    else if (route === '/enrollment' && state.user)
      page = await enrollmentPage(state, async () => {
        await refresh();
        await render();
      });
    else if (route === '/admin' && state.me?.is_admin)
      page = await adminPage(params, async () => {
        await refresh();
        await render();
      });
    else if (route === '/feedback' && state.user && state.me?.profile)
      page = await feedbackPage(params, render);
    else if (route === '/rules') page = await rulesPage(params);
    else if (route === '/guide')
      page = el(
        'section',
        {},
        pageTitle(
          'ABOUT SCHOOLPOT',
          '스쿨팟 이용 안내',
          '서로를 존중하며 이야기를 나누는 공간이에요.',
        ),
        el(
          'article',
          { class: 'panel prose' },
          link('요약본·전체 운영 규정 읽기', '#/rules', 'button primary'),
          el('h2', {}, '회원가입과 이용'),
          el(
            'p',
            {},
            '아이디·8자 이상 비밀번호·본인 학년과 반을 입력하고 가입할 수 있어요. 이메일 인증이나 재학생 인증 신청은 받지 않으며, 소속은 본인 신고에 따릅니다.',
          ),
          el('h2', {}, '안전한 커뮤니티'),
          el(
            'p',
            {},
            '실명, 학번, 연락처, 주소, 타인의 개인정보를 게시하지 마세요. 익명 글과 댓글에서도 학교 규칙과 상대방의 권리를 존중해 주세요. 부적절한 글과 댓글은 신고할 수 있어요.',
          ),
          el('h2', {}, '개인정보와 내 활동'),
          el(
            'p',
            {},
            '실제 이메일, 학생증, 학번, 생년월일은 받지 않아요. 닉네임은 프로필에서 바꿀 수 있고 소속 정정은 관리자에게 요청합니다. 수행평가는 등록된 본인 반에만 공유합니다. 탈퇴하면 소속 정보와 계정에 연결된 작성 내용도 삭제합니다.',
          ),
          link('개인정보 처리방침', '#/privacy', 'button secondary'),
          el('h2', {}, '계정과 복구 코드'),
          el(
            'p',
            {},
            '가입할 때 한 번 표시되는 복구 코드를 안전한 곳에 보관해 주세요. 비밀번호를 잊었다면 로그인 화면에서 복구 코드로 재설정할 수 있어요. 비밀번호를 재설정하면 새 복구 코드가 발급됩니다. 공용 기기에서는 사용 후 로그아웃해 주세요.',
          ),
        ),
      );
    else if (route === '/boards')
      page = boardsPage(state, async () => {
        await refresh();
        await render();
      });
    else if (route === '/profile' && state.user)
      page = await profilePage(
        state,
        async () => {
          await refresh();
          await render();
        },
        params,
      );
    else if (!publicRoutes.includes(route) && gate())
      page = el('section', { class: 'panel gate' }, gate());
    else if (route.startsWith('/board/') || route === '/search' || route === '/popular')
      page = await boardPage(route, params, state);
    else if (route.startsWith('/post/'))
      page = await postPage(route.split('/')[2], state, render, params);
    else if (route === '/write') page = await writePage(params, state);
    else if (route === '/feedback') page = await feedbackPage(params, render);
    else if (route === '/notifications') page = await notificationsPage(render);
    else if (route === '/notices') page = await noticesPage(params);
    else if (route.startsWith('/notice/'))
      page = await noticePage(route.split('/')[2], params, state, render);
    else if (route === '/meals' || route === '/schedule')
      page = await neisPage(route.slice(1), params);
    else if (route === '/assessments') page = await assessmentsPage(params, state, render);
    else if (route === '/admin')
      page = state.me?.is_admin
        ? await adminPage(params, render)
        : empty('관리자 전용 화면이에요', '이 계정에는 관리자 권한이 없어요.');
    else
      page = empty(
        '페이지를 찾을 수 없어요',
        '주소를 확인해 주세요.',
        link('홈으로', '#/', 'button primary'),
      );
    if (current === renderId) {
      main.replaceChildren(page);
      document.title = `${page.querySelector('h1,h2')?.textContent || '우리 학교의 작은 광장'} · 스쿨팟`;
      void showSitePopups();
    }
  } catch (err) {
    if (current === renderId) {
      const staleModule =
        /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
          err.message,
        );
      main.replaceChildren(
        errorBox(
          staleModule
            ? '새 화면을 불러오지 못했어요. 연결을 확인하고 다시 시도하면 사이트를 새로 불러옵니다.'
            : err.message,
          async () => {
            if (staleModule) {
              location.reload();
              return;
            }
            await refresh();
            await render();
          },
        ),
      );
    }
  }
}
window.addEventListener('hashchange', async () => {
  const target = location.hash;
  await render();
  if (location.hash !== target) return;
  document.querySelector('#main')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
});
document.querySelector('.skip-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  document.querySelector('#main')?.focus();
});
if (client)
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED') return;
    if (event === 'SIGNED_IN' && state.user?.id === session?.user?.id && state.me) return;
    if (event === 'PASSWORD_RECOVERY') {
      recovery = true;
      setTimeout(async () => {
        await refresh();
        location.hash = '/password';
        render();
      }, 0);
    } else if (['SIGNED_IN', 'SIGNED_OUT'].includes(event)) {
      setTimeout(async () => {
        await refresh();
        if (!recovery) render();
      }, 0);
    }
  });
connectionStatus();
const initial = layout(state, toggleTheme, logout);
initial.main.append(
  el(
    'div',
    { class: 'loading', role: 'status' },
    el('span', { class: 'spinner' }),
    '스쿨팟을 준비하고 있어요…',
  ),
);
document.querySelector('#app').replaceChildren(initial.root);
await refresh();
await render();
