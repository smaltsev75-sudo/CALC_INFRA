/**
 * Stage 15.4 — Модалка «Бюджетные ограничения».
 *
 * Отвечает на вопрос: «Укладывается ли расчёт в целевой бюджет?»
 *
 * Структура:
 *   1. Бейдж общего статуса (ok / warning / not_configured).
 *   2. Блок CAPEX:  цель / факт / превышение, если есть.
 *   3. Блок OPEX:   то же самое в ₽/мес.
 *   4. «Основные причины» (top-3 драйверов из sensitivity).
 *   5. «Рекомендации» (полный список hints, до 5 штук).
 *   6. Footer: кнопка «Закрыть».
 *
 * Кэш sensitivity живёт в budgetGuardrailsController; модалка не пересчитывает
 * sensitivity при ре-рендере (overlay пересоздаётся на patchModal — без кэша
 * это бы запускало 30+ полных calculate() на каждый клик).
 *
 * Layer compliance: импортирует только domain (через ctx) и dom.js.
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';
import { BUDGET_STATUS, formatBudgetStatus } from '../../domain/budgetGuardrails.js';
import { formatPercentPoints, formatRubShort } from '../../services/format.js';
import { renderCalculationProviderPriceActuality } from '../providerPriceActuality.js';

/* ============================================================
 * Форматирование
 * ============================================================ */

function fmtMoney(v) {
    return formatRubShort(v, { millionFractionDigits: 1, thousandFractionDigits: 1 });
}

function fmtMoneyMonthly(v) {
    return `${fmtMoney(v)}/мес`;
}

function fmtPercent(v) {
    return formatPercentPoints(v, { min: 1, max: 1, spaceBeforePercent: true });
}

/* ============================================================
 * Под-секции
 * ============================================================ */

function renderSection(label, section, isMonthly) {
    const fmt = isMonthly ? fmtMoneyMonthly : fmtMoney;

    if (section.status === BUDGET_STATUS.NOT_CONFIGURED) {
        return el('div', { class: 'budget-section' },
            el('div', { class: 'budget-section-header' },
                el('span', { class: 'budget-section-label', text: label }),
                el('span', {
                    class: ['budget-status-chip', 'budget-status-muted'],
                    text: 'не задан'
                })
            ),
            el('div', { class: 'budget-section-body budget-section-body-muted' },
                el('span', { text: 'Целевой бюджет не указан в опроснике.' })
            )
        );
    }

    const isWarning = section.status === BUDGET_STATUS.WARNING;
    const statusCls = isWarning ? 'budget-status-warning' : 'budget-status-ok';
    const statusText = isWarning ? 'превышение' : 'в пределах бюджета';

    return el('div', { class: 'budget-section' },
        el('div', { class: 'budget-section-header' },
            el('span', { class: 'budget-section-label', text: label }),
            el('span', { class: ['budget-status-chip', statusCls], text: statusText })
        ),
        el('div', { class: 'budget-section-body' },
            el('div', { class: 'budget-section-row' },
                el('span', { class: 'budget-section-row-label', text: 'Цель:' }),
                el('span', { class: 'budget-section-row-value', text: fmt(section.target) })
            ),
            el('div', { class: 'budget-section-row' },
                el('span', { class: 'budget-section-row-label', text: 'Факт:' }),
                el('span', { class: 'budget-section-row-value', text: fmt(section.actual) })
            ),
            isWarning
                ? el('div', { class: ['budget-section-row', 'budget-section-row-gap'] },
                    el('span', { class: 'budget-section-row-label', text: 'Превышение:' }),
                    el('span', { class: 'budget-gap-value' },
                        el('span', { text: fmt(section.gap) }),
                        el('span', {
                            class: 'budget-gap-percent',
                            text: ` (${fmtPercent(section.gapPercent)})`
                        })
                    )
                )
                : el('div', { class: ['budget-section-row', 'budget-section-row-gap'] },
                    el('span', { class: 'budget-section-row-label', text: 'Запас:' }),
                    el('span', { class: 'budget-gap-value' },
                        el('span', { text: fmt(Math.abs(section.gap)) }),
                        el('span', {
                            class: 'budget-gap-percent',
                            text: ` (${fmtPercent(-Math.abs(section.gapPercent))})`
                        })
                    )
                )
        )
    );
}

function renderReasons(reasons) {
    if (!reasons || reasons.length === 0) return null;
    return el('section', { class: 'budget-reasons' },
        el('h4', { class: 'budget-subtitle', text: 'Основные причины' }),
        el('ol', { class: 'budget-reason-list' },
            ...reasons.map(r =>
                el('li', { class: 'budget-reason-item' },
                    el('span', { class: 'budget-reason-label', text: r.label }),
                    el('span', {
                        class: 'budget-reason-impact',
                        title: 'Оценка влияния параметра на стоимость',
                        text: `≈ ${fmtMoney(r.impact)}`
                    })
                )
            )
        )
    );
}

