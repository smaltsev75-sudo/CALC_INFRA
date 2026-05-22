import { el } from './../dom.js';
import { icon } from './../icons.js';
import { groupOptimizationLevers } from '../../domain/costOptimizationPlanner.js';
import { formatRubThousands, parseNumberInput } from '../../services/format.js';
import {
    DECIMAL_INPUT_TYPE,
    applyDecimalInputPrecision,
    decimalInputAttrs,
    formatDecimalInputValue
} from '../decimalInput.js';
import {
    RISK_BADGE,
    formatValueShort,
    pluralParams
} from './costOptimizationPlannerModalFormat.js';

/* ============================================================
 * Editable levers
 * ============================================================ */

/* Stage 18.1.1 — grouped levers (accordion). Каждая группа имеет header с
   summary (count / saving / max risk), при клике сворачивается/разворачивается.
   Заблокированные группы рендерятся collapsed с причиной и inline-кнопкой
   «Разрешить ...», которая дёргает toggleOptimizationConstraint(true) — она
   НЕ применяет правки, а только снимает ограничение. */
export function renderLeversBlock(calc, m, ctx) {
    const draft = m.draft;
    const groups = groupOptimizationLevers(calc, draft);
    const openSet = new Set(Array.isArray(m.openGroups) ? m.openGroups : []);

    /* Если ни одной доступной группы и ни одной с changes/blocked'ом — пусто. */
    const hasAnyVisible = groups.some(g =>
        g.availableLeverCount > 0 || g.changedCount > 0 || g.blocked);
    if (!hasAnyVisible) {
        return el('section', { class: 'cop-modal-section cop-modal-levers' },
            el('h4', { class: 'cop-modal-section-title', text: 'Рычаги оптимизации' }),
            el('p', { class: 'cop-modal-section-hint',
                text: 'Нет доступных рычагов при текущих ограничениях. Включите дополнительные категории сверху или поднимите уровень оптимизации.' })
        );
    }

    /* Сортировка: группы «Нет применимых параметров» (constraint включён,
       но appliesIf отсеял все spec'и — например AI без ai_llm_used) опускаются
       в самый низ. Blocked-группы остаются в естественном порядке (они применимы,
       просто запрещены — у пользователя есть путь снять constraint). */
    const isEmpty = (g) => !g.blocked && g.availableLeverCount === 0 && g.changedCount === 0;
    const orderedGroups = [
        ...groups.filter(g => !isEmpty(g)),
        ...groups.filter(isEmpty)
    ];

    return el('section', { class: 'cop-modal-section cop-modal-levers',
        attrs: { 'aria-label': 'Рычаги оптимизации' } },
        el('h4', { class: 'cop-modal-section-title', text: 'Рычаги оптимизации' }),
        el('p', { class: 'cop-modal-section-hint',
            text: 'Рычаги сгруппированы по тому, чем придётся пожертвовать: стенды, SLA, хранение, AI / RAG, рисковые резервы или горизонт планирования.' }),
        el('div', { class: 'cop-lever-groups' },
            ...orderedGroups.map(g => renderLeverGroup(g, openSet.has(g.id), ctx))
        )
    );
}

function renderLeverGroup(group, isOpen, ctx) {
    const isBlocked = group.blocked;
    const isEmpty = !isBlocked && group.availableLeverCount === 0 && group.changedCount === 0;
    /* Заблокированная группа НЕ ведёт себя как accordion — body виден всегда,
       чтобы пользователь сразу читал причину и видел inline-кнопку «Разрешить».
       Аккордеон применяется только к unblocked-группам (см. ниже). */
    const expanded = isBlocked ? true : isOpen;
    const cls = ['cop-lever-group',
        isBlocked && 'cop-lever-group-blocked',
        isEmpty && 'cop-lever-group-empty',
        expanded && 'is-expanded'];
    const headerId = `cop-lever-group-${group.id}-header`;
    const bodyId   = `cop-lever-group-${group.id}-body`;

    /* Header: для blocked — статичный div (нет toggling smysl'а); для остальных
       — button с aria-expanded и onClick. */
    const header = isBlocked
        ? el('div', { class: 'cop-lever-group-header cop-lever-group-header-static',
            attrs: { id: headerId, title: group.description } },
            el('span', { class: 'cop-lever-group-chevron', attrs: { 'aria-hidden': 'true' } },
                icon('lock', { size: 14 })),
            el('span', { class: 'cop-lever-group-title', text: group.title }),
            renderLeverGroupMeta(group, isBlocked, isEmpty)
        )
        : el('button', {
            class: 'cop-lever-group-header',
            attrs: {
                type: 'button',
                id: headerId,
                'aria-expanded': expanded ? 'true' : 'false',
                'aria-controls': bodyId,
                title: group.description
            },
            onClick: () => ctx.toggleOptimizationLeverGroup?.(group.id)
        },
            el('span', { class: 'cop-lever-group-chevron', attrs: { 'aria-hidden': 'true' } },
                icon(expanded ? 'chevron-down' : 'chevron-right', { size: 14 })),
            el('span', { class: 'cop-lever-group-title', text: group.title }),
            renderLeverGroupMeta(group, isBlocked, isEmpty)
        );

    return el('div', { class: cls },
        header,
        el('div', {
            class: ['cop-lever-group-body', !expanded && 'is-collapsed'],
            attrs: { id: bodyId, role: 'region', 'aria-labelledby': headerId,
                hidden: expanded ? null : 'hidden' }
        },
            el('p', { class: 'cop-lever-group-description', text: group.description }),
            isBlocked
                ? renderLeverGroupBlocked(group, ctx)
                : isEmpty
                    ? el('p', { class: 'cop-lever-group-empty-hint',
                        text: 'Нет применимых параметров для текущего расчёта.' })
                    : el('ol', { class: 'cop-lever-list' },
                        ...group.levers.map(l => renderLeverItem(l, ctx)))
        )
    );
}

