/**
 * Модальное окно сброса приложения к значениям по умолчанию.
 * Содержит явное предупреждение и предложение экспортировать данные перед сбросом.
 */

import { el } from '../dom.js';
import { icon } from '../icons.js';
import { modalShell } from './baseModal.js';
import { success } from '../snackbar.js';

export function renderResetModal(state, ctx) {
    const m = state.modals.reset;
    if (!m.open) return null;
    const onClose = () => ctx.closeModal('reset');
    const hasData = state.calcList.length > 0 || !!state.activeCalc;

    const onConfirm = () => {
        ctx.resetToDefaults();
        onClose();
        success('Приложение сброшено к значениям по умолчанию');
    };

    return modalShell({
        title: 'Сброс приложения',
        size: 'md',
        onClose,
        children: el('div', { class: 'reset-body' },
            el('p', { class: 'reset-lead' }, 'Будет выполнено:'),
            el('ul', { class: 'reset-list' },
                el('li', { text: 'Удалены все ваши расчёты.' }),
                el('li', { text: 'Справочники элементов и вопросов восстановлены к исходным шаблонам.' }),
                el('li', { text: 'Все параметры расчёта (запасы на риски, индексация, валюта, период) возвращены к рекомендуемым значениям.' }),
                el('li', { text: 'Откроется стартовая страница «Расчёты».' })
            ),
            el('div', { class: 'reset-warning' },
                'Действие необратимо. Перед сбросом рекомендуется экспортировать важные расчёты.'
            ),
            hasData && el('div', { class: 'reset-export-hint' },
                el('button', {
                    class: 'btn btn-ghost btn-icon-text',
                    title: 'Сохранить активный расчёт в файл прежде, чем выполнить сброс — на случай, если захотите вернуться',
                    onClick: () => {
                        if (state.activeCalc) {
                            ctx.exportCalc();
                        }
                    },
                    disabled: !state.activeCalc
                }, icon('save', { size: 16 }), el('span', { text: 'Экспортировать активный расчёт' }))
            )
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-ghost',
                title: 'Отменить сброс (Esc)',
                onClick: onClose
            }, 'Отмена'),
            el('button', {
                class: 'btn btn-danger btn-icon-text',
                title: 'Удалить все расчёты и вернуть исходный набор шаблонов. Действие необратимо.',
                onClick: onConfirm
            }, icon('rotate-ccw', { size: 16 }), el('span', { text: 'Сбросить' }))
        )
    });
}
