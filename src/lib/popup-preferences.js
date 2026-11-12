import { localDate } from './dom.js';
export function popupKey(popup) {
  return `${popup.id}:${popup.revision}`;
}
export function isPopupDismissed(popup, seen, storage, day = localDate()) {
  if (seen.has(popupKey(popup))) return true;
  try {
    const value = JSON.parse(storage.getItem(`schoolpot-popup:${popup.id}`) || 'null');
    return (
      value?.revision === popup.revision &&
      (value.kind === 'forever' || (value.kind === 'today' && value.day === day))
    );
  } catch {
    return false;
  }
}
export function dismissPopup(popup, kind, seen, storage, day = localDate()) {
  if (!popup.close_options.includes(kind)) throw new Error('허용되지 않은 닫기 옵션이에요.');
  if (kind === 'once') {
    seen.add(popupKey(popup));
    return true;
  }
  try {
    storage.setItem(
      `schoolpot-popup:${popup.id}`,
      JSON.stringify({ revision: popup.revision, kind, day: kind === 'today' ? day : null }),
    );
    return true;
  } catch {
    seen.add(popupKey(popup));
    return false;
  }
}