function renderLeverGroupMeta(group, isBlocked, isEmpty) {
    if (isBlocked) {
        return el('span', { class: 'cop-lever-group-meta cop-lever-group-meta-blocked',
            text: 'Заблокировано ограничениями' });
    }
    if (isEmpty) {
        return el('span', { class: 'cop-lever-group-meta cop-lever-group-meta-empty',
            text: 'Нет применимых параметров' });
    }
    /* Активная группа: count + saving + risk-badge. */
    const parts = [];
    const countText = group.changedCount > 0
        ? `${group.changedCount} из ${group.availableLeverCount} изменено`
        : `${group.availableLeverCount} ${pluralParams(group.availableLeverCount)}`;
    parts.push(el('span', { class: 'cop-lever-group-meta-count', text: countText }));
    if (group.totalSavingRub > 0) {
        parts.push(el('span', { class: 'cop-lever-group-meta-saving',
            text: `−${formatRubThousands(group.totalSavingRub)} / мес` }));
    }
    if (group.maxRiskLevel) {
        const risk = RISK_BADGE[group.maxRiskLevel] || RISK_BADGE.low;
        parts.push(el('span', {
            class: ['cop-risk-badge', 'cop-risk-badge-sm', risk.cls, 'cop-lever-group-meta-risk'],
            text: risk.label
        }));
    }
    return el('span', { class: 'cop-lever-group-meta' }, ...parts);
}

function renderLeverGroupBlocked(group, ctx) {
    return el('div', { class: 'cop-lever-group-blocked-body' },
        el('p', { class: 'cop-lever-group-blocked-reason', text: group.blockedReason }),
        group.constraintKey && group.constraintEnableLabel
            ? el('button', {
                class: 'btn btn-ghost btn-sm cop-lever-group-unblock',
                attrs: { type: 'button',
                    title: 'Снять ограничение. Изменения в расчёт не применяются.' },
                onClick: () => ctx.toggleOptimizationConstraint?.(group.constraintKey, true)
            }, group.constraintEnableLabel)
            : null
    );
}

function renderLeverItem(lever, ctx) {
    const risk = RISK_BADGE[lever.riskLevel] || RISK_BADGE.low;
    /* PATCH 2.14.17: description — одна строка под title объясняет ЧТО за
       параметр (берётся из metadata модели через resolveLeverDescription).
       Длинные description-тексты из seed.js могут содержать переносы строки
       и второй абзац (рекомендации). Для UI планера показываем только
       первую содержательную строку — её достаточно, полный текст пользователь
       видит в Опроснике через кнопку «Перейти к полю». */
    const descShort = (lever.description || '')
        .split(/\n+/)[0]
        .trim()
        .slice(0, 240); // sanity cap — избежать гигантских карточек
    return el('li', { class: ['cop-lever', `cop-lever-${lever.riskLevel}`,
            lever.hasDraftChange && 'cop-lever-modified'] },
        el('div', { class: 'cop-lever-head' },
            el('span', { class: 'cop-lever-title', text: lever.title }),
            el('span', { class: ['cop-risk-badge', 'cop-risk-badge-sm', risk.cls],
                text: risk.label })
        ),
        descShort
            ? el('p', { class: 'cop-lever-description', text: descShort })
            : null,
        renderLeverEditor(lever, ctx),
        lever.consequence
            ? el('p', { class: 'cop-lever-consequence', text: `Последствие: ${lever.consequence}` })
            : null,
        renderLeverActions(lever, ctx)
    );
}

