import './styles/main.css';
import { el, link, empty, errorBox, toast } from './lib/dom.js';
import { client, configured } from './services/api.js';
import { call } from './services/community.js';
import { layout, pageTitle } from './components/layout.js';
import { boards } from './config/site.js';
import { homePage } from './pages/home.js';
import { authPage, profilePage } from './pages/auth.js';
import { boardPage, postPage, writePage } from './pages/community.js';
import { notificationsPage, noticesPage, neisPage, assessmentsPage } from './pages/school.js';
import { adminPage } from './pages/admin.js';
import { icon } from './components/icons.js';
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
}
applyTheme();
async function refresh() {
  const version = ++sessionVersion;
  let user = null,
    me = null,
    authError = null;
  try {
    if (client) {
      const { data } = await client.auth.getUser();
      user = data?.user || null;
      if (user) me = await call('me');
    }
  } catch (err) {
    authError = err.message;
  }
  if (version !== sessionVersion) return;
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
  state.me = null;
  state.authError = null;
  location.hash = '/';
  await render();
}
function gate() {
  if (!configured)
    return empty(
      '서비스 연결을 준비하고 있어요',
      'Supabase 공개 키 설정과 DB 마이그레이션 적용 후 이용할 수 있어요.',
      link('연결 안내', '#/guide', 'button primary'),
    );
  if (!state.user)
    return empty(
      '로그인하고 함께해요',
      '게시글과 학교 정보는 로그인한 회원에게만 보여요.',
      link('로그인', '#/login', 'button primary'),
    );
  if (state.authError)
    return errorBox(state.authError, async () => {
      await refresh();
      await render();
    });
  if (!state.me?.profile)
    return empty(
      '마지막으로 닉네임을 정해주세요',
      '다른 친구들에게 보여줄 닉네임과 학년을 설정할 수 있어요.',
      link('프로필 설정', '#/profile', 'button primary'),
    );
  return null;
}
async function render() {
  const current = ++renderId;
  const [route = '/', search = ''] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(search);
  const { root, main } = layout(
    state,
    () => {
      state.dark = !state.dark;
      applyTheme();
      try {
        localStorage.setItem('schoolpot-theme', state.dark ? 'dark' : 'light');
      } catch {
        /* theme remains in memory */
      }
      render();
    },
    logout,
  );
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
    const publicRoutes = ['/', '/login', '/signup', '/reset', '/guide', '/boards'];
    if (route === '/') page = await homePage(state);
    else if (['/login', '/signup', '/reset', '/password'].includes(route)) {
      if (route === '/password' && !state.user) page = gate();
      else page = authPage(route.slice(1), refresh);
    } else if (route === '/guide')
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
          el('h2', {}, '회원가입과 이용'),
          el(
            'p',
            {},
            '아이디와 8자 이상 비밀번호로 가입해 이용할 수 있어요. 이메일 인증은 없습니다. 재학생 인증 신청은 받지 않으며, 실제 재학생 여부를 확인하지 않습니다.',
          ),
          el('h2', {}, '안전한 커뮤니티'),
          el(
            'p',
            {},
            '실명, 학번, 연락처, 주소, 타인의 개인정보를 게시하지 마세요. 익명 글과 댓글에서도 학교 규칙과 상대방의 권리를 존중해 주세요. 부적절한 글과 댓글은 신고할 수 있어요.',
          ),
          el('h2', {}, '개인정보와 운영 준비'),
          el(
            'p',
            {},
            '서비스 연결 전에는 계정과 게시물이 생성되지 않아요. 실제 공개 운영 전 운영자는 개인정보 처리방침, 이용약관, 연락처, 연령 및 동의 절차를 확정해 제공해야 합니다. 현재 이 안내는 정식 개인정보 처리방침이 아닙니다.',
          ),
          el('h2', {}, '개발 환경 연결'),
          el(
            'p',
            {},
            '프로젝트 README의 절차에 따라 .env.local에 Supabase URL과 publishable key를 설정하고 마이그레이션을 적용하세요. 서버 비밀키는 브라우저 환경변수에 넣으면 안 됩니다.',
          ),
        ),
      );
    else if (route === '/boards')
      page = el(
        'section',
        {},
        pageTitle('COMMUNITY', '우리 학교 게시판', '어떤 이야기를 나누고 싶나요?'),
        el(
          'div',
          { class: 'boards-grid' },
          ...boards.map(
            (b) =>
              link('', `#/board/${b.id}`, 'panel board-tile').appendChild(
                el(
                  'div',
                  {},
                  el(
                    'span',
                    { class: 'quick-icon' },
                    icon(
                      {
                        free: 'chat',
                        anonymous: 'anonymous',
                        questions: 'question',
                        study: 'book',
                        lost: 'search',
                        clubs: 'club',
                        polls: 'poll',
                      }[b.id],
                    ),
                  ),
                  el('h2', {}, b.name),
                  el('p', { class: 'muted' }, b.description),
                ),
              ).parentNode,
          ),
        ),
      );
    else if (route === '/profile' && state.user)
      page = profilePage(state, async () => {
        await refresh();
        await render();
      });
    else if (!publicRoutes.includes(route) && gate())
      page = el('section', { class: 'panel gate' }, gate());
    else if (route.startsWith('/board/') || route === '/search' || route === '/popular')
      page = await boardPage(route, params);
    else if (route.startsWith('/post/'))
      page = await postPage(route.split('/')[2], state, render, params);
    else if (route === '/write') page = await writePage(params, state);
    else if (route === '/notifications') page = await notificationsPage(render);
    else if (route === '/notices') page = await noticesPage(state, render);
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
    }
  } catch (err) {
    if (current === renderId) main.replaceChildren(errorBox(err.message, render));
  }
}
window.addEventListener('hashchange', async () => {
  await render();
  document.querySelector('#main')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
});
document.querySelector('.skip-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  document.querySelector('#main')?.focus();
});
if (client)
  client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      recovery = true;
      setTimeout(async () => {
        await refresh();
        location.hash = '/password';
        render();
      }, 0);
    } else if (['SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED'].includes(event)) {
      setTimeout(async () => {
        await refresh();
        if (!recovery) render();
      }, 0);
    }
  });
await refresh();
await render();
