/**
 * Stage 15.3 (PATCH 2.8.2) — Sensitivity Analysis.
 *
 * Чистый domain-модуль (без DOM, store, services). Отвечает на вопрос:
 * «Какие параметры расчёта сильнее всего влияют на итоговую стоимость?»
 *
 * Алгоритм:
 *   1. Взять активный расчёт (передаётся снаружи).
 *   2. Для каждого числового поля: deep-clone calc, увеличить поле на +10%,
 *      пересчитать, сравнить с baseline.
 *   3. Для каждого булева поля: deep-clone, переключить, пересчитать.
 *   4. Разделить на results (ok) и notAvailable (na: нулевое/null значение или ошибка).
 *   5. Ранжировать results по abs(delta) для выбранного cost-type.
 *
 * Ограничения:
 *   - Анализирует только активный сценарий.
 *   - Исходный calc НЕ мутируется (deep-clone перед каждым изменением).
 *   - Кэш calculate() обходится через revision=null.
 *   - Не делает сетевых запросов, не читает localStorage.
 */

import { calculate } from './calculator.js';
import { SEED_QUESTIONS } from './seed.js';
import {
    SENSITIVITY_NUMERIC_FIELDS,
    SENSITIVITY_TOGGLE_FIELDS,
    SENSITIVITY_SETTINGS_NUMERIC_FIELDS,
    SENSITIVITY_SETTINGS_TOGGLE_FIELDS,
    SENSITIVITY_FIELD_CATEGORIES
} from '../utils/constants.js';

/* ============================================================
 * Внутренние множества для O(1) lookup
 * ============================================================ */

const SETTINGS_NUMERIC = new Set(SENSITIVITY_SETTINGS_NUMERIC_FIELDS);
const SETTINGS_TOGGLE  = new Set(SENSITIVITY_SETTINGS_TOGGLE_FIELDS);

/* Человекочитаемые метки для settings-полей (в вопросах опросника их нет). */
const SETTINGS_LABELS = Object.freeze({
    planningHorizonYears: 'Горизонт планирования, лет',
    phaseDurationMonths:  'Длительность фазы, мес.',
    bufferTask:           'Буфер задачи',
    bufferProject:        'Буфер проекта',
    kInflation:           'Коэффициент инфляции',
    kContingency:         'Непредвиденные расходы',
    kSeasonal:            'Сезонный коэффициент',
    kScheduleShift:       'Сдвиг графика',
    vatRate:              'Ставка НДС',
    applyRiskFactors:     'Применять риск-коэффициенты',
    vatEnabled:           'Учитывать НДС'
});

/* ============================================================
 * Helpers (module-private)
 * ============================================================ */

function cloneCalc(calc) {
    return JSON.parse(JSON.stringify(calc));
}

/** Вернуть metric-объект из результата calculate().
 *  ВАЖНО: result.byCostType.opex и .capex — это ПЛОСКИЕ числа (₽), а не
 *  объекты {totalMonthly}. См. calculator.js:488 — там аккумулируется
 *  `result.byCostType[ct] += costFinal`. До hotfix Stage 17.1 здесь стояло
 *  `?.byCostType?.opex?.totalMonthly`, которое всегда давало undefined → 0,
 *  и весь Sensitivity Analysis по OPEX/CAPEX показывал нули. budgetGuardrails.js
 *  читает поле корректно — паттерн оттуда. */
function extractMetrics(result) {
    return {
        opexMonthly:  Number(result?.byCostType?.opex)  || 0,
        capexMonthly: Number(result?.byCostType?.capex) || 0,
        total:        Number(result?.totalMonthly)      || 0
    };
}

function getLabelForField(calc, fieldId) {
    if (SETTINGS_LABELS[fieldId]) return SETTINGS_LABELS[fieldId];
    const questions = calc.dictionaries?.questions || SEED_QUESTIONS;
    const q = questions.find(q => q.id === fieldId);
    return q?.title || fieldId;
}

function getCategoryForField(fieldId) {
    return SENSITIVITY_FIELD_CATEGORIES[fieldId] || 'service';
}

