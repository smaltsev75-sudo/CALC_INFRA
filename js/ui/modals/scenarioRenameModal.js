/**
 * Sprint 3.0 Stage 2: ввод нового имени для scenario.
 *
 * Открывается:
 *   - Из scenarioMenu по клику «Переименовать»
 *   - Авто после addScenario в ctx.addScenario (UX: пользователь обычно
 *     хочет сразу дать имя, чтобы потом не возвращаться)
 *
 * Поведение:
 *   - draft.label поддерживает persist в state.modals.scenarioRename.draft
 *     (избегаем потери ввода при патчах модалки)
 *   - Submit пустой (whitespace) → no-op (renameScenario сам отбрасывает)
 *   - Submit ≠ текущему label → renameScenario, закрытие модала
 *   - Submit === текущему label → no-op + закрытие
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';
import { getScenariosForUI } from '../../domain/scenarios.js';

export function renderScenarioRenameModal(state, ctx) {
    const m = state.modals.scenarioRename;
    if (!m.open) return null;
    const calc = state.activeCalc;
    if (!calc) return null;

    const scenarios = getScenariosForUI(calc);
    const scenario = scenarios.find(s => s.id === m.scenarioId);
    if (!scenario) {
        ctx.closeModal('scenarioRename');
        return null;
    }

    const draft = (m.draft !== undefined && m.draft !== null) ? m.draft : scenario.label;

    const onClose = () => ctx.closeModal('scenarioRename');
    const onSubmit = () => {
        const trimmed = (draft || '').trim();
        if (trimmed && trimmed !== scenario.label) {
            ctx.renameScenario(scenario.id, trimmed);
        }
        ctx.closeModal('scenarioRename');
    };

    return modalShell({
        title: 'Имя сценария',
        size: 'sm',
        onClose,
        children: el('div', {
            class: 'scenario-rename-body',
            attrs: { 'data-testid': 'scenario-rename-modal' }
        },
            el('label', { class: 'field' },
                el('span', { class: 'field-label-text', text: 'Название' }),
                el('input', {
                    class: 'input',
                    type: 'text',
                    value: draft,
                    attrs: {
                        'data-focus-key': 'scenario-rename-input',
                        'data-testid': 'scenario-rename-input',
                        'data-autofocus': '',
                        maxlength: '60',
                        placeholder: 'Например: «Базовый», «С GPU», «Без AI»'
                    },
                    onInput: e => ctx.patchModal('scenarioRename', { draft: e.target.value }),
                    onKeyDown: e => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            onSubmit();
                        }
                    }
                })
            ),
            el('p', { class: 'field-hint-text', text: 'Имя видно во вкладках сверху и при экспорте расчёта.' })
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-ghost',
                attrs: { type: 'button', 'data-testid': 'scenario-rename-cancel' },
                onClick: onClose
            }, 'Отмена'),
            el('button', {
                class: 'btn btn-primary',
                title: 'Применить новое имя (Enter)',
                attrs: { type: 'button', 'data-testid': 'scenario-rename-submit' },
                onClick: onSubmit
            }, 'Сохранить')
        )
    });
}
