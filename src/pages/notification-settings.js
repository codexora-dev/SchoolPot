import { el, field, button, toast, link } from '../lib/dom.js';
import { pageTitle } from '../components/layout.js';
import { v2 } from '../services/v2.js';
import { pushSupported, enablePush, disablePush } from '../services/push.js';
export async function notificationSettingsPage(reload) {
  const [pref, devices] = await Promise.all([v2('preferences'), v2('push_devices')]);
  const status = el('p', { role: 'status' });
  const checks = {
    push_enabled: '푸시 알림 전체 활성화',
    comment_enabled: '내 게시글 댓글',
    reply_enabled: '내 댓글 답글',
    mention_enabled: '멘션',
    notice_enabled: '공지사항',
    subscription_enabled: '구독 게시글 댓글',
    report_enabled: '신고 처리 결과',
    quiet_hours_enabled: '방해 금지 시간 사용',
    mention_discoverable: '닉네임으로 멘션 검색 허용',
  };
  const act = async (action) => {
    try {
      await action();
      await reload();
    } catch (error) {
      toast(error.message);
    }
  };
  const form = el(
    'form',
    {
      class: 'panel form-stack',
      onSubmit: async () => {
        const data = Object.fromEntries(new FormData(form));
        try {
          await v2('save_preferences', {
            ...data,
            revision: pref.revision,
            ...Object.fromEntries(
              Object.keys(checks).map((key) => [key, form.querySelector(`[name=${key}]`).checked]),
            ),
          });
          toast('계정 설정을 저장했어요. 다른 기기에도 적용됩니다.');
          await reload();
        } catch (error) {
          status.textContent = error.message;
        }
      },
    },
    el('h2', {}, '계정 알림 설정'),
    ...Object.entries(checks).map(([key, label]) =>
      el(
        'label',
        { class: 'checkbox' },
        el('input', { type: 'checkbox', name: key, checked: pref[key] }),
        label,
      ),
    ),
    el(
      'p',
      { class: 'hint' },
      '멘션 검색은 기본 꺼짐입니다. 허용하면 닉네임과 공개 프로필을 검색할 수 있어요. 익명 작성 내역은 프로필에 표시하지 않습니다. 계정 운영 통지는 앱 내부에 반드시 기록됩니다.',
    ),
    field('방해 금지 시작', 'quiet_hours_start', 'time', {
      value: pref.quiet_hours_start.slice(0, 5),
      required: true,
    }),
    field('방해 금지 종료', 'quiet_hours_end', 'time', {
      value: pref.quiet_hours_end.slice(0, 5),
      required: true,
    }),
    field('시간대', 'timezone', 'text', { value: pref.timezone, required: true, maxlength: 80 }),
    el('button', { type: 'submit', class: 'button primary' }, '설정 저장'),
    status,
  );
  return el(
    'section',
    {},
    pageTitle('YOUR PREFERENCES', '알림 설정', '계정 설정은 함께, 푸시 권한은 기기마다'),
    form,
    el(
      'section',
      { class: 'panel form-stack' },
      el('h2', {}, '이 기기의 푸시 알림'),
      el(
        'p',
        {},
        pushSupported()
          ? `브라우저 권한: ${{ granted: '허용', denied: '차단', default: '아직 선택하지 않음' }[window.Notification.permission]}`
          : '현재 환경은 푸시를 지원하지 않아요. iOS에서는 홈 화면에 설치 후 확인해 주세요.',
      ),
      el(
        'p',
        { class: 'hint' },
        '푸시 활성화 설정을 저장하고 이 기기 알림을 연결하세요. 알림 내용은 잠금 화면에 표시하지 않습니다. 로그아웃하면 이 기기 연결이 해제됩니다.',
      ),
      button('이 기기 알림 연결', () => act(enablePush), 'button primary'),
      button('이 기기 알림 해제', () => act(disablePush)),
      link('앱 설치 방법', '#/app-install', 'text-button'),
    ),
    el(
      'section',
      { class: 'panel form-stack' },
      el('h2', {}, '연결된 기기'),
      devices.length
        ? devices.map((device) =>
            el(
              'div',
              { class: 'actions' },
              el(
                'span',
                {},
                `${device.device_name}${device.current_session ? ' · 현재 세션' : ''}${device.disabled_at ? ' · 만료됨' : ''}`,
              ),
              button('연결 삭제', () => act(() => v2('push_delete', { id: device.id }))),
            ),
          )
        : el('p', {}, '연결된 기기가 없어요.'),
    ),
  );
}
