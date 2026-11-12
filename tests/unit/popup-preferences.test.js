import { it, expect } from 'vitest';
import { isPopupDismissed, dismissPopup } from '../../src/lib/popup-preferences.js';
const popup = { id: 'test', revision: 1, close_options: ['once', 'today', 'forever'] };
function memory() {
  const data = new Map();
  return { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}
it('기본 닫기는 현재 페이지 방문 동안만 유지한다', () => {
  const seen = new Set(),
    storage = memory();
  dismissPopup(popup, 'once', seen, storage);
  expect(isPopupDismissed(popup, seen, storage)).toBe(true);
  expect(isPopupDismissed(popup, new Set(), storage)).toBe(false);
});
it('오늘 하루 보지 않기는 날짜가 바뀌면 해제된다', () => {
  const storage = memory(),
    seen = new Set();
  dismissPopup(popup, 'today', seen, storage, '2026-11-12');
  expect(isPopupDismissed(popup, seen, storage, '2026-11-12')).toBe(true);
  expect(isPopupDismissed(popup, seen, storage, '2026-11-13')).toBe(false);
});
it('다시 보지 않기는 날짜와 관계없이 유지하되 수정된 팝업은 다시 표시한다', () => {
  const storage = memory();
  dismissPopup(popup, 'forever', new Set(), storage, '2026-11-12');
  expect(isPopupDismissed(popup, new Set(), storage, '2027-01-01')).toBe(true);
  expect(isPopupDismissed({ ...popup, revision: 2 }, new Set(), storage)).toBe(false);
});
it('다른 팝업의 닫기 기록은 공유하지 않는다', () => {
  const storage = memory();
  dismissPopup(popup, 'forever', new Set(), storage);
  expect(isPopupDismissed({ ...popup, id: 'other' }, new Set(), storage)).toBe(false);
});
it('손상된 저장 데이터는 무시한다', () => {
  expect(isPopupDismissed(popup, new Set(), { getItem: () => '{broken' })).toBe(false);
});
it('저장이 차단되어도 이번 방문에는 반복 표시하지 않는다', () => {
  const seen = new Set(),
    storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
  expect(isPopupDismissed(popup, seen, storage)).toBe(false);
  expect(dismissPopup(popup, 'today', seen, storage)).toBe(false);
  expect(isPopupDismissed(popup, seen, storage)).toBe(true);
});
it('허용하지 않은 닫기 옵션은 기록하지 않는다', () => {
  expect(() =>
    dismissPopup({ ...popup, close_options: ['once'] }, 'forever', new Set(), memory()),
  ).toThrow();
});
