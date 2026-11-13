import { el, field, button, link, toast, empty, date } from '../lib/dom.js';
import { pageTitle } from '../components/layout.js';
import { call } from '../services/community.js';
import { boardManager } from './admin-boards.js';
import { feedbackManager } from './feedback.js';
import { popupManager } from './admin-popups.js';
import { classManager, privacyManager } from './admin-classes.js';
import { contentEditor } from '../components/content-editor.js';
export async function adminPage(params, reload) {
  const tab = params.get('tab') || 'overview';
  const main = el('div');
  if (tab === 'classes') main.append(await classManager(params, reload));
  if (tab === 'privacy') main.append(await privacyManager(reload));
  if (tab === 'boards') main.append(await boardManager(reload));
  if (tab === 'feedback') main.append(await feedbackManager(params, reload));
  if (tab === 'popups') main.append(await popupManager(reload));
  const action = async (name, data) => {
    try {
      await call(name, data);
      toast('처리했어요.');
      await reload();
    } catch (err) {
      toast(err.message);
    }
  };
  if (tab === 'overview') {
    const stats = await call('admin_stats');
    main.append(
      el(
        'div',
        { class: 'stats-grid' },
        ...Object.entries({
          members: '회원',
          posts: '게시글',
          comments: '댓글',
          reports: '미처리 신고',
          feedback: '미처리 문의',
        }).map(([key, label]) =>
          el(
            'div',
            { class: 'panel stat' },
            el('span', { class: 'muted' }, label),
            el('strong', {}, stats[key]),
          ),
        ),
      ),
    );
  }
  if (tab === 'members') {
    const q = params.get('q') || '';
    const members = await call('admin_members', { query: q });
    main.append(
      el(
        'form',
        {
          class: 'filters',
          onSubmit: (e) => {
            e.preventDefault();
            location.hash = `/admin?tab=members&q=${encodeURIComponent(new FormData(e.target).get('q'))}`;
          },
        },
        el('input', {
          name: 'q',
          placeholder: '닉네임 검색',
          value: q,
          'aria-label': '닉네임 검색',
        }),
        el('button', { class: 'button secondary' }, '검색'),
      ),
      el(
        'div',
        { class: 'panel member-list' },
        ...members.map((m) =>
          el(
            'article',
            { class: 'member-row' },
            el(
              'div',
              {},
              el('strong', {}, m.nickname),
              el('p', { class: 'meta' }, `${m.grade || '미설정'}학년 · ${date(m.created_at)}`),
            ),
            el(
              'div',
              { class: 'actions' },
              el(
                'span',
                { class: 'meta' },
                m.suspended_until && new Date(m.suspended_until) > new Date()
                  ? '이용 제한 중'
                  : '이용 중',
              ),
              button(
                '7일 제한',
                () => action('admin_suspend', { id: m.id, suspend: true }),
                'button danger small',
              ),
              button(
                '제한 해제',
                () => action('admin_suspend', { id: m.id, suspend: false }),
                'button secondary small',
              ),
            ),
          ),
        ),
      ),
    );
  }
  if (tab === 'reports') {
    const reports = await call('admin_reports');
    const list = [
      ...reports.content.map((r) => ({ ...r, kind: 'content' })),
      ...reports.assessments.map((r) => ({ ...r, kind: 'assessment' })),
    ];
    main.append(
      el(
        'div',
        { class: 'report-list' },
        list.length
          ? list.map((r) =>
              el(
                'article',
                { class: 'panel' },
                el('span', { class: 'board-chip' }, r.status),
                el('p', { class: 'preserve' }, r.reason),
                el('small', { class: 'meta' }, date(r.created_at)),
                r.context_post_id ? link('게시글 확인', `#/post/${r.context_post_id}`) : null,
                r.comment_id ? el('p', { class: 'meta' }, `댓글 ID: ${r.comment_id}`) : null,
                r.assessment_id ? link('수행평가 확인', '#/assessments') : null,
                el(
                  'div',
                  { class: 'actions' },
                  button('처리 완료', () =>
                    action('admin_resolve', { id: r.id, kind: r.kind, status: 'resolved' }),
                  ),
                  button('기각', () =>
                    action('admin_resolve', { id: r.id, kind: r.kind, status: 'dismissed' }),
                  ),
                  r.subject_user_id
                    ? button(
                        '작성자 7일 제한',
                        () => action('admin_suspend', { id: r.subject_user_id, suspend: true }),
                        'button danger small',
                      )
                    : null,
                  r.comment_id
                    ? button(
                        '신고 댓글 삭제',
                        () => action('admin_delete', { id: r.comment_id, kind: 'comment' }),
                        'button danger small',
                      )
                    : null,
                ),
              ),
            )
          : empty('처리할 신고가 없어요', '새 신고와 일정 수정 요청을 여기서 확인합니다.'),
      ),
    );
  }
  if (tab === 'notice') {
    main.append(
      el(
        'form',
        {
          class: 'panel form-stack',
          onSubmit: async (e) => {
            e.preventDefault();
            await action('admin_notice', Object.fromEntries(new FormData(e.target)));
          },
        },
        el('h2', {}, '공지사항 등록'),
        field('제목', 'title', 'text', { required: true, minlength: 2, maxlength: 120 }),
        contentEditor(),
        el('button', { class: 'button primary', type: 'submit' }, '등록하고 알림 보내기'),
      ),
    );
  }
  if (tab === 'audit') {
    const logs = await call('admin_audit');
    main.append(
      el(
        'div',
        { class: 'panel' },
        logs.length
          ? logs.map((a) =>
              el(
                'div',
                { class: 'audit-row' },
                el('strong', {}, a.action),
                el(
                  'span',
                  { class: 'meta' },
                  `${date(a.created_at)} · ${a.target_id || '대상 없음'}`,
                ),
              ),
            )
          : empty('작업 기록이 없어요', '관리자 작업은 자동으로 기록됩니다.'),
      ),
    );
  }
  return el(
    'section',
    {},
    pageTitle(
      'ADMINISTRATION',
      '관리자 대시보드',
      '학교 공간을 관리하고 접수된 문의를 확인하세요.',
    ),
    el(
      'div',
      { class: 'tabs' },
      ...Object.entries({
        overview: '현황',
        classes: '학급·소속 관리',
        privacy: '개인정보 설정',
        boards: '게시판 관리',
        feedback: '건의·오류 관리',
        members: '회원 관리',
        reports: '신고 관리',
        notice: '공지 등록',
        popups: '팝업 관리',
        audit: '작업 기록',
      }).map(([k, v]) => link(v, `#/admin?tab=${k}`, `tab ${tab === k ? 'selected' : ''}`)),
    ),
    main,
  );
}
