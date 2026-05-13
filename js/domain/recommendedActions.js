/**
 * Stage 16.6 (PATCH 2.10.1) — Recommended Actions (navigation-only).
 *
 * Заменяет mutation-style Optimization Playbooks (Stage 16.4). В отличие от
 * старой модели, recommended action ТОЛЬКО предлагает следующий шаг и ссылается
 * на существующий инструмент (Health / Assumptions / Sensitivity / Budget /
 * Decision Memo / Guided Completion / Price Import). Никакой мутации calc,
 * никакого preview, никакого rollback.
 *
 * Layer: pure domain (без DOM, store, services).
 *
 * Action object:
 *   { id, title, reason, target, actionLabel, severity, source, sortOrder }
 *
 * Разрешённые targets:
 *   guided_completion / assumptions_register / sensitivity_analysis /
 *   budget_guardrails / price_import_mapping / scenario_comparison /
 *   decision_memo / health_check.
 *
 * Запрещённые targets (defensive lint):
 *   apply_to_scenario / mutate_scenario / apply_playbook / what_if_modal /
 *   scenario_pack / price_simulation.
 */

import { evaluateCalculationHealth } from './calculationHealth.js';
import { buildAssumptionsRegister, getRiskyAssumptions } from './assumptionsRegister.js';
import { getBudgetGap, BUDGET_STATUS } from './budgetGuardrails.js';

/* ============================================================
 * Whitelists
 * ============================================================ */

export const ALLOWED_TARGETS = Object.freeze([
    'guided_completion',
    'assumptions_register',
    'sensitivity_analysis',
    'budget_guardrails',
    'price_import_mapping',
    'scenario_comparison',
    'decision_memo',
    'health_check',
    'cost_optimization_planner'
]);

const FORBIDDEN_TARGETS = new Set([
    'apply_to_scenario',
    'mutate_scenario',
    'apply_playbook',
    'what_if_modal',
    'scenario_pack',
    'price_simulation'
]);

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2, info: 3 };

/* ============================================================
 * Internal helpers
 * ============================================================ */

function isFiniteNum(x) {
    return typeof x === 'number' && Number.isFinite(x);
}

function makeAction({ id, title, reason, target, actionLabel, severity, source }) {
    if (!ALLOWED_TARGETS.includes(target)) {
        throw new Error(`Recommended action target "${target}" not allowed`);
    }
    if (FORBIDDEN_TARGETS.has(target)) {
        throw new Error(`Recommended action target "${target}" is forbidden`);
    }
    return {
        id, title, reason, target, actionLabel,
        severity: severity || 'info',
        source: source || 'health_check'
    };
}

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * Построить список рекомендованных действий для заданного calc.
 *
 * @param {object|null} calc
 * @param {object} [context] — { healthResult, budgetStatus, assumptionsRegister }
 * @returns {Array} — list of recommended actions
 */
