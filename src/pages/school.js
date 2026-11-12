import { el, field, button, link, empty, date, toast, localDate } from '../lib/dom.js';
import { pageTitle } from '../components/layout.js';
import { call } from '../services/community.js';
import { edge } from '../services/api.js';
import { reportDialog } from './community.js';
export async function notificationsPage(reload) {
  const items = await call('notifications');
  return el(
    'section',
    {},
    pageTitle(
      'STAY CONNECTED',
      '내 알림',
      '나에게 도착한 새로운 소식',
      button('모두 읽음', async () => {
        try {
          await call('read_notifications');
          await reload();
        } catch (err) {
          toast(err.message);
        }
      }),
    ),
    el(
      'div',
      { class: 'panel notification-list' },
      items.length
        ? items.map((n) =>
            el(
              'article',
              { class: `notification ${n.read_at ? 'read' : ''}` },
              el('span', { class: 'notification-dot' }),
              el(
                'div',
                {},
                n.feedback_id
                  ? link(n.message, '#/feedback')
                  : n.post_id
                    ? link(n.message, `#/post/${n.post_id}`)
                    : link(n.message, '#/notices'),
                el('small', { class: 'meta' }, date(n.created_at)),
              ),
              !n.read_at
                ? button(
                    '읽음',
                    async () => {
                      try {
                        await call('read_notifications', { id: n.id });
                        await reload();
                      } catch (err) {
                        toast(err.message);
                      }
                    },
                    'text-button',
                  )
                : null,
            ),
          )
        : empty('아직 도착한 알림이 없어요', '새 댓글과 학교 소식을 여기서 확인할 수 있어요.'),
    ),
  );
}
export async function noticesPage(state, reload) {
  const notices = await call('notices');
  return el(
    'section',
    {},
    pageTitle('SCHOOL NEWS', '공지사항', '학교와 스쿨팟의 새로운 소식을 확인하세요.'),
    notices.length
      ? notices.map((n) =>
          el(
            'article',
            { class: 'panel notice' },
            el('span', { class: 'board-chip' }, '공지'),
            el('h2', {}, n.title),
            el('small', { class: 'meta' }, date(n.created_at)),
            el('p', { class: 'preserve' }, n.body),
            state.me?.is_admin
              ? button(
                  '공지 삭제',
                  async () => {
                    try {
                      await call('admin_delete', { kind: 'notice', id: n.id });
                      await reload();
                    } catch (err) {
                      toast(err.message);
                    }
                  },
                  'text-button',
                )
              : null,
          ),
        )
      : el(
          'div',
          { class: 'panel' },
          empty('등록된 공지가 없어요', '새로운 소식이 올라오면 알려드릴게요.'),
        ),
  );
}
export async function neisPage(kind, params) {
  const day = params.get('day') || localDate();
  const title = kind === 'meals' ? '오늘의 급식' : '학사일정';
  const results = el('div', { class: 'panel' });
  const form = el(
    'form',
    {
      class: 'filters',
      onSubmit: (e) => {
        e.preventDefault();
        location.hash = `/${kind}?day=${new FormData(e.target).get('day')}`;
      },
    },
    field('날짜', 'day', 'date', { value: day, required: true }),
    el('button', { type: 'submit', class: 'button primary' }, '조회'),
  );
  try {
    const data = await edge('neis', { kind, day });
    const rows = data.items || [];
    results.replaceChildren(
      rows.length
        ? el(
            'div',
            { class: 'school-items' },
            ...rows.map((row) =>
              el(
                'article',
                { class: 'school-item' },
                el('span', { class: 'board-chip' }, row.label),
                el('h2', {}, row.title),
                el('p', { class: 'preserve' }, row.description),
                row.calories ? el('small', { class: 'muted' }, row.calories) : null,
              ),
            ),
          )
        : empty('해당 날짜의 정보가 없어요', '주말, 공휴일 또는 정보 미등록일일 수 있어요.'),
    );
  } catch (err) {
    results.replaceChildren(
      empty(
        '학교 정보 연결이 필요해요',
        `${err.message} NEIS 학교 코드·교육청 코드와 서버 API 키 설정 후 조회할 수 있어요.`,
      ),
    );
  }
  return el(
    'section',
    {},
    pageTitle(
      'SCHOOL LIFE',
      title,
      kind === 'meals'
        ? '오늘은 어떤 맛있는 하루가 기다릴까요?'
        : '학교의 중요한 날을 놓치지 마세요.',
    ),
    form,
    results,
    el(
      'p',
      { class: 'hint' },
      '정보 출처: NEIS 교육정보 개방 포털 · 급식의 숫자는 알레르기 유발 식품 표시입니다. 최종 안내는 학교 공지를 확인해 주세요.',
    ),
  );
}
export async function assessmentsPage(params, state, reload) {
  const membership = state.me?.membership;
  if (!membership || state.me?.enrollment_current !== true)
    return empty(
      '소속을 등록해 주세요',
      '본인 학년·반의 일정만 확인할 수 있어요.',
      link('소속·동의 등록', '#/enrollment', 'button primary'),
    );
  const items = await call('assessments');
  const unassigned = await call('assessments_unassigned');
  const openEditor = (item = {}) => {
    const dialog = el(
      'dialog',
      {},
      el(
        'form',
        {
          class: 'form-stack',
          onSubmit: async (e) => {
            e.preventDefault();
            try {
              await call('save_assessment', {
                ...Object.fromEntries(new FormData(e.target)),
                id: item.id || null,
              });
              dialog.close();
              await reload();
            } catch (err) {
              toast(err.message);
            }
          },
        },
        el('h2', {}, item.id ? '수행평가 수정' : '수행평가 등록'),
        field('제목', 'title', 'text', {
          required: true,
          minlength: 2,
          maxlength: 120,
          value: item.title || '',
        }),
        field('과목', 'subject', 'text', {
          required: true,
          maxlength: 40,
          value: item.subject || '',
        }),
        el(
          'p',
          { class: 'hint' },
          `${membership.school_year}학년도 ${membership.grade}학년 ${membership.class_number}반에만 공유합니다.`,
        ),
        field('날짜', 'due_date', 'date', { required: true, value: item.due_date || localDate() }),
        field('메모', 'body', 'textarea', { maxlength: 2000, rows: 3 }),
        el(
          'div',
          { class: 'actions' },
          button('취소', () => dialog.close()),
          el('button', { class: 'button primary', type: 'submit' }, '저장'),
        ),
      ),
    );
    dialog.querySelector('textarea').value = item.body || '';
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  };
  const grouped = Object.groupBy(items, (i) => i.due_date);

  const calendar = el('div', { class: 'calendar' });
  for (const [day, list] of Object.entries(grouped)) {
    const cards = el('div', { class: 'assessment-list' });
    for (const a of list) {
      cards.append(
        el(
          'article',
          { class: 'panel assessment' },
          el('span', { class: 'board-chip' }, `${a.grade}학년 ${a.class_number}반 · ${a.subject}`),
          el('h3', {}, a.title),
          el('p', { class: 'preserve muted' }, a.body),
          el(
            'div',
            { class: 'actions' },
            a.is_mine ? button('수정', () => openEditor(a), 'text-button') : null,
            a.is_mine
              ? button(
                  '삭제',
                  async () => {
                    try {
                      await call('delete_assessment', { id: a.id });
                      await reload();
                    } catch (err) {
                      toast(err.message);
                    }
                  },
                  'text-button',
                )
              : null,
            button('수정 요청', () => reportDialog('assessment', a.id), 'text-button'),
          ),
        ),
      );
    }
    calendar.append(
      el(
        'section',
        { class: 'calendar-day' },
        el(
          'div',
          { class: 'calendar-date' },
          el('strong', {}, day.slice(8)),
          el('span', {}, day.slice(0, 7)),
        ),
        cards,
      ),
    );
  }
  return el(
    'section',
    {},
    pageTitle(
      'STUDY PLANNER',
      '수행평가 캘린더',
      `${membership.school_year}학년도 ${membership.grade}학년 ${membership.class_number}반의 일정만 표시합니다.`,
      button('＋ 일정 등록', () => openEditor(), 'button primary'),
    ),
    el(
      'p',
      { class: 'hint' },
      '학생이 공유한 일정입니다. 최근 30일부터 앞으로 90일까지 표시하며, 정확한 내용은 과목 선생님께 확인해 주세요.',
    ),
    items.length
      ? calendar
      : el(
          'div',
          { class: 'panel' },
          empty(
            '다가오는 수행평가가 없어요',
            '알고 있는 일정을 친구들과 공유해 주세요.',
            button('일정 등록', () => openEditor(), 'button primary'),
          ),
        ),
    unassigned.length
      ? el(
          'section',
          { class: 'panel' },
          el('h2', {}, '내 이전 일정 이관'),
          el(
            'p',
            { class: 'hint' },
            '반 구분 도입 전에 본인이 작성한 일정입니다. 다른 반에는 공개하지 않습니다. 내용을 확인한 뒤 본인 반으로 이관하거나 삭제할 수 있어요.',
          ),
          ...unassigned.map((a) =>
            el(
              'article',
              { class: 'audit-row' },
              el('div', {}, el('strong', {}, a.title), el('p', { class: 'preserve' }, a.body)),
              button('내 반으로 이관', () => openEditor(a), 'button secondary'),
              button(
                '이전 일정 삭제',
                async () => {
                  try {
                    await call('delete_assessment', { id: a.id });
                    await reload();
                  } catch (err) {
                    toast(err.message);
                  }
                },
                'button danger',
              ),
            ),
          ),
        )
      : null,
  );
}
