import { rpc } from './api.js';
import { setBoards } from '../config/site.js';
export const manageBoards = (action, payload = {}) =>
  rpc('manage_boards', { p_action: action, p_payload: payload });
export const feedback = (action, payload = {}) =>
  rpc('feedback', { p_action: action, p_payload: payload });
export async function loadBoards(isAdmin = false) {
  return isAdmin ? manageBoards('list') : rpc('board_catalog');
}
export async function refreshBoards() {
  setBoards(await loadBoards(true));
}
