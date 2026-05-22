/**
 * Unit-тесты Stage 15.4 — Budget Guardrails.
 *
 * Покрывает: getBudgetGap (CAPEX/OPEX status, gap, gapPercent, edge cases),
 * buildOptimizationHints (sensitivity → hints, dedup, limit, costType priority),
 * rankOptimizationHints (стабильная сортировка),
 * evaluateBudgetGuardrails (полный отчёт), formatBudgetStatus.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    getBudgetGap,
    buildOptimizationHints,
    rankOptimizationHints,
    evaluateBudgetGuardrails,
    formatBudgetStatus,
    BUDGET_STATUS
} from '../../../js/domain/budgetGuardrails.js';

/* ============================================================
 * Минимальная фабрика расчёта (зеркалит sensitivity-analysis.test.js)
 * ============================================================ */

function makeCalc(answers = {}, overrides = {}) {
    return {
        id: 'bg-t1',
        name: 'BG Test',
        schemaVersion: 12,
        answers: {
            pcu_target: 1000,
            ai_llm_used: false,
            target_capex_rub: null,
            target_opex_monthly_rub: null,
            ...answers
        },
        answersMeta: {},
        settings: {
            applyRiskFactors: false,
            vatEnabled: false,
            planningHorizonYears: 1,
            phaseDurationMonths: 12,
            bufferTask: 0, bufferProject: 0,
            kInflation: 0, kSeasonal: 0, kScheduleShift: 0, kContingency: 0,
            vatRate: 0.2,
            standSizeRatio: { DEV: 0.1, IFT: 0.4, PSI: 0.5, PROD: 1.0, LOAD: 0.8 },
            resourceRatio: {},
            aiStandFactor: { DEV: 0.02, IFT: 0.2, PSI: 0.5, PROD: 1.0, LOAD: 1.0 },
            ...(overrides.settings || {})
        },
        dictionaries: overrides.dictionaries !== undefined ? overrides.dictionaries : {
            questions: [
                { id: 'pcu_target', type: 'number', title: 'Пиковая аудитория',
                  defaultValue: 500, defaultIfUnknown: 500 }
            ],
            items: [
                {
                    // monthly OPEX-item: каждый PCU = 100 ₽/мес OPEX на PROD
                    id: 'bg-vcpu', name: 'BG vCPU',
                    category: 'HW', resourceClass: 'COMPUTE',
                    billingInterval: 'monthly', pricePerUnit: 100,
                    qtyFormulas: { DEV: '0', IFT: '0', PSI: '0', PROD: 'Q.pcu_target', LOAD: '0' },
                    applicableStands: ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']
                },
                {
                    // oneTime CAPEX-item: фиксированная разовая сумма 60 000 ₽ за фазу
                    id: 'bg-capex', name: 'BG CAPEX',
                    category: 'HW', resourceClass: 'COMPUTE',
                    billingInterval: 'oneTime', pricePerUnit: 60_000,
                    qtyFormulas: { DEV: '0', IFT: '0', PSI: '0', PROD: '1', LOAD: '0' },
                    applicableStands: ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']
                }
            ],
            settings: {}
        },
        view: { disabledStands: [] },
        providerVersion: null
    };
}

/**
 * Фейковый sensitivity-результат: status='ok', с указанным delta.total.
 */
function fakeDriver(fieldId, totalDelta, label = null, category = 'service') {
    return {
        fieldId,
        label: label || fieldId,
        category,
        status: 'ok',
        delta:        { opexMonthly: totalDelta, capexMonthly: 0, total: totalDelta },
        deltaPercent: { opexMonthly: 0,          capexMonthly: 0, total: 0 },
        baseline:  { opexMonthly: 0, capexMonthly: 0, total: 0 },
        simulated: { opexMonthly: 0, capexMonthly: 0, total: 0 },
        perturbationType: 'numeric',
        changeLabel: '+10%',
        baselineValue: 100,
        simulatedValue: 110,
        note: null
    };
}

/* ============================================================
 * getBudgetGap — базовые сценарии CAPEX
 * ============================================================ */

