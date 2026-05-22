/**
 * Модальное окно подтверждения при импорте расчёта с уже существующим id.
 *
 * Этап 11.1.4: ранее `importCalcFromFile` молча генерировал новый uuid при
 * коллизии — пользователь терял возможность обновить ранее импортированный
 * расчёт и каждый повторный импорт плодил дубликаты в списке. Теперь
 * контроллер возвращает `reason='duplicate'`, а ctx-обёртка открывает эту
 * модалку, чтобы пользователь явно выбрал стратегию.
 *
 * Открывается через `store.openModal('duplicateImport', payload)`:
 *   {
 *     existingName: string,   // имя ранее сохранённого расчёта
 *     importedName: string,   // имя импортируемого расчёта (из файла)
 *     onReplace:   () => void, // обновить существующий
 *     onClone:     () => void, // импортировать как копию (новый uuid)
 *     onCancel?:   () => void  // закрытие без действия
 *   }
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';

export function renderDuplicateImportModal(state, ctx) {
    const m = state.modals.duplicateImport;
    if (!m.open) return null;

    const existingName = m.existingName || '';
    const importedName = m.importedName || '';

    const close = () => ctx.closeModal('duplicateImport');

    const onCancel = () => {
        const fn = m.onCancel;
        close();
        if (typeof fn === 'function') fn();
    };
    const onReplace = () => {
        const fn = m.onReplace;
        close();
        if (typeof fn === 'function') fn();
    };
    const onClone = () => {
        const fn = m.onClone;
        close();
        if (typeof fn === 'function') fn();
    };

    // Сообщение собираем явным текстом — без HTML-вставок (чтобы не таскать
    // trustedHtml ради двух жирных слов).
    const message =
        `Расчёт «${existingName}» уже существует в списке. ` +
        `Импортируемый файл содержит расчёт «${importedName}» с тем же ` +
        `идентификатором.\n\n` +
        `Что сделать?\n` +
        `  • «Обновить существующий» — перезаписать сохранённый расчёт ` +
        `данными из файла (id сохранится).\n` +
        `  • «Импортировать как копию» — добавить новый расчёт с новым id, ` +
        `существующий не трогать.`;

    return modalShell({
        title: 'Расчёт с таким же id уже существует',
        onClose: onCancel,
        children: el('div', {
            class: 'confirm-body',
            attrs: { 'data-testid': 'duplicate-import-modal' },
            text: message
        }),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-ghost',
                title: 'Отменить импорт (Esc)',
                attrs: { type: 'button', 'data-testid': 'duplicate-import-cancel' },
                onClick: onCancel
            }, 'Отмена'),
            el('button', {
                class: 'btn btn-secondary',
                title: 'Импортировать как новый расчёт (новый id)',
                attrs: { type: 'button', 'data-testid': 'duplicate-import-clone' },
                onClick: onClone
            }, 'Импортировать как копию'),
            el('button', {
                class: 'btn btn-primary',
                title: 'Перезаписать сохранённый расчёт данными из файла',
                attrs: {
                    type: 'button',
                    'data-autofocus': '',
                    'data-testid': 'duplicate-import-replace'
                },
                onClick: onReplace
            }, 'Обновить существующий')
        )
    });
}
