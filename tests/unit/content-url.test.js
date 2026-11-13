import { it, expect } from 'vitest';
import { contentUrl } from '../../src/lib/rich-text.js';
const base = 'https://school.example/SchoolPot/';
it('images require HTTPS and reject executable/embedded or credentialed URLs', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:image/svg+xml,<svg/>',
    'blob:https://example/1',
    'file:///image.png',
    'http://example/image.png',
    'https://user:password@example/image.png',
    'java\nscript:alert(1)',
  ])
    expect(contentUrl(url, true, base)).toBe(null);
  expect(contentUrl('../image.png', true, base)).toBe('https://school.example/image.png');
  expect(contentUrl('https://images.example/image.png', true, base)).toBe(
    'https://images.example/image.png',
  );
});
it('links reject executable protocols and preserve valid destinations', () => {
  expect(contentUrl('javascript:alert(1)', false, base)).toBe(null);
  expect(contentUrl('mailto:help@example.test', false, base)).toBe('mailto:help@example.test');
  expect(contentUrl('#/boards', false, base)).toBe(base + '#/boards');
});
