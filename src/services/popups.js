import { rpc } from './api.js';
export const getSitePopups = () => rpc('site_popups');
export const managePopups = (action, payload = {}) =>
  rpc('manage_popups', { p_action: action, p_payload: payload });
