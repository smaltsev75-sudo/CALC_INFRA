/**
 * Stage 16.1 (MINOR 2.9.0) — Модалка «Мастер уточнения расчёта».
 *
 * Содержимое:
 *   - Header: progress (X из N), score-trend (start → current).
 *   - Body: текущий шаг — title, message, suggestedAction, поле ввода.
 *           Тип поля выбирается по step.question.type (number/boolean/select/
 *           multiselect/text). Для master_toggle — только boolean toggle.
 *   - Footer: [Откатить мастер] [Назад] [Пропустить] [Сохранить и далее].
 *   - Empty state: «Расчёт выглядит полным — не нашли проблем для уточнения».
 *
 * Все действия идут через ctx.* методы:
 *   ctx.applyGuidedAnswer(value), ctx.skipGuidedStep(), ctx.goPrevGuidedStep(),
 *   ctx.finishGuidedCompletion(), ctx.rollbackGuidedCompletion().
 *
 * Health score пересчитывается per-step: каждый render зовёт
 * evaluateCalculationHealth(activeCalc), сравнивает с ui.startScore.
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';
import { evaluateCalculationHealth } from '../../domain/calculationHealth.js';
import { getStepAt, getCompletionProgress } from '../../domain/guidedCompletion.js';
import { parseNumberInput } from '../../services/format.js';
import { DECIMAL_INPUT_TYPE, applyDecimalInputPrecision, decimalInputAttrs, formatDecimalInputValue } from '../decimalInput.js';

/* ============================================================
 * Главный entry
 * ============================================================ */

export function renderGuidedCompletionModal(state, ctx) {
    const m = state.modals?.guidedCompletion;
    if (!m || !m.open) return null;

    const ui = state.ui?.guidedCompletion;
    const calc = state.activeCalc;

    const onClose = () => ctx.finishGuidedCompletion();

    return modalShell({
        title: 'Мастер уточнения расчёта',
        size: 'lg',
        onClose,
        children: el('div', { class: 'guided-completion-body' },
            !calc
                ? renderNoCalcState()
                : !ui || !ui.active
                    ? renderInactiveState()
                    : ui.plan.totalSteps === 0
                        ? renderEmptyPlanState(calc, ui)
                        : renderActiveStep(calc, ui, ctx)
        ),
        footer: renderFooter(calc, ui, ctx, onClose)
    });
}

/* ============================================================
 * Header (progress + score)
 * ============================================================ */

function renderHeader(calc, ui) {
    const progress = getCompletionProgress(
        ui.plan, ui.completedStepIds, ui.skippedStepIds
    );
    const currentLabel = `Шаг ${Math.min(ui.currentIndex + 1, ui.plan.totalSteps)} из ${ui.plan.totalSteps}`;

    // Live re-evaluate score
    const { score } = evaluateCalculationHealth(calc);
    const startScore = ui.startScore;
    const trend = score === startScore
        ? `${score} / 100`
        : `${startScore} → ${score}`;
    const trendDirection = score > startScore ? 'up' : score < startScore ? 'down' : 'flat';

    const pctComplete = ui.plan.totalSteps > 0
        ? Math.round(((progress.completed + progress.skipped) / ui.plan.totalSteps) * 100)
        : 100;

    return el('header', { class: 'guided-completion-header' },
        el('div', { class: 'guided-completion-header-row' },
            el('span', { class: 'guided-completion-step-label', text: currentLabel }),
            el('span', {
                class: ['guided-completion-score', `guided-completion-score--${trendDirection}`],
                title: `Качество расчёта на старте: ${startScore} / 100, сейчас: ${score} / 100`
            }, `Качество: ${trend}`)
        ),
        el('div', { class: 'guided-completion-progress' },
            el('div', {
                class: 'guided-completion-progress-bar',
                style: { width: `${pctComplete}%` }
            })
        ),
        el('div', { class: 'guided-completion-counts' },
            progress.completed > 0
                ? el('span', { class: 'guided-completion-count guided-completion-count--done',
                    text: `Применено: ${progress.completed}` })
                : null,
            progress.skipped > 0
                ? el('span', { class: 'guided-completion-count guided-completion-count--skipped',
                    text: `Пропущено: ${progress.skipped}` })
                : null,
            progress.remaining > 0
                ? el('span', { class: 'guided-completion-count',
                    text: `Осталось: ${progress.remaining}` })
                : null
        )
    );
}

/* ============================================================
 * Active step (current step with input control)
 * ============================================================ */

