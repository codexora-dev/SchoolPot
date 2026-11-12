import { describe, it, expect } from 'vitest';
import { createAuthStorage } from '../../src/lib/auth-storage.js';
function store() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}
const key = 'sb-test-auth-token';
function setup(persistent = store(), temporary = store()) {
  return {
    persistent,
    temporary,
    create: () =>
      createAuthStorage({ key, persistent: () => persistent, temporary: () => temporary }),
  };
}
describe('로그인 세션 보관 선택', () => {
  it('기본은 탭 세션이며 이전의 무조건 영구 저장 토큰을 사용하지 않는다', () => {
    const { persistent, temporary, create } = setup();
    persistent.setItem(key, 'legacy');
    const auth = create();
    expect(persistent.getItem(key)).toBe(null);
    expect(auth.isRemembered()).toBe(false);
    expect(auth.storage.getItem(key)).toBe(null);
    auth.storage.setItem(key, 'session');
    expect(temporary.getItem(key)).toBe('session');
    expect(persistent.getItem(key)).toBe(null);
  });
  it('선택하면 토큰과 SDK 부가 키를 옮기고 브라우저 재생성 후 복원한다', () => {
    const { persistent, temporary, create } = setup();
    const auth = create();
    auth.storage.setItem(key, 'token');
    auth.storage.setItem(key + '-user', 'user');
    persistent.setItem('schoolpot-theme', 'dark');
    expect(auth.setRemember(true)).toBe(true);
    expect(temporary.getItem(key)).toBe(null);
    expect(create().storage.getItem(key)).toBe('token');
    expect(persistent.getItem(key + '-user')).toBe('user');
    expect(persistent.getItem('schoolpot-theme')).toBe('dark');
  });
  it('해제하면 영구 토큰을 제거하고 현재 탭에서만 복원한다', () => {
    const { persistent, temporary, create } = setup();
    const auth = create();
    auth.setRemember(true);
    auth.storage.setItem(key, 'token');
    auth.setRemember(false);
    expect(persistent.getItem(key)).toBe(null);
    expect(persistent.getItem('schoolpot-remember-login')).toBe(null);
    expect(temporary.getItem(key)).toBe('token');
    expect(create().storage.getItem(key)).toBe('token');
    const next = setup(persistent, store());
    expect(next.create().storage.getItem(key)).toBe(null);
  });
  it('로그아웃·탈퇴는 두 저장소의 인증 정보와 자동로그인 선택을 정리한다', () => {
    const { persistent, temporary, create } = setup();
    const auth = create();
    auth.setRemember(true);
    auth.storage.setItem(key, 'token');
    temporary.setItem(key + '-user', 'stale');
    auth.clear();
    expect(auth.isRemembered()).toBe(false);
    expect(persistent.getItem(key)).toBe(null);
    expect(temporary.getItem(key + '-user')).toBe(null);
  });
  it('영구 저장이 차단되면 자동로그인을 성공했다고 표시하지 않는다', () => {
    const blocked = {
      getItem: () => null,
      setItem: () => {
        throw Error('blocked');
      },
      removeItem: () => {
        throw Error('blocked');
      },
    };
    const { temporary, create } = setup(blocked);
    const auth = create();
    auth.storage.setItem(key, 'token');
    expect(auth.setRemember(true)).toBe(false);
    expect(temporary.getItem(key)).toBe('token');
  });
  it('저장소 접근이 모두 차단돼도 메모리 로그인과 정리가 동작한다', () => {
    const auth = createAuthStorage({
      key,
      persistent: () => {
        throw Error('blocked');
      },
      temporary: () => {
        throw Error('blocked');
      },
    });
    auth.storage.setItem(key, 'token');
    expect(auth.storage.getItem(key)).toBe('token');
    auth.clear();
    expect(auth.storage.getItem(key)).toBe(null);
  });
  it('선택 플래그는 저장돼도 토큰이 용량을 초과하면 탭 저장으로 돌아간다', () => {
    const persistent = store();
    const set = persistent.setItem;
    persistent.setItem = (name, value) => {
      if (name === key) throw Error('quota');
      set(name, value);
    };
    const { temporary, create } = setup(persistent);
    const auth = create();
    auth.storage.setItem(key, 'token');
    expect(auth.setRemember(true)).toBe(false);
    expect(persistent.getItem('schoolpot-remember-login')).toBe(null);
    expect(temporary.getItem(key)).toBe('token');
  });
  it('저장 용량 부족으로 갱신 실패 시 오래된 토큰 대신 메모리의 최신 토큰을 사용한다', () => {
    const temporary = store();
    temporary.setItem(key, 'old');
    temporary.setItem = () => {
      throw Error('quota');
    };
    const auth = setup(store(), temporary).create();
    auth.storage.setItem(key, 'new');
    expect(auth.storage.getItem(key)).toBe('new');
  });
});
