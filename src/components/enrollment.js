import { el } from '../lib/dom.js';
export function privacyContent(setup) {
  const p = setup.policy;
  return el(
    'article',
    { class: 'privacy-content prose' },
    el('p', { class: 'hint' }, `개인정보처리자: ${p.controller} · 문서 버전 ${p.version}`),
    ...p.sections.map(([title, body]) => el('section', {}, el('h3', {}, title), el('p', {}, body))),
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
  );
}
export function enrollmentPayload(form, setup, existing) {
  const data = new FormData(form);
  return {
    school_year: setup.school_year,
    grade: existing?.grade || Number(data.get('grade')),
    class_number: existing?.class_number || Number(data.get('class_number')),
    policy_version: setup.policy.version,
  };
}
