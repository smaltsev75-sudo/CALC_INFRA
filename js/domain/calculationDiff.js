/**
 * Stage 17.1 (MINOR 2.10.0) — Calculation Diff Engine.
 *
 * Pure-domain логика для построения diff'а между двумя snapshot'ами расчёта.
 * Используется как фундамент для:
 *   - 17.2 Change Summary Before Apply (preview перед apply);
 *   - 17.3 Review Workflow (approved ↔ current);
 *   - rollback explanation;
 *   - decision memo updates.
 *
 * Layer: pure domain (без DOM, store, services). НЕ мутирует входные calc.
 *
 * Категории diff:
 *   1. answers      — ответы опросника
 *   2. settings     — calc.settings (включая вложенные standSizeRatio, resourceRatio)
 *   3. scenarios    — calc.scenarios[] (added / removed / changed по id)
 *   4. provider     — calc.providerVersion ({ id, version, timestamp })
 *   5. totals       — totalMonthly / byCostType.opex / .capex (через calculate)
 *
 * Diff item format:
 *   { id, type: 'changed'|'added'|'removed', category, sectionId, label,
 *     before, after, delta, deltaPercent }
 */

import { calculate } from './calculator.js';

/* ============================================================
 * Helpers
 * ============================================================ */

function isFiniteNum(x) {
    return typeof x === 'number' && Number.isFinite(x);
}

function toFinite(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
}

/** Глубокое сравнение через JSON.stringify (быстрая семантическая эквивалентность
 *  для plain-objects/arrays — для primitive значений работает как ===). */
function deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return a === b;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

/** Является ли значение «отсутствующим» — null/undefined/пустой массив/пустая строка. */
function isAbsent(v) {
    if (v === null || v === undefined) return true;
    if (Array.isArray(v) && v.length === 0) return true;
    if (v === '') return true;
    return false;
}

/** Resolve question metadata (label + sectionId) из catalog. */
function resolveQuestionMeta(catalog, fieldId) {
    if (!Array.isArray(catalog)) return { label: fieldId, sectionId: null };
    const q = catalog.find(q => q && q.id === fieldId);
    if (!q) return { label: fieldId, sectionId: null };
    return {
        label: q.title || fieldId,
        sectionId: q.section || null
    };
}

/** Считает delta/deltaPercent для пары числовых значений. Для не-чисел — null. */
function computeDelta(before, after) {
    if (!isFiniteNum(before) || !isFiniteNum(after)) {
        return { delta: null, deltaPercent: null };
    }
    const delta = after - before;
    const deltaPercent = before !== 0
        ? (delta / before) * 100
        : (after !== 0 ? null : 0);
    return { delta, deltaPercent };
}

/* ============================================================
 * 1. diffAnswers
 * ============================================================ */

export function diffAnswers(beforeAnswers, afterAnswers, questionCatalog) {
    const before = beforeAnswers && typeof beforeAnswers === 'object' ? beforeAnswers : {};
    const after  = afterAnswers && typeof afterAnswers === 'object'  ? afterAnswers  : {};
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const out = [];
    for (const key of allKeys) {
        const b = before[key];
        const a = after[key];
        if (deepEqual(b, a)) continue;
        const bAbsent = isAbsent(b);
        const aAbsent = isAbsent(a);
        if (bAbsent && aAbsent) continue;
        const meta = resolveQuestionMeta(questionCatalog, key);
        let type;
        let beforeVal = bAbsent ? null : b;
        let afterVal  = aAbsent ? null : a;
        if (bAbsent && !aAbsent) type = 'added';
        else if (!bAbsent && aAbsent) type = 'removed';
        else type = 'changed';
        const { delta, deltaPercent } = computeDelta(beforeVal, afterVal);
        out.push({
            id: `answers.${key}`,
            type,
            category: 'answers',
            sectionId: meta.sectionId,
            label: meta.label,
            before: beforeVal,
            after: afterVal,
            delta,
            deltaPercent
        });
    }
    return out;
}

/* ============================================================
 * 2. diffSettings
 * ============================================================ */

const SETTINGS_NESTED_KEYS = new Set(['standSizeRatio', 'resourceRatio', 'aiStandFactor']);

