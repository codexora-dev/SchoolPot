import { el, button, link } from '../lib/dom.js';
import { pageTitle } from '../components/layout.js';
import { pwa, isInstalled, installApp } from '../services/pwa.js';
export function appInstallPage() {
  const status = el('div', { class: 'panel form-stack' });
  const update = () => {
    status.replaceChildren(
      el('h2', {}, isInstalled() ? '설치된 스쿨팟을 사용 중이에요' : '학교 소식을 앱으로 만나세요'),
      el(
        'p',
        {},
        pwa.error || 'SchoolPot 2.0 · 설치는 선택 사항이며 웹에서도 모든 기능을 사용할 수 있어요.',
      ),
      !isInstalled() && pwa.prompt ? button('SchoolPot 설치', installApp, 'button primary') : null,
      !isInstalled()
        ? el(
            'p',
            {},
            /iPhone|iPad|iPod/.test(navigator.userAgent)
              ? 'iPhone·iPad: Safari의 공유 버튼 → 홈 화면에 추가를 선택하세요. 푸시는 홈 화면에 설치한 앱에서 지원되는 환경에 한해 사용할 수 있어요.'
              : '설치 버튼이 없다면 브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 확인하세요. 브라우저와 기기에 따라 지원 여부가 달라요.',
          )
        : null,
      el(
        'p',
        {},
        '새 버전은 안내에서 직접 적용합니다. 오프라인에서는 게시글·개인정보를 표시하지 않아요.',
      ),
      link('알림 설정', '#/notification-settings', 'button secondary'),
      link('나중에 · 홈으로', '#/', 'text-button'),
    );
  };
  update();
  const changed = () => {
    if (status.isConnected) update();
    else window.removeEventListener('schoolpot-pwa', changed);
  };
  window.addEventListener('schoolpot-pwa', changed);
  window.addEventListener(
    'hashchange',
    () => window.removeEventListener('schoolpot-pwa', changed),
    { once: true },
  );
  return el(
    'section',
    {},
    pageTitle('SCHOOLPOT APP', '앱 설치 안내', '자주 찾는 학교생활을 더 가까이'),
    status,
  );
}
