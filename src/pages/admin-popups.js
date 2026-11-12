import { el, field, button, empty, toast, date } from '../lib/dom.js';
import { required } from '../lib/validation.js';
import { managePopups } from '../services/popups.js';
import { popupDialog, invalidateSitePopups } from '../components/site-popups.js';

const optionLabels = {
  once: '기본 닫기 (항상 제공)',
  today: '오늘 하루 보지 않기',
  forever: '다시 보지 않기',
};
export async function popupManager(reload) {
  const items = await managePopups('list');
  const afterSave = async () => {
    invalidateSitePopups();
    await reload();
  };
  const edit = (item = {}) => {
    const isEdit = Boolean(item.id);
    const status = el('p', { role: 'status', class: 'form-status' });
    const values = () => {
      const data = Object.fromEntries(new FormData(form));
      return {
        id: item.id || null,
        revision: item.revision || null,
        title: required(data.title, 2, 120),
        body: required(data.body, 1, 8000),
        is_active: Boolean(data.is_active),
        close_options: [
          'once',
          ...['today', 'forever'].filter((kind) => form.querySelector(`[name=${kind}]`).checked),
        ],
      };
    };
    const form = el(
      'form',
      {
        class: 'form-stack',
        onSubmit: async (event) => {
          event.preventDefault();
          const submit = form.querySelector('[type=submit]');
          submit.disabled = true;
          try {
            await managePopups('save', values());
            dialog.close();
            toast(isEdit ? '팝업을 수정했어요.' : '팝업을 등록했어요.');
            await afterSave();
          } catch (error) {
            status.textContent = error.message;
          } finally {
            submit.disabled = false;
          }
        },
      },
      el('h2', {}, isEdit ? '팝업 수정' : '새 팝업 등록'),
      el(
        'p',
        { class: 'hint' },
        '게시하면 로그인 전 방문자에게도 표시됩니다. 동시에 최대 3개까지 게시할 수 있어요.',
      ),
      field('팝업 제목', 'title', 'text', {
        required: true,
        minlength: 2,
        maxlength: 120,
        value: item.title || '',
      }),
      field('팝업 본문', 'body', 'textarea', {
        required: true,
        maxlength: 8000,
        rows: 8,
        placeholder: '방문자에게 안내할 내용을 입력해 주세요.',
      }),
      el(
        'fieldset',
        { class: 'popup-close-settings' },
        el('legend', {}, '방문자 닫기 옵션'),
        ...Object.entries(optionLabels).map(([kind, label]) =>
          el(
            'label',
            { class: 'checkbox' },
            el('input', {
              type: 'checkbox',
              name: kind,
              checked:
                kind === 'once' || (item.close_options || ['today', 'forever']).includes(kind),
              disabled: kind === 'once',
            }),
            label,
          ),
        ),
      ),
      el(
        'label',
        { class: 'checkbox' },
        el('input', { type: 'checkbox', name: 'is_active', checked: item.is_active !== false }),
        '등록 후 바로 게시',
      ),
      isEdit
        ? el(
            'p',
            { class: 'hint' },
            '제목·본문·닫기 옵션을 바꾸면 이전에 보지 않기를 선택한 방문자에게도 새 안내로 다시 표시됩니다.',
          )
        : null,
      status,
      el(
        'div',
        { class: 'actions' },
        button('취소', () => dialog.close()),
        button('미리보기', () => {
          try {
            popupDialog(values(), { preview: true });
          } catch (error) {
            status.textContent = error.message;
          }
        }),
        el(
          'button',
          { type: 'submit', class: 'button primary' },
          isEdit ? '수정 저장' : '팝업 등록',
        ),
      ),
    );
    form.querySelector('[name=body]').value = item.body || '';
    const dialog = el(
      'dialog',
      { class: 'popup-editor', 'aria-label': isEdit ? '팝업 수정' : '새 팝업 등록' },
      form,
    );
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  };
  const toggle = async (item) => {
    try {
      await managePopups('save', { ...item, is_active: !item.is_active });
      toast(item.is_active ? '팝업 게시를 중지했어요.' : '팝업을 게시했어요.');
      await afterSave();
    } catch (error) {
      toast(error.message);
    }
  };
  const remove = (item) => {
    const dialog = el(
      'dialog',
      { 'aria-label': '팝업 삭제 확인' },
      el('h2', {}, '팝업을 삭제할까요?'),
      el('p', {}, `“${item.title}” 팝업을 삭제합니다. 삭제한 내용은 복구할 수 없어요.`),
      el(
        'div',
        { class: 'actions' },
        button('취소', () => dialog.close()),
        button(
          '삭제',
          async () => {
            try {
              await managePopups('delete', { id: item.id, revision: item.revision });
              dialog.close();
              toast('팝업을 삭제했어요.');
              await afterSave();
            } catch (error) {
              toast(error.message);
            }
          },
          'button danger',
        ),
      ),
    );
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  };
  return el(
    'section',
    {},
    el(
      'div',
      { class: 'section-heading popup-manager-heading' },
      el(
        'div',
        {},
        el('h2', {}, '방문 안내 팝업'),
        el('p', { class: 'hint' }, '방문자가 사이트에 처음 들어오면 게시 중인 팝업이 표시됩니다.'),
      ),
      el(
        'div',
        { class: 'actions' },
        button('새로고침', reload),
        button('＋ 팝업 등록', () => edit(), 'button primary'),
      ),
    ),
    el(
      'div',
      { class: 'popup-admin-list' },
      items.length
        ? items.map((item) =>
            el(
              'article',
              { class: 'panel popup-admin-card' },
              el(
                'div',
                { class: 'section-heading' },
                el(
                  'span',
                  { class: `board-chip ${item.is_active ? '' : 'paused'}` },
                  item.is_active ? '게시 중' : '게시 중지',
                ),
                el('small', { class: 'meta' }, date(item.updated_at)),
              ),
              el('h3', {}, item.title),
              el('p', { class: 'muted preserve' }, item.body.slice(0, 160)),
              el(
                'p',
                { class: 'hint' },
                ['once', 'today', 'forever']
                  .filter((kind) => item.close_options.includes(kind))
                  .map((kind) => optionLabels[kind])
                  .join(' · '),
              ),
              el(
                'div',
                { class: 'actions' },
                button('미리보기', () => popupDialog(item, { preview: true })),
                button('수정', () => edit(item)),
                button(item.is_active ? '게시 중지' : '게시하기', () => toggle(item)),
                button('삭제', () => remove(item), 'button danger'),
              ),
            ),
          )
        : empty(
            '등록된 팝업이 없어요',
            '방문자에게 전할 첫 안내를 등록해 보세요.',
            button('팝업 등록', () => edit(), 'button primary'),
          ),
    ),
  );
}