function renderHints(hints) {
    if (!hints || hints.length === 0) {
        return el('section', { class: 'budget-hints' },
            el('h4', { class: 'budget-subtitle', text: 'Рекомендации' }),
            el('div', { class: 'budget-hints-empty', text:
                'Рекомендации недоступны: анализ чувствительности не дал значимых драйверов. ' +
                'Уточните параметры расчёта в опроснике.'
            })
        );
    }
    return el('section', { class: 'budget-hints' },
        el('h4', { class: 'budget-subtitle', text: 'Рекомендации' }),
        el('div', { class: 'budget-hint-list' },
            ...hints.map(h =>
                el('div', { class: 'budget-hint-card' },
                    el('div', { class: 'budget-hint-card-header' },
                        el('span', { class: 'budget-hint-label', text: `Пересмотрите: ${h.label}` }),
                        el('span', {
                            class: 'budget-hint-saving',
                            text: `≈ ${fmtMoney(h.expectedSaving)}`
                        })
                    ),
                    h.message
                        ? el('div', { class: 'budget-hint-message', text: h.message })
                        : null
                )
            )
        )
    );
}

function renderStalePriceWarning(calc) {
    // Метка provider-pricing задержки (если pricing был импортирован, но прайс
    // помечен пользователем как stale). Для MVP — просто если у calc есть
    // флаг providerVersion.stale === true.
    const stale = calc?.providerVersion && calc.providerVersion.stale === true;
    if (!stale) return null;
    return el('div', {
        class: ['budget-stale-warning'],
        attrs: { role: 'note' }
    },
        'Расчёт использует старый прайс. Бюджетная оценка выполнена по текущей версии расчёта.'
    );
}

/* ============================================================
 * Главный entry
 * ============================================================ */

export function renderBudgetGuardrailsModal(state, ctx) {
    const m = state.modals?.budgetGuardrails;
    if (!m || !m.open) return null;

    const onClose = () => ctx.closeModal('budgetGuardrails');
    const calc = state.activeCalc;

    if (!calc) {
        return modalShell({
            title: 'Бюджетные ограничения',
            size: 'md',
            onClose,
            children: el('div', { class: 'budget-modal-empty', text: 'Нет активного расчёта.' }),
            footer: el('button', {
                class: 'btn btn-primary',
                attrs: { type: 'button' },
                onClick: onClose
            }, 'Закрыть')
        });
    }

    const guardrails = ctx.evaluateBudgetGuardrails();
    const overall = guardrails.status;
    const overallCls = overall === BUDGET_STATUS.WARNING ? 'budget-status-warning'
                     : overall === BUDGET_STATUS.OK      ? 'budget-status-ok'
                     : 'budget-status-muted';

    const hasAnyTarget = guardrails.capex.target != null || guardrails.opex.target != null;

    return modalShell({
        title: 'Бюджетные ограничения',
        size: 'lg',
        onClose,
        children: el('div', { class: 'budget-modal-body' },
            renderCalculationProviderPriceActuality(calc, {
                className: 'modal-price-actuality',
                title: 'Прайс расчёта'
            }),
            renderStalePriceWarning(calc),
            el('div', { class: 'budget-overall-status' },
                el('span', { class: ['budget-status-chip', overallCls], text: formatBudgetStatus(overall) })
            ),
            el('div', { class: 'budget-sections-grid' },
                renderSection('CAPEX', guardrails.capex, false),
                renderSection('OPEX',  guardrails.opex,  true)
            ),
            !hasAnyTarget
                ? el('div', { class: 'budget-empty-budget-hint' },
                    'Чтобы видеть оценку бюджета, укажите целевой CAPEX или OPEX в опроснике ' +
                    '(вопросы «Целевой бюджет CAPEX» и «Целевой бюджет OPEX в месяц»).'
                  )
                : null,
            hasAnyTarget && overall === BUDGET_STATUS.WARNING
                ? renderReasons(guardrails.reasons)
                : null,
            hasAnyTarget && overall === BUDGET_STATUS.WARNING
                ? renderHints(guardrails.hints)
                : null,
            hasAnyTarget && overall === BUDGET_STATUS.OK
                ? el('div', { class: 'budget-ok-message',
                    text: 'Расчёт укладывается в заданные бюджетные ограничения.'
                  })
                : null
        ),
        footer: el('div', { class: 'budget-modal-footer' },
            // Stage 17.2/18.2: cross-link на «Рекомендованные действия» удалён.
            // Подсказки теперь живут в composite-сводке Dashboard
            // (js/ui/calculationStateSummary.js) — пользователь видит их в основном
            // виде, без необходимости открывать отдельную модалку.
            // Stage 15.5: cross-link в Decision Memo — пользователь видит детали
            // бюджета и сразу может перейти к сборке управленческого обоснования.
            typeof ctx.openDecisionMemoModal === 'function'
                ? el('button', {
                    class: 'btn btn-ghost',
                    attrs: { type: 'button' },
                    title: 'Сформировать обоснование расчёта (Markdown)',
                    onClick: () => {
                        ctx.closeModal('budgetGuardrails');
                        ctx.openDecisionMemoModal();
                    }
                }, 'Сформировать memo →')
                : null,
            el('button', {
                class: 'btn btn-primary',
                attrs: { type: 'button' },
                title: 'Закрыть (Esc)',
                onClick: onClose
            }, 'Закрыть')
        )
    });
}