function renderActiveStep(calc, ui, ctx) {
    const step = getStepAt(ui.plan, ui.currentIndex);
    if (!step) {
        return renderAllDoneState(calc, ui);
    }

    return el('div', { class: 'guided-completion-step' },
        renderHeader(calc, ui),
        el('article', {
            class: ['guided-completion-step-card', `guided-completion-step-card--${step.kind}`]
        },
            el('header', { class: 'guided-completion-step-card-header' },
                el('span', {
                    class: ['guided-completion-kind-badge', `guided-completion-kind-badge--${step.kind}`],
                    text: kindLabel(step.kind)
                }),
                el('h3', { class: 'guided-completion-step-title', text: step.title })
            ),
            el('p', { class: 'guided-completion-step-message', text: step.message }),
            step.suggestedAction
                ? el('p', { class: 'guided-completion-step-action' },
                    el('span', { class: 'guided-completion-step-action-label',
                        text: 'Что сделать: ' }),
                    el('span', { text: step.suggestedAction }))
                : null,
            renderInputControl(step, calc, ctx)
        )
    );
}

function kindLabel(kind) {
    switch (kind) {
        case 'finding':       return 'Проблема';
        case 'assumption':    return 'Допущение';
        case 'incomplete':    return 'Не заполнено';
        case 'master_toggle': return 'Зависимость';
        default:              return kind;
    }
}

/* ============================================================
 * Input control by question type
 * ============================================================ */

function renderInputControl(step, calc, ctx) {
    const q = step.question;
    if (!q) {
        return el('p', { class: 'guided-completion-input-fallback',
            text: 'Поле недоступно для редактирования здесь — закройте мастер и откройте опросник.' });
    }

    const currentValue = calc.answers?.[step.fieldId];
    const onApply = (val) => ctx.applyGuidedAnswer(val);

    if (step.kind === 'master_toggle' || q.type === 'boolean') {
        return renderBooleanInput(currentValue, onApply, q);
    }
    if (q.type === 'number') {
        return renderNumberInput(currentValue, onApply, q);
    }
    if (q.type === 'select') {
        return renderSelectInput(currentValue, onApply, q);
    }
    if (q.type === 'multiselect') {
        return renderMultiselectInput(currentValue, onApply, q);
    }
    return renderTextInput(currentValue, onApply, q);
}

function renderBooleanInput(currentValue, onApply, q) {
    return el('div', { class: 'guided-completion-input guided-completion-input--boolean' },
        el('button', {
            class: ['btn', currentValue === true ? 'btn-primary' : 'btn-ghost'],
            attrs: { type: 'button', 'aria-pressed': currentValue === true ? 'true' : 'false' },
            onClick: () => onApply(true)
        }, 'Да'),
        el('button', {
            class: ['btn', currentValue === false ? 'btn-primary' : 'btn-ghost'],
            attrs: { type: 'button', 'aria-pressed': currentValue === false ? 'true' : 'false' },
            onClick: () => onApply(false)
        }, 'Нет')
    );
}

function renderNumberInput(currentValue, onApply, q) {
    let draft = currentValue ?? '';
    const inputAttrs = decimalInputAttrs({
        type: DECIMAL_INPUT_TYPE,
        'data-focus-key': `gc-${q.id}`
    });

    const submit = () => {
        const num = parseNumberInput(draft);
        if (!Number.isFinite(num)) return;
        onApply(num);
    };

    return el('div', { class: 'guided-completion-input guided-completion-input--number' },
        el('input', {
            class: 'input',
            attrs: inputAttrs,
            value: formatDecimalInputValue(draft),
            onInput: e => { draft = applyDecimalInputPrecision(e.target); },
            onKeyDown: e => { if (e.key === 'Enter') submit(); }
        }),
        el('button', {
            class: 'btn btn-primary',
            attrs: { type: 'button' },
            onClick: submit
        }, 'Сохранить')
    );
}

function renderSelectInput(currentValue, onApply, q) {
    const options = q.options || [];
    if (options.length === 0) {
        // Без options — fallback на text-input
        return renderTextInput(currentValue, onApply, q);
    }
    return el('div', { class: 'guided-completion-input guided-completion-input--select' },
        ...options.map(opt => {
            const value = typeof opt === 'object' ? opt.value : opt;
            const label = typeof opt === 'object' ? (opt.label || opt.value) : opt;
            const isActive = currentValue === value;
            return el('button', {
                class: ['btn', isActive ? 'btn-primary' : 'btn-ghost'],
                attrs: {
                    type: 'button',
                    'aria-pressed': isActive ? 'true' : 'false'
                },
                onClick: () => onApply(value)
            }, String(label));
        })
    );
}

