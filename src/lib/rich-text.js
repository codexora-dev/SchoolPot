import MarkdownIt from 'markdown-it';
import { parseFragment } from 'parse5';
import { el } from './dom.js';

const markdown = new MarkdownIt({ html: true, breaks: true, linkify: false });
const allowed = new Set(
  'p br hr h1 h2 h3 h4 h5 h6 strong b em i u s del mark sub sup blockquote ol ul li pre code table thead tbody tfoot tr th td a img div span figure figcaption'.split(
    ' ',
  ),
);
const dropped = new Set(
  'script style iframe object embed template form input button textarea select option link meta base head title noscript svg math audio video source'.split(
    ' ',
  ),
);

export function contentUrl(value, image = false, base = location.href) {
  if (!value || [...value].some((char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127))
    return null;
  try {
    const url = new URL(value.trim(), base);
    if (url.username || url.password) return null;
    if (!(image ? ['https:'] : ['https:', 'http:', 'mailto:']).includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

// Parse into an inert JS tree; copy only known tags/attributes into fresh DOM nodes.
// Source HTML is never assigned to a browser HTML injection sink.
export function richText(body, format) {
  const source = String(body || '').slice(0, 20000);
  const tree = parseFragment(format === 'markdown' ? markdown.render(source) : source, {
    scriptingEnabled: false,
  });
  let count = 0;
  function render(node, depth = 0) {
    if (++count > 5000 || depth > 40) return null;
    if (node.nodeName === '#text') return document.createTextNode(node.value);
    const tag = node.tagName;
    if (!tag || dropped.has(tag) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml')
      return null;
    const attrs = Object.fromEntries((node.attrs || []).map((a) => [a.name, a.value]));
    const children = () => (node.childNodes || []).map((n) => render(n, depth + 1));
    if (!allowed.has(tag)) return el('span', {}, ...children());
    if (tag === 'img') {
      const src = contentUrl(attrs.src, true);
      const alt = attrs.alt?.slice(0, 500) || '안내 이미지';
      if (!src) return el('span', { class: 'image-fallback' }, alt);
      const img = el('img', {
        src,
        alt,
        loading: 'lazy',
        decoding: 'async',
        referrerpolicy: 'no-referrer',
      });
      for (const dimension of ['width', 'height']) {
        if (
          /^\d{1,4}$/.test(attrs[dimension] || '') &&
          +attrs[dimension] > 0 &&
          +attrs[dimension] <= 2000
        )
          img.setAttribute(dimension, attrs[dimension]);
      }
      img.addEventListener(
        'error',
        () =>
          img.replaceWith(
            el('span', { class: 'image-fallback' }, `${alt} · 이미지를 불러오지 못했어요.`),
          ),
        { once: true },
      );
      return img;
    }
    if (tag === 'a') {
      const href = contentUrl(attrs.href);
      return el(
        href ? 'a' : 'span',
        href
          ? {
              href,
              target: '_blank',
              rel: 'noopener noreferrer nofollow',
              referrerpolicy: 'no-referrer',
            }
          : {},
        ...children(),
      );
    }
    const safe = {};
    if (['th', 'td'].includes(tag))
      for (const span of ['colspan', 'rowspan'])
        if (/^[1-9]$/.test(attrs[span] || '')) safe[span] = attrs[span];
    if (tag === 'ol' && /^\d{1,4}$/.test(attrs.start || '')) safe.start = attrs.start;
    return el(tag, safe, ...children());
  }
  return el('div', {}, ...(tree.childNodes || []).map((n) => render(n)));
}
