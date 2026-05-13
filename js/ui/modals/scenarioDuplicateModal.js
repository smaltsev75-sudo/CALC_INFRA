/**
 * Sprint 4 Stage 4.8: ввод имени для копии при дублировании сценария.
 *
 * Открывается:
 *   - Из scenarioMenu по клику «Дублировать» (kebab «⋯» на tab'е).
 *
 * Поведение:
 *   - draft.label поддерживает persist в state.modals.scenarioDuplicate.draft.
 *     При первом открытии прелоадим default «<source.label> (копия)», чтобы
 *     пользователю не нужно было набирать имя вручную, если автоподстановки
 *     достаточно.
 *   - Submit пустой (whitespace) → domain подставит default «X (копия)»
 *     (defensive: см. duplicateScenario в js/domain/scenarios.js).
 *   - Submit непустой → передаём в ctx.duplicateScenario(sourceId, customLabel),
 *     контроллер создаёт копию и переключает на неё.
 *   - Закрытие через Esc или «Отмена» — без побочных эффектов, копия НЕ создаётся.
 *
 * Зачем модалка, а не сразу copy с auto-label:
 *   Пользователь почти всегда хочет дать копии осмысленное имя (например,
 *   «Базовый» → «С GPU» / «Без AI» / «Сценарий заказчика»). Без модалки
 *   приходилось бы делать два клика: «Дублировать» → «Переименовать».
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';
import { getScenariosForUI } from '../../domain/scenarios.js';

export function renderScenarioDuplicateModal(state, ctx) {
    const m = state.modals.scenarioDuplicate;
    if (!m.open) return null;
    const calc = state.activeCalc;
    if (!calc) return null;

    const scenarios = getScenariosForUI(calc);
    const source = scenarios.find(s => s.id === m.scenarioId);
    if (!source) {
        ctx.closeModal('scenarioDuplicate');
        return null;
    }

    /* draft = '' означает «пользователь только что открыл модалку» — подставляем
       default «<source.label> (копия)», чтобы input был сразу заполнен.
       После первого keystroke patchModal перепишет draft на пользовательский
       ввод, и эта подстановка больше не сработает. */
    const draft = (m.draft !== undefined && m.draft !== null && m.draft !== '')
        ? m.draft
        : `${source.label} (копия)`;

    const onClose = () => ctx.closeModal('scenarioDuplicate');
    const onSubmit = () => {
        const trimmed = (draft || '').trim();
        ctx.closeModal('scenarioDuplicate');
        ctx.duplicateScenario(source.id, trimmed || null);
    };

    return modalShell({
        title: 'Дублировать сценарий',
        size: 'sm',
        onClose,
        children: el('div', { class: 'scenario-rename-body' },
            el('label', { class: 'field' },
                el('span', { class: 'field-label-text', text: 'Имя копии' }),
                el('input', {
                    class: 'input',
                    type: 'text',
                    value: draft,
                    attrs: {
                        'data-focus-key': 'scenario-duplicate-input',
                        'data-autofocus': '',
                        maxlength: '60',
                        placeholder: 'Например: «С GPU», «Без AI», «Сценарий заказчика»'
                    },
                    onInput: e => ctx.patchModal('scenarioDuplicate', { draft: e.target.value }),
                    onKeyDown: e => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            onSubmit();
                        }
                    }
                })
            ),
            el('p', { class: 'field-hint-text',
                text: 'Копия унаследует все ответы и настройки исходного сценария, включая ваши ручные правки.' })
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', { class: 'btn btn-ghost', onClick: onClose }, 'Отмена'),
            el('button', {
                class: 'btn btn-primary',
                title: 'Создать копию сценария с этим именем (Enter). Ручные правки сохранятся.',
                onClick: onSubmit
            }, 'Создать копию')
        )
    });
}
