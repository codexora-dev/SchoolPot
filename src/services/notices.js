import { rpc } from './api.js';
export const manageNotices = (action, payload = {}) =>
  rpc('manage_notices', { p_action: action, p_payload: payload });
