import { el, button, link, toast, empty, date } from '../lib/dom.js';
import { pageTitle } from '../components/layout.js';
import { call } from '../services/community.js';
import { boardManager } from './admin-boards.js';
import { feedbackManager } from './feedback.js';
import { popupManager } from './admin-popups.js';
import { classManager, privacyManager } from './admin-classes.js';
import { roleOf } from '../services/governance.js';
import {
  memberManager,
  requestManager,
  appealManager,
  sanctionHistory,
  securityPanel,
} from './admin-governance.js';
import { operationDialog, reasonField } from '../components/operation-dialog.js';
import { noticeManager } from './admin-notices.js';
export async function adminPage(params, reload, state = {}) {
  const owner = roleOf(state.me) === 'owner';
  const menus = owner
    ? {
        overview: '운영 현황',
        reports: '신고 관리',
        members: '회원·제재 관리',
        feedback: '건의·오류 관리',
        notice: '공지 관리',
        requests: '제재 요청 검토',
        appeals: '이의 제기',
        sanctions: '제재 기록',
        roles: '관리자 권한',
        assessments: '우리 반 수행평가',
        classes: '학급·소속 설정',
        privacy: '개인정보 설정',
        boards: '게시판 관리',
        popups: '팝업 관리',
        settings: '서비스 설정',
        rules: '이용 규정 관리',
        security: '보안 운영',
        audit: '감사 기록',
      }
    : {
        overview: '운영 현황',
        reports: '신고 관리',
        feedback: '건의·오류 관리',
        notice: '일반 공지 관리',
        request: '회원 제재 요청',
        requests: '내 요청 처리 현황',
        appeals: '이의 제기',
      };
  const tab = params.get('tab') || 'overview';
  if (!Object.hasOwn(menus, tab))
    return empty(
      '접근할 수 없는 관리 화면이에요',
      '현재 역할에 허용된 메뉴를 선택해 주세요.',
      link('운영 현황', '#/admin'),
    );
  const main = el('div', { class: 'admin-content' });
  if (tab === 'roles' || tab === 'members' || tab === 'request')
    main.append(
      await memberManager(params, reload, {
        owner,
        roles: tab === 'roles',
        request: tab === 'request',
      }),
    );
  if (tab === 'requests') main.append(await requestManager(params, reload, owner));
  if (tab === 'appeals') main.append(await appealManager(params, reload));
  if (tab === 'sanctions') main.append(await sanctionHistory(params));
  if (tab === 'assessments')
    main.append(
      el(
        'section',
        {},
        el('h2', {}, '우리 반 수행평가'),
        el('p', {}, '관리자도 현재 등록된 본인 반의 일정만 관리할 수 있습니다.'),
        link('우리 반 수행평가 관리', '#/assessments', 'button primary'),
      ),
    );
  if (tab === 'security') main.append(await securityPanel());
  if (tab === 'settings' || tab === 'rules') {
    const { configurationManager } = await import('./admin-settings.js');
    main.append(await configurationManager(tab, reload));
  }
  if (tab === 'classes') main.append(await classManager(params, reload));
  if (tab === 'privacy') main.append(await privacyManager(reload));
  if (tab === 'boards') main.append(await boardManager(reload));
  if (tab === 'feedback') main.append(await feedbackManager(params, reload));
  if (tab === 'popups') main.append(await popupManager(reload));
  if (tab === 'notice') main.append(await noticeManager(params, reload, owner));
  const action = async (name, data) => {
    if (!data.reason) {
      operationDialog(
        '신고 처리 확인',
        [reasonField()],
        (values) => call(name, { ...data, ...values }),
        reload,
      );
      return;
    }
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
          ...(stats.reports_total !== undefined
            ? {
                reports_total: '전체 신고',
                posts_today: '최근 24시간 글',
                comments_today: '최근 24시간 댓글',
              }
            : {}),
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
                    action('admin_resolve', {
                      id: r.id,
                      kind: r.kind,
                      status: 'resolved',
                      revision: r.revision,
                    }),
                  ),
                  button('기각', () =>
                    action('admin_resolve', {
                      id: r.id,
                      kind: r.kind,
                      status: 'dismissed',
                      revision: r.revision,
                    }),
                  ),
                  r.subject_user_id
                    ? link(
                        '회원 검색·제재 요청',
                        `#/admin?tab=${owner ? 'members' : 'request'}&q=${encodeURIComponent(r.subject_user_id)}&report_id=${r.id}${r.comment_id ? `&comment_id=${r.comment_id}` : r.post_id ? `&post_id=${r.post_id}` : ''}`,
                        'button secondary small',
                      )
                    : null,
                  r.post_id
                    ? button(
                        '신고 게시글 삭제',
                        () => action('admin_delete', { id: r.post_id, kind: 'post' }),
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
                a.details
                  ? el(
                      'details',
                      {},
                      el('summary', {}, '사유·변경 내역'),
                      el('pre', { class: 'preserve' }, JSON.stringify(a.details, null, 2)),
                    )
                  : null,
              ),
            )
          : empty('작업 기록이 없어요', '관리자 작업은 자동으로 기록됩니다.'),
      ),
    );
  }
  const page = el(
    'section',
    { class: 'admin-console' },
    pageTitle(
      'ADMINISTRATION',
      '관리자 대시보드',
      owner
        ? '최고 관리자 · 운영과 정책의 최종 결정을 관리하세요.'
        : '부관리자 · 커뮤니티를 살피고 필요한 제재를 요청하세요.',
    ),
    el(
      'div',
      { class: 'admin-workspace' },
      el(
        'nav',
        { class: 'admin-nav', 'aria-label': '관리자 메뉴' },
        ...Object.entries(menus).map(([key, label]) =>
          el(
            'a',
            {
              href: `#/admin?tab=${key}`,
              class: `admin-nav-item ${tab === key ? 'selected' : ''}`,
              'aria-current': tab === key ? 'page' : null,
            },
            label,
          ),
        ),
      ),
      main,
    ),
  );
  window.requestAnimationFrame(() => {
    if (!page.isConnected) return;
    const nav = page.querySelector('.admin-nav'),
      selected = nav.querySelector('.selected');
    if (selected && nav.scrollWidth > nav.clientWidth)
      nav.scrollLeft +=
        selected.getBoundingClientRect().left -
        nav.getBoundingClientRect().left -
        (nav.clientWidth - selected.clientWidth) / 2;
  });
  return page;
}
