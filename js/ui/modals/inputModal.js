/**
 * Модальное окно ввода одной строки. Замена `window.prompt`:
 * стилизуется, не блокирует UI, поддерживает Enter / Esc.
 *
 * Открывается через store.openModal('input', { title, message, defaultValue, onConfirm, placeholder, label }).
 * Значение draft хранится в state.modals.input.draft (single source of truth).
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';

export function renderInputModal(state, ctx) {
    const m = state.modals.input;
    if (!m.open) return null;

    const value = m.draft !== undefined ? m.draft : (m.defaultValue ?? '');

    const onClose = () => {
        const onCancel = m.onCancel;
        ctx.closeModal('input');
        if (typeof onCancel === 'function') onCancel();
    };
    const onSubmit = () => {
        const fn = m.onConfirm;
        const submitted = value;
        ctx.closeModal('input');
        if (typeof fn === 'function') fn(submitted);
    };

    return modalShell({
        title: m.title || 'Введите значение',
        size: 'sm',
        onClose,
        children: el('div', { class: 'input-modal-body' },
            m.message && el('p', { class: 'input-modal-message', text: m.message }),
            el('label', { class: 'field' },
                m.label && el('span', { class: 'field-label', text: m.label }),
                el('input', {
                    class: 'input',
                    type: m.type || 'text',
                    value,
                    placeholder: m.placeholder || '',
                    attrs: {
                        'data-autofocus': '',
                        'data-focus-key': 'input-modal',
                        maxlength: m.maxlength || 200
                    },
                    onInput: e => ctx.patchModal('input', { draft: e.target.value }),
                    onKeydown: e => {
                        if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
                    }
                })
            )
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-ghost',
                title: 'Отменить ввод (Esc)',
                onClick: onClose
            }, m.cancelLabel || 'Отмена'),
            el('button', {
                class: 'btn btn-primary',
                title: 'Подтвердить (Enter)',
                onClick: onSubmit
            }, m.confirmLabel || 'OK')
        )
    });
}
