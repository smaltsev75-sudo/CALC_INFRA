/**
 * Stage 15.4 (PATCH 2.8.3) — Budget Guardrails.
 *
 * Чистый domain-модуль (без DOM, store, services). Отвечает на вопрос:
 * «Укладывается ли расчёт в целевой бюджет, и если нет — какие параметры
 *  сильнее всего его раздувают?»
 *
 * Сравниваются:
 *   - target_capex_rub          ↔ ∑ CAPEX (одноразовая сумма за фазу)
 *   - target_opex_monthly_rub   ↔ ∑ OPEX (₽/мес)
 *
 * Базы:
 *   actualOpexMonthly = result.byCostType.opex             // плоское число, см. calculator.js:488
 *   actualCapexMonthly = result.byCostType.capex            // плоское число (амортизированный oneTime)
 *   actualCapexTotal  = actualCapexMonthly × phaseDurationMonths
 *
 * Источник рекомендаций — sensitivityResults: модуль НЕ запускает sensitivity сам;
 * controller передаёт уже готовый results[]. Это позволяет переиспользовать
 * кэш sensitivity-модалки и сделать domain детерминированным.
 *
 * Layer compliance: импортируется только calculator + sensitivity-helpers.
 */

import { calculate } from './calculator.js';
import { rankSensitivityDrivers } from './sensitivityAnalysis.js';
import { DEFAULT_PHASE_DURATION_MONTHS } from '../utils/constants.js';

/* ============================================================
 * Статусы
 * ============================================================ */

export const BUDGET_STATUS = Object.freeze({
    NOT_CONFIGURED: 'not_configured',
    OK: 'ok',
    WARNING: 'warning'
});

/* ============================================================
 * Helpers
 * ============================================================ */

function toFiniteNumber(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
}

function emptySection() {
    return {
        target: null,
        actual: 0,
        gap: null,
        gapPercent: null,
        status: BUDGET_STATUS.NOT_CONFIGURED
    };
}

function buildSection(target, actual) {
    if (target == null || target <= 0) {
        return {
            target: null,
            actual: Number.isFinite(actual) ? actual : 0,
            gap: null,
            gapPercent: null,
            status: BUDGET_STATUS.NOT_CONFIGURED
        };
    }
    const safeActual = Number.isFinite(actual) ? actual : 0;
    const gap = safeActual - target;
    const gapPercent = target !== 0 ? (gap / target) * 100 : 0;
    const status = gap > 0 ? BUDGET_STATUS.WARNING : BUDGET_STATUS.OK;
    return { target, actual: safeActual, gap, gapPercent, status };
}

function combineStatus(capexStatus, opexStatus) {
    if (capexStatus === BUDGET_STATUS.WARNING || opexStatus === BUDGET_STATUS.WARNING) {
        return BUDGET_STATUS.WARNING;
    }
    if (capexStatus === BUDGET_STATUS.OK || opexStatus === BUDGET_STATUS.OK) {
        return BUDGET_STATUS.OK;
    }
    return BUDGET_STATUS.NOT_CONFIGURED;
}

/**
 * Запускает calculate() и возвращает actualOpexMonthly / actualCapexMonthly /
 * actualCapexTotal / actualTotalMonthly. На любой ошибке расчёта — нули.
 */
function getActualSpend(calc) {
    if (!calc) {
        return {
            opexMonthly: 0,
            capexMonthly: 0,
            capexTotal: 0,
            totalMonthly: 0
        };
    }
    let result;
    try {
        // calculate сам поддерживает кэш по revision; null → bypass
        result = calculate(calc, calc.calcRevision ?? null);
    } catch (_e) {
        return {
            opexMonthly: 0,
            capexMonthly: 0,
            capexTotal: 0,
            totalMonthly: 0
        };
    }
    const opexMonthly = toFiniteNumber(result?.byCostType?.opex) ?? 0;
    const capexMonthly = toFiniteNumber(result?.byCostType?.capex) ?? 0;
    const totalMonthly = toFiniteNumber(result?.totalMonthly) ?? 0;
    const phase = toFiniteNumber(calc?.settings?.phaseDurationMonths)
                  ?? DEFAULT_PHASE_DURATION_MONTHS;
    const safePhase = phase > 0 ? phase : DEFAULT_PHASE_DURATION_MONTHS;
    const capexTotal = capexMonthly * safePhase;
    return { opexMonthly, capexMonthly, capexTotal, totalMonthly };
}

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * Возвращает разрыв между фактом и целевым бюджетом по двум осям (CAPEX/OPEX).
 *
 * @param {object|null} calc - активный расчёт
 * @returns {{
 *   status: 'ok'|'warning'|'not_configured',
 *   capex: { target, actual, gap, gapPercent, status },
 *   opex:  { target, actual, gap, gapPercent, status },
 *   actual: { opexMonthly, capexMonthly, capexTotal, totalMonthly }
 * }}
 */
export function getBudgetGap(calc) {
    if (!calc) {
        return {
            status: BUDGET_STATUS.NOT_CONFIGURED,
            capex: emptySection(),
            opex: emptySection(),
            actual: { opexMonthly: 0, capexMonthly: 0, capexTotal: 0, totalMonthly: 0 }
        };
    }
    const targetCapex = toFiniteNumber(calc?.answers?.target_capex_rub);
    const targetOpex  = toFiniteNumber(calc?.answers?.target_opex_monthly_rub);
    const actual = getActualSpend(calc);

    const capex = buildSection(targetCapex, actual.capexTotal);
    const opex  = buildSection(targetOpex,  actual.opexMonthly);

    return {
        status: combineStatus(capex.status, opex.status),
        capex,
        opex,
        actual
    };
}

