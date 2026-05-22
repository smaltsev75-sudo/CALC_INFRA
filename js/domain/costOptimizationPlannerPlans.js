/**
 * Read-only plan builder for Cost Optimization Planner.
 *
 * Produces the three summary plans from calc + constraints. The editable draft
 * workflow lives in costOptimizationPlanner.js and shares the pure helpers.
 */

import { calculate } from './calculator.js';
import {
    PLAN_IDS,
    PLAN_TIERS,
    DEFAULT_CONSTRAINTS,
    LEVER_SPECS
} from './costOptimizationPlannerConfig.js';
import {
    applyToClone,
    cloneCalc,
    computeProposedValue,
    readCurrentValue
} from './costOptimizationPlannerShared.js';

function buildLever(spec, calc, tier, constraints, baseTotal) {
    // 1. Constraint-gate (pre-applies-if)
    if (spec.constraintKey && !constraints[spec.constraintKey]) {
        return null;
    }
    // 2. skipInTiers
    if (Array.isArray(spec.skipInTiers) && spec.skipInTiers.includes(tier.id)) {
        return null;
    }
    // 3. appliesIf gating (master toggles, horizon > 3, etc)
    if (typeof spec.appliesIf === 'function' && !spec.appliesIf(calc)) {
        return null;
    }
    // 4. Read & validate current value
    const currentValue = readCurrentValue(calc, spec);
    if (!Number.isFinite(currentValue) || currentValue <= 0) {
        return null;
    }
    // 5. Compute proposed
    const proposedValue = computeProposedValue(spec, currentValue, tier.id, constraints);
    if (proposedValue == null || !Number.isFinite(proposedValue) || proposedValue >= currentValue) {
        return null;
    }
    // 6. Clone + recompute
    const clone = cloneCalc(calc);
    applyToClone(clone, spec, proposedValue);
    let simResult;
    try { simResult = calculate(clone, null); }
    catch (_e) { return null; }
    const simTotal = Number(simResult?.totalMonthly) || 0;
    const savingRub = baseTotal - simTotal;
    if (!Number.isFinite(savingRub) || savingRub <= 0) {
        return null;
    }
    const savingPercent = baseTotal > 0 ? (savingRub / baseTotal) * 100 : 0;
    if (!Number.isFinite(savingPercent) || savingPercent <= 0) {
        return null;
    }

    return {
        id: `${spec.id}__${tier.id}`,
        specId: spec.id,
        title: spec.title,
        category: spec.category,
        fieldId: spec.focusFieldId,
        from: currentValue,
        to: proposedValue,
        expectedSavingRub: savingRub,
        expectedSavingPercent: savingPercent,
        riskLevel: spec.risk,
        consequence: spec.consequence,
        blocked: false,
        blockedReason: null
    };
}

function aggregatePlanRisk(levers, baseRisk) {
    if (levers.some(l => l.riskLevel === 'high')) return 'high';
    if (levers.some(l => l.riskLevel === 'medium')) return baseRisk === 'low' ? 'medium' : baseRisk;
    return baseRisk;
}

function computeBlockers(tier, constraints) {
    const out = [];
    if (tier.id === PLAN_IDS.AMBITIOUS || tier.id === PLAN_IDS.EXTREME) {
        if (!constraints.allowReliabilityTradeoff) out.push('reliability');
        if (!constraints.allowAiReduction)         out.push('ai');
        if (!constraints.allowRiskBufferReduction) out.push('risk_buffers');
    }
    return out;
}

function feasibilitySummary(tier, expectedReductionPercent, feasible) {
    if (!feasible) {
        return `Цель ${tier.range.minPercent}–${tier.range.maxPercent}% не достигается выбранными ограничениями.`;
    }
    if (expectedReductionPercent < tier.range.minPercent + 0.01) {
        return `Цель ${tier.range.minPercent}–${tier.range.maxPercent}% достигнута на нижней границе.`;
    }
    return `Цель ${tier.range.minPercent}–${tier.range.maxPercent}% достижима.`;
}

/**
 * Построить набор levers для конкретного tier (без plan-aggregation).
 * Полезно для тестов и для UI, который рисует «доступные рычаги».
 */
export function buildOptimizationLevers(calc, tier, options = {}) {
    if (!calc || !tier) return [];
    const constraints = { ...DEFAULT_CONSTRAINTS, ...(options.constraints || {}) };
    let baseTotal;
    try { baseTotal = Number(calculate(calc, null)?.totalMonthly) || 0; }
    catch (_e) { return []; }
    if (baseTotal <= 0) return [];
    const out = [];
    for (const spec of LEVER_SPECS) {
        const lever = buildLever(spec, calc, tier, constraints, baseTotal);
        if (lever) out.push(lever);
    }
    return out;
}

