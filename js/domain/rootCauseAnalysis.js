/**
 * Root-cause analysis for budget optimisation.
 *
 * This module answers a different question than "which item is expensive":
 * which input parameters can materially reduce the current budget if reviewed.
 * It runs real recalculations, then shows which configuration items moved.
 */

import { calculate } from './calculator.js';
import { applyStandFilter } from './standsFilter.js';
import { buildQuantityTrace } from './quantityTrace.js';
import {
    MONTHS_PER_YEAR,
    SENSITIVITY_FIELD_CATEGORIES,
    SENSITIVITY_NUMERIC_FIELDS,
    SENSITIVITY_SETTINGS_NUMERIC_FIELDS,
    SENSITIVITY_SETTINGS_TOGGLE_FIELDS,
    SENSITIVITY_TOGGLE_FIELDS,
    STAND_IDS
} from '../utils/constants.js';

const MONEY_EPS = 0.01;
const DEFAULT_LIMIT = 8;
const DEFAULT_NUMERIC_REDUCTION_PCT = 10;
const NON_OPTIMIZATION_FIELDS = new Set([
    'applyRiskFactors',
    'vatEnabled',
    'vatRate'
]);
const SETTINGS_LABELS = Object.freeze({
    planningHorizonYears: 'Горизонт планирования, лет',
    phaseDurationMonths: 'Длительность фазы, мес.',
    bufferTask: 'Буфер задачи',
    bufferProject: 'Буфер проекта',
    kInflation: 'Коэффициент инфляции',
    kContingency: 'Непредвиденные расходы',
    kSeasonal: 'Сезонный коэффициент',
    kScheduleShift: 'Сдвиг графика'
});

function cloneCalc(calc) {
    return JSON.parse(JSON.stringify(calc));
}

function setField(clone, candidate, value) {
    if (candidate.scope === 'setting') {
        clone.settings = { ...(clone.settings || {}), [candidate.fieldId]: value };
    } else {
        clone.answers = { ...(clone.answers || {}), [candidate.fieldId]: value };
    }
}

function getField(calc, candidate) {
    return candidate.scope === 'setting'
        ? calc?.settings?.[candidate.fieldId]
        : calc?.answers?.[candidate.fieldId];
}

function activeMonthlyForItem(itemResult, disabled) {
    let total = 0;
    for (const stand of STAND_IDS) {
        if (disabled.has(stand)) continue;
        total += itemResult?.stands?.[stand]?.costFinal || 0;
    }
    return total;
}

function activeTotal(result, disabledStands) {
    return Number(applyStandFilter(result, disabledStands)?.totalMonthly) || 0;
}

function buildItemNameMap(calc) {
    return new Map((calc?.dictionaries?.items || []).map(item => [item.id, item.name || item.id]));
}

function buildMetaByField(calc) {
    const meta = new Map();
    const questions = calc?.dictionaries?.questions || [];
    const qById = new Map(questions.map(question => [question.id, question]));
    for (const candidate of buildCandidates()) {
        meta.set(candidate.fieldId, {
            label: SETTINGS_LABELS[candidate.fieldId] || qById.get(candidate.fieldId)?.title || candidate.fieldId,
            category: SENSITIVITY_FIELD_CATEGORIES[candidate.fieldId] || 'service'
        });
    }
    return meta;
}

function buildCandidates() {
    return [
        ...SENSITIVITY_NUMERIC_FIELDS.map(fieldId => ({ scope: 'answer', kind: 'numeric', fieldId })),
        ...SENSITIVITY_SETTINGS_NUMERIC_FIELDS.map(fieldId => ({ scope: 'setting', kind: 'numeric', fieldId })),
        ...SENSITIVITY_TOGGLE_FIELDS.map(fieldId => ({ scope: 'answer', kind: 'toggle', fieldId })),
        ...SENSITIVITY_SETTINGS_TOGGLE_FIELDS.map(fieldId => ({ scope: 'setting', kind: 'toggle', fieldId }))
    ].filter(candidate => !NON_OPTIMIZATION_FIELDS.has(candidate.fieldId));
}

function compareItems(baseResult, simulatedResult, calc, disabled) {
    const names = buildItemNameMap(calc);
    const itemIds = new Set([
        ...Object.keys(baseResult?.items || {}),
        ...Object.keys(simulatedResult?.items || {})
    ]);

    const rows = [];
    for (const itemId of itemIds) {
        const before = activeMonthlyForItem(baseResult?.items?.[itemId], disabled);
        const after = activeMonthlyForItem(simulatedResult?.items?.[itemId], disabled);
        const saving = before - after;
        if (Math.abs(saving) <= MONEY_EPS) continue;
        rows.push({
            itemId,
            itemName: names.get(itemId) || itemId,
            beforeMonthly: before,
            afterMonthly: after,
            savingMonthly: saving,
            absDeltaMonthly: Math.abs(saving)
        });
    }

    return rows.sort((a, b) => b.absDeltaMonthly - a.absDeltaMonthly);
}

