/**
 * Параметры PDF для вкладки «Детализация».
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';

const DEFAULT_DRAFT = { includeQuantityCheck: true };

export function renderDetailsPrintOptionsModal(state, ctx) {
    const m = state.modals.detailsPrintOptions;
    if (!m.open) return null;

    const draft = { ...DEFAULT_DRAFT, ...(m.draft || {}) };
    const close = () => ctx.closeModal('detailsPrintOptions');

    const onCancel = () => {
        const fn = m.onCancel;
        close();
        if (typeof fn === 'function') fn();
    };
    const submit = () => {
        const fn = m.onChoose;
        close();
        if (typeof fn === 'function') {
            fn({ includeQuantityCheck: !!draft.includeQuantityCheck });
        }
    };
    const setDraft = (patch) => ctx.patchModal('detailsPrintOptions', {
        draft: { ...draft, ...patch }
    });

    return modalShell({
        title: 'Параметры PDF детализации',
        size: 'sm',
        onClose: onCancel,
        children: el('div', {
            class: 'print-format-body',
            attrs: { 'data-testid': 'details-print-options-modal' }
        },
            renderQuantityCheckToggle(draft, setDraft)
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-ghost',
                title: 'Отменить выгрузку (Esc)',
                attrs: { type: 'button', 'data-testid': 'details-print-options-cancel' },
                onClick: onCancel
            }, 'Отмена'),
            el('button', {
                class: 'btn btn-primary',
                title: 'Скачать PDF с выбранными параметрами',
                attrs: {
                    type: 'button',
                    'data-autofocus': '',
                    'data-testid': 'details-print-options-submit'
                },
                onClick: submit
            }, 'Скачать PDF')
        )
    });
}

function renderQuantityCheckToggle(draft, setDraft) {
    const enabled = !!draft.includeQuantityCheck;
    const hint = enabled
        ? 'Добавит блок «Почему столько?» после таблицы.'
        : 'В PDF останется только детализация расчёта.';

    return el('label', { class: 'print-format-toggle' },
        el('input', {
            type: 'checkbox',
            class: 'print-format-toggle-input',
            attrs: {
                'data-focus-key': 'details-print-quantity-check',
                'data-testid': 'details-print-quantity-toggle'
            },
            checked: enabled,
            onChange: (e) => setDraft({ includeQuantityCheck: !!e.target.checked })
        }),
        el('div', { class: 'print-format-toggle-content' },
            el('div', { class: 'print-format-toggle-title', text: 'Печатать проверку количества ЭК' }),
            el('div', { class: 'print-format-toggle-hint', text: hint })
        )
    );
}
