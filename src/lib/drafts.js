const TTL = 24 * 60 * 60 * 1000;
export function draftKey(user, post = '') {
  return `schoolpot-draft:${user}${post ? ':' + post : ''}`;
}
export function readDraft(storage, key, now = Date.now()) {
  try {
    const item = JSON.parse(storage.getItem(key) || 'null');
    if (
      !item ||
      !Number.isFinite(item.saved_at) ||
      item.saved_at > now ||
      now - item.saved_at >= TTL
    ) {
      storage.removeItem(key);
      return {};
    }
    return item;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* Blocked storage. */
    }
    return {};
  }
}
export function saveDraft(storage, key, data, now = Date.now()) {
  storage.setItem(key, JSON.stringify({ ...data, saved_at: now }));
}
export function clearDrafts(user) {
  for (const getStorage of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const storage = getStorage();
      for (const key of Object.keys(storage))
        if (key === draftKey(user) || key.startsWith(draftKey(user) + ':')) storage.removeItem(key);
    } catch {
      /* The account operation must still complete if storage is blocked. */
    }
  }
}
