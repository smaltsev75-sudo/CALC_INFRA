/**
 * Sprint 3.0 Stage 2: меню действий для одной scenario-вкладки.
 *
 * Открывается кликом по «⋯» (kebab) на любой вкладке tab-switcher'а в topbar.
 * Содержит 3 действия: Rename / Duplicate / Delete.
 *
 * Delete блокирован если scenarios.length === 1 (нельзя удалить последний).
 * Для legacy-virtual scenario (id='legacy-virtual') — все действия активны:
 * первое же CRUD bootstrap'ит реальный scenarios[] из root через
 * _withSyncedRoot в calcController.
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';
import { icon } from '../icons.js';
import { getScenariosForUI } from '../../domain/scenarios.js';

export function renderScenarioMenuModal(state, ctx) {
    const m = state.modals.scenarioMenu;
    if (!m.open) return null;
    const calc = state.activeCalc;
    if (!calc) return null;

    const scenarios = getScenariosForUI(calc);
    const scenario = scenarios.find(s => s.id === m.scenarioId);
    if (!scenario) {
        // Странно — scenarioId не нашёлся (удалили под рукой?). Закрываем модал.
        ctx.closeModal('scenarioMenu');
        return null;
    }

    const isOnlyOne = scenarios.length <= 1;
    const onClose = () => ctx.closeModal('scenarioMenu');

    const onRename = () => {
        ctx.closeModal('scenarioMenu');
        ctx.openScenarioRename(scenario.id);
    };
    const onDuplicate = () => {
        ctx.closeModal('scenarioMenu');
        /* Stage 4.8: вместо мгновенного копирования с auto-label «X (копия)»
           открываем модалку, где пользователь задаёт имя копии (default
           подставлен — если ничего не менять, поведение совпадёт со старым). */
        ctx.openScenarioDuplicate(scenario.id);
    };
    const onDelete = () => {
        if (isOnlyOne) return;
        ctx.closeModal('scenarioMenu');
        ctx.deleteScenario(scenario.id);
    };

    return modalShell({
        title: `Сценарий: ${scenario.label}`,
        size: 'sm',
        onClose,
        children: el('div', {
            class: 'scenario-menu-body',
            attrs: { 'data-testid': 'scenario-menu-modal' }
        },
            el('button', {
                class: 'scenario-menu-item',
                attrs: {
                    type: 'button',
                    'data-autofocus': '',
                    'data-testid': 'scenario-menu-rename'
                },
                onClick: onRename
            },
                icon('edit-3', { size: 16 }),
                el('span', { class: 'scenario-menu-item-label', text: 'Переименовать' })
            ),
            el('button', {
                class: 'scenario-menu-item',
                attrs: { type: 'button', 'data-testid': 'scenario-menu-duplicate' },
                onClick: onDuplicate
            },
                icon('copy', { size: 16 }),
                el('span', { class: 'scenario-menu-item-label', text: 'Дублировать' })
            ),
            el('button', {
                class: ['scenario-menu-item', 'scenario-menu-item-danger', isOnlyOne && 'is-disabled'],
                attrs: {
                    type: 'button',
                    disabled: isOnlyOne ? 'disabled' : undefined,
                    'data-testid': 'scenario-menu-delete'
                },
                title: isOnlyOne ? 'Нельзя удалить единственный сценарий расчёта' : undefined,
                onClick: onDelete
            },
                icon('trash-2', { size: 16 }),
                el('span', { class: 'scenario-menu-item-label', text: 'Удалить' })
            )
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-ghost',
                attrs: { type: 'button', 'data-testid': 'scenario-menu-close' },
                onClick: onClose
            }, 'Закрыть')
        )
    });
}
