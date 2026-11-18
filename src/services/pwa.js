import { el, button, toast } from '../lib/dom.js';
export const pwa = { prompt: null, registration: null, error: null, installed: false };
export function isInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true ||
    pwa.installed
  );
}
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  pwa.prompt = event;
  window.dispatchEvent(new window.Event('schoolpot-pwa'));
});
window.addEventListener('appinstalled', () => {
  pwa.installed = true;
  pwa.prompt = null;
  window.dispatchEvent(new window.Event('schoolpot-pwa'));
});
export async function installApp() {
  if (!pwa.prompt) return;
  const prompt = pwa.prompt;
  pwa.prompt = null;
  await prompt.prompt();
  await prompt.userChoice;
  window.dispatchEvent(new window.Event('schoolpot-pwa'));
}
export async function registerPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    pwa.registration = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI), {
      updateViaCache: 'none',
    });
    const offerUpdate = () => {
      if (
        !pwa.registration.waiting ||
        !navigator.serviceWorker.controller ||
        document.querySelector('#pwa-update')
      )
        return;
      const panel = el(
        'aside',
        { id: 'pwa-update', class: 'pwa-update', role: 'status' },
        el('strong', {}, '새 버전이 준비됐어요'),
        el('p', {}, 'SchoolPot 2.0 · 작성 중인 내용을 확인한 뒤 적용해 주세요.'),
        button(
          '업데이트 적용',
          () => {
            if (
              [
                ...document.querySelectorAll(
                  'textarea,input:not([type=checkbox]):not([type=password])',
                ),
              ].some((node) => node.value.trim()) &&
              !window.confirm(
                '작성 중인 내용이 있을 수 있어요. 저장을 마쳤다면 업데이트를 적용해 주세요. 계속할까요?',
              )
            )
              return;
            navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
              once: true,
            });
            pwa.registration.waiting?.postMessage({ type: 'ACTIVATE_UPDATE' });
          },
          'button primary',
        ),
        button('나중에', () => panel.remove()),
      );
      document.body.append(panel);
      const channel = new window.MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        channel.port2.close();
      }, 3000);
      channel.port1.onmessage = (event) => {
        if (/^[a-z0-9-]{1,64}$/i.test(String(event.data)))
          panel.querySelector('p').textContent =
            `SchoolPot 2.0 · 빌드 ${event.data} · 작성 중인 내용을 확인한 뒤 적용해 주세요.`;
        clearTimeout(timer);
        channel.port1.close();
        channel.port2.close();
      };
      pwa.registration.waiting.postMessage({ type: 'VERSION' }, [channel.port2]);
    };
    offerUpdate();
    pwa.registration.addEventListener('updatefound', () => {
      const worker = pwa.registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') offerUpdate();
      });
    });
    window.addEventListener('online', () => pwa.registration.update().catch(() => {}));
  } catch {
    pwa.error = '앱 기능을 준비하지 못했어요. 연결 후 다시 시도해 주세요.';
    toast(pwa.error);
  }
}