export function buildRecommendedActions(calc, context = {}) {
    if (!calc) return [];

    const actions = [];
    const seenIds = new Set();
    const seenTargets = new Set();
    const push = (action) => {
        if (seenIds.has(action.id)) return;
        if (seenTargets.has(action.target)) return;
        seenIds.add(action.id);
        seenTargets.add(action.target);
        actions.push(action);
    };

    /* ---- Health: errors / warnings / low score ---- */
    let healthResult = context.healthResult;
    if (!healthResult) {
        try { healthResult = evaluateCalculationHealth(calc); }
        catch (_e) { healthResult = null; }
    }
    if (healthResult) {
        const counts = healthResult.counts || {};
        const score = isFiniteNum(healthResult.score) ? healthResult.score : 100;
        if ((counts.error || 0) > 0) {
            push(makeAction({
                id: 'open-guided-completion-errors',
                title: 'Уточнить критичные вводные',
                reason: `В расчёте найдено ${counts.error} ${pluralizeRu(counts.error, 'ошибка', 'ошибки', 'ошибок')}.`,
                target: 'guided_completion',
                actionLabel: 'Открыть мастер уточнения',
                severity: 'high',
                source: 'health_check'
            }));
        } else if (score < 60) {
            push(makeAction({
                id: 'open-guided-completion-low-score',
                title: 'Уточнить ключевые вводные',
                reason: `Оценка качества расчёта ${score} / 100 — есть пробелы в данных.`,
                target: 'guided_completion',
                actionLabel: 'Открыть мастер уточнения',
                severity: 'medium',
                source: 'health_check'
            }));
        }

        if ((counts.warning || 0) >= 3) {
            push(makeAction({
                id: 'open-health-check-warnings',
                title: 'Просмотреть предупреждения',
                reason: `${counts.warning} ${pluralizeRu(counts.warning, 'предупреждение', 'предупреждения', 'предупреждений')} в расчёте.`,
                target: 'health_check',
                actionLabel: 'Открыть проверку расчёта',
                severity: 'medium',
                source: 'health_check'
            }));
        }
    }

    /* ---- Risky assumptions ---- */
    let risky = [];
    const ctxAssumptions = context.assumptionsRegister;
    if (Array.isArray(ctxAssumptions?.risky)) {
        // Принимаем precomputed shape `{ all, risky }` — упрощает тесты.
        risky = ctxAssumptions.risky;
    } else if (Array.isArray(ctxAssumptions)) {
        try { risky = getRiskyAssumptions(ctxAssumptions); }
        catch (_e) { risky = []; }
    } else {
        try {
            const reg = buildAssumptionsRegister(calc);
            risky = Array.isArray(reg) ? getRiskyAssumptions(reg) : [];
        } catch (_e) { risky = []; }
    }
    if (risky.length >= 3) {
        push(makeAction({
            id: 'open-assumptions-risky',
            title: 'Проверить рискованные допущения',
            reason: `${risky.length} ${pluralizeRu(risky.length, 'допущение', 'допущения', 'допущений')} высокого риска используют значения по умолчанию.`,
            target: 'assumptions_register',
            actionLabel: 'Открыть допущения',
            severity: 'medium',
            source: 'assumptions_register'
        }));
    }

    /* ---- Budget guardrails ---- */
    let budgetGap = context.budgetStatus;
    if (!budgetGap) {
        try { budgetGap = getBudgetGap(calc); }
        catch (_e) { budgetGap = null; }
    }
    if (budgetGap && budgetGap.status === BUDGET_STATUS.WARNING) {
        push(makeAction({
            id: 'open-budget-guardrails-exceeded',
            title: 'Изучить превышение бюджета',
            reason: 'Расчёт выходит за целевые ограничения CAPEX/OPEX.',
            target: 'budget_guardrails',
            actionLabel: 'Открыть бюджетные ограничения',
            severity: 'high',
            source: 'budget_guardrails'
        }));
        push(makeAction({
            id: 'open-sensitivity-budget-driver',
            title: 'Найти драйверы стоимости',
            reason: 'Понять, какие параметры сильнее всего раздувают бюджет.',
            target: 'sensitivity_analysis',
            actionLabel: 'Открыть анализ чувствительности',
            severity: 'medium',
            source: 'sensitivity'
        }));
        // Stage 18.1: при превышении бюджета предложить также план оптимизации.
        // Это управленческое предложение (3 готовых tier'а), не perturbation-tool.
        push(makeAction({
            id: 'open-cost-optimization-planner-budget',
            title: 'Составить план оптимизации стоимости',
            reason: 'Посмотреть, чем можно пожертвовать ради снижения стоимости (3 готовых плана).',
            target: 'cost_optimization_planner',
            actionLabel: 'Открыть план оптимизации',
            severity: 'medium',
            source: 'cost_optimization'
        }));
    }

    /* ---- Stale provider price ---- */
    if (calc?.providerVersion && calc.providerVersion.stale === true) {
        push(makeAction({
            id: 'open-price-import-stale',
            title: 'Обновить прайс провайдера',
            reason: 'Прайс провайдера помечен как устаревший — пересчитайте по актуальным ценам.',
            target: 'price_import_mapping',
            actionLabel: 'Открыть импорт прайса',
            severity: 'medium',
            source: 'pricing'
        }));
    }

    /* ---- Multiple scenarios → scenario_comparison ---- */
    if (Array.isArray(calc?.scenarios) && calc.scenarios.length >= 2) {
        push(makeAction({
            id: 'open-scenario-comparison-multi',
            title: 'Сравнить сценарии',
            reason: `Активно ${pluralizeRu(calc.scenarios.length, 'сценарий', 'сценария', 'сценариев')} — посмотрите различия между ними.`,
            target: 'scenario_comparison',
            actionLabel: 'Открыть сравнение',
            severity: 'low',
            source: 'comparison'
        }));
    }

    /* ---- Decision memo (low priority always-on) ---- */
    if (actions.length === 0) {
        push(makeAction({
            id: 'open-decision-memo-default',
            title: 'Сформировать обоснование расчёта',
            reason: 'Расчёт выглядит готовым — соберите memo для согласования.',
            target: 'decision_memo',
            actionLabel: 'Открыть memo',
            severity: 'low',
            source: 'memo'
        }));
    }

    return rankRecommendedActions(actions);
}

/**
 * Сортировка действий: severity-first (high → medium → low → info), затем по
 * порядку добавления. Стабильна (не мутирует вход).
 */
export function rankRecommendedActions(actions) {
    if (!Array.isArray(actions)) return [];
    return [...actions].sort((a, b) => {
        const sa = SEVERITY_ORDER[a?.severity] ?? 99;
        const sb = SEVERITY_ORDER[b?.severity] ?? 99;
        return sa - sb;
    });
}

/**
 * Сгруппировать действия по severity. Возвращает объект со всеми severity-ключами
 * (даже пустыми) — UI может рисовать пустые группы без NPE.
 */
export function groupRecommendedActions(actions) {
    const out = { high: [], medium: [], low: [], info: [] };
    if (!Array.isArray(actions)) return out;
    for (const a of actions) {
        const sev = a?.severity || 'info';
        if (out[sev]) out[sev].push(a);
        else out.info.push(a);
    }
    return out;
}

/* ============================================================
 * Helpers (private)
 * ============================================================ */

function pluralizeRu(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}