function renderLeverEditor(lever, ctx) {
    const editor = lever.editor;
    switch (editor.editorType) {
        case 'enum':       return renderEnumEditor(lever, ctx);
        case 'number_int': return renderNumberEditor(lever, ctx, /*integer*/ true);
        case 'number_float':
        case 'percent':    return renderNumberEditor(lever, ctx, /*integer*/ false);
        default:           return null;
    }
}

function renderEnumEditor(lever, ctx) {
    const fieldId = lever.fieldId;
    const current = Number(lever.editingValue);
    const opts = lever.editor.options || [];
    const suggested = lever.suggestedValue;
    return el('div', { class: 'cop-lever-editor cop-lever-editor-enum' },
        el('label', { class: 'cop-lever-editor-label' },
            el('span', { class: 'cop-lever-editor-from',
                text: `Сейчас: ${formatValueShort(lever.baseValue, lever)}` }),
            el('select', {
                class: 'input cop-lever-select',
                attrs: { 'data-focus-key': `cop-lever-${lever.id}` },
                onChange: e => ctx.updateOptimizationDraftValue(fieldId, Number(e.target.value))
            },
                ...opts.map(v => el('option', {
                    value: String(v),
                    selected: Math.abs(v - current) < 1e-9,
                    text: formatValueShort(v, lever)
                }))
            ),
            suggested != null && Math.abs(suggested - current) > 1e-9
                ? el('span', { class: 'cop-lever-suggested',
                    text: `Рекомендуется: ${formatValueShort(suggested, lever)}` })
                : null
        )
    );
}

function renderNumberEditor(lever, ctx, integer) {
    const fieldId = lever.fieldId;
    const editor = lever.editor;
    const current = Number(lever.editingValue);
    const suggested = lever.suggestedValue;
    /* Range input + текстовое значение. Не делаем slider в Phase 2 для
       простоты тестов; обычный number input с min/max/step справится. */
    return el('div', { class: 'cop-lever-editor cop-lever-editor-number' },
        el('div', { class: 'cop-lever-editor-row' },
            el('span', { class: 'cop-lever-editor-from',
                text: `Сейчас: ${formatValueShort(lever.baseValue, lever)}` }),
            el('input', {
                class: 'input cop-lever-input',
                type: DECIMAL_INPUT_TYPE,
                value: formatDecimalInputValue(integer ? Math.round(current) : current),
                attrs: decimalInputAttrs({
                    'data-focus-key': `cop-lever-${lever.id}`,
                }),
                onInput: e => { applyDecimalInputPrecision(e.target); },
                onChange: e => {
                    const raw = parseNumberInput(applyDecimalInputPrecision(e.target));
                    if (Number.isFinite(raw)) ctx.updateOptimizationDraftValue(fieldId, raw);
                }
            })
        ),
        suggested != null && Math.abs(suggested - current) > (editor.step ?? 0.01) / 100
            ? el('p', { class: 'cop-lever-suggested',
                text: `Рекомендуется для уровня: ${formatValueShort(suggested, lever)}` })
            : null,
        el('p', { class: 'cop-lever-range-hint',
            text: `Диапазон: ${formatValueShort(editor.min, lever)} – ${formatValueShort(editor.max, lever)}` })
    );
}

function renderLeverActions(lever, ctx) {
    const fieldId = lever.fieldId;
    return el('div', { class: 'cop-lever-actions' },
        lever.hasDraftChange
            ? el('button', {
                class: 'btn btn-ghost btn-sm cop-lever-reset',
                attrs: { type: 'button',
                    title: 'Вернуть значение к исходному (текущее в расчёте)' },
                onClick: () => ctx.removeOptimizationDraftChange(fieldId)
            }, 'Сбросить параметр')
            : null,
        typeof ctx?.focusQuestion === 'function' && fieldId.startsWith('answer:')
            ? el('button', {
                class: 'btn btn-ghost btn-sm cop-lever-nav',
                attrs: { type: 'button',
                    title: 'Открыть поле в опроснике' },
                onClick: () => {
                    ctx.closeCostOptimizationPlannerModal();
                    ctx.focusQuestion(fieldId.slice('answer:'.length));
                }
            }, 'Перейти к полю', icon('chevron-right', { size: 12 }))
            : null
    );
}
