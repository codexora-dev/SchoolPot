import { rpc } from './api.js';
export const governance = (action, payload = {}) =>
  rpc('governance', { p_action: action, p_payload: payload });
export const roleOf = (me) => me?.role || (me?.is_admin ? 'owner' : 'member');
export const levels = {
  advice: '안내',
  warning: '경고',
  1: '1일 이용 제한',
  3: '3일 이용 제한',
  7: '7일 이용 제한',
  range: '7~30일 이용 제한',
  30: '30일 이용 제한',
  review: '30일 제한 + 영구 제한 검토',
  permanent: '영구 이용 제한',
};
export const requestStates = {
  pending: '접수',
  reviewing: '검토 중',
  needs_info: '보완 요청',
  approved: '승인',
  rejected: '반려',
  cancelled: '취소',
};