function settingPathMatches(path, fieldId) {
    return path === fieldId || path.startsWith(`${fieldId}.`) || fieldId.startsWith(`${path}.`);
}

function buildDirectLinks(calc, result, disabled, candidate) {
    const itemNames = buildItemNameMap(calc);
    const linkedItems = new Map();
    let formulaCount = 0;

    for (const item of calc?.dictionaries?.items || []) {
        for (const stand of STAND_IDS) {
            if (disabled.has(stand)) continue;
            try {
                const trace = buildQuantityTrace(calc, item.id, stand, result);
                const linked = candidate.scope === 'answer'
                    ? trace.questionInputs.some(input => input.id === candidate.fieldId)
                    : trace.settingInputs.some(input => settingPathMatches(input.path, candidate.fieldId));
                if (!linked) continue;
                formulaCount++;
                linkedItems.set(item.id, itemNames.get(item.id) || item.id);
            } catch (_error) {
                // Broken formula tracing for one item must not hide other root causes.
            }
        }
    }

    return {
        formulaCount,
        itemNames: [...linkedItems.values()].slice(0, 5)
    };
}

function simulateCandidate(calc, candidate, context) {
    const currentValue = getField(calc, candidate);
    const clone = cloneCalc(calc);
    let proposedValue;
    let actionLabel;

    if (candidate.kind === 'numeric') {
        const currentNumber = Number(currentValue);
        if (!Number.isFinite(currentNumber) || currentNumber <= 0) return null;
        proposedValue = currentNumber * (1 - context.numericReductionPct / 100);
        actionLabel = `проверить -${context.numericReductionPct}%`;
    } else {
        proposedValue = !Boolean(currentValue);
        actionLabel = 'проверить необходимость';
    }

    setField(clone, candidate, proposedValue);

    let simulatedResult;
    try {
        simulatedResult = calculate(clone, null);
    } catch (_error) {
        return null;
    }

    const afterMonthly = activeTotal(simulatedResult, context.disabledStands);
    const savingMonthly = context.beforeMonthly - afterMonthly;
    if (savingMonthly <= MONEY_EPS) return null;

    const meta = context.metaByField.get(candidate.fieldId) || {
        label: candidate.fieldId,
        category: 'service'
    };
    const affectedItems = compareItems(
        context.baseResult,
        simulatedResult,
        calc,
        context.disabledSet
    );
    const links = buildDirectLinks(calc, context.baseResult, context.disabledSet, candidate);

    return {
        fieldId: candidate.fieldId,
        scope: candidate.scope,
        kind: candidate.kind,
        label: meta.label,
        category: meta.category,
        currentValue,
        proposedValue,
        actionLabel,
        beforeMonthly: context.beforeMonthly,
        afterMonthly,
        savingMonthly,
        savingAnnual: savingMonthly * MONTHS_PER_YEAR,
        savingPercent: context.beforeMonthly > 0 ? (savingMonthly / context.beforeMonthly) * 100 : 0,
        affectedItemsCount: affectedItems.length,
        topAffectedItems: affectedItems.slice(0, 5),
        directFormulaCount: links.formulaCount,
        directItemNames: links.itemNames
    };
}

export function buildRootCauseAnalysisModel(calc, options = {}) {
    if (!calc) return { limit: DEFAULT_LIMIT, rows: [], shown: 0, beforeMonthly: 0 };

    const limit = Number.isInteger(options.limit) ? Math.max(1, options.limit) : DEFAULT_LIMIT;
    const numericReductionPct = Number.isFinite(Number(options.numericReductionPct))
        ? Math.max(1, Math.min(50, Number(options.numericReductionPct)))
        : DEFAULT_NUMERIC_REDUCTION_PCT;
    const disabledStands = Array.isArray(options.disabledStands) ? options.disabledStands : [];
    const disabledSet = new Set(disabledStands);

    const baseResult = options.result || calculate(calc);
    const beforeMonthly = activeTotal(baseResult, disabledStands);
    const metaByField = buildMetaByField(calc);
    const context = {
        baseResult,
        beforeMonthly,
        disabledStands,
        disabledSet,
        metaByField,
        numericReductionPct
    };

    const rows = buildCandidates()
        .map(candidate => simulateCandidate(calc, candidate, context))
        .filter(Boolean)
        .sort((a, b) => b.savingMonthly - a.savingMonthly)
        .slice(0, limit);

    return {
        limit,
        shown: rows.length,
        beforeMonthly,
        numericReductionPct,
        rows
    };
}
