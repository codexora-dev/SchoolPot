import { el, field, button, empty, date, link } from '../lib/dom.js';
import { governance, levels, requestStates } from '../services/governance.js';
import { operationDialog, selectField, reasonField } from '../components/operation-dialog.js';

function sanctionFields(item = {}) {
  const selection = selectField('제재 수준', 'level', levels, item.proposed || 'warning');
  const days = field('제한 일수 (7~30일 선택 시)', 'days', 'number', {
    min: 7,
    max: 30,
    value: item.days || 7,
  });
  const confirmation = field('영구 제한 시 “영구 제한” 입력', 'confirmation', 'text', {
    autocomplete: 'off',
  });
  const update = () => {
    const value = selection.querySelector('select').value;
    days.hidden = value !== 'range';
    days.querySelector('input').disabled = value !== 'range';
    confirmation.hidden = value !== 'permanent';
    confirmation.querySelector('input').disabled = value !== 'permanent';
  };
  selection.addEventListener('change', update);
  update();
  return [
    selection,
    days,
    reasonField('위반 규정', 'rule', item.rule || ''),
    reasonField('안내·제재 사유', 'reason', item.reason || ''),
    el(
      'p',
      { class: 'hint' },
      '안내·경고는 이용을 차단하지 않습니다. “영구 제한 검토”는 우선 30일간 제한하며 영구 제한은 별도로 결정합니다.',
    ),
    confirmation,
  ];
}
export function applyDialog(member, reload) {
  const operation_id = crypto.randomUUID();
  operationDialog(
    `${member.nickname} · 제재 적용`,
    sanctionFields(),
    (data) => governance('apply', { ...data, target_id: member.id, operation_id }),
    reload,
    '내용 확인 후 적용',
  );
}
export function releaseDialog(member, reload) {
  operationDialog(
    `${member.nickname} · 이용 제한 해제`,
    [reasonField()],
    (data) =>
      governance('release', { ...data, target_id: member.id, revision: member.sanction_revision }),
    reload,
    '제한 해제',
  );
}
function requestDialog(member, reload, item = {}) {
  operationDialog(
    '최고 관리자에게 제재 요청',
    [
      el('p', {}, `대상: ${member.nickname}`),
      selectField(
        '위반 유형',
        'category',
        {
          abuse: '욕설·괴롭힘',
          privacy: '개인정보 침해',
          spam: '도배·광고',
          other: '기타 규정 위반',
        },
        item.category || 'abuse',
      ),
      ...sanctionFields(item),
      ...['post_id', 'comment_id', 'report_id'].map((name) =>
        field(
          {
            post_id: '관련 게시글 ID (선택)',
            comment_id: '관련 댓글 ID (선택)',
            report_id: '관련 신고 ID (선택)',
          }[name],
          name,
          'text',
          { value: item[name] || '', maxlength: 36 },
        ),
      ),
    ],
    (data) =>
      governance('request', {
        ...data,
        target_id: member.id,
        id: item.id || null,
        revision: item.revision || null,
      }),
    reload,
    '요청 제출',
  );
}
export async function memberManager(params, reload, { owner, roles = false, request = false }) {
  const query = params.get('q') || '';
  const members =
    owner || query.trim().length >= 3
      ? await governance(owner ? 'members' : 'targets', {
          query,
          offset: Number(params.get('offset')) || 0,
        })
      : [];
  const main = el(
    'section',
    {},
    el('h2', {}, roles ? '관리자 권한 관리' : request ? '회원 제재 요청' : '회원·제재 관리'),
    el(
      'p',
      { class: 'hint' },
      owner
        ? '현재 역할과 제한 상태를 확인한 뒤 사유를 작성해 처리하세요.'
        : '아이디 또는 닉네임을 3자 이상 입력하세요. 직접 제재할 수 없으며 최고 관리자의 승인이 필요합니다.',
    ),
    el(
      'form',
      {
        class: 'filters',
        onSubmit: (event) => {
          const next = new URLSearchParams({
            tab: roles ? 'roles' : request ? 'request' : 'members',
            q: new FormData(event.target).get('q'),
          });
          location.hash = '/admin?' + next;
        },
      },
      el('input', {
        type: 'search',
        name: 'q',
        value: query,
        maxlength: 120,
        'aria-label': '아이디·닉네임 검색',
        placeholder: '아이디·닉네임 검색',
      }),
      el('button', { type: 'submit', class: 'button secondary' }, '검색'),
    ),
    el(
      'div',
      { class: 'management-list' },
      members.length
        ? members.map((member) =>
            el(
              'article',
              { class: 'panel member-row' },
              el(
                'div',
                {},
                el('h3', {}, member.nickname),
                el(
                  'p',
                  { class: 'meta' },
                  `${member.username} · ${{ owner: '최고 관리자', moderator: '부관리자', member: '일반 회원' }[member.role]}`,
                ),
                el(
                  'p',
                  {},
                  member.restricted
                    ? member.permanent
                      ? '영구 이용 제한 중'
                      : `${date(member.suspended_until)}까지 이용 제한`
                    : '이용 가능',
                ),
              ),
              el(
                'div',
                { class: 'actions' },
                member.role !== 'owner'
                  ? roles
                    ? button(
                        member.role === 'moderator' ? '부관리자 해임' : '부관리자 임명',
                        () => {
                          operationDialog(
                            '관리자 역할 변경 확인',
                            [
                              el(
                                'p',
                                {},
                                `${member.nickname} → ${member.role === 'moderator' ? '일반 회원' : '부관리자'}`,
                              ),
                              reasonField(),
                            ],
                            (data) =>
                              governance('role_set', {
                                ...data,
                                target_id: member.id,
                                revision: member.role_revision,
                                role: member.role === 'moderator' ? 'member' : 'moderator',
                              }),
                            reload,
                          );
                        },
                      )
                    : [
                        owner
                          ? button(
                              '안내·경고·이용 제한',
                              () => applyDialog(member, reload),
                              'button danger',
                            )
                          : null,
                        owner && member.restricted
                          ? button('제한 해제', () => releaseDialog(member, reload))
                          : null,
                        button('제재 요청', () =>
                          requestDialog(member, reload, {
                            report_id: params.get('report_id'),
                            post_id: params.get('post_id'),
                            comment_id: params.get('comment_id'),
                          }),
                        ),
                      ]
                  : el('p', { class: 'hint' }, '최고 관리자 변경은 별도 확인 절차가 필요합니다.'),
              ),
            ),
          )
        : empty('검색 결과가 없어요', '아이디 또는 닉네임을 확인하세요.'),
    ),
  );
  main.append(pager(params, members.length, owner ? 50 : 10));
  if (roles) {
    const [admins, history] = await Promise.all([governance('roles'), governance('role_history')]);
    main.append(
      el('h2', {}, '현재 관리자'),
      ...admins.map((a) =>
        el(
          'article',
          { class: 'panel' },
          el('strong', {}, `${a.nickname} · ${a.role === 'owner' ? '최고 관리자' : '부관리자'}`),
          el(
            'p',
            { class: 'meta' },
            `${a.username} · ${date(a.assigned_at)} · ${a.restricted ? '이용 제한 중' : '활성'}`,
          ),
        ),
      ),
      el('h2', {}, '역할 변경 이력'),
      ...history.map((h) =>
        el(
          'article',
          { class: 'panel' },
          el('p', {}, `${h.previous_role} → ${h.next_role}`),
          el('p', {}, h.reason),
          el('small', {}, `${date(h.created_at)} · ${h.target_id}`),
        ),
      ),
    );
  }
  return main;
}
export async function requestManager(params, reload, owner) {
  const items = await governance('requests', { status: params.get('status') || '' });
  return withPager(
    params,
    items.length,
    el(
      'section',
      {},
      el('h2', {}, owner ? '제재 요청 검토' : '내 요청 처리 현황'),
      el(
        'form',
        {
          class: 'filters',
          onSubmit: (event) => {
            location.hash =
              '/admin?' +
              new URLSearchParams({
                tab: 'requests',
                ...Object.fromEntries(new FormData(event.target)),
              });
          },
        },
        selectField('상태', 'status', { '': '전체', ...requestStates }, params.get('status') || ''),
        el('button', { class: 'button secondary', type: 'submit' }, '조회'),
      ),
      el(
        'div',
        { class: 'management-list' },
        items.length
          ? items.map((r) =>
              el(
                'article',
                { class: 'panel' },
                el('span', { class: 'status-chip' }, requestStates[r.status]),
                el('h3', {}, r.nickname),
                el(
                  'p',
                  {},
                  `${r.category} · ${levels[r.proposed]}${r.proposed === 'range' ? ` (${r.days}일)` : ''}`,
                ),
                el('p', { class: 'preserve' }, r.rule),
                el('p', { class: 'preserve' }, r.reason),
                r.post_id
                  ? link('관련 게시글', `#/post/${r.post_id}`, 'button secondary small')
                  : null,
                r.comment_id ? el('p', { class: 'meta' }, `댓글: ${r.comment_id}`) : null,
                r.report_id ? el('p', { class: 'meta' }, `신고: ${r.report_id}`) : null,
                el(
                  'small',
                  { class: 'meta' },
                  `요청 ${date(r.created_at)} · 변경 ${date(r.updated_at)}`,
                ),
                r.decision_reason
                  ? el('p', { class: 'feedback-reply preserve' }, r.decision_reason)
                  : null,
                ['pending', 'reviewing', 'needs_info'].includes(r.status)
                  ? el(
                      'div',
                      { class: 'actions' },
                      owner
                        ? [
                            button('검토·결정', () =>
                              operationDialog(
                                '제재 요청 결정',
                                [
                                  selectField(
                                    '결정',
                                    'status',
                                    {
                                      reviewing: '검토 중',
                                      needs_info: '보완 요청',
                                      approved: '승인하고 제재 적용',
                                      rejected: '반려',
                                    },
                                    'reviewing',
                                  ),
                                  reasonField('결정 사유', 'decision_reason'),
                                  ...sanctionFields(r),
                                ],
                                (data) =>
                                  governance('decide', { ...data, id: r.id, revision: r.revision }),
                                reload,
                              ),
                            ),
                          ]
                        : [
                            r.status === 'needs_info'
                              ? button('보완하여 재제출', () =>
                                  requestDialog(
                                    { id: r.target_id, nickname: r.nickname },
                                    reload,
                                    r,
                                  ),
                                )
                              : null,
                            button('요청 취소', () =>
                              operationDialog(
                                '제재 요청 취소',
                                [reasonField('취소 사유', 'decision_reason')],
                                (data) =>
                                  governance('cancel', { ...data, id: r.id, revision: r.revision }),
                                reload,
                              ),
                            ),
                          ],
                    )
                  : null,
              ),
            )
          : empty('요청이 없어요', '접수된 제재 요청과 처리 결과를 표시합니다.'),
      ),
    ),
  );
}
export async function appealManager(params, reload) {
  const items = await governance('appeals', { offset: Number(params.get('offset')) || 0 });
  return withPager(
    params,
    items.length,
    el(
      'section',
      {},
      el('h2', {}, '이의 제기'),
      el(
        'p',
        { class: 'hint' },
        '모든 관리자가 검토·답변할 수 있습니다. 이용 제한 해제는 최고 관리자의 회원·제재 관리에서 처리합니다.',
      ),
      el(
        'div',
        { class: 'management-list' },
        items.length
          ? items.map((a) =>
              el(
                'article',
                { class: 'panel' },
                el(
                  'span',
                  { class: 'status-chip' },
                  { new: '접수', reviewing: '검토 중', closed: '종료' }[a.status],
                ),
                el('h3', {}, a.nickname),
                el('p', { class: 'preserve' }, a.body),
                el(
                  'p',
                  { class: 'hint preserve' },
                  `제재 근거: ${a.sanction.rule}\n${a.sanction.reason}`,
                ),
                a.reply ? el('p', { class: 'feedback-reply preserve' }, a.reply) : null,
                button('검토·답변', () =>
                  operationDialog(
                    '이의 제기 답변',
                    [
                      selectField(
                        '처리 상태',
                        'status',
                        { new: '접수', reviewing: '검토 중', closed: '종료' },
                        a.status,
                      ),
                      reasonField('답변', 'reply', a.reply),
                    ],
                    (data) =>
                      governance('reply_appeal', { ...data, id: a.id, revision: a.revision }),
                    reload,
                  ),
                ),
              ),
            )
          : empty('이의 제기가 없어요', '회원이 제출한 이의 제기를 이곳에서 확인합니다.'),
      ),
    ),
  );
}
export async function sanctionHistory(params) {
  const items = await governance('sanctions', { offset: Number(params.get('offset')) || 0 });
  return withPager(
    params,
    items.length,
    el(
      'section',
      {},
      el('h2', {}, '제재 기록'),
      el(
        'p',
        { class: 'hint' },
        '제재 적용·해제는 회원·제재 관리에서 처리하세요. “검토” 기록은 30일 제한 후 영구 제한 여부를 별도로 결정해야 합니다.',
      ),
      ...items.map((s) =>
        el(
          'article',
          { class: 'panel' },
          el('span', { class: 'status-chip' }, s.kind),
          el('p', {}, s.rule),
          el('p', { class: 'preserve' }, s.reason),
          el(
            'p',
            { class: 'meta' },
            `${s.target_id} · ${date(s.starts_at)}${s.ends_at ? ` ~ ${date(s.ends_at)}` : ''}${s.revoked_at ? ' · 해제됨' : ''}`,
          ),
        ),
      ),
      items.length
        ? null
        : empty('제재 기록이 없어요', '기록된 안내·경고와 이용 제한을 표시합니다.'),
    ),
  );
}
export async function securityPanel() {
  const stats = await governance('security');
  return el(
    'section',
    {},
    el('h2', {}, '보안 운영 상태'),
    el(
      'div',
      { class: 'panel form-stack' },
      el('p', {}, `RLS 활성화 테이블: ${stats.rls_enabled} / ${stats.private_tables}`),
      el('p', {}, `최고 관리자: ${stats.owners}명 · 제한 계정: ${stats.active_restrictions}명`),
      el('p', { class: 'meta' }, `서버 조회: ${date(stats.server_time)}`),
      el(
        'p',
        { class: 'hint' },
        '권한은 매 요청마다 서버에서 확인합니다. 최고 관리자 이관과 Auth·네트워크 보안 설정은 별도 운영 절차로 확인해야 합니다.',
      ),
    ),
  );
}

function pager(params, count, size) {
  const offset = Math.min(10000, Math.max(0, Number(params.get('offset')) || 0));
  const url = (n) => {
    const next = new URLSearchParams(params);
    next.set('offset', n);
    return '#/admin?' + next;
  };
  return el(
    'nav',
    { class: 'pagination', 'aria-label': '관리 기록 페이지' },
    offset ? link('← 이전', url(Math.max(0, offset - size)), 'button secondary') : null,
    count === size && offset < 10000
      ? link('다음 →', url(offset + size), 'button secondary')
      : null,
  );
}

function withPager(params, count, node) {
  node.append(pager(params, count, 100));
  return node;
}
