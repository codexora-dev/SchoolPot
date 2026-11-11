import { defineConfig, loadEnv } from 'vite';
import { safePublicKey } from './src/lib/validation.js';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (
    (env.VITE_SUPABASE_PUBLISHABLE_KEY && !safePublicKey(env.VITE_SUPABASE_PUBLISHABLE_KEY)) ||
    Object.entries(env).some(
      ([name, value]) => value && /SECRET|SERVICE_ROLE|PRIVATE_KEY/i.test(name),
    )
  ) {
    throw new Error('브라우저 환경변수에 비밀키를 넣을 수 없습니다. publishable key를 사용하세요.');
  }
  return {
    base: env.VITE_BASE_PATH || './',
    plugins: [
      {
        name: 'production-csp',
        apply: 'build',
        transformIndexHtml() {
          return [
            {
              tag: 'meta',
              attrs: {
                'http-equiv': 'Content-Security-Policy',
                content:
                  "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://hlglstdtgcodblynicmh.supabase.co wss://hlglstdtgcodblynicmh.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'",
              },
              injectTo: 'head-prepend',
            },
          ];
        },
      },
    ],
    server: { host: '127.0.0.1' },
    build: { target: 'es2022' },
    test: { include: ['tests/unit/**/*.test.js'] },
  };
});
