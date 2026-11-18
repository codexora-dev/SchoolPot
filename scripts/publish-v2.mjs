// Default: display the exact publication draft without any network request or write.
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { safePublicKey } from '../src/lib/validation.js';
const draft = JSON.parse(
  await readFile(new URL('../docs/releases/v2-publication.json', import.meta.url), 'utf8'),
);
if (!process.argv.includes('--publish')) {
  console.log(JSON.stringify(draft, null, 2));
} else {
  const expected = process.env.RELEASE_EXPECTED_BUILD;
  const token = process.env.RELEASE_ACCESS_TOKEN;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = process.env.VITE_SUPABASE_URL;
  if (
    !expected ||
    expected === 'local' ||
    !token ||
    !key ||
    !safePublicKey(key) ||
    url !== 'https://hlglstdtgcodblynicmh.supabase.co'
  )
    throw new Error('검증된 배포 빌드·실제 owner 세션·프로젝트 공개 연결 설정이 필요합니다.');
  const deployment = new URL('https://codexora-dev.github.io/SchoolPot/');
  deployment.searchParams.set('build', expected);
  const response = await fetch(deployment, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const html = await response.text();
  if (
    !response.ok ||
    !html.includes(`name="schoolpot-build" content="${expected}"`) ||
    !html.includes('name="schoolpot-version" content="2.0.0"')
  )
    throw new Error('실제 V2 배포 완료를 확인하지 못했습니다. 게시하지 않습니다.');
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const user = await client.auth.getUser(token);
  if (user.error || !user.data.user) throw new Error('유효한 게시자 세션이 필요합니다.');
  const rpc = async (name, action, payload = {}) => {
    const result = await client.rpc(name, { p_action: action, p_payload: payload });
    if (result.error) throw new Error(`게시 API 실패: ${name} / ${result.error.code}`);
    return result.data;
  };
  const me = await rpc('community', 'me');
  if (me.role !== 'owner' || me.restricted) throw new Error('현재 owner 권한이 필요합니다.');
  const roles = await rpc('governance', 'roles');
  if (
    JSON.stringify(roles.map((item) => `${item.username}=${item.role}`).sort()) !==
    JSON.stringify(['kminjae803=owner', 'yoonjihoo_0221=moderator'])
  )
    throw new Error('원격 관리자 구성이 달라졌습니다. 게시를 중단합니다.');
  await rpc('schoolpot_v2', 'unread');
  const notices = await rpc('manage_notices', 'list', { query: draft.notice.title });
  const popups = await rpc('manage_popups', 'list');
  const matchingNotices = notices.filter((item) => item.title === draft.notice.title);
  const matchingPopups = popups.filter((item) => item.title === draft.popup.title);
  if (matchingNotices.length > 1 || matchingPopups.length > 1)
    throw new Error('동일 제목의 기존 안내가 여러 개입니다. 관리자에서 확인해야 합니다.');
  if (!matchingPopups.length && popups.filter((item) => item.is_active).length >= 3)
    throw new Error('게시 중인 팝업이 3개입니다. 기존 팝업을 임의로 중지하지 않습니다.');
  const notice = matchingNotices[0] || (await rpc('manage_notices', 'save', draft.notice));
  console.log(`공지 확인: ${notice.id}`);
  const popup =
    matchingPopups[0] ||
    (await rpc('manage_popups', 'save', {
      ...draft.popup,
      body: draft.popup.body.replace('#/notices', `#/notice/${notice.id}`),
    }));
  console.log(`팝업 확인: ${popup.id}`);
  console.log(
    '기존 안내를 덮어쓰거나 알림을 재발송하지 않았습니다. 재실행해도 기존 동일 제목 안내를 보존합니다.',
  );
}