/**
 * Строит подсказки по оптимизации из ranked sensitivity drivers.
 * Дубликаты по fieldId удаляются (берётся первый, т.е. с большим impact).
 *
 * @param {object|null} calc
 * @param {Array} sensitivityResults - массив с status='ok' (см. sensitivityAnalysis)
 * @param {object} budgetGap - результат getBudgetGap(calc)
 * @param {object} [options]
 * @param {number} [options.limit=5]
 * @returns {Array<{
 *   id, fieldId, label, category, expectedSaving, costType, source, action, message
 * }>}
 */
export function buildOptimizationHints(calc, sensitivityResults, budgetGap, options = {}) {
    const limit = Number.isFinite(options.limit) && options.limit > 0
        ? Math.floor(options.limit)
        : 5;
    if (!Array.isArray(sensitivityResults) || sensitivityResults.length === 0) {
        return [];
    }

    // Какую ось превышения «лечим»? OPEX-warning приоритетнее CAPEX (чаще всего
    // именно ежемесячный фон бьёт по бюджету). Если оба ОК — total.
    let costType = 'total';
    if (budgetGap?.opex?.status === BUDGET_STATUS.WARNING) {
        costType = 'opex';
    } else if (budgetGap?.capex?.status === BUDGET_STATUS.WARNING) {
        costType = 'capex';
    }

    // Sensitivity-модуль выдаёт `delta.opexMonthly` / `delta.capexMonthly` /
    // `delta.total`. Ранжируем по ВЫБРАННОЙ оси, но savings всегда показываем
    // как Math.abs(delta.total) — пользовательски это «сколько уйдёт со счёта»,
    // вне зависимости от классификации costType.
    const ranked = rankSensitivityDrivers(sensitivityResults, costType);

    const seenFieldIds = new Set();
    const hints = [];
    for (const driver of ranked) {
        if (hints.length >= limit) break;
        if (!driver?.fieldId || seenFieldIds.has(driver.fieldId)) continue;

        const totalImpact = Math.abs(toFiniteNumber(driver.delta?.total) ?? 0);
        if (totalImpact <= 0) continue;

        hints.push({
            id: `reduce-${driver.fieldId}`,
            fieldId: driver.fieldId,
            label: driver.label || driver.fieldId,
            category: driver.category || 'service',
            expectedSaving: totalImpact,
            costType,
            source: 'sensitivity',
            action: 'review_field',
            message: 'Этот параметр входит в top-драйверы стоимости. Проверьте, насколько корректно он задан.'
        });
        seenFieldIds.add(driver.fieldId);
    }
    return hints;
}

/**
 * Сортирует hints по убыванию ожидаемой экономии. Стабильна (не мутирует вход).
 */
export function rankOptimizationHints(hints) {
    if (!Array.isArray(hints)) return [];
    return [...hints].sort((a, b) =>
        (toFiniteNumber(b?.expectedSaving) ?? 0) -
        (toFiniteNumber(a?.expectedSaving) ?? 0)
    );
}

/**
 * Полный отчёт по бюджетным ограничениям: статус + причины + рекомендации.
 *
 * @param {object|null} calc
 * @param {Array} [sensitivityResults=[]]
 * @param {object} [options]
 * @returns {{
 *   status, capex, opex, reasons: Array, hints: Array
 * }}
 */
export function evaluateBudgetGuardrails(calc, sensitivityResults = [], options = {}) {
    const budgetGap = getBudgetGap(calc);
    if (!calc) {
        return {
            status: budgetGap.status,
            capex: budgetGap.capex,
            opex: budgetGap.opex,
            actual: budgetGap.actual,
            reasons: [],
            hints: []
        };
    }

    const rawHints = buildOptimizationHints(calc, sensitivityResults, budgetGap, options);
    const hints = rankOptimizationHints(rawHints);

    // reasons — top-3 hint'ов (по тем же fieldId, без message/action).
    // Это compact-формат для рендера на dashboard и в шапке модалки.
    const reasons = hints.slice(0, 3).map(h => ({
        fieldId: h.fieldId,
        label: h.label,
        category: h.category,
        impact: h.expectedSaving,
        costType: h.costType
    }));

    /* Stage 18.1.6: добавлен `actual` в return. Раньше `evaluateBudgetGuardrails`
       возвращал только targets и hints — без abs-totals (`actual.totalMonthly`,
       `capexTotal`, etc.). Из-за этого consumers (Decision Memo, потенциально
       другие модули) не могли показать «Итоговый CAPEX / OPEX» и считать
       проценты от total. `getBudgetGap` уже считал `actual` — просто не
       пробрасывался. */
    return {
        status: budgetGap.status,
        capex: budgetGap.capex,
        opex: budgetGap.opex,
        actual: budgetGap.actual,
        reasons,
        hints
    };
}

/**
 * Человекочитаемый ярлык статуса (для бейджей и `aria-label`).
 */
export function formatBudgetStatus(status) {
    if (status === BUDGET_STATUS.OK) return 'В пределах бюджета';
    if (status === BUDGET_STATUS.WARNING) return 'Превышение бюджета';
    return 'Бюджет не задан';
}