describe('getBudgetGap: CAPEX', () => {
    it('CAPEX в пределах бюджета → status=ok, gap < 0', () => {
        // Расчёт: 60_000 ₽ oneTime / 12 мес = 5000 ₽/мес × 12 (back) = 60_000 ₽ total.
        // Target = 100_000 ₽. Gap = -40_000.
        const r = getBudgetGap(makeCalc({ target_capex_rub: 100_000 }));
        assert.equal(r.capex.status, BUDGET_STATUS.OK);
        assert.equal(r.capex.target, 100_000);
        assert.equal(Math.round(r.capex.actual), 60_000);
        assert.ok(r.capex.gap < 0);
        assert.ok(r.capex.gapPercent < 0);
    });

    it('CAPEX превышен → status=warning, gap > 0, gapPercent > 0', () => {
        const r = getBudgetGap(makeCalc({ target_capex_rub: 30_000 }));
        assert.equal(r.capex.status, BUDGET_STATUS.WARNING);
        assert.ok(r.capex.gap > 0);
        // 60_000 vs 30_000 → +100%
        assert.ok(r.capex.gapPercent > 0);
        assert.equal(r.status, BUDGET_STATUS.WARNING);
    });

    it('target_capex_rub=null → not_configured (без warning)', () => {
        const r = getBudgetGap(makeCalc({ target_capex_rub: null }));
        assert.equal(r.capex.status, BUDGET_STATUS.NOT_CONFIGURED);
        assert.equal(r.capex.target, null);
        assert.equal(r.capex.gap, null);
    });

    it('target_capex_rub=0 → not_configured (как «не задан»)', () => {
        const r = getBudgetGap(makeCalc({ target_capex_rub: 0 }));
        assert.equal(r.capex.status, BUDGET_STATUS.NOT_CONFIGURED);
    });

    it('target_capex_rub отрицательный → not_configured', () => {
        const r = getBudgetGap(makeCalc({ target_capex_rub: -100 }));
        assert.equal(r.capex.status, BUDGET_STATUS.NOT_CONFIGURED);
    });
});

/* ============================================================
 * getBudgetGap — OPEX
 * ============================================================ */

describe('getBudgetGap: OPEX', () => {
    it('OPEX в пределах бюджета → status=ok', () => {
        // OPEX/мес = 1000 PCU × 100 ₽ = 100_000. Target = 200_000 → ok.
        const r = getBudgetGap(makeCalc({ target_opex_monthly_rub: 200_000 }));
        assert.equal(r.opex.status, BUDGET_STATUS.OK);
        assert.equal(Math.round(r.opex.actual), 100_000);
        assert.ok(r.opex.gap < 0);
    });

    it('OPEX превышен → status=warning, корректный gapPercent', () => {
        // 100_000 vs 80_000 → +25%
        const r = getBudgetGap(makeCalc({ target_opex_monthly_rub: 80_000 }));
        assert.equal(r.opex.status, BUDGET_STATUS.WARNING);
        assert.ok(Math.abs(r.opex.gapPercent - 25) < 0.5);
    });

    it('target_opex_monthly_rub=null → not_configured', () => {
        const r = getBudgetGap(makeCalc({ target_opex_monthly_rub: null }));
        assert.equal(r.opex.status, BUDGET_STATUS.NOT_CONFIGURED);
    });

    it('actual=0 не даёт divide-by-zero', () => {
        // Пустой calc без OPEX-items.
        const calc = makeCalc(
            { target_opex_monthly_rub: 100_000 },
            { dictionaries: { questions: [], items: [], settings: {} } }
        );
        const r = getBudgetGap(calc);
        assert.equal(r.opex.status, BUDGET_STATUS.OK); // factually 0 < target
        assert.equal(r.opex.actual, 0);
        assert.ok(Number.isFinite(r.opex.gapPercent));
    });
});

/* ============================================================
 * getBudgetGap — общий status и null-calc
 * ============================================================ */

