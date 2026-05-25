/**
 * Repair helpers for imported / legacy answers.
 *
 * JSON.stringify(NaN) becomes null, and imported files can also contain
 * explicit null for "unknown" answers. Formulas must not treat such values as
 * zero when a question has a documented defaultIfUnknown/defaultValue.
 */

import { CRITICAL_FIELDS } from '../utils/constants.js';

const CRITICAL_FIELD_IDS = new Set(CRITICAL_FIELDS);

function cloneValue(value) {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
}

function getFallback(q) {
    if (!q || typeof q !== 'object') return { hasFallback: false, value: undefined, source: null };
    if (q.defaultIfUnknown !== undefined && q.defaultIfUnknown !== null) {
        return { hasFallback: true, value: cloneValue(q.defaultIfUnknown), source: 'defaultIfUnknown' };
    }
    if (q.defaultValue !== undefined && q.defaultValue !== null) {
        return { hasFallback: true, value: cloneValue(q.defaultValue), source: 'defaultValue' };
    }
    return { hasFallback: false, value: undefined, source: null };
}

function isNumberInRange(value, q) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (typeof q.min === 'number' && value < q.min) return false;
    if (typeof q.max === 'number' && value > q.max) return false;
    return true;
}

function pushRepair(repairs, { scope, fieldId, q, fallbackSource, value, reason, scenario }) {
    repairs.push({
        scope,
        path: `${scope}.${fieldId}`,
        fieldId,
        title: q?.title || fieldId,
        fallbackSource,
        value: cloneValue(value),
        reason,
        scenarioId: scenario?.id || null,
        scenarioLabel: scenario?.label || null
    });
}

function repairAnswersObject(answers, questionsById, scope, repairs, scenario = null) {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return;
    for (const [fieldId, value] of Object.entries(answers)) {
        const q = questionsById.get(fieldId);
        if (!q) continue;

        if (q.type === 'number' && typeof value === 'string' && value.trim() !== '') {
            const normalized = Number(value.replace(',', '.'));
            if (isNumberInRange(normalized, q)) {
                answers[fieldId] = normalized;
                pushRepair(repairs, {
                    scope, fieldId, q, fallbackSource: 'coerceNumber',
                    value: normalized, reason: 'numeric-string', scenario
                });
                continue;
            }
        }

        if (q.type === 'select' && typeof value === 'string' && value.trim() !== '' && Array.isArray(q.options)) {
            const allowed = q.options.map(option =>
                (option && typeof option === 'object' && 'value' in option) ? option.value : option
            );
            const normalized = Number(value.replace(',', '.'));
            if (Number.isFinite(normalized) && allowed.includes(normalized)) {
                answers[fieldId] = normalized;
                pushRepair(repairs, {
                    scope, fieldId, q, fallbackSource: 'coerceSelect',
                    value: normalized, reason: 'select-numeric-string', scenario
                });
                continue;
            }
        }

        const fallback = getFallback(q);
        if (q.type === 'number' && typeof value === 'number' &&
                !isNumberInRange(value, q) && fallback.hasFallback &&
                CRITICAL_FIELD_IDS.has(fieldId)) {
            const fallbackNumber = Number(fallback.value);
            if (isNumberInRange(fallbackNumber, q)) {
                answers[fieldId] = fallbackNumber;
                pushRepair(repairs, {
                    scope, fieldId, q, fallbackSource: fallback.source,
                    value: fallbackNumber, reason: 'out-of-range', scenario
                });
                continue;
            }
        }

        if (value !== null && value !== undefined) continue;
        if (!fallback.hasFallback) continue;
        const nextValue = cloneValue(fallback.value);
        answers[fieldId] = nextValue;
        pushRepair(repairs, {
            scope, fieldId, q, fallbackSource: fallback.source,
            value: nextValue, reason: 'empty', scenario
        });
    }

    for (const fieldId of CRITICAL_FIELD_IDS) {
        if (Object.prototype.hasOwnProperty.call(answers, fieldId)) continue;
        const q = questionsById.get(fieldId);
        const fallback = getFallback(q);
        if (!fallback.hasFallback) continue;
        const nextValue = cloneValue(fallback.value);
        answers[fieldId] = nextValue;
        pushRepair(repairs, {
            scope, fieldId, q, fallbackSource: fallback.source,
            value: nextValue, reason: 'missing', scenario
        });
    }
}

/**
 * Replace explicit null/undefined answers with documented fallbacks.
 *
 * Missing keys are filled only for CRITICAL_FIELDS: those answers drive core
 * infrastructure and must be visible in the manual review dialog after import.
 *
 * @param {object} calc
 * @returns {{ changed: boolean, repairs: Array<object> }}
 */
export function repairUnknownAnswersWithDefaults(calc) {
    const repairs = [];
    if (!calc || typeof calc !== 'object') return { changed: false, repairs };

    const questions = Array.isArray(calc.dictionaries?.questions)
        ? calc.dictionaries.questions
        : [];
    const questionsById = new Map(
        questions.filter(q => q?.id).map(q => [q.id, q])
    );
    if (questionsById.size === 0) return { changed: false, repairs };

    repairAnswersObject(calc.answers, questionsById, 'answers', repairs);

    if (Array.isArray(calc.scenarios)) {
        calc.scenarios.forEach((scenario, index) => {
            if (!scenario || typeof scenario !== 'object') return;
            repairAnswersObject(
                scenario.answers,
                questionsById,
                `scenarios[${index}].answers`,
                repairs,
                scenario
            );
        });
    }

    return { changed: repairs.length > 0, repairs };
}
