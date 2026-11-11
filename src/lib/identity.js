export function username(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(normalized))
    throw new Error('아이디는 영문자로 시작하는 영문 소문자·숫자·밑줄 3~20자로 입력해 주세요.');
  return normalized;
}
// This is an internal Auth identifier, never a real inbox or a recovery address.
export const accountEmail = (value) => `${username(value)}@accounts.schoolpot.invalid`;
