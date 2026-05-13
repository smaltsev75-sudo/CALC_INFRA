/**
 * Простое информационное модальное окно (OK).
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';

export function renderMessageModal(state, ctx) {
    const m = state.modals.message;
    if (!m.open) return null;
    const onClose = () => ctx.closeModal('message');
    return modalShell({
        title: m.title || 'Сообщение',
        onClose,
        children: el('div', { class: 'message-body', text: m.message || '' }),
        footer: el('button', {
            class: 'btn btn-primary',
            title: 'Закрыть (Esc)',
            onClick: onClose,
            attrs: { autofocus: true }
        }, 'OK')
    });
}
