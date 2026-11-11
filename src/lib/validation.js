export function required(value, min = 1, max = 20000) {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max) throw new Error(`${min}~${max}자로 입력해 주세요.`);
  return text;
}
export function nickname(value) {
  const s = required(value, 2, 20);
  if (!/^[\p{L}\p{N}_ ]+$/u.test(s))
    throw new Error('닉네임에는 문자, 숫자, 공백, 밑줄만 사용할 수 있어요.');
  return s;
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128)
    throw new Error('비밀번호는 8~128자로 입력해 주세요.');
  return value;
}
export function safePublicKey(key) {
  if (key.startsWith('sb_publishable_')) return true;
  try {
    return JSON.parse(atob(key.split('.')[1])).role === 'anon';
  } catch {
    return false;
  }
}
