import { it, expect } from 'vitest';
import { username, accountEmail } from '../../src/lib/identity.js';
it('아이디는 대소문자를 구분하지 않고 공백을 정리한다', () => {
  expect(username(' School_12 ')).toBe('school_12');
});
it('이메일·HTML·한글·경로를 로그인 아이디로 허용하지 않는다', () => {
  for (const value of [
    'test@example.com',
    '<script>',
    '한글아이디',
    '../abc',
    '12abc',
    'ab',
    'a'.repeat(21),
  ])
    expect(() => username(value)).toThrow();
});
it('내부 Auth 식별자만 생성하며 사용자 이메일을 요구하지 않는다', () => {
  expect(accountEmail('School_12')).toBe('school_12@accounts.schoolpot.invalid');
});
