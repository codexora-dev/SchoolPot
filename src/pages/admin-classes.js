import { el, field, button, link, toast, empty } from '../lib/dom.js';
import { schoolMembership } from '../services/school-membership.js';
export async function classManager(params, reload) {
  const setup = await schoolMembership('admin_settings');
  const status = el('p', { role: 'status', class: 'form-status' });
  const settings = el(
    'form',
    {
      class: 'panel form-stack',
      onSubmit: async (event) => {
        event.preventDefault();
        const submit = settings.querySelector('[type=submit]');
        submit.disabled = true;
        const data = new FormData(settings);
        try {
          await schoolMembership('admin_save_classes', {
            revision: setup.revision,
            school_year: Number(data.get('school_year')),
            counts: [1, 2, 3].map((g) => Number(data.get('grade_' + g))),
          });
          toast('학급 설정을 저장했어요.');
          await reload();
        } catch (err) {
          status.textContent = err.message;
        } finally {
          submit.disabled = false;
        }
      },
    },
    el('h2', {}, '학년별 반 수'),
    field('학년도', 'school_year', 'number', {
      required: true,
      min: setup.school_year,
      max: 2100,
      value: setup.school_year,
    }),
    ...[1, 2, 3].map((g) =>
      field(`${g}학년은 몇 반까지 있나요? (0: 등록 중지)`, 'grade_' + g, 'number', {
        required: true,
        min: 0,
        max: 30,
        value: setup.counts[g - 1],
      }),
    ),
    el(
      'p',
      { class: 'hint' },
      '학년별로 1반부터 입력한 반까지 선택할 수 있어요. 소속 회원이 있는 반을 없애려면 먼저 소속을 정정해야 합니다. 학년도가 바뀌면 기존 회원은 새 소속을 등록하고 이전 학년도 일정은 보이지 않아요.',
    ),
    status,
    el('button', { class: 'button primary', type: 'submit' }, '학급 설정 저장'),
  );
  const query = params.get('q') || '';
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const members = await schoolMembership('admin_members', { query, offset });
  const correct = (member) => {
    const grade = el(
      'select',
      { name: 'grade', 'aria-label': '정정할 학년', required: true },
      ...[1, 2, 3]
        .filter((g) => setup.counts[g - 1])
        .map((g) => el('option', { value: g, selected: g === member.grade }, g + '학년')),
    );
    const classroom = el('select', {
      name: 'class_number',
      'aria-label': '정정할 반',
      required: true,
    });
    const update = () =>
      classroom.replaceChildren(
        ...Array.from({ length: setup.counts[Number(grade.value) - 1] || 0 }, (_, i) =>
          el('option', { value: i + 1, selected: i + 1 === member.class_number }, i + 1 + '반'),
        ),
      );
    grade.addEventListener('change', update);
    update();
    const message = el('p', { role: 'status' });
    const form = el(
      'form',
      {
        class: 'form-stack',
        onSubmit: async (event) => {
          event.preventDefault();
          const submit = form.querySelector('[type=submit]');
          submit.disabled = true;
          try {
            await schoolMembership('admin_correct_member', {
              id: member.id,
              revision: member.revision,
              grade: Number(grade.value),
              class_number: Number(classroom.value),
              reason: new FormData(form).get('reason'),
            });
            dialog.close();
            toast('소속을 정정했어요.');
            await reload();
          } catch (err) {
            message.textContent = err.message;
          } finally {
            submit.disabled = false;
          }
        },
      },
      el('h2', {}, '소속 정정'),
      el(
        'p',
        {},
        `${member.nickname} (${member.username})의 소속을 확인한 뒤 변경해 주세요. 기존 일정의 반은 바뀌지 않습니다.`,
      ),
      el('label', { class: 'field' }, el('span', {}, '학년'), grade),
      el('label', { class: 'field' }, el('span', {}, '반'), classroom),
      field('정정 사유', 'reason', 'text', { required: true, minlength: 2, maxlength: 200 }),
      message,
      el(
        'div',
        { class: 'actions' },
        button('취소', () => dialog.close()),
        el('button', { type: 'submit', class: 'button primary' }, '소속 정정 저장'),
      ),
    );
    const dialog = el('dialog', { 'aria-label': '소속 정정' }, form);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  };
  return el(
    'section',
    {},
    settings,
    el('h2', {}, '회원 소속 정정'),
    el(
      'p',
      { class: 'hint' },
      '소속은 가입자 본인이 등록하며 재학생 인증을 의미하지 않습니다. 정정 권한은 관리자만 사용합니다. 관리자도 수행평가 본문은 자신의 소속 반에서만 조회합니다.',
    ),
    el(
      'form',
      {
        class: 'filters',
        onSubmit: (event) => {
          event.preventDefault();
          location.hash =
            '/admin?tab=classes&q=' + encodeURIComponent(new FormData(event.target).get('q'));
        },
      },
      field('아이디·닉네임 검색', 'q', 'text', { value: query, maxlength: 40 }),
      el('button', { class: 'button secondary', type: 'submit' }, '회원 검색'),
    ),
    el(
      'div',
      { class: 'management-list' },
      members.length
        ? members.map((m) =>
            el(
              'article',
              { class: 'panel management-card' },
              el(
                'div',
                {},
                el('h3', {}, m.nickname),
                el(
                  'p',
                  { class: 'meta' },
                  `${m.username} · ${m.school_year ? `${m.school_year}학년도 ${m.grade}학년 ${m.class_number}반` : '본인 소속 등록·동의 필요'}`,
                ),
              ),
              m.revision ? button('소속 정정', () => correct(m), 'button secondary') : null,
            ),
          )
        : empty('검색된 회원이 없어요', '아이디나 닉네임을 확인해 주세요.'),
    ),
    el(
      'div',
      { class: 'pagination' },
      offset
        ? link(
            '← 이전',
            `#/admin?tab=classes&q=${encodeURIComponent(query)}&offset=${Math.max(0, offset - 30)}`,
            'button secondary',
          )
        : null,
      members.length === 30
        ? link(
            '다음 →',
            `#/admin?tab=classes&q=${encodeURIComponent(query)}&offset=${offset + 30}`,
            'button secondary',
          )
        : null,
    ),
  );
}
export async function privacyManager(reload) {
  const setup = await schoolMembership('admin_settings');
  const p = setup.policy;
  const status = el('p', { role: 'status' });
  const form = el(
    'form',
    {
      class: 'panel form-stack',
      onSubmit: async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type=submit]');
        submit.disabled = true;
        const data = new FormData(form);
        try {
          await schoolMembership('admin_save_policy', {
            version: p.version,
            controller: data.get('controller'),
            contact_url: data.get('contact_url'),
            overseas_notice: data.get('overseas_notice'),
            is_ready: data.has('is_ready'),
            review_confirmed: data.has('review_confirmed'),
          });
          toast('개인정보 안내를 저장했어요. 변경된 문서는 회원에게 다시 동의를 받습니다.');
          await reload();
        } catch (err) {
          status.textContent = err.message;
        } finally {
          submit.disabled = false;
        }
      },
    },
    el('h2', {}, '개인정보 안내·동의 접수'),
    field('실제 개인정보처리자 이름 또는 단체명', 'controller', 'text', {
      required: true,
      maxlength: 120,
      value: p.controller,
    }),
    field('로그인 없이 이용 가능한 개인정보 문의 URL', 'contact_url', 'url', {
      required: true,
      maxlength: 400,
      value: p.contact_url,
    }),
    field('위탁·국외 처리·보안 기록 보유기간 안내', 'overseas_notice', 'textarea', {
      required: true,
      maxlength: 8000,
      rows: 14,
    }),
    el(
      'p',
      { class: 'hint' },
      'Supabase 프로젝트 DB 리전은 한국 서울입니다. 이것만으로 인증·Edge·지원·하위 처리업체와 GitHub Pages의 모든 처리가 국내에만 있다고 볼 수는 없습니다. 실제 계약·하위 처리업체·국가·연락처·이전 항목/시점/방법·목적·보유기간·거부 방법과 영향을 확인해 명시하세요. 보안 해시 카운터의 보유기간과 외부 사업자 로그·백업의 삭제 절차도 고지해야 합니다.',
    ),
    el(
      'p',
      { class: 'hint' },
      '문의 사이트가 준비 중이거나 실제 문의를 받지 못하면 접수를 켜지 마세요. 문서 저장만으로 법적 검토가 완료되는 것은 아닙니다. 반 수와 정책을 준비하기 전에는 새 가입을 받을 수 없습니다.',
    ),
    el(
      'label',
      { class: 'checkbox' },
      el('input', { type: 'checkbox', name: 'review_confirmed' }),
      '실제 처리 주체·문의 수신·처리업체와 고지 내용 및 동의 근거를 확인했습니다.',
    ),
    el(
      'label',
      { class: 'checkbox' },
      el('input', { type: 'checkbox', name: 'is_ready', checked: p.is_ready }),
      '확인한 문서를 공개하고 개인정보 동의·가입 접수를 켭니다.',
    ),
    status,
    el('button', { class: 'button primary', type: 'submit' }, '개인정보 안내 저장'),
    link('공개 처리방침 확인', '#/privacy', 'button secondary'),
  );
  form.querySelector('textarea').value = p.overseas_notice;
  return form;
}