const SETTINGS_LABELS = Object.freeze({
    applyRiskFactors:    'Применять риск-коэффициенты',
    vatEnabled:          'Учитывать НДС',
    vatRate:             'Ставка НДС',
    planningHorizonYears:'Горизонт планирования, лет',
    phaseDurationMonths: 'Длительность фазы, мес.',
    bufferTask:          'Буфер задачи',
    bufferProject:       'Буфер проекта',
    kInflation:          'Коэффициент инфляции',
    kSeasonal:           'Сезонный коэффициент',
    kScheduleShift:      'Сдвиг графика',
    kContingency:        'Непредвиденные расходы',
    daysPerMonth:        'Дней в месяце',
    provider:            'Провайдер'
});

function settingLabel(path) {
    if (path.length === 1) return SETTINGS_LABELS[path[0]] || path.join('.');
    if (path[0] === 'standSizeRatio') return `Доля стенда ${path[1]}`;
    if (path[0] === 'aiStandFactor') return `AI-доля стенда ${path[1]}`;
    if (path[0] === 'resourceRatio') {
        return `Ресурс ${path[2] || ''} на ${path[1] || ''}`.trim();
    }
    return path.join('.');
}

function diffSettingsKey(before, after, path, out) {
    const b = before;
    const a = after;
    if (deepEqual(b, a)) return;
    if (b && typeof b === 'object' && !Array.isArray(b) &&
        a && typeof a === 'object' && !Array.isArray(a)) {
        const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
        for (const k of keys) {
            diffSettingsKey(b[k], a[k], [...path, k], out);
        }
        return;
    }
    const id = ['settings', ...path].join('.');
    let type;
    if ((b === undefined || b === null) && a !== undefined && a !== null) type = 'added';
    else if ((a === undefined || a === null) && b !== undefined && b !== null) type = 'removed';
    else type = 'changed';
    const beforeVal = b === undefined ? null : b;
    const afterVal  = a === undefined ? null : a;
    const { delta, deltaPercent } = computeDelta(beforeVal, afterVal);
    out.push({
        id,
        type,
        category: 'settings',
        sectionId: 'settings',
        label: settingLabel(path),
        before: beforeVal,
        after: afterVal,
        delta,
        deltaPercent
    });
}

export function diffSettings(beforeSettings, afterSettings) {
    const before = beforeSettings && typeof beforeSettings === 'object' ? beforeSettings : {};
    const after  = afterSettings && typeof afterSettings === 'object'  ? afterSettings  : {};
    const out = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
        // Вложенные объекты раскрываем рекурсивно (standSizeRatio.LOAD ≠ standSizeRatio.DEV).
        if (SETTINGS_NESTED_KEYS.has(k) ||
            (typeof before[k] === 'object' && before[k] !== null && !Array.isArray(before[k])) ||
            (typeof after[k]  === 'object' && after[k]  !== null && !Array.isArray(after[k]))) {
            diffSettingsKey(before[k], after[k], [k], out);
        } else {
            diffSettingsKey(before[k], after[k], [k], out);
        }
    }
    return out;
}

/* ============================================================
 * 3. diffScenarios
 * ============================================================ */

export function diffScenarios(beforeScenarios, afterScenarios) {
    const before = Array.isArray(beforeScenarios) ? beforeScenarios : [];
    const after  = Array.isArray(afterScenarios)  ? afterScenarios  : [];
    const beforeById = new Map();
    const afterById  = new Map();
    for (const s of before) if (s && s.id) beforeById.set(s.id, s);
    for (const s of after)  if (s && s.id) afterById.set(s.id, s);

    const added = [];
    const removed = [];
    const changed = [];

    for (const [id, s] of afterById) {
        if (!beforeById.has(id)) added.push({ id, label: s.label || id });
    }
    for (const [id, s] of beforeById) {
        if (!afterById.has(id)) removed.push({ id, label: s.label || id });
    }
    for (const [id, b] of beforeById) {
        const a = afterById.get(id);
        if (!a) continue;
        const labelChanged = b.label !== a.label;
        const answersChanged = !deepEqual(b.answers || {}, a.answers || {});
        const wizardChanged = !deepEqual(b.wizard || null, a.wizard || null);
        if (labelChanged || answersChanged || wizardChanged) {
            changed.push({
                id,
                label: a.label || id,
                labelChanged,
                answersChanged,
                wizardChanged
            });
        }
    }

    return { added, removed, changed };
}

/* ============================================================
 * 4. diffProviderPriceState
 * ============================================================ */

export function diffProviderPriceState(beforeCalc, afterCalc) {
    const b = beforeCalc?.providerVersion || null;
    const a = afterCalc?.providerVersion  || null;
    if (b === null && a === null) return null;
    if (deepEqual(b, a)) return null;
    let type;
    if (b === null && a !== null) type = 'added';
    else if (b !== null && a === null) type = 'removed';
    else type = 'changed';
    return {
        id: 'provider.version',
        type,
        category: 'provider',
        before: b,
        after: a
    };
}

