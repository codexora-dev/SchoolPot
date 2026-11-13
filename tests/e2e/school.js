import { privacySections } from '../../src/config/privacy.js';
export const schoolSetup = {
  school_year: 2026,
  counts: [2, 3, 1],
  revision: 1,
  policy: {
    sections: privacySections,
    version: 1,
    controller: '테스트 운영자',
    contact_url: 'https://example.invalid/contact',
    overseas_notice:
      '테스트 fixture입니다. 실제 운영 개인정보 고지로 사용하지 않습니다. 처리 업체·국가·항목·시점·방법·목적·보유기간·거부권을 검증용으로 표시합니다.',
    is_ready: true,
    updated_at: new Date().toISOString(),
  },
};
export const enrolled = {
  membership: { school_year: 2026, grade: 1, class_number: 1, policy_version: 1, revision: 1 },
  enrollment_current: true,
};
export async function agreeSignup(page, grade = '1', classroom = '1') {
  await page.getByLabel('학년', { exact: true }).selectOption(grade);
  await page.getByLabel('반', { exact: true }).selectOption(classroom);
}