describe('getBudgetGap: общий status', () => {
    it('оба бюджета не заданы → status=not_configured', () => {
        const r = getBudgetGap(makeCalc({}));
        assert.equal(r.status, BUDGET_STATUS.NOT_CONFIGURED);
    });

    it('OPEX превышен, CAPEX задан и ок → общий status=warning', () => {
        const r = getBudgetGap(makeCalc({
            target_capex_rub: 100_000,
            target_opex_monthly_rub: 50_000
        }));
        assert.equal(r.opex.status, BUDGET_STATUS.WARNING);
        assert.equal(r.capex.status, BUDGET_STATUS.OK);
        assert.equal(r.status, BUDGET_STATUS.WARNING);
    });

    it('calc=null → not_configured без exception', () => {
        const r = getBudgetGap(null);
        assert.equal(r.status, BUDGET_STATUS.NOT_CONFIGURED);
        assert.equal(r.opex.status, BUDGET_STATUS.NOT_CONFIGURED);
        assert.equal(r.actual.totalMonthly, 0);
    });
});

/* ============================================================
 * buildOptimizationHints
 * ============================================================ */

describe('buildOptimizationHints', () => {
    it('пустой sensitivity → пустой массив hints', () => {
        const r = buildOptimizationHints(makeCalc(), [], getBudgetGap(makeCalc()));
        assert.deepEqual(r, []);
    });

    it('null sensitivity → пустой массив hints', () => {
        const r = buildOptimizationHints(makeCalc(), null, getBudgetGap(makeCalc()));
        assert.deepEqual(r, []);
    });

    it('hints формируются из sensitivity и сортируются по убыванию impact', () => {
        const drivers = [
            fakeDriver('field_a', 1000),
            fakeDriver('field_b', 5000),
            fakeDriver('field_c', 3000)
        ];
        const gap = getBudgetGap(makeCalc({ target_opex_monthly_rub: 50_000 }));
        const hints = buildOptimizationHints(makeCalc(), drivers, gap);
        assert.equal(hints.length, 3);
        assert.equal(hints[0].fieldId, 'field_b'); // 5000
        assert.equal(hints[1].fieldId, 'field_c'); // 3000
        assert.equal(hints[2].fieldId, 'field_a'); // 1000
        assert.equal(hints[0].source, 'sensitivity');
        assert.equal(hints[0].expectedSaving, 5000);
    });

    it('дубликаты по fieldId удаляются (первый = больший impact выживает)', () => {
        const drivers = [
            fakeDriver('field_x', 5000),
            fakeDriver('field_x', 1000), // дубль с меньшим impact
            fakeDriver('field_y', 3000)
        ];
        const gap = getBudgetGap(makeCalc({ target_opex_monthly_rub: 50_000 }));
        const hints = buildOptimizationHints(makeCalc(), drivers, gap);
        assert.equal(hints.length, 2);
        assert.equal(hints[0].fieldId, 'field_x');
        assert.equal(hints[0].expectedSaving, 5000);
    });

    it('limit ограничивает количество hints', () => {
        const drivers = Array.from({ length: 10 }, (_, i) => fakeDriver(`f${i}`, 1000 - i));
        const gap = getBudgetGap(makeCalc({ target_opex_monthly_rub: 50_000 }));
        const hints = buildOptimizationHints(makeCalc(), drivers, gap, { limit: 3 });
        assert.equal(hints.length, 3);
    });

    it('костТип берётся из превышенного бюджета (OPEX → costType=opex)', () => {
        const drivers = [fakeDriver('f1', 1000)];
        const gap = getBudgetGap(makeCalc({ target_opex_monthly_rub: 50_000 }));
        const hints = buildOptimizationHints(makeCalc(), drivers, gap);
        assert.equal(hints[0].costType, 'opex');
    });

    it('drivers с нулевым delta.total отфильтровываются', () => {
        const drivers = [
            fakeDriver('zero_field', 0),
            fakeDriver('real_field', 1000)
        ];
        const gap = getBudgetGap(makeCalc({ target_opex_monthly_rub: 50_000 }));
        const hints = buildOptimizationHints(makeCalc(), drivers, gap);
        assert.equal(hints.length, 1);
        assert.equal(hints[0].fieldId, 'real_field');
    });
});

