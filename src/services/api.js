import { createClient } from '@supabase/supabase-js';
import { safePublicKey } from '../lib/validation.js';
import { createAuthStorage } from '../lib/auth-storage.js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const schoolErrors = {
  POLICY_NOT_READY: '운영자가 개인정보 안내와 문의 경로를 준비하고 있어요.',
  AGE_REQUIRED: '만 14세 이상인 경우에만 가입할 수 있어요.',
  CONSENT_REQUIRED: '최신 개인정보 안내를 확인하고 필수 동의해 주세요.',
  STALE_POLICY: '개인정보 안내가 변경됐어요. 새로고침한 뒤 다시 확인해 주세요.',
  STALE_CLASS_SETTINGS: '학급 설정이 변경됐어요. 새로고침한 뒤 다시 선택해 주세요.',
  CLASS_INVALID: '운영 중인 학년·반을 선택해 주세요.',
  MEMBERSHIP_REQUIRED: '본인 학년·반과 필수 동의를 등록해 주세요.',
  MEMBERSHIP_LOCKED: '소속 변경은 관리자에게 정정을 요청해 주세요.',
  STALE_MEMBERSHIP: '소속 정보가 변경됐어요. 목록을 다시 불러와 주세요.',
  CLASS_IN_USE: '소속 회원이 있는 반은 없앨 수 없어요. 먼저 소속을 정정해 주세요.',
};
export const configured = Boolean(url && key && safePublicKey(key));
export const authStorage = createAuthStorage({
  key: url ? `sb-${new URL(url).hostname.split('.')[0]}-auth-token` : 'schoolpot-auth',
  persistent: () => window.localStorage,
  temporary: () => window.sessionStorage,
});
export const client = configured
  ? createClient(url, key, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        storage: authStorage.storage,
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
    ...schoolErrors,
    AUTH_REQUIRED: '로그인이 필요해요.',
    ACCOUNT_REQUIRED: '아이디 계정으로 다시 로그인해 주세요.',
    FORBIDDEN: '이 작업을 할 권한이 없어요.',
    SUSPENDED: '이용이 제한된 계정이에요.',
    RATE_LIMIT: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    NOT_FOUND: '찾을 수 없는 항목이에요.',
    INVALID_INPUT: '입력 내용을 확인해 주세요.',
    ALREADY_VOTED: '이미 투표한 항목이에요.',
    BOARD_CLOSED: '지금은 읽기 전용이거나 숨겨진 게시판이에요.',
    BOARD_HAS_POSTS: '글이 있는 게시판은 삭제할 수 없어요. 숨김 또는 읽기 전용으로 변경해 주세요.',
    STALE_BOARD: '다른 게시판 변경사항이 있어요. 목록을 새로고침한 뒤 다시 시도해 주세요.',
    STALE_FEEDBACK: '다른 문의 처리 내역이 있어요. 목록을 새로고침한 뒤 다시 시도해 주세요.',
    STALE_POPUP: '다른 변경사항이 있어요. 팝업 목록을 새로고침한 뒤 다시 시도해 주세요.',
    POPUP_LIMIT: '동시에 게시할 수 있는 팝업은 최대 3개예요. 기존 팝업을 중지한 뒤 등록해 주세요.',
    POPUP_STORAGE_LIMIT: '등록된 팝업이 100개예요. 필요 없는 팝업을 정리한 뒤 등록해 주세요.',
  };
  for (const [key, value] of Object.entries(messages))
    if (error.message?.includes(key)) return value;
  if (error.code === '23505') return '이미 사용 중이거나 등록된 항목이에요.';
  if (error.code === 'PGRST202') return '서버 업데이트가 필요해요. 연결 상태를 확인해 주세요.';
  return '요청을 처리하지 못했어요. 연결 상태와 입력 내용을 확인해 주세요.';
}
export async function auth(action, ...payload) {
  if (!client) throw new Error('Supabase 연결 설정 후 이용할 수 있어요.');
  const { data, error } = await client.auth[action](...payload);
  if (error) throw new Error('인증 요청에 실패했어요. 아이디와 비밀번호를 확인해 주세요.');
  return data;
}
export async function edge(name, payload) {
  if (!client) throw new Error('Supabase 연결이 필요해요.');
  const { data, error } = await client.functions.invoke(name, { body: payload });
  if (error) {
    let detail;
    try {
      detail = await error.context?.json();
    } catch {
      /* not every error has a response */
    }
    const messages = {
      ...schoolErrors,
      ACCOUNT_EXISTS: '이미 사용 중인 아이디예요.',
      INVALID_INPUT: '아이디와 비밀번호 입력 조건을 확인해 주세요.',
      RECOVERY_FAILED: '아이디 또는 복구 코드가 올바르지 않아요.',
      RATE_LIMIT: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
      CONFIG: '계정 서버 설정을 확인해야 해요. 잠시 후 다시 시도해 주세요.',
      REAUTHENTICATION_FAILED: '현재 비밀번호가 올바르지 않아요. 다시 확인해 주세요.',
      FORBIDDEN_OR_RATE_LIMIT: '다시 로그인하거나 잠시 후 탈퇴를 다시 시도해 주세요.',
      DELETE_FAILED: '탈퇴 요청을 완료하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.',
    };
    throw new Error(
      messages[detail?.error] || '요청을 처리할 수 없어요. 연결을 확인하고 다시 시도해 주세요.',
    );
  }
  return data;
}
