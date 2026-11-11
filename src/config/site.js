export const schoolName = import.meta.env.VITE_SCHOOL_NAME || '우리 학교';
export const boards = [
  { id: 'free', name: '자유게시판', icon: '☕', description: '소소한 일상부터 학교 이야기까지' },
  { id: 'anonymous', name: '익명게시판', icon: '◌', description: '이름 없이, 조금 더 솔직하게' },
  { id: 'questions', name: '질문게시판', icon: '?', description: '궁금한 건 함께 풀어요' },
  { id: 'study', name: '공부게시판', icon: '✎', description: '우리의 공부가 쌓이는 곳' },
  { id: 'lost', name: '분실물게시판', icon: '⌕', description: '잃어버린 물건, 함께 찾아요' },
  { id: 'clubs', name: '동아리게시판', icon: '♧', description: '좋아하는 것을 함께하는 친구들' },
  { id: 'polls', name: '투표게시판', icon: '▤', description: '우리의 생각을 모아봐요' },
];
