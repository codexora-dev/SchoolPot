import webpush from 'npm:web-push@3.6.7';
import { createECDH, randomBytes } from 'node:crypto';
function assert(value: unknown) {
  if (!value) throw new Error('Assertion failed');
}
Deno.test('Deno에서 실제 Web Push 암호화 요청과 VAPID 서명을 생성한다 (외부 전송 없음)', () => {
  const receiver = createECDH('prime256v1');
  receiver.generateKeys();
  const vapid = webpush.generateVAPIDKeys();
  const payload = JSON.stringify({ tag: 'schoolpot-news' });
  const request = webpush.generateRequestDetails(
    {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-only',
      keys: {
        p256dh: receiver.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    },
    payload,
    {
      vapidDetails: {
        subject: 'https://example.invalid',
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
      TTL: 300,
      contentEncoding: 'aes128gcm',
    },
  );
  assert(request.method === 'POST');
  assert(request.headers['Content-Encoding'] === 'aes128gcm');
  assert(request.headers.Authorization.startsWith('vapid '));
  assert(request.body.length > payload.length);
  assert(!request.body.toString().includes('schoolpot-news'));
});
