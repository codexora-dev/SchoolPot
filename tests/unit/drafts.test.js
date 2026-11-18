import { it, expect } from 'vitest';
import { draftKey, readDraft, saveDraft } from '../../src/lib/drafts.js';
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
it('자동 임시 저장은 계정·편집 글별로 분리하고 24시간 뒤 폐기한다', () => {
  const store = storage(),
    key = draftKey('a');
  saveDraft(store, key, { title: '임시 글', body: '입력한 내용' }, 1000);
  expect(readDraft(store, key, 2000).body).toBe('입력한 내용');
  expect(readDraft(store, draftKey('b'), 2000)).toEqual({});
  expect(readDraft(store, draftKey('a', 'post'), 2000)).toEqual({});
  expect(readDraft(store, key, 1000 + 86400000)).toEqual({});
  expect(store.getItem(key)).toBeUndefined();
});
it('잘못된 JSON·저장소 차단·시각이 없는 예전 초안은 복원하지 않는다', () => {
  const store = storage();
  store.setItem('old', '{"title":"timestamp 없는 초안"}');
  store.setItem('invalid', '<invalid>');
  expect(readDraft(store, 'old')).toEqual({});
  expect(readDraft(store, 'invalid')).toEqual({});
  expect(
    readDraft(
      {
        getItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {},
      },
      'x',
    ),
  ).toEqual({});
});
