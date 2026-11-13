import { el, field, button, toast } from '../lib/dom.js';
export function selectField(label, name, choices, selected = '') {
  return el(
    'label',
    { class: 'field' },
    el('span', {}, label),
    el(
      'select',
      { name },
      ...Object.entries(choices).map(([value, text]) =>
        el('option', { value, selected: value === String(selected) }, text),
      ),
    ),
  );
}
// Reviewable confirmation shared by all privileged changes. Server validates again.
export function operationDialog(title, controls, execute, done, submitLabel = '확인하고 저장') {
  const status = el('p', { role: 'status', class: 'form-status' });
  let dialog;
  const form = el(
    'form',
    {
      class: 'form-stack',
      onSubmit: async (event) => {
        try {
          await execute(Object.fromEntries(new FormData(event.target)));
          dialog.close();
          toast('처리했어요.');
          await done?.();
        } catch (e) {
          status.textContent = e.message;
        }
      },
    },
    el('h2', {}, title),
    ...controls,
    status,
    el(
      'div',
      { class: 'actions' },
      button('취소', () => dialog.close()),
      el('button', { type: 'submit', class: 'button primary' }, submitLabel),
    ),
  );
  dialog = el('dialog', { 'aria-label': title }, form);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.addEventListener('cancel', (event) => {
    if (form.getAttribute('aria-busy') === 'true') event.preventDefault();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
export function reasonField(label = '처리 사유', name = 'reason', value = '') {
  const control = field(label, name, 'textarea', {
    required: true,
    minlength: 2,
    maxlength: name === 'rule' ? 300 : 2000,
    rows: 3,
  });
  control.querySelector('textarea').value = value;
  return control;
}
