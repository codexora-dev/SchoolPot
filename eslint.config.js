import js from '@eslint/js';
export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'supabase/functions/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: Object.fromEntries(
        [
          'window',
          'document',
          'location',
          'localStorage',
          'sessionStorage',
          'navigator',
          'URL',
          'URLSearchParams',
          'FormData',
          'HTMLElement',
          'Node',
          'crypto',
          'atob',
          'btoa',
          'setTimeout',
          'clearTimeout',
          'console',
          'process',
        ].map((x) => [x, 'readonly']),
      ),
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true }],
    },
  },
];
