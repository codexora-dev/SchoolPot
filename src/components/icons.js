const paths = {
  home: ['m3 10 9-7 9 7', 'M5 9v12h5v-7h4v7h5V9'],
  trend: ['m3 17 6-6 4 4 8-10', 'M15 5h6v6'],
  chat: ['M21 11.5a8.5 8.5 0 0 1-8.5 8.5H5l-3 2 1.5-5A8.5 8.5 0 1 1 21 11.5Z', 'M7 10h8M7 14h5'],
  anonymous: ['M6 8h12l2 12H4L6 8Z', 'M8 8V6a4 4 0 0 1 8 0v2', 'M9 13h.01M15 13h.01'],
  question: [
    'M9.1 8a3 3 0 0 1 5.8 1c0 2-3 2-3 4',
    'M12 17h.01',
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  ],
  book: ['M12 5v16', 'M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v17h-5a4 4 0 0 0-4 1 4 4 0 0 0-4-1H3Z'],
  search: ['M21 21l-4.5-4.5', 'M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z'],
  club: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M13 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87',
    'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  ],
  poll: ['M4 3h16v18H4Z', 'M8 8h8M8 12h5M8 16h8'],
  meal: ['M4 3v7a3 3 0 0 0 6 0V3M7 3v18M20 3c-4 1-5 7-2 9h2M20 3v18'],
  calendar: [
    'M8 2v4M16 2v4M3 10h18',
    'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    'M7 14h.01M12 14h.01M17 14h.01M7 18h.01M12 18h.01',
  ],
  check: ['m5 12 4 4L19 6'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  user: ['M20 21a8 8 0 0 0-16 0', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  shield: ['M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Z', 'm8 12 3 3 5-6'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z'],
  sun: [
    'M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42',
    'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  ],
  chevron: ['m6 9 6 6 6-6'],
  close: ['m6 6 12 12M6 18 18 6'],
  plus: ['M12 5v14M5 12h14'],
  logout: ['M9 21H4V3h5M9 12h12m-4-4 4 4-4 4'],
  cap: ['m2 8 10-5 10 5-10 5-10-5Z', 'M6 10v7c4 3 8 3 12 0v-7M22 8v8'],
  heart: [
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  ],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
};
export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.7,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    class: 'icon',
  }))
    svg.setAttribute(key, String(value));
  for (const d of paths[name] || paths.chat) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
