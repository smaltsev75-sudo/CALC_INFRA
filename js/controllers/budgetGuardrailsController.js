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
 * Кэш sensitivity-результатов (module-scope, keyed by calcRevision)
 * ============================================================
 * Sensitivity — самая дорогая часть пайплайна (полный пересчёт calculate
 * на каждое перебираемое поле). Кэшируем по revision: модалка может
 * пересоздаваться при ре-рендере, но пока calc не менялся — результаты те же.
 */

let _cachedRevision = null;
let _cachedSensitivity = null; // { results, notAvailable }

function getOrRunSensitivity(calc) {
    if (!calc) return { results: [], notAvailable: [] };
    const rev = calc.calcRevision ?? null;
    if (rev !== null && rev === _cachedRevision && _cachedSensitivity) {
        return _cachedSensitivity;
    }
    _cachedRevision = rev;
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
    return evaluateBudgetGuardrails(activeCalc, results);
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
    return getBudgetGap(activeCalc);
}