/**
 * Главная функция: 3 плана с levers, экономией, риском и feasibility.
 *
 * @param {object|null} calc
 * @param {object} [options]
 * @param {object} [options.constraints]
 * @returns {Array<Plan>}
 */
export function buildOptimizationPlans(calc, options = {}) {
    const constraints = { ...DEFAULT_CONSTRAINTS, ...(options.constraints || {}) };

    if (!calc) {
        return PLAN_TIERS.map(tier => emptyPlan(tier, constraints, 0));
    }

    let baseTotal = 0;
    try { baseTotal = Number(calculate(calc, null)?.totalMonthly) || 0; }
    catch (_e) { /* leave 0 */ }
    if (baseTotal <= 0) {
        return PLAN_TIERS.map(tier => emptyPlan(tier, constraints, 0));
    }

    return PLAN_TIERS.map(tier => {
        const levers = [];
        for (const spec of LEVER_SPECS) {
            const lever = buildLever(spec, calc, tier, constraints, baseTotal);
            if (lever) levers.push(lever);
        }

        // Honest plan total: применяем ВСЕ levers одновременно, recompute → реальная экономия.
        // Сумма по-lever savings игнорирует cross-effects (risk uplift, VAT и т.п.).
        let planTotalSavingRub = 0;
        if (levers.length > 0) {
            const clone = cloneCalc(calc);
            for (const lever of levers) {
                const spec = LEVER_SPECS.find(s => s.id === lever.specId);
                if (spec) applyToClone(clone, spec, lever.to);
            }
            try {
                const simTotal = Number(calculate(clone, null)?.totalMonthly) || 0;
                planTotalSavingRub = Math.max(0, baseTotal - simTotal);
            } catch (_e) {
                planTotalSavingRub = levers.reduce((s, l) => s + l.expectedSavingRub, 0);
            }
        }
        const planSavingPercent = baseTotal > 0
            ? (planTotalSavingRub / baseTotal) * 100
            : 0;

        const expectedReductionPercent = Math.min(planSavingPercent, tier.range.maxPercent + 5);
        const feasible = expectedReductionPercent >= tier.range.minPercent;
        const aggregatedRisk = aggregatePlanRisk(levers, tier.risk);

        const seenC = new Set();
        const consequences = [];
        for (const l of levers) {
            if (!seenC.has(l.consequence)) {
                seenC.add(l.consequence);
                consequences.push(l.consequence);
            }
        }

        return {
            id: tier.id,
            title: tier.title,
            subtitle: tier.subtitle,
            description: tier.description,
            targetRange: { ...tier.range },
            expectedReductionPercent,
            expectedSavingRub: planTotalSavingRub,
            riskLevel: aggregatedRisk,
            feasible,
            levers,
            summary: feasibilitySummary(tier, expectedReductionPercent, feasible),
            consequences,
            blockers: feasible ? [] : computeBlockers(tier, constraints)
        };
    });
}

function emptyPlan(tier, _constraints, _baseTotal) {
    return {
        id: tier.id,
        title: tier.title,
        subtitle: tier.subtitle,
        description: tier.description,
        targetRange: { ...tier.range },
        expectedReductionPercent: 0,
        expectedSavingRub: 0,
        riskLevel: tier.risk,
        feasible: false,
        levers: [],
        summary: `Расчёт пуст — план ${tier.title.toLowerCase()} не построен.`,
        consequences: [],
        blockers: []
    };
}

/**
 * Сортировка планов: по id (conservative → ambitious → extreme).
 */
export function rankOptimizationPlans(plans) {
    if (!Array.isArray(plans)) return [];
    const order = { [PLAN_IDS.CONSERVATIVE]: 0, [PLAN_IDS.AMBITIOUS]: 1, [PLAN_IDS.EXTREME]: 2 };
    return [...plans].sort((a, b) => (order[a?.id] ?? 99) - (order[b?.id] ?? 99));
}

/**
 * Краткая сводка плана для Memo / отчёта.
 */
export function summarizeOptimizationPlan(plan) {
    if (!plan) return '';
    const { title, targetRange, expectedReductionPercent, riskLevel, feasible, levers } = plan;
    const head = `${title}: ${targetRange.minPercent}–${targetRange.maxPercent}%, риск ${riskLevel}`;
    if (!feasible) {
        return `${head}. Недостижим: максимум ${expectedReductionPercent.toFixed(1)}%.`;
    }
    return `${head}. Ожидаемая экономия: ${expectedReductionPercent.toFixed(1)}%, рычагов: ${levers.length}.`;
}

/**
 * Feasibility-сводка для всех планов: помогает UI решить, какой план «доступен».
 */
export function getOptimizationFeasibility(plans) {
    if (!Array.isArray(plans)) return [];
    return plans.map(p => ({
        id: p.id,
        feasible: p.feasible,
        targetRange: p.targetRange,
        maxAchievablePercent: p.expectedReductionPercent,
        blockers: p.blockers || []
    }));
}