/* ============================================================
 * 5. diffTotals
 * ============================================================ */

export function diffTotals(beforeTotals, afterTotals) {
    const b = beforeTotals && typeof beforeTotals === 'object' ? beforeTotals : {};
    const a = afterTotals  && typeof afterTotals  === 'object' ? afterTotals  : {};
    const bTotal = toFinite(b.totalMonthly);
    const aTotal = toFinite(a.totalMonthly);
    const bOpex  = toFinite(b.byCostType?.opex);
    const aOpex  = toFinite(a.byCostType?.opex);
    const bCapex = toFinite(b.byCostType?.capex);
    const aCapex = toFinite(a.byCostType?.capex);
    return {
        totalMonthlyDelta: aTotal - bTotal,
        opexDelta:         aOpex - bOpex,
        capexDelta:        aCapex - bCapex,
        beforeTotalMonthly: bTotal,
        afterTotalMonthly:  aTotal
    };
}

/* ============================================================
 * 6. buildCalculationDiff
 * ============================================================ */

function safeCalculate(calc) {
    if (!calc) return null;
    try { return calculate(calc, null); }
    catch { return null; }
}

export function buildCalculationDiff(beforeCalc, afterCalc, options = {}) {
    const compute = options.compute !== false;
    if (!beforeCalc || !afterCalc) {
        return {
            answers: [],
            settings: [],
            scenarios: { added: [], removed: [], changed: [] },
            provider: null,
            totals: { totalMonthlyDelta: 0, opexDelta: 0, capexDelta: 0,
                      beforeTotalMonthly: 0, afterTotalMonthly: 0 },
            summary: emptySummary()
        };
    }
    const catalog = options.questionCatalog
        || beforeCalc?.dictionaries?.questions
        || afterCalc?.dictionaries?.questions
        || null;

    const answers   = diffAnswers(beforeCalc.answers, afterCalc.answers, catalog);
    const settings  = diffSettings(beforeCalc.settings, afterCalc.settings);
    const scenarios = diffScenarios(beforeCalc.scenarios, afterCalc.scenarios);
    const provider  = diffProviderPriceState(beforeCalc, afterCalc);

    let totals;
    if (compute) {
        const beforeRes = safeCalculate(beforeCalc);
        const afterRes  = safeCalculate(afterCalc);
        totals = diffTotals(beforeRes, afterRes);
    } else {
        totals = { totalMonthlyDelta: 0, opexDelta: 0, capexDelta: 0,
                   beforeTotalMonthly: 0, afterTotalMonthly: 0 };
    }

    const diff = { answers, settings, scenarios, provider, totals };
    diff.summary = summarizeCalculationDiff(diff);
    return diff;
}

/* ============================================================
 * 7. summarizeCalculationDiff
 * ============================================================ */

function emptySummary() {
    return {
        changedFields: 0,
        addedScenarios: 0,
        removedScenarios: 0,
        changedScenarios: 0,
        providerChanged: false,
        totalDelta: 0,
        opexDelta: 0,
        capexDelta: 0
    };
}

export function summarizeCalculationDiff(diff) {
    if (!diff) return emptySummary();
    const ans = Array.isArray(diff.answers) ? diff.answers.length : 0;
    const set = Array.isArray(diff.settings) ? diff.settings.length : 0;
    const sc = diff.scenarios || { added: [], removed: [], changed: [] };
    return {
        changedFields:    ans + set,
        addedScenarios:   Array.isArray(sc.added)   ? sc.added.length   : 0,
        removedScenarios: Array.isArray(sc.removed) ? sc.removed.length : 0,
        changedScenarios: Array.isArray(sc.changed) ? sc.changed.length : 0,
        providerChanged:  !!diff.provider,
        totalDelta:       toFinite(diff.totals?.totalMonthlyDelta),
        opexDelta:        toFinite(diff.totals?.opexDelta),
        capexDelta:       toFinite(diff.totals?.capexDelta)
    };
}

/* ============================================================
 * 8. groupDiffBySection
 * ============================================================ */

export function groupDiffBySection(diffItems) {
    if (!Array.isArray(diffItems) || diffItems.length === 0) return {};
    const out = {};
    for (const it of diffItems) {
        if (!it) continue;
        const key = it.sectionId || '_other';
        if (!out[key]) out[key] = [];
        out[key].push(it);
    }
    return out;
}
