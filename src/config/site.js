import { school } from './school.js';
export let schoolName = import.meta.env.VITE_SCHOOL_NAME || school.name;
export let boards = [];
export function setBoards(value) {
  boards = Array.isArray(value) ? value : [];
}

export function setServiceInformation(info) {
  if (info?.school_name) schoolName = info.school_name;
}
