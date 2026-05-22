/**
 * Stage 18.2 — Сводка состояния расчёта (Calculation State Summary).
 *
 * Композитный presentation-блок, объединяющий 4 ранее отдельные карточки
 * Dashboard (Готовность расчёта / Качество расчёта / Бюджет / Следующие шаги)
 * в один управленческий status-блок.
 *
 * Должен ответить на 3 вопроса:
 *   1) Можно ли идти к обсуждению? (readiness verdict + summary badge)
 *   2) Есть ли проблемы по качеству или бюджету? (diagnostic rows)
 *   3) Что делать следующим шагом? (embedded primary action)
 *
 * Никакой собственной domain-логики — всё уже существует:
 *   - evaluateCalculationReadiness(calc) — verdict / blockers / warnings
 *   - evaluateCalculationHealth(calc)    — score / counts
 *   - ctx.getBudgetGuardrailsSummary()   — gap по CAPEX/OPEX
 *   - ctx.getActiveNextSteps()           — top-N подсказок (уже отсортированы)
 *
 * Layer: ui/ (читает домен напрямую и через ctx).
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import {
    evaluateCalculationReadiness,
    READINESS_VERDICTS
} from '../domain/calculationReadiness.js';
import { evaluateCalculationHealth } from '../domain/calculationHealth.js';
import { BUDGET_STATUS } from '../domain/budgetGuardrails.js';
import { PLAN_TIERS } from '../domain/costOptimizationPlanner.js';

/* ============================================================
 * Vocabulary
 * ============================================================ */

const STATE = Object.freeze({ GREEN: 'green', YELLOW: 'yellow', RED: 'red' });

/* Маппинг target → ctx-метод для primary CTA «Следующий шаг».
   Совпадает с TARGET_DISPATCH из бывшего nextSteps.js — поведение navigation-
   only сохранено. */
const TARGET_DISPATCH = Object.freeze({
    guided_completion:         (ctx) => ctx.openGuidedCompletion?.(),
    assumptions_register:      (ctx) => ctx.openAssumptionsRegisterModal?.(),
    sensitivity_analysis:      (ctx) => ctx.openSensitivityAnalysisModal?.(),
    budget_guardrails:         (ctx) => ctx.openBudgetGuardrailsModal?.(),
    price_import_mapping:      (ctx) => ctx.openPriceImportMappingModal?.(),
    scenario_comparison:       (ctx) => ctx.openScenarioComparisonModal?.(),
    decision_memo:             (ctx) => ctx.openDecisionMemoModal?.(),
    health_check:              (ctx) => ctx.openCalculationHealthModal?.(),
    cost_optimization_planner: (ctx) => ctx.openCostOptimizationPlannerModal?.()
});

/* ============================================================
 * Helpers
 * ============================================================ */

function pluralRu(n, one, few, many) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
    return `${n} ${many}`;
}

