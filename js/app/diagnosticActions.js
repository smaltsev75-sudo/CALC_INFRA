import { calculate } from '../domain/calculator.js';
import { evaluateCalculationHealth } from '../domain/calculationHealth.js';
import { aggregateAiMetrics } from '../ui/dashboardAggregates.js';
import { copyTextToClipboard } from '../services/clipboard.js';
import { APP_VERSION, STAND_IDS } from '../utils/constants.js';

function cloneJson(value, fallback = null) {
    if (value === undefined) return fallback;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_err) {
        return fallback;
    }
}

function answerDefault(question) {
    if (question?.defaultIfUnknown !== undefined && question.defaultIfUnknown !== null) {
        return question.defaultIfUnknown;
    }
    if (question?.defaultValue !== undefined && question.defaultValue !== null) {
        return question.defaultValue;
    }
    return undefined;
}

export function buildNormalizedAnswers(calc) {
    const answers = calc?.answers || {};
    const out = {};
    for (const question of calc?.dictionaries?.questions || []) {
        const value = answers[question.id];
        if (value !== null && value !== undefined && value !== '') {
            out[question.id] = value;
            continue;
        }
        const def = answerDefault(question);
        if (def !== undefined) out[question.id] = def;
    }
    for (const [id, value] of Object.entries(answers)) {
        if (!Object.prototype.hasOwnProperty.call(out, id)) out[id] = value;
    }
    return out;
}

function buildItemQtyDiagnostics(calc, result) {
    const itemsById = new Map((calc?.dictionaries?.items || []).map(item => [item.id, item]));
    return Object.entries(result?.items || {}).map(([itemId, itemResult]) => {
        const item = itemsById.get(itemId) || {};
        return {
            itemId,
            name: item.name || itemId,
            category: item.category || null,
            unit: item.unit || '',
            dashboardResource: item.dashboardResource || null,
            dashboardAiMetric: item.dashboardAiMetric || null,
            stands: Object.fromEntries(STAND_IDS.map(stand => [
                stand,
                {
                    qty: Number(itemResult?.stands?.[stand]?.qty) || 0,
                    costMonthly: Number(itemResult?.stands?.[stand]?.costFinal) || 0,
                    error: itemResult?.stands?.[stand]?.error || null
                }
            ])),
            totalMonthly: Number(itemResult?.totalMonthly) || 0
        };
    });
}

function safeHealth(calc) {
    try {
        const health = evaluateCalculationHealth(calc);
        return {
            score: health.score,
            counts: health.counts,
            findings: (health.findings || []).map(finding => ({
                id: finding.id,
                severity: finding.severity,
                category: finding.category,
                title: finding.title,
                message: finding.message,
                fieldIds: finding.fieldIds || [],
                suggestedAction: finding.suggestedAction || ''
            }))
        };
    } catch (err) {
        return { error: err?.message || String(err) };
    }
}

function safeCalculate(calc, revision) {
    try {
        return { result: calculate(calc, revision), error: null };
    } catch (err) {
        return { result: null, error: err?.message || String(err) };
    }
}

function safeAiMetrics(calc, result) {
    if (!calc || !result) return null;
    try {
        return aggregateAiMetrics(
            result,
            calc.dictionaries?.items || [],
            calc.view?.disabledStands || [],
            calc.settings?.applyRiskFactors !== false,
            calc
        );
    } catch (err) {
        return { error: err?.message || String(err) };
    }
}

export function buildCalculationDiagnosticBundle(calc, options = {}) {
    const generatedAt = options.now || new Date().toISOString();
    const revision = options.revision ?? null;
    const { result, error } = safeCalculate(calc, revision);
    return {
        schema: 'calc-diagnostics-v1',
        generatedAt,
        appVersion: APP_VERSION,
        warning:
            'Локальный диагностический дамп: приложение само никуда его не отправляет. ' +
            'Внутри могут быть параметры расчёта; делитесь им только осознанно.',
        calc: calc ? {
            id: calc.id || null,
            name: calc.name || '',
            schemaVersion: calc.schemaVersion ?? null,
            updatedAt: calc.updatedAt || null,
            activeScenarioId: calc.activeScenarioId || null,
            provider: calc.settings?.provider || null,
            disabledStands: Array.isArray(calc.view?.disabledStands)
                ? calc.view.disabledStands.slice()
                : []
        } : null,
        answers: cloneJson(calc?.answers || {}, {}),
        normalizedAnswers: buildNormalizedAnswers(calc),
        answersMeta: cloneJson(calc?.answersMeta || {}, {}),
        health: calc ? safeHealth(calc) : null,
        aggregateAiMetrics: safeAiMetrics(calc, result),
        result: result ? {
            totalMonthly: Number(result.totalMonthly) || 0,
            totalAnnual: Number(result.totalAnnual) || 0,
            byCategory: cloneJson(result.byCategory, {}),
            items: buildItemQtyDiagnostics(calc, result)
        } : { error }
    };
}

export async function copyCalculationDiagnosticBundle(calc, options = {}) {
    const bundle = buildCalculationDiagnosticBundle(calc, options);
    const ok = await copyTextToClipboard(JSON.stringify(bundle, null, 2));
    return { ok, bundle };
}
