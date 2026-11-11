import { describe, it, expect } from 'vitest';
import { required, nickname, password, safePublicKey } from '../../src/lib/validation.js';
describe('입력 검증', () => {
  it('빈 문자열과 과도한 길이를 거절한다', () => {
    expect(() => required('  ')).toThrow();
    expect(() => required('abc', 1, 2)).toThrow();
    expect(required('  학교  ')).toBe('학교');
  });
  it('닉네임으로 HTML을 허용하지 않는다', () => {
    expect(() => nickname('<img src=x>')).toThrow();
    expect(nickname('학교친구_1')).toBe('학교친구_1');
  });
  it('12자 미만 비밀번호를 거절한다', () => {
    expect(() => password('password')).toThrow();
    expect(password('my-long-password')).toBe('my-long-password');
  });
  it('service role과 secret 키를 브라우저에서 거절한다', () => {
    expect(safePublicKey('sb_secret_fake')).toBe(false);
    expect(safePublicKey('x.' + btoa(JSON.stringify({ role: 'service_role' })) + '.x')).toBe(false);
    expect(safePublicKey('sb_publishable_test')).toBe(true);
    expect(safePublicKey('x.' + btoa(JSON.stringify({ role: 'anon' })) + '.x')).toBe(true);
  });
});
