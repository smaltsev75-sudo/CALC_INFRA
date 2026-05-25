/**
 * Базовая обёртка модального окна.
 */

import { el } from '../dom.js';

let _titleIdSeq = 0;

export function modalShell({ title, onClose, children, footer, size = 'md', closeable = true }) {
    // Уникальный id заголовка — для aria-labelledby. Screen reader озвучивает
    // заголовок при открытии диалога (WCAG 4.1.2 Name, Role, Value).
    const titleId = `modal-title-${++_titleIdSeq}`;

    const overlay = el('div', {
        class: 'modal-overlay',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        onClick: e => { if (closeable && e.target === overlay) onClose(); }
    },
        el('div', { class: ['modal', `modal-${size}`] },
            el('header', { class: 'modal-header' },
                el('h3', { class: 'modal-title', id: titleId, text: title }),
                closeable && el('button', {
                    class: 'modal-close',
                    title: 'Закрыть (Esc)',
                    attrs: { type: 'button', 'aria-label': 'Закрыть' },
                    onClick: onClose
                }, '×')
            ),
            el('div', { class: 'modal-body' }, children),
            footer && el('footer', { class: 'modal-footer' }, footer)
        )
    );
    return overlay;
}