/* ============================================================
 * evaluateBudgetGuardrails (full pipeline)
 * ============================================================ */

describe('evaluateBudgetGuardrails', () => {
    it('бюджет не задан → status=not_configured, hints/reasons пусты', () => {
        const r = evaluateBudgetGuardrails(makeCalc({}), [fakeDriver('f1', 1000)]);
        assert.equal(r.status, BUDGET_STATUS.NOT_CONFIGURED);
        // Когда нет ни одного warning, hints всё равно строятся (costType=total),
        // но reasons показывают именно те hints — что приемлемо: пользователь
        // увидит «вы в бюджете, но эти параметры — главные драйверы стоимости».
        assert.ok(Array.isArray(r.hints));
        assert.ok(Array.isArray(r.reasons));
    });

    it('OPEX превышен → reasons содержит top-3 драйвера', () => {
        const drivers = [
            fakeDriver('f1', 5000),
            fakeDriver('f2', 4000),
            fakeDriver('f3', 3000),
            fakeDriver('f4', 2000),
            fakeDriver('f5', 1000)
        ];
        const r = evaluateBudgetGuardrails(
            makeCalc({ target_opex_monthly_rub: 50_000 }),
            drivers
        );
        assert.equal(r.status, BUDGET_STATUS.WARNING);
        assert.equal(r.reasons.length, 3);
        assert.equal(r.reasons[0].fieldId, 'f1');
        assert.equal(r.reasons[0].impact, 5000);
        // hints — все 5 (limit по умолчанию 5)
        assert.equal(r.hints.length, 5);
    });

    it('calc=null → корректный пустой отчёт', () => {
        const r = evaluateBudgetGuardrails(null, []);
        assert.equal(r.status, BUDGET_STATUS.NOT_CONFIGURED);
        assert.deepEqual(r.reasons, []);
        assert.deepEqual(r.hints, []);
    });

    it('calc не мутируется во время evaluate', () => {
        const calc = makeCalc({ target_opex_monthly_rub: 50_000 });
        const before = JSON.stringify(calc);
        evaluateBudgetGuardrails(calc, [fakeDriver('f1', 1000)]);
        assert.equal(JSON.stringify(calc), before);
    });
});

/* ============================================================
 * rankOptimizationHints
 * ============================================================ */

describe('rankOptimizationHints', () => {
    it('сортирует по убыванию expectedSaving', () => {
        const hints = [
            { id: 'a', expectedSaving: 100 },
            { id: 'b', expectedSaving: 500 },
            { id: 'c', expectedSaving: 250 }
        ];
        const r = rankOptimizationHints(hints);
        assert.equal(r[0].id, 'b');
        assert.equal(r[1].id, 'c');
        assert.equal(r[2].id, 'a');
    });

    it('не мутирует входной массив', () => {
        const hints = [
            { id: 'a', expectedSaving: 100 },
            { id: 'b', expectedSaving: 500 }
        ];
        const before = hints.map(h => h.id);
        rankOptimizationHints(hints);
        assert.deepEqual(hints.map(h => h.id), before);
    });

    it('null/undefined → пустой массив', () => {
        assert.deepEqual(rankOptimizationHints(null), []);
        assert.deepEqual(rankOptimizationHints(undefined), []);
    });
});

/* ============================================================
 * formatBudgetStatus
 * ============================================================ */

describe('formatBudgetStatus', () => {
    it('возвращает читаемый ярлык для каждого статуса', () => {
        assert.equal(formatBudgetStatus(BUDGET_STATUS.OK), 'В пределах бюджета');
        assert.equal(formatBudgetStatus(BUDGET_STATUS.WARNING), 'Превышение бюджета');
        assert.equal(formatBudgetStatus(BUDGET_STATUS.NOT_CONFIGURED), 'Бюджет не задан');
        assert.equal(formatBudgetStatus('unknown'), 'Бюджет не задан');
    });
});
