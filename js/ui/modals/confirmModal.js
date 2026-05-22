/**
 * Модальное окно подтверждения с двумя кнопками.
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';

export function renderConfirmModal(state, ctx) {
    const m = state.modals.confirm;
    if (!m.open) return null;
    const danger = m.danger !== false;

    const onCancel = () => {
        ctx.closeModal('confirm');
        if (typeof m.onCancel === 'function') m.onCancel();
    };
    const onConfirm = () => {
        ctx.closeModal('confirm');
        if (typeof m.onConfirm === 'function') m.onConfirm();
    };

    return modalShell({
        title: m.title || 'Подтверждение',
        onClose: onCancel,
        children: el('div', {
            class: 'confirm-body',
            attrs: { 'data-testid': 'confirm-modal' },
            text: m.message || ''
        }),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-ghost',
                title: 'Отменить действие (Esc)',
                attrs: { type: 'button', 'data-testid': 'confirm-cancel' },
                onClick: onCancel
            }, m.cancelLabel || 'Отмена'),
            el('button', {
                class: danger ? 'btn btn-danger' : 'btn btn-primary',
                title: 'Подтвердить действие',
                attrs: { type: 'button', 'data-autofocus': '', 'data-testid': 'confirm-submit' },
                onClick: onConfirm
            }, m.confirmLabel || 'Подтвердить')
        )
    });
}
