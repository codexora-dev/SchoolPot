import { el, field, button, date } from '../lib/dom.js';
import { rpc } from '../services/api.js';
import { operationDialog, reasonField } from '../components/operation-dialog.js';
import { contentBody } from '../components/content-body.js';
const config = (action, payload = {}) =>
  rpc('service_configuration', { p_action: action, p_payload: payload });
export async function configurationManager(tab, reload) {
  if (tab === 'settings') {
    const settings = await config('public');
    return el(
      'section',
      {},
      el('h2', {}, '서비스 기본 정보'),
      el(
        'div',
        { class: 'panel form-stack' },
        el('h3', {}, settings.title),
        el('p', {}, settings.school_name),
        el('p', {}, settings.description),
        el(
          'p',
          { class: 'hint' },
          '표시 이름만 변경합니다. 급식·학사일정의 NEIS 연결 학교는 검증된 학교 설정 파일을 따릅니다.',
        ),
        button('기본 정보 수정', () =>
          operationDialog(
            '서비스 정보 수정',
            [
              field('서비스 이름', 'title', 'text', {
                required: true,
                maxlength: 40,
                value: settings.title,
              }),
              field('학교 표시 이름', 'school_name', 'text', {
                required: true,
                maxlength: 80,
                value: settings.school_name,
              }),
              field('서비스 소개', 'description', 'text', {
                maxlength: 300,
                value: settings.description,
              }),
              reasonField(),
            ],
            (data) => config('save', { ...data, revision: settings.revision }),
            reload,
          ),
        ),
      ),
    );
  }
  const [rules, history] = await Promise.all([config('rules'), config('history')]);
  const summary = field('요약본 (Markdown)', 'summary', 'textarea', {
    required: true,
    maxlength: 20000,
    rows: 12,
  });
  const full = field('전문 (Markdown)', 'full_text', 'textarea', {
    required: true,
    maxlength: 20000,
    rows: 16,
  });
  summary.querySelector('textarea').value = rules.summary;
  full.querySelector('textarea').value = rules.full_text;
  return el(
    'section',
    {},
    el('h2', {}, '이용 규정 관리'),
    el(
      'p',
      { class: 'hint' },
      '요약본과 전문을 함께 검토하여 새 버전으로 게시합니다. 최초 제공 원문과 이전 버전은 보존합니다.',
    ),
    el('p', {}, `현재 버전 ${rules.version}`),
    button('규정 편집·게시', () => {
      operationDialog(
        '이용 규정 게시 확인',
        [
          summary,
          full,
          button('안전한 미리보기', () => {
            const preview = el(
              'dialog',
              { 'aria-label': '규정 미리보기' },
              el('h2', {}, '규정 미리보기'),
              el('h3', {}, '요약본'),
              contentBody(summary.querySelector('textarea').value, 'markdown'),
              el('h3', {}, '전문'),
              contentBody(full.querySelector('textarea').value, 'markdown'),
              button('닫기', () => preview.close()),
            );
            preview.addEventListener('close', () => preview.remove(), { once: true });
            document.body.append(preview);
            preview.showModal();
          }),
          reasonField('변경 사유'),
          field('게시하려면 “규정 게시” 입력', 'confirmation', 'text', {
            required: true,
            autocomplete: 'off',
          }),
        ],
        (data) => config('publish_rules', { ...data, version: rules.version }),
        reload,
        '새 규정 게시',
      );
    }),
    el('h3', {}, '변경 이력'),
    ...history.map((h) =>
      el(
        'article',
        { class: 'panel' },
        el('strong', {}, `버전 ${h.version}`),
        el('p', {}, h.reason),
        el('small', {}, date(h.created_at)),
      ),
    ),
  );
}
