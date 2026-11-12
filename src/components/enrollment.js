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
        '운영자가 실제 처리업체·처리 국가·보유기간과 권리행사 경로를 확인하고 있습니다. 준비가 끝나기 전에는 새 동의를 받지 않습니다.',
    ),
    el('h3', {}, '개인정보 문의와 권리행사'),
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
  const checkbox = (name, text) =>
    el(
      'label',
      { class: 'checkbox consent-checkbox' },
      el('input', { type: 'checkbox', name, required: true }),
      text,
    );
  return el(
    'fieldset',
    { class: 'enrollment-fields' },
    el('legend', {}, `${setup.school_year}학년도 소속과 필수 동의`),
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
      'div',
      { class: 'privacy-summary hint' },
      el('p', {}, '목적: 계정 인증·복구, 본인 반 수행평가, 커뮤니티와 문의 운영·보안'),
      el(
        'p',
        {},
        '항목: 아이디·비밀번호·닉네임·학년도·학년·반·14세 이상 확인·동의 기록·서비스 이용 기록',
      ),
      el(
        'p',
        {},
        '기간: 회원 정보와 작성 내용은 탈퇴 시 삭제. 보안·처리업체 기록의 별도 기간은 아래 안내에 명시합니다.',
      ),
      el('p', {}, '동의를 거부할 수 있으며, 필수 동의 거부 시 가입·회원 서비스 이용이 제한됩니다.'),
    ),
    el(
      'details',
      { class: 'consent-notice' },
      el('summary', {}, '개인정보 수집·이용 및 위탁·국외 처리 안내 전문'),
      privacyContent(setup),
    ),
    link('개인정보 처리방침 별도 페이지', '#/privacy', 'text-button'),
    checkbox('age_14_confirmed', '[필수] 만 14세 이상입니다.'),
    checkbox(
      'privacy_consent',
      '[필수] 수집 목적·항목·보유기간·거부권을 확인하고 개인정보 수집·이용에 동의합니다.',
    ),
    checkbox(
      'overseas_consent',
      '[필수] 별도 위탁·국외 처리 안내를 확인하고 해당 처리에 동의합니다.',
    ),
    !setup.policy.is_ready
      ? el(
          'p',
          { class: 'hint', role: 'status' },
          '개인정보 처리방침과 문의 경로를 준비 중이에요. 준비가 끝나면 동의하고 진행할 수 있어요.',
        )
      : null,
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
    privacy_consent: data.has('privacy_consent'),
    overseas_consent: data.has('overseas_consent'),
  };
}
