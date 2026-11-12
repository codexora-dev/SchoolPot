// Database metadata fixtures for deterministic UI tests only.
export const boards = [
  ['free', '자유게시판', 'general'],
  ['anonymous', '익명게시판', 'anonymous'],
  ['questions', '질문게시판', 'general'],
  ['study', '공부게시판', 'general'],
  ['lost', '분실물게시판', 'general'],
  ['clubs', '동아리게시판', 'general'],
  ['polls', '투표게시판', 'poll'],
].map(([id, name, kind], index) => ({
  id,
  name,
  kind,
  description: '학교의 이야기를 나누어요',
  position: index * 10,
  is_active: true,
  can_post: true,
  revision: 1,
  posts: 0,
}));
