import { el, button, toast } from '../lib/dom.js';
import { icon } from './icons.js';
import { configured } from '../services/api.js';
import { getSitePopups } from '../services/popups.js';
import { isPopupDismissed, dismissPopup } from '../lib/popup-preferences.js';

const labels = { once: '닫기', today: '오늘 하루 보지 않기', forever: '다시 보지 않기' };
export function popupDialog(popup, { preview = false, onDismiss = () => {} } = {}) {
  const titleId = `popup-title-${popup.id || 'preview'}`;
  const finish = (kind) => {
    dialog.close();
    onDismiss(kind);
  };
  const dialog = el(
    'dialog',
    { class: 'site-popup', 'aria-labelledby': titleId },
    el(
      'div',
      { class: 'site-popup-top' },
      el('span', { class: 'board-chip' }, preview ? '팝업 미리보기' : '스쿨팟 안내'),
      el(
        'button',
        {
          type: 'button',
          class: 'icon-button',
          'aria-label': '팝업 닫기',
          onClick: () => finish('once'),
        },
        icon('close'),
      ),
    ),
    el('h2', { id: titleId }, popup.title),
    el('div', { class: 'site-popup-body preserve' }, popup.body),
    el(
      'div',
      { class: 'site-popup-footer' },
      el(
        'p',
        { class: 'hint' },
        preview
          ? '미리보기에서는 보지 않기 설정이 저장되지 않습니다.'
          : '보지 않기 설정은 이 브라우저에 적용됩니다.',
      ),
      el(
        'div',
        { class: 'site-popup-options' },
        ...['once', 'today', 'forever']
          .filter((kind) => popup.close_options.includes(kind))
          .map((kind) =>
            button(
              labels[kind],
              () => finish(kind),
              kind === 'once' ? 'button primary' : 'button secondary',
            ),
          ),
      ),
    ),
  );
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finish('once');
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
const seen = new Set();
const storage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};
let cache = null,
  active = false,
  loading = false,
  generation = 0,
  waitingFor = null;
export function invalidateSitePopups() {
  cache = null;
  generation++;
}
const adminRoute = () => location.hash.slice(1).split('?')[0] === '/admin';
export async function showSitePopups() {
  if (!configured || active || loading || adminRoute()) return;
  loading = true;
  const version = generation;
  try {
    cache ??= getSitePopups();
    const items = await cache;
    if (version !== generation || adminRoute()) return;
    const openDialog = document.querySelector('dialog[open]');
    if (openDialog) {
      if (waitingFor !== openDialog) {
        waitingFor = openDialog;
        openDialog.addEventListener(
          'close',
          () => {
            waitingFor = null;
            void showSitePopups();
          },
          { once: true },
        );
      }
      return;
    }
    const next = items.find((p) => !isPopupDismissed(p, seen, storage));
    if (!next) return;
    active = true;
    popupDialog(next, {
      onDismiss: (kind) => {
        const saved = dismissPopup(next, kind, seen, storage);
        if (!saved) toast('이 브라우저에서는 설정을 저장할 수 없어 이번만 닫았어요.');
        active = false;
        setTimeout(showSitePopups, 0);
      },
    });
  } catch {
    cache = null;
    console.warn('Site notices are temporarily unavailable.');
  } finally {
    loading = false;
  }
}
