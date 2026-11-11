import { createClient } from '@supabase/supabase-js';
import { safePublicKey } from '../lib/validation.js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
export const configured = Boolean(url && key && safePublicKey(key));
export const client = configured
  ? createClient(url, key, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
export async function rpc(name, payload = {}) {
  if (!client)
    throw new Error('Supabase 연결 설정이 필요해요. README의 연결 방법을 확인해 주세요.');
  const { data, error } = await client.rpc(name, payload);
  if (error) {
    console.warn('API request failed', error.code);
    throw new Error(friendlyError(error));
  }
  return data;
}
export function friendlyError(error) {
  const messages = {
    AUTH_REQUIRED: '로그인이 필요해요.',
    EMAIL_REQUIRED: '이메일 인증을 먼저 완료해 주세요.',
    FORBIDDEN: '이 작업을 할 권한이 없어요.',
    SUSPENDED: '이용이 제한된 계정이에요.',
    RATE_LIMIT: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    NOT_FOUND: '찾을 수 없는 항목이에요.',
    INVALID_INPUT: '입력 내용을 확인해 주세요.',
    ALREADY_VOTED: '이미 투표한 항목이에요.',
  };
  for (const [key, value] of Object.entries(messages))
    if (error.message?.includes(key)) return value;
  if (error.code === '23505') return '이미 사용 중이거나 등록된 항목이에요.';
  return '요청을 처리하지 못했어요. 연결 상태와 입력 내용을 확인해 주세요.';
}
export async function auth(action, ...payload) {
  if (!client) throw new Error('Supabase 연결 설정 후 이용할 수 있어요.');
  const { data, error } = await client.auth[action](...payload);
  if (error)
    throw new Error('인증 요청에 실패했어요. 이메일, 비밀번호와 인증 상태를 확인해 주세요.');
  return data;
}
export async function edge(name, payload) {
  if (!client) throw new Error('Supabase 연결이 필요해요.');
  const { data, error } = await client.functions.invoke(name, { body: payload });
  if (error) throw new Error('요청을 처리할 수 없어요. 서버 설정과 연결을 확인해 주세요.');
  return data;
}
