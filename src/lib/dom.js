import { icon } from '../components/icons.js';
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'onSubmit' && tag === 'form' && typeof v === 'function') {
      let busy = false;
      node.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        busy = true;
        node.setAttribute('aria-busy', 'true');
        const controls = [...node.querySelectorAll('button[type=submit]')].map((button) => [
          button,
          button.disabled,
        ]);
        for (const [button] of controls) button.disabled = true;
        try {
          await v(event);
        } catch {
          const status = node.querySelector('[role=status]');
          if (status) status.textContent = '처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
          else toast('처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
        } finally {
          busy = false;
          node.setAttribute('aria-busy', 'false');
          for (const [button, disabled] of controls) button.disabled = disabled;
        }
      });
    } else if (k.startsWith('on') && typeof v === 'function')
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected') node[k] = Boolean(v);
    else node.setAttribute(k, String(v));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false)
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
export const link = (text, href, cls = '') => el('a', { href, class: cls }, text);
export const button = (text, action, cls = 'button secondary') =>
  el('button', { type: 'button', class: cls, onClick: action }, text);
let toastTimer;
export function toast(message) {
  const node = document.querySelector('#toast');
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('visible'), 5000);
}
let fieldSequence = 0;
export function field(label, name, type = 'text', options = {}) {
  const id = options.id || `${name}-${++fieldSequence}`;
  const input = el(type === 'textarea' ? 'textarea' : 'input', {
    name,
    id,
    type: type === 'textarea' ? null : type,
    ...options,
  });
  let control = input;
  if (type === 'password') {
    const toggle = el(
      'button',
      {
        type: 'button',
        class: 'password-toggle',
        'aria-label': `${label} 표시`,
        'aria-pressed': 'false',
        'aria-controls': id,
        title: `${label} 표시`,
        onClick: () => {
          const visible = input.type === 'password';
          input.type = visible ? 'text' : 'password';
          toggle.replaceChildren(icon(visible ? 'eyeOff' : 'eye'));
          toggle.setAttribute('aria-label', `${label} ${visible ? '숨기기' : '표시'}`);
          toggle.setAttribute('aria-pressed', String(visible));
          toggle.title = `${label} ${visible ? '숨기기' : '표시'}`;
        },
      },
      icon('eye'),
    );
    control = el('div', { class: 'password-control' }, input, toggle);
  }
  return el('div', { class: 'field' }, el('label', { for: id }, label), control);
}
export function empty(title, description, action) {
  return el(
    'div',
    { class: 'empty' },
    el('div', { class: 'empty-icon', 'aria-hidden': 'true' }, '✧'),
    el('h3', {}, title),
    el('p', {}, description),
    action,
  );
}
export function errorBox(message, retry) {
  return el(
    'div',
    { class: 'error-box', role: 'alert' },
    el('strong', {}, '불러오지 못했어요'),
    el('p', {}, message),
    retry ? button('다시 시도', retry) : null,
  );
}
export function date(value) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}
export function localDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
