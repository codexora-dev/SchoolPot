import { el, date } from '../lib/dom.js';
import { v2 } from '../services/v2.js';
export async function deliveryManager() {
  const data = await v2('delivery_stats');
  const states = {
    pending: '대기',
    sending: '전송 중',
    sent: '전송 완료',
    skipped: '설정·접근·묶음 처리로 생략',
    failed: '실패',
  };
  return el(
    'section',
    { class: 'panel form-stack' },
    el('h2', {}, '푸시 전송 현황'),
    el(
      'p',
      { class: 'hint' },
      '최근 30일의 완료 기록입니다. 발송 실패는 앱 내부 알림을 지우지 않습니다. 수신자·구독 주소·키·본문은 표시하지 않습니다.',
    ),
    ...Object.entries(data.counts).map(([key, count]) =>
      el('p', {}, `${states[key] || key}: ${count}건`),
    ),
    el('h3', {}, '최근 전송 결과'),
    data.recent.length
      ? data.recent.map((log) =>
          el(
            'p',
            { class: 'meta' },
            `${date(log.created_at)} · ${log.attempt}회 시도 · ${log.status_code === 0 ? '네트워크 오류' : `HTTP ${log.status_code}`}`,
          ),
        )
      : el('p', {}, '아직 전송 기록이 없어요.'),
  );
}