function renderMultiselectInput(currentValue, onApply, q) {
    const options = q.options || [];
    const selected = Array.isArray(currentValue) ? [...currentValue] : [];

    const toggle = (val) => {
        const idx = selected.indexOf(val);
        if (idx >= 0) selected.splice(idx, 1);
        else selected.push(val);
        onApply([...selected]);
    };

    return el('div', { class: 'guided-completion-input guided-completion-input--multiselect' },
        ...options.map(opt => {
            const value = typeof opt === 'object' ? opt.value : opt;
            const label = typeof opt === 'object' ? (opt.label || opt.value) : opt;
            const isActive = selected.includes(value);
            return el('button', {
                class: ['btn', isActive ? 'btn-primary' : 'btn-ghost'],
                attrs: {
                    type: 'button',
                    'aria-pressed': isActive ? 'true' : 'false'
                },
                onClick: () => toggle(value)
            }, String(label));
        })
    );
}

function renderTextInput(currentValue, onApply, q) {
    let draft = currentValue ?? '';
    const submit = () => onApply(String(draft));
    return el('div', { class: 'guided-completion-input guided-completion-input--text' },
        el('input', {
            class: 'input',
            attrs: { type: 'text', 'data-focus-key': `gc-${q.id}` },
            value: String(draft),
            onInput: e => { draft = e.target.value; },
            onKeyDown: e => { if (e.key === 'Enter') submit(); }
        }),
        el('button', {
            class: 'btn btn-primary',
            attrs: { type: 'button' },
            onClick: submit
        }, 'Сохранить')
    );
}

/* ============================================================
 * Empty / inactive states
 * ============================================================ */

function renderEmptyPlanState(calc, ui) {
    const { score } = evaluateCalculationHealth(calc);
    return el('div', { class: 'guided-completion-empty' },
        el('h3', { text: 'Расчёт выглядит полным' }),
        el('p', { text: 'Мы не нашли проблем, которые стоило бы уточнить через мастер. ' +
            'Все ключевые поля заполнены, противоречий не обнаружено.' }),
        el('p', {
            class: 'guided-completion-empty-score',
            text: `Качество расчёта: ${score} / 100`
        })
    );
}

function renderAllDoneState(calc, ui) {
    const { score } = evaluateCalculationHealth(calc);
    const startScore = ui.startScore;
    return el('div', { class: 'guided-completion-empty' },
        renderHeader(calc, ui),
        el('h3', { text: 'Все шаги пройдены' }),
        el('p', { text: 'Вы прошли все шаги мастера. Можно закрыть это окно — ' +
            'изменения уже сохранены в расчёте.' }),
        el('p', {
            class: 'guided-completion-empty-score',
            text: score !== startScore
                ? `Качество расчёта: ${startScore} → ${score} / 100`
                : `Качество расчёта: ${score} / 100`
        })
    );
}

function renderInactiveState() {
    return el('div', { class: 'guided-completion-empty' },
        el('p', { text: 'Мастер не запущен. Попробуйте открыть его снова из дашборда.' })
    );
}

function renderNoCalcState() {
    return el('div', { class: 'guided-completion-empty' },
        el('p', { text: 'Откройте расчёт, чтобы запустить мастер уточнения.' })
    );
}

/* ============================================================
 * Footer
 * ============================================================ */

function renderFooter(calc, ui, ctx, onClose) {
    if (!calc || !ui || !ui.active) {
        return el('div', { class: 'guided-completion-footer' },
            el('button', {
                class: 'btn btn-primary',
                attrs: { type: 'button' },
                onClick: onClose
            }, 'Закрыть')
        );
    }

    if (ui.plan.totalSteps === 0) {
        return el('div', { class: 'guided-completion-footer' },
            el('button', {
                class: 'btn btn-primary',
                attrs: { type: 'button' },
                onClick: onClose
            }, 'Закрыть')
        );
    }

    const step = getStepAt(ui.plan, ui.currentIndex);
    const isAllDone = !step;
    const canGoBack = ui.currentIndex > 0;

    return el('div', { class: 'guided-completion-footer' },
        el('button', {
            class: 'btn btn-ghost guided-completion-footer-rollback',
            attrs: { type: 'button' },
            title: 'Восстановить значения, которые были до открытия мастера',
            onClick: () => ctx.rollbackGuidedCompletion()
        }, 'Откатить мастер'),
        el('div', { class: 'guided-completion-footer-spacer' }),
        canGoBack
            ? el('button', {
                class: 'btn btn-ghost',
                attrs: { type: 'button' },
                onClick: () => ctx.goPrevGuidedStep()
            }, 'Назад')
            : null,
        isAllDone
            ? el('button', {
                class: 'btn btn-primary',
                attrs: { type: 'button' },
                onClick: onClose
            }, 'Готово')
            : el('button', {
                class: 'btn btn-ghost',
                attrs: { type: 'button' },
                title: 'Не уточнять это поле сейчас (вернётся при следующем запуске мастера)',
                onClick: () => ctx.skipGuidedStep()
            }, 'Пропустить')
    );
}
