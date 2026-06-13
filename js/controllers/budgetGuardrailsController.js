/**
 * Stage 15.4 — Budget Guardrails controller.
 *
 * Тонкая прослойка между UI и domain-модулем. Запускает sensitivity-анализ
 * по требованию (для пересчёта рекомендаций) и вызывает evaluateBudgetGuardrails.
 *
 * Layer compliance: контроллер импортирует store/services/domain, но НЕ ui.
 */

import { store } from '../state/store.js';
import { evaluateBudgetGuardrails, getBudgetGap } from '../domain/budgetGuardrails.js';
import { runSensitivityAnalysis } from '../domain/sensitivityAnalysis.js';

/* ============================================================
 * Кэш sensitivity-результатов (module-scope, keyed by calc reference)
 * ============================================================
 * Sensitivity — самая дорогая часть пайплайна (полный пересчёт calculate
 * на каждое перебираемое поле). Кэшируем по ИДЕНТИЧНОСТИ объекта calc:
 * store.updateActiveCalc/setActiveCalc создают НОВЫЙ объект на каждую
 * мутацию (store.js), поэтому ссылочное равенство — корректный store-
 * независимый ключ. Прежний ключ calc.calcRevision был всегда undefined
 * (revision живёт на store-root, а не на объекте calc) → memo не срабатывал
 * и sensitivity перебирался на КАЖДЫЙ ре-рендер модалки (RISK-2,
 * состязательное ревью 2026-06-13).
 */

let _cachedCalc = null;
let _cachedSensitivity = null; // { results, notAvailable }

function getOrRunSensitivity(calc) {
    if (!calc) return { results: [], notAvailable: [] };
    if (calc === _cachedCalc && _cachedSensitivity) {
        return _cachedSensitivity;
    }
    _cachedCalc = calc;
    _cachedSensitivity = runSensitivityAnalysis(calc);
    return _cachedSensitivity;
}

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * Открыть модалку «Бюджетные ограничения».
 */
export function openBudgetGuardrailsModal() {
    store.openModal('budgetGuardrails');
}

/**
 * Полная оценка бюджета для активного расчёта (gap + reasons + hints).
 * Использует кэшированный sensitivity-результат.
 */
export function evaluateBudgetGuardrailsForActiveCalc() {
    const { activeCalc } = store.getState();
    if (!activeCalc) {
        return evaluateBudgetGuardrails(null, []);
    }
    const { results } = getOrRunSensitivity(activeCalc);
    // RISK-2: store-level revision → LRU-кэш calculate() внутри getBudgetGap.
    return evaluateBudgetGuardrails(activeCalc, results, { revision: store.getState().calcRevision });
}

/**
 * Лёгкая сводка для dashboard-карточки: только статус + проценты по осям,
 * без рекомендаций (они дороже из-за sensitivity).
 */
export function getBudgetGuardrailsSummary() {
    const { activeCalc } = store.getState();
    if (!activeCalc) {
        return getBudgetGap(null);
    }
    // RISK-2: store-level revision → calculate() попадает в LRU-кэш (тот же,
    // что использует дашборд), устраняя двойной item×stand-проход на кадр.
    return getBudgetGap(activeCalc, store.getState().calcRevision);
}
