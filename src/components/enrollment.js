import { el, link } from '../lib/dom.js';
export function privacyContent(setup) {
  const p = setup.policy;
  return el(
    'article',
    { class: 'privacy-content prose' },
    el('p', { class: 'hint' }, `개인정보처리자: ${p.controller} · 문서 버전 ${p.version}`),
    ...p.sections.map(([title, body]) => el('section', {}, el('h3', {}, title), el('p', {}, body))),
    el('h3', {}, '위탁·국외 처리 및 보안 기록'),
    el(
      'p',
      { class: 'preserve' },
      p.overseas_notice ||
        '처리업체·처리 국가·로그 및 백업 보유기간의 상세 안내는 운영자가 확인 중입니다. 문의는 아래 이메일로 접수할 수 있습니다.',
    ),
    el('h3', {}, '개인정보 문의와 권리행사'),
    p.contact_email
      ? el('a', { class: 'privacy-email', href: `mailto:${p.contact_email}` }, p.contact_email)
      : null,
    el(
      'p',
      {},
      '서비스 내 건의·오류 제보 또는 로그인 없이 이용할 수 있는 외부 문의 경로를 사용해 주세요.',
    ),
    el(
      'a',
      { href: p.contact_url, target: '_blank', rel: 'noopener noreferrer' },
      '스쿨팟 개인정보 문의 (외부 사이트)',
    ),
    el(
      'p',
      { class: 'hint' },
      '개인정보 열람·정정·삭제·처리정지와 동의 철회에 관한 문의도 위 경로로 접수할 수 있습니다.',
    ),
  );
}
export function enrollmentFields(setup, existing) {
  const grade = el(
    'select',
    { name: 'grade', required: true, 'aria-label': '학년', disabled: Boolean(existing) },
    el('option', { value: '' }, '학년 선택'),
    ...setup.counts.map((count, index) =>
      count
        ? el(
            'option',
            { value: index + 1, selected: existing?.grade === index + 1 },
            `${index + 1}학년`,
          )
        : null,
    ),
  );
  const classroom = el('select', {
    name: 'class_number',
    required: true,
    'aria-label': '반',
    disabled: Boolean(existing),
  });
  const update = () => {
    const count = setup.counts[Number(grade.value) - 1] || 0;
    classroom.replaceChildren(
      el('option', { value: '' }, '반 선택'),
      ...Array.from({ length: count }, (_, i) =>
        el('option', { value: i + 1, selected: existing?.class_number === i + 1 }, `${i + 1}반`),
      ),
    );
    classroom.disabled = Boolean(existing) || !count;
  };
  grade.addEventListener('change', update);
  update();
  return el(
    'fieldset',
    { class: 'enrollment-fields' },
    el('legend', {}, `${setup.school_year}학년도 내 소속`),
    el(
      'div',
      { class: 'class-selectors' },
      el('label', { class: 'field' }, el('span', {}, '학년'), grade),
      el('label', { class: 'field' }, el('span', {}, '반'), classroom),
    ),
    !setup.counts.some(Boolean)
      ? el('p', { class: 'hint' }, '관리자가 학년별 반 수를 설정한 뒤 가입할 수 있어요.')
      : null,
    el(
      'p',
      { class: 'hint' },
      '본인 소속을 정확히 선택해 주세요. 가입 후에는 관리자에게 정정을 요청해야 해요.',
    ),
    el(
      'p',
      { class: 'processing-note' },
      '선택한 소속을 저장해 우리 반 수행평가를 보여드려요. 별도의 동의 체크 없이 등록할 수 있습니다. ',
      link('개인정보 처리 안내', '#/privacy', 'inline-link'),
    ),
  );
}
export function enrollmentPayload(form, setup, existing) {
  const data = new FormData(form);
  return {
    school_year: setup.school_year,
    grade: existing?.grade || Number(data.get('grade')),
    class_number: existing?.class_number || Number(data.get('class_number')),
    policy_version: setup.policy.version,
    age_14_confirmed: data.has('age_14_confirmed'),
  };
}
