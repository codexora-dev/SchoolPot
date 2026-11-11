import { rpc } from './api.js';
export const call = (action, payload = {}) =>
  rpc('community', { p_action: action, p_payload: payload });
