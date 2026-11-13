import { el, field, button } from '../lib/dom.js';
import { contentBody } from './content-body.js';

export function contentEditor({
  label = '내용',
  body = '',
  format = 'text',
  maxLength = 20000,
  rows = 10,
} = {}) {
  const input = field(label, 'body', 'textarea', { required: true, maxlength: maxLength, rows });
  input.querySelector('textarea').value = body;
  const select = el(
    'select',
    { name: 'content_format', 'aria-label': '작성 형식' },
    ...[
      ['text', 'Text · 일반 텍스트'],
      ['markdown', 'Markdown'],
      ['html', 'HTML'],
    ].map(([value, title]) => el('option', { value, selected: value === format }, title)),
  );
  const help = el('p', { class: 'hint' });
  const helpText = () => {
    help.textContent =
      select.value === 'text'
        ? '입력한 문장을 줄바꿈 그대로 보여줍니다.'
        : '제목·굵게·목록·표·링크와 HTTPS 이미지 주소를 지원합니다. 실행 코드와 임의 스타일은 제외됩니다.';
  };
  select.addEventListener('change', helpText);
  helpText();
  const preview = () => {
    const dialog = el(
      'dialog',
      { 'aria-label': '본문 미리보기', class: 'content-preview' },
      el('h2', {}, '본문 미리보기'),
      contentBody(input.querySelector('textarea').value, select.value),
      button('닫기', () => dialog.close()),
    );
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  };
  return el(
    'div',
    { class: 'content-editor' },
    el('label', { class: 'field' }, el('span', {}, '작성 형식'), select),
    help,
    input,
    button('본문 미리보기', preview, 'button secondary'),
  );
}
