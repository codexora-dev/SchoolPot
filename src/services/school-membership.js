import { rpc } from './api.js';
export const getSchoolSetup = () => rpc('school_setup');
export const schoolMembership = (action, payload = {}) =>
  rpc('school_membership', { p_action: action, p_payload: payload });