function getDeltaAbsValue(delta, costType) {
    if (costType === 'opex')  return Math.abs(delta.opexMonthly);
    if (costType === 'capex') return Math.abs(delta.capexMonthly);
    return Math.abs(delta.total);
}

function computeDelta(baseMets, simMets) {
    const delta = {
        opexMonthly:  simMets.opexMonthly  - baseMets.opexMonthly,
        capexMonthly: simMets.capexMonthly - baseMets.capexMonthly,
        total:        simMets.total        - baseMets.total
    };
    const safePercent = (d, b) => (b !== 0 ? (d / b) * 100 : 0);
    const deltaPercent = {
        opexMonthly:  safePercent(delta.opexMonthly,  baseMets.opexMonthly),
        capexMonthly: safePercent(delta.capexMonthly, baseMets.capexMonthly),
        total:        safePercent(delta.total,         baseMets.total)
    };
    return { delta, deltaPercent };
}

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * Симулирует +perturbPercent% к числовому полю.
 *
 * @param {object} calc - активный расчёт (не мутируется)
 * @param {string} fieldId - id поля (answers или settings)
 * @param {number} [perturbPercent=10] - процент изменения
 * @returns {object} sensitivity result или N/A
 */
export function simulateNumericPerturbation(calc, fieldId, perturbPercent = 10) {
    const isSettings = SETTINGS_NUMERIC.has(fieldId);
    const currentValue = isSettings
        ? (calc.settings?.[fieldId] ?? null)
        : (calc.answers?.[fieldId] ?? null);

    const label    = getLabelForField(calc, fieldId);
    const category = getCategoryForField(fieldId);

    const numVal = Number(currentValue);
    if (!Number.isFinite(numVal) || numVal === 0) {
        return {
            fieldId, label, category, status: 'na',
            reason: (numVal === 0)
                ? 'Нулевое исходное значение — нельзя посчитать изменение.'
                : 'Значение не задано.'
        };
    }

    let baseResult;
    try {
        baseResult = calculate(calc, null);
    } catch (_e) {
        return { fieldId, label, category, status: 'na', reason: 'Ошибка базового расчёта.' };
    }

    const baseMets = extractMetrics(baseResult);
    const simulatedValue = numVal * (1 + perturbPercent / 100);
    const clone = cloneCalc(calc);

    if (isSettings) {
        clone.settings = { ...clone.settings, [fieldId]: simulatedValue };
    } else {
        clone.answers  = { ...clone.answers,  [fieldId]: simulatedValue };
    }

    let simResult;
    try {
        simResult = calculate(clone, null);
    } catch (_e) {
        return { fieldId, label, category, status: 'na', reason: 'Ошибка пересчёта.' };
    }

    const simMets = extractMetrics(simResult);
    const { delta, deltaPercent } = computeDelta(baseMets, simMets);

    return {
        fieldId, label, category,
        perturbationType: 'numeric',
        changeLabel: `+${perturbPercent}%`,
        baselineValue: numVal,
        simulatedValue,
        baseline:     baseMets,
        simulated:    simMets,
        delta,
        deltaPercent,
        note:   null,
        status: 'ok'
    };
}

/**
 * Симулирует переключение булева поля (false→true или true→false).
 * Если включение открывает зависимые поля — заполняет их дефолтными значениями
 * из словаря вопросов и добавляет note.
 *
 * @param {object} calc - активный расчёт (не мутируется)
 * @param {string} fieldId - id поля (answers или settings)
 * @returns {object} sensitivity result или N/A
 */
