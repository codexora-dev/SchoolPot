import { el, link, toast } from '../lib/dom.js';
import { pageTitle } from '../components/layout.js';
import { enrollmentFields, enrollmentPayload, privacyContent } from '../components/enrollment.js';
import { getSchoolSetup, schoolMembership } from '../services/school-membership.js';
export async function privacyPage() {
  const setup = await getSchoolSetup();
  return el(
    'section',
    {},
    pageTitle(
      'PRIVACY',
      '개인정보 처리방침',
      '가입 전에도 내용을 확인하고 외부 문의 경로를 이용할 수 있어요.',
    ),
    el('div', { class: 'panel' }, privacyContent(setup)),
  );
}
export async function enrollmentPage(state, refresh) {
  const setup = await getSchoolSetup();
  const existing =
    state.me?.membership?.school_year === setup.school_year ? state.me.membership : null;
  const status = el('p', { role: 'status', class: 'form-status' });
  const form = el(
    'form',
    {
      class: 'panel form-stack',
      onSubmit: async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type=submit]');
        submit.disabled = true;
        try {
          await schoolMembership('enroll', enrollmentPayload(form, setup, existing));
          await refresh();
          toast('소속과 동의를 저장했어요.');
          location.hash = '/assessments';
        } catch (err) {
          status.textContent = err.message;
        } finally {
          submit.disabled = false;
        }
      },
    },
    enrollmentFields(setup, existing),
    status,
    el(
      'button',
      {
        class: 'button primary',
        type: 'submit',
        disabled: !setup.policy.is_ready || !setup.counts.some(Boolean),
      },
      '동의하고 소속 등록',
    ),
  );
  return el(
    'section',
    {},
    pageTitle(
      'MY CLASS',
      '소속과 개인정보 동의',
      '기존 회원도 최초 한 번 본인 소속을 등록해야 해요.',
    ),
    form,
    link('동의하지 않고 계정 관리·탈퇴', '#/profile?section=account', 'button secondary'),
    state.me?.is_admin
      ? link('관리자 학급·개인정보 설정', '#/admin?tab=classes', 'button secondary')
      : null,
  );
}
