/**
 * Модальное окно выбора формата перед печатью ответов опросника (PDF).
 *
 * Этап 13.U4 (редизайн): вместо 3-х кнопок «Отмена / Полный / Сокращённый»
 * — две radio-карточки с CSS-схемами документа, toggle ориентации
 * и одна Primary-кнопка «Скачать PDF».
 *
 * Открывается через `store.openModal('printAnswersOptions', payload)`:
 *   {
 *     draft?: { format: 'compact'|'extended', landscape: boolean },
 *     onChoose: ({ extended: boolean, landscape: boolean }) => void,
 *     onCancel?: () => void
 *   }
 *
 * Default-фокус и Enter ставятся на «Скачать PDF» — нажатие Enter без
 * дополнительных кликов запускает печать в выбранном по умолчанию формате
 * (Сокращённый + landscape — минимум friction для большинства сценариев).
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';

const DEFAULT_DRAFT = { format: 'compact', landscape: true };

export function renderPrintAnswersOptionsModal(state, ctx) {
    const m = state.modals.printAnswersOptions;
    if (!m.open) return null;

    const draft = m.draft || DEFAULT_DRAFT;
    const close = () => ctx.closeModal('printAnswersOptions');

    const onCancel = () => {
        const fn = m.onCancel;
        close();
        if (typeof fn === 'function') fn();
    };
    const submit = () => {
        const fn = m.onChoose;
        close();
        if (typeof fn === 'function') {
            fn({
                extended: draft.format === 'extended',
                landscape: !!draft.landscape
            });
        }
    };

    const setDraft = (patch) => ctx.patchModal('printAnswersOptions', {
        draft: { ...draft, ...patch }
    });

    return modalShell({
        title: 'Формат выгрузки ответов опросника',
        size: 'md',
        onClose: onCancel,
        children: el('div', { class: 'print-format-body' },
            renderFormatFieldset(draft, setDraft),
            renderOrientationToggle(draft, setDraft)
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-ghost',
                title: 'Отменить выгрузку (Esc)',
                attrs: { type: 'button' },
                onClick: onCancel
            }, 'Отмена'),
            el('button', {
                class: 'btn btn-primary',
                title: 'Скачать PDF в выбранном формате (Enter)',
                attrs: { type: 'button', 'data-autofocus': '' },
                onClick: submit
            }, 'Скачать PDF')
        )
    });
}

/* ---------- Fieldset с двумя radio-карточками ---------- */

function renderFormatFieldset(draft, setDraft) {
    return el('fieldset', { class: 'print-format-fieldset' },
        el('legend', { class: 'print-format-legend', text: 'Формат таблицы' }),
        el('div', {
            class: 'print-format-grid',
            attrs: { role: 'radiogroup', 'aria-label': 'Формат таблицы' }
        },
            renderFormatCard({
                value: 'compact',
                title: 'Сокращённый',
                subtitle: 'Вопрос → Ответ. Компактно, меньше страниц.',
                mockup: renderDocMockup(2),
                draft, setDraft
            }),
            renderFormatCard({
                value: 'extended',
                title: 'Полный',
                subtitle: '+ Пояснения к вопросам. Удобно для согласования.',
                mockup: renderDocMockup(3),
                draft, setDraft
            })
        )
    );
}

function renderFormatCard({ value, title, subtitle, mockup, draft, setDraft }) {
    const selected = draft.format === value;
    return el('label', {
        class: ['print-format-card', selected && 'is-selected'],
        attrs: { 'data-value': value }
    },
        el('input', {
            type: 'radio',
            class: 'print-format-card-input',
            attrs: {
                name: 'print-format',
                value,
                'data-focus-key': `format-${value}`
            },
            checked: selected,
            onChange: () => setDraft({ format: value })
        }),
        el('div', { class: 'print-format-card-mockup' }, mockup),
        el('div', { class: 'print-format-card-text' },
            el('div', { class: 'print-format-card-title', text: title }),
            el('div', { class: 'print-format-card-subtitle', text: subtitle })
        )
    );
}

/**
 * CSS-схема документа: «шапка» + 5 строк ячеек. Параметр cols (2 или 3) задаёт
 * раскладку колонок. Для 3-колоночного варианта последняя колонка шире —
 * визуальный намёк на пояснения.
 */
function renderDocMockup(cols) {
    const rowClass = cols === 3 ? 'pf-doc-row pf-doc-row-3' : 'pf-doc-row pf-doc-row-2';
    const rows = [];
    for (let i = 0; i < 5; i++) {
        const cells = [
            el('div', { class: 'pf-doc-cell pf-doc-cell-q' }),
            el('div', { class: 'pf-doc-cell pf-doc-cell-a' })
        ];
        if (cols === 3) cells.push(el('div', { class: 'pf-doc-cell pf-doc-cell-x' }));
        rows.push(el('div', { class: rowClass }, ...cells));
    }
    return el('div', { class: ['pf-doc', cols === 3 && 'pf-doc-3'] },
        el('div', { class: 'pf-doc-header-line' }),
        ...rows
    );
}

/* ---------- Toggle «Альбомная ориентация (A4)» ---------- */

function renderOrientationToggle(draft, setDraft) {
    const hint = draft.landscape
        ? 'Шире страница — длинные вопросы и ответы помещаются без переноса.'
        : 'Книжная ориентация — больше страниц, но привычнее для согласования.';
    return el('label', { class: 'print-format-toggle' },
        el('input', {
            type: 'checkbox',
            class: 'print-format-toggle-input',
            attrs: { 'data-focus-key': 'landscape' },
            checked: !!draft.landscape,
            onChange: (e) => setDraft({ landscape: !!e.target.checked })
        }),
        el('div', { class: 'print-format-toggle-content' },
            el('div', { class: 'print-format-toggle-title', text: 'Альбомная ориентация (A4)' }),
            el('div', { class: 'print-format-toggle-hint', text: hint })
        )
    );
}
