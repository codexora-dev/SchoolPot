import { el, toast } from '../lib/dom.js';

export function connectionStatus() {
  const status = el(
    'div',
    { class: 'connection-status', role: 'status', 'aria-live': 'polite' },
    '인터넷 연결이 끊겼어요. 연결 후 다시 시도해 주세요.',
  );
  let offline = !navigator.onLine;
  const update = () => {
    const restored = offline && navigator.onLine;
    offline = !navigator.onLine;
    status.hidden = !offline;
    if (restored) toast('인터넷에 다시 연결되었어요.');
  };
  update();
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  document.body.append(status);
}