export function simulateTogglePerturbation(calc, fieldId) {
    const isSettings = SETTINGS_TOGGLE.has(fieldId);
    const currentValue = isSettings
        ? (calc.settings?.[fieldId] ?? false)
        : (calc.answers?.[fieldId] ?? false);

    const label    = getLabelForField(calc, fieldId);
    const category = getCategoryForField(fieldId);

    let baseResult;
    try {
        baseResult = calculate(calc, null);
    } catch (_e) {
        return { fieldId, label, category, status: 'na', reason: 'Ошибка базового расчёта.' };
    }

    const baseMets = extractMetrics(baseResult);
    const newValue = !currentValue;
    const clone    = cloneCalc(calc);
    let note = null;

    if (isSettings) {
        clone.settings = { ...clone.settings, [fieldId]: newValue };
    } else {
        clone.answers = { ...clone.answers, [fieldId]: newValue };

        // Включение master-toggle: заполнить зависимые поля дефолтами из словаря
        if (newValue) {
            const questions = calc.dictionaries?.questions || SEED_QUESTIONS;
            const dependents = questions.filter(
                q => Array.isArray(q.dependsOn) && q.dependsOn.includes(fieldId)
            );
            if (dependents.length > 0) {
                for (const dq of dependents) {
                    const hasAnswer = clone.answers[dq.id] !== null && clone.answers[dq.id] !== undefined;
                    if (!hasAnswer) {
                        const def = dq.defaultIfUnknown !== undefined ? dq.defaultIfUnknown : dq.defaultValue;
                        if (def !== undefined) clone.answers[dq.id] = def;
                    }
                }
                note = 'Использованы значения по умолчанию для зависимых полей.';
            }
        }
    }

    let simResult;
    try {
        simResult = calculate(clone, null);
    } catch (_e) {
        return { fieldId, label, category, status: 'na', reason: 'Ошибка пересчёта.' };
    }

    const simMets = extractMetrics(simResult);
    const { delta, deltaPercent } = computeDelta(baseMets, simMets);

    return {
        fieldId, label, category,
        perturbationType: 'toggle',
        changeLabel: currentValue ? 'выкл → вкл' : 'вкл → выкл',
        baselineValue:  !!currentValue,
        simulatedValue: newValue,
        baseline:   baseMets,
        simulated:  simMets,
        delta,
        deltaPercent,
        note,
        status: 'ok'
    };
}

/**
 * Запускает полный анализ чувствительности для активного расчёта.
 *
 * @param {object|null} calc - активный расчёт
 * @param {object} [options] - переопределения полей и процента
 * @returns {{ results: Array, notAvailable: Array }}
 */
export function runSensitivityAnalysis(calc, options = {}) {
    if (!calc) return { results: [], notAvailable: [] };

    const {
        perturbPercent         = 10,
        numericFields          = SENSITIVITY_NUMERIC_FIELDS,
        toggleFields           = SENSITIVITY_TOGGLE_FIELDS,
        settingsNumericFields  = SENSITIVITY_SETTINGS_NUMERIC_FIELDS,
        settingsToggleFields   = SENSITIVITY_SETTINGS_TOGGLE_FIELDS
    } = options;

    const results      = [];
    const notAvailable = [];

    for (const fieldId of numericFields) {
        const r = simulateNumericPerturbation(calc, fieldId, perturbPercent);
        (r.status === 'ok' ? results : notAvailable).push(r);
    }

    for (const fieldId of settingsNumericFields) {
        const r = simulateNumericPerturbation(calc, fieldId, perturbPercent);
        (r.status === 'ok' ? results : notAvailable).push(r);
    }

    for (const fieldId of toggleFields) {
        const r = simulateTogglePerturbation(calc, fieldId);
        (r.status === 'ok' ? results : notAvailable).push(r);
    }

    for (const fieldId of settingsToggleFields) {
        const r = simulateTogglePerturbation(calc, fieldId);
        (r.status === 'ok' ? results : notAvailable).push(r);
    }

    return { results, notAvailable };
}

/**
 * Ранжирует результаты анализа по убыванию abs(delta) для заданного costType.
 *
 * @param {Array} results - массив sensitivity results (status='ok')
 * @param {string} [costType='opex'] - 'opex' | 'capex' | 'total'
 * @param {string[]|null} [categories] - фильтр по категориям (null = все)
 * @returns {Array} отсортированный массив (не мутирует аргумент)
 */
export function rankSensitivityDrivers(results, costType = 'opex', categories = null) {
    let filtered = results.filter(r => r.status === 'ok');

    if (categories && categories.length > 0) {
        filtered = filtered.filter(r => categories.includes(r.category));
    }

    return [...filtered].sort((a, b) =>
        getDeltaAbsValue(b.delta, costType) - getDeltaAbsValue(a.delta, costType)
    );
}
