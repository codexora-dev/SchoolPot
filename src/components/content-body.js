import { el, button } from '../lib/dom.js';

export function contentBody(body, format = 'text', className = '') {
  const node = el('div', { class: `content-body ${className}` });
  if (!['markdown', 'html'].includes(format)) {
    node.classList.add('content-plain');
    node.textContent = body || '';
    return node;
  }
  const load = async () => {
    node.setAttribute('aria-busy', 'true');
    node.replaceChildren(el('p', { class: 'hint', role: 'status' }, '내용을 불러오는 중…'));
    try {
      const { richText } = await import('../lib/rich-text.js');
      node.replaceChildren(richText(body, format));
    } catch {
      node.replaceChildren(
        el('p', { role: 'alert' }, '서식 내용을 불러오지 못했어요. 연결을 확인해 주세요.'),
        button('새로 불러오기', () => location.reload()),
      );
    } finally {
      node.removeAttribute('aria-busy');
    }
  };
  void load();
  return node;
}