function fmtPct(v) {
    if (!Number.isFinite(v)) return '—';
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(0)} %`;
}

/**
 * Маппинг readiness verdict + health → один из трёх UI-состояний.
 *   green  — READY (нет блокеров).
 *   yellow — NEEDS_CLARIFICATION без серьёзных блокеров (budget_missing,
 *            risky_assumptions, provider_stale). Это случай «есть замечания,
 *            но критичных проблем нет».
 *   red    — EMPTY ИЛИ NEEDS_CLARIFICATION с серьёзными блокерами
 *            (health_errors, health_score_low). Это случай «есть блокеры,
 *            расчёт некорректен / недостаточен для обсуждения».
 */
export function deriveSummaryState(readiness, health) {
    if (!readiness || readiness.verdict === READINESS_VERDICTS.EMPTY) {
        return STATE.RED;
    }
    if (readiness.verdict === READINESS_VERDICTS.READY) return STATE.GREEN;

    const severeIds = new Set(['health_errors', 'health_score_low']);
    const hasSevere = Array.isArray(readiness.blockers)
        && readiness.blockers.some(b => severeIds.has(b?.id));
    if (hasSevere) return STATE.RED;

    // Дополнительная защита: если health.counts.error > 0 (по какой-то причине
    // readiness не зафиксировал blocker, например внешний healthResult).
    const healthErrors = Number(health?.counts?.error) || 0;
    if (healthErrors > 0) return STATE.RED;

    return STATE.YELLOW;
}

/* ---------- Top next step ---------- */

function pickTopNextStep(ctx) {
    if (typeof ctx?.getActiveNextSteps !== 'function') return null;
    const all = ctx.getActiveNextSteps() || [];
    return Array.isArray(all) && all.length > 0 ? all[0] : null;
}

/* ---------- Labels / verdict text ---------- */

function readinessBadgeLabel(state) {
    if (state === STATE.GREEN)  return 'Готов к обсуждению';
    if (state === STATE.YELLOW) return 'Требует уточнения';
    return 'Есть блокеры';
}

function readinessBadgeCls(state) {
    if (state === STATE.GREEN)  return 'calc-state-summary-badge-ready';
    if (state === STATE.YELLOW) return 'calc-state-summary-badge-warning';
    return 'calc-state-summary-badge-danger';
}

function verdictText(state, readiness) {
    if (state === STATE.RED && readiness?.verdict === READINESS_VERDICTS.EMPTY) {
        return 'Расчёт пуст — заполните Опросник, чтобы получить готовность.';
    }
    if (state === STATE.GREEN)  return 'Блокеров нет — можно идти к обсуждению.';
    if (state === STATE.YELLOW) return 'Есть замечания — перед обсуждением стоит уточнить расчёт.';
    return 'Есть блокеры — сначала исправьте критичные проблемы.';
}

/* ---------- Quality ---------- */

function qualityBadge(score, counts) {
    const errors = Number(counts?.error) || 0;
    if (errors > 0) {
        return { label: `Качество: ${score} / 100`, cls: 'calc-state-summary-badge-danger' };
    }
    if (score >= 80) return { label: `Качество: ${score} / 100`, cls: 'calc-state-summary-badge-ready'   };
    if (score >= 60) return { label: `Качество: ${score} / 100`, cls: 'calc-state-summary-badge-warning' };
    return                  { label: `Качество: ${score} / 100`, cls: 'calc-state-summary-badge-danger'  };
}

function qualityRowBody(score, counts) {
    const errors  = Number(counts?.error) || 0;
    const warns   = Number(counts?.warning) || 0;
    const recs    = Number(counts?.recommendation) || 0;
    if (errors > 0) {
        return `Есть ${pluralRu(errors, 'критичная проблема', 'критичные проблемы', 'критичных проблем')}.`;
    }
    if (warns === 0 && recs === 0) {
        return 'Критичных проблем не найдено.';
    }
    const parts = [];
    if (warns > 0) parts.push(pluralRu(warns, 'предупреждение', 'предупреждения', 'предупреждений'));
    if (recs  > 0) parts.push(pluralRu(recs,  'рекомендация',   'рекомендации',   'рекомендаций'));
    return parts.join(' · ') + '.';
}

/* ---------- Budget ---------- */

function budgetBadge(gap) {
    if (!gap || gap.status === BUDGET_STATUS.NOT_CONFIGURED) {
        return { label: 'Бюджет: не задан', cls: 'calc-state-summary-badge-warning' };
    }
    if (gap.status === BUDGET_STATUS.WARNING) {
        return { label: 'Бюджет: требует внимания', cls: 'calc-state-summary-badge-warning' };
    }
    return { label: 'Бюджет: в норме', cls: 'calc-state-summary-badge-ready' };
}

function budgetRowBody(gap) {
    if (!gap || gap.status === BUDGET_STATUS.NOT_CONFIGURED) {
        return 'Целевой бюджет не задан.';
    }
    const capexWarn = gap.capex?.status === BUDGET_STATUS.WARNING;
    const opexWarn  = gap.opex?.status  === BUDGET_STATUS.WARNING;

    if (!capexWarn && !opexWarn) return 'CAPEX и OPEX в пределах бюджета.';
    if (capexWarn && opexWarn) {
        return `CAPEX и OPEX превышают бюджет (${fmtPct(gap.capex.gapPercent)} / ${fmtPct(gap.opex.gapPercent)}).`;
    }
    if (capexWarn) return `CAPEX превышает бюджет на ${fmtPct(gap.capex.gapPercent)}.`;
    return `OPEX превышает бюджет на ${fmtPct(gap.opex.gapPercent)}.`;
}

/* ============================================================
 * Sub-renderers
 * ============================================================ */

function renderHeader(state, score, healthCounts, gap) {
    const readiness = { label: readinessBadgeLabel(state), cls: readinessBadgeCls(state) };
    const quality   = qualityBadge(score, healthCounts);
    const budget    = budgetBadge(gap);

    return el('header', { class: 'calc-state-summary-header' },
        el('h3', {
            class: 'calc-state-summary-title',
            id: 'calc-state-summary-title',
            text: 'Сводка состояния расчёта'
        }),
        el('div', { class: 'calc-state-summary-badges' },
            el('span', { class: ['calc-state-summary-badge', readiness.cls], text: readiness.label }),
            el('span', { class: ['calc-state-summary-badge', quality.cls],   text: quality.label   }),
            el('span', { class: ['calc-state-summary-badge', budget.cls],    text: budget.label    })
        )
    );
}

function renderDiagnostics(score, healthCounts, gap, ctx) {
    const hasAnyTarget = gap?.capex?.target != null || gap?.opex?.target != null;
    const budgetCtaLabel = hasAnyTarget ? 'Посмотреть рекомендации →' : 'Указать бюджет →';
    const onBudgetClick = hasAnyTarget
        ? () => ctx.openBudgetGuardrailsModal?.()
        : () => ctx.focusQuestion?.('target_capex_rub');

    return el('div', { class: 'calc-state-summary-diagnostics' },
        /* Качество */
        el('div', { class: ['calc-state-summary-row', 'calc-state-summary-row-quality'] },
            el('div', { class: 'calc-state-summary-row-title', text: 'Качество расчёта' }),
            el('div', { class: 'calc-state-summary-row-body', text: qualityRowBody(score, healthCounts) }),
            el('div', { class: 'calc-state-summary-row-actions' },
                el('button', {
                    class: 'btn btn-ghost',
                    attrs: { type: 'button' },
                    title: 'Открыть детальный список проверок',
                    onClick: () => ctx.openCalculationHealthModal?.()
                }, 'Открыть проверку →')
            )
        ),
        /* Бюджет */
        el('div', { class: ['calc-state-summary-row', 'calc-state-summary-row-budget'] },
            el('div', { class: 'calc-state-summary-row-title', text: 'Бюджет' }),
            el('div', { class: 'calc-state-summary-row-body', text: budgetRowBody(gap) }),
            el('div', { class: 'calc-state-summary-row-actions' },
                el('button', {
                    class: 'btn btn-ghost',
                    attrs: { type: 'button' },
                    title: hasAnyTarget
                        ? 'Открыть детальную сводку и рекомендации'
                        : 'Перейти в Опросник к вопросам о целевом CAPEX и OPEX',
                    onClick: onBudgetClick
                }, budgetCtaLabel)
            )
        )
    );
}

/* ---------- Cost Optimization teaser (вторичная секция) ----------
   Stage 18.2.x: бывшая отдельная Dashboard-карточка [costOptimizationPlanner.js]
   удалена. Точка входа в планер живёт здесь как secondary-action внутри
   composite-сводки. Editor controls / constraints / Apply остаются в модалке.

   Дедупликация: если primary next step уже ведёт в planner
   (target === 'cost_optimization_planner'), teaser показывается без CTA-кнопки —
   только короткий note «План доступен в «Следующем шаге» выше», иначе на
   Dashboard будут две одинаковые кнопки. */

function renderCostOptimizationTeaser(nextStep, ctx) {
    const rangeMin = Math.min(...PLAN_TIERS.map(t => t.range.minPercent));
    const rangeMax = Math.max(...PLAN_TIERS.map(t => t.range.maxPercent));
    const tiers = PLAN_TIERS.map(t => t.title).join(' · ');
    const primaryIsPlanner = nextStep?.target === 'cost_optimization_planner';

    return el('div', { class: 'calc-state-summary-optimization' },
        el('div', { class: 'calc-state-summary-optimization-head' },
            el('span', {
                class: 'calc-state-summary-optimization-title',
                text: 'Оптимизация стоимости'
            }),
            el('span', {
                class: 'calc-state-summary-optimization-tags',
                text: tiers
            })
        ),
        el('p', {
            class: 'calc-state-summary-optimization-text',
            text: primaryIsPlanner
                ? `План оптимизации доступен в «Следующем шаге» выше — снижение на ${rangeMin}–${rangeMax}% и компромиссы.`
                : `Оцените снижение стоимости на ${rangeMin}–${rangeMax}% и возможные компромиссы.`
        }),
        primaryIsPlanner
            ? null
            : el('div', { class: 'calc-state-summary-optimization-actions' },
                el('button', {
                    class: 'btn btn-ghost calc-state-summary-optimization-cta',
                    attrs: {
                        type: 'button',
                        'aria-label': 'Открыть план оптимизации стоимости',
                        'data-testid': 'open-cost-optimization-planner'
                    },
                    onClick: () => ctx?.openCostOptimizationPlannerModal?.()
                },
                    el('span', { text: 'Открыть план оптимизации' }),
                    icon('chevron-right', { size: 14 })
                )
            )
    );
}

const NEXT_STEP_PRIORITY_LABELS = {
    high: 'высокий',
    medium: 'средний',
    low: 'низкий',
    info: 'информационный'
};

function renderNextStep(nextStep, ctx) {
    if (!nextStep) return null;
    const dispatch = TARGET_DISPATCH[nextStep.target];
    const disabled = typeof dispatch !== 'function';
    const sev = nextStep.severity || 'info';
    const priorityLabel = NEXT_STEP_PRIORITY_LABELS[sev] || NEXT_STEP_PRIORITY_LABELS.info;

    return el('div', {
        class: ['calc-state-summary-next', `calc-state-summary-next-${sev}`],
        attrs: {
            role: 'group',
            'aria-label': `Следующий шаг. Приоритет: ${priorityLabel}. ${nextStep.title}`
        }
    },
        el('div', { class: 'calc-state-summary-next-label', text: 'Следующий шаг' }),
        el('div', { class: 'calc-state-summary-next-title', text: nextStep.title }),
        nextStep.reason
            ? el('p', { class: 'calc-state-summary-next-body', text: nextStep.reason })
            : null,
        el('div', { class: 'calc-state-summary-next-actions' },
            el('button', {
                class: 'btn btn-primary calc-state-summary-next-cta',
                attrs: {
                    type: 'button',
                    'data-testid': `next-step-${nextStep.target}`,
                    disabled: disabled ? 'disabled' : null
                },
                title: nextStep.actionLabel || 'Открыть',
                onClick: () => { if (!disabled) dispatch(ctx); }
            }, nextStep.actionLabel || 'Открыть', icon('chevron-right', { size: 14 }))
        )
    );
}

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * @param {object|null} calc — активный расчёт
 * @param {object}      ctx  — app-context (openCalculationHealthModal,
 *                              openBudgetGuardrailsModal, focusQuestion,
 *                              getBudgetGuardrailsSummary, getActiveNextSteps,
 *                              + диспетчеры для top next step).
 */
export function renderCalculationStateSummary(calc, ctx) {
    if (!calc) return null;

    const readiness = evaluateCalculationReadiness(calc);
    const health    = (() => {
        try { return evaluateCalculationHealth(calc); }
        catch { return { score: 100, counts: { error: 0, warning: 0, recommendation: 0, info: 0 } }; }
    })();
    const gap = typeof ctx?.getBudgetGuardrailsSummary === 'function'
        ? ctx.getBudgetGuardrailsSummary()
        : null;
    const state = deriveSummaryState(readiness, health);
    const nextStep = pickTopNextStep(ctx);

    return el('section', {
        class: [
            'dash-card',
            'calc-state-summary',
            `calc-state-summary-${state}`
        ],
        attrs: { 'aria-labelledby': 'calc-state-summary-title' }
    },
        renderHeader(state, health.score, health.counts, gap),
        el('p', { class: 'calc-state-summary-verdict', text: verdictText(state, readiness) }),
        renderDiagnostics(health.score, health.counts, gap, ctx),
        renderNextStep(nextStep, ctx),
        // Stage 18.2.x: бывшая отдельная карточка «План оптимизации стоимости»
        // встроена как secondary-action. ctx.openCostOptimizationPlannerModal
        // обязателен; модалка/контроллер/domain не тронуты.
        typeof ctx?.openCostOptimizationPlannerModal === 'function'
            ? renderCostOptimizationTeaser(nextStep, ctx)
            : null
    );
}

/* Экспорт helper'ов для тестов. */
export const __test = {
    deriveSummaryState,
    pickTopNextStep,
    qualityRowBody,
    budgetRowBody,
    STATE
};
