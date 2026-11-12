import { school } from './school.js';
export const schoolName = import.meta.env.VITE_SCHOOL_NAME || school.name;
export let boards = [];
export function setBoards(value) {
  boards = Array.isArray(value) ? value : [];
}
