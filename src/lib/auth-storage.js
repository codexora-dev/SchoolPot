const preferenceKey = 'schoolpot-remember-login';
// Supabase stores tokens here; passwords and recovery codes never enter this adapter.
export function createAuthStorage({ key, persistent, temporary }) {
  const fallback = new Map();
  const keys = new Set([key, `${key}-user`, `${key}-code-verifier`]);
  const read = (provider, name) => {
    try {
      return provider()?.getItem(name) ?? null;
    } catch {
      return null;
    }
  };
  const write = (provider, name, value) => {
    try {
      const storage = provider();
      if (!storage) return false;
      storage.setItem(name, value);
      return true;
    } catch {
      return false;
    }
  };
  const remove = (provider, name) => {
    try {
      provider()?.removeItem(name);
    } catch {
      /* Storage may be blocked. */
    }
  };
  let remember = read(persistent, preferenceKey) === 'true';
  if (!remember) for (const name of keys) remove(persistent, name);
  const storage = {
    getItem(name) {
      keys.add(name);
      return fallback.get(name) ?? read(remember ? persistent : temporary, name) ?? null;
    },
    setItem(name, value) {
      keys.add(name);
      if (write(remember ? persistent : temporary, name, value)) fallback.delete(name);
      else fallback.set(name, value);
      remove(remember ? temporary : persistent, name);
    },
    removeItem(name) {
      keys.add(name);
      remove(persistent, name);
      remove(temporary, name);
      fallback.delete(name);
    },
  };
  return {
    storage,
    isRemembered: () => remember,
    setRemember(value) {
      const saved = [...keys].map((name) => [name, storage.getItem(name)]);
      for (const name of keys) storage.removeItem(name);
      remember = Boolean(value) && write(persistent, preferenceKey, 'true');
      if (!remember) remove(persistent, preferenceKey);
      for (const [name, token] of saved) if (token !== null) storage.setItem(name, token);
      if (remember && saved.some(([name, token]) => token !== null && fallback.has(name))) {
        // A preference flag fitting in storage does not prove that the larger token fitted.
        for (const name of keys) storage.removeItem(name);
        remember = false;
        remove(persistent, preferenceKey);
        for (const [name, token] of saved) if (token !== null) storage.setItem(name, token);
      }
      return remember;
    },
    clear() {
      for (const name of keys) storage.removeItem(name);
      remove(persistent, preferenceKey);
      remember = false;
    },
  };
}
