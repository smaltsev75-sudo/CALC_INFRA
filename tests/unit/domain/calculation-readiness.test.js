/**
 * Stage 17.6 — calculationReadiness domain truth-table.
 *
 * Контракт (зафиксирован в spec):
 *   BLOCKERS: health_errors, health_score_low, budget_missing, calc_empty
 *   WARNINGS: risky_assumptions, provider_stale
 *   VERDICTS: 'empty' | 'needs_clarification' | 'ready'
 *
 * Pure-domain тесты — никаких импортов из ui/, controllers/, services/.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    evaluateCalculationReadiness,
    READINESS_VERDICTS,
    READINESS_THRESHOLDS
} from '../../../js/domain/calculationReadiness.js';

/* ============================================================
 * Helpers
 * ============================================================ */

function makeCalc(overrides = {}) {
    return {
        id: 'rd-test',
        name: 'test',
        schemaVersion: 16,
        answers: { question_a: 'foo' },           // 1 непустой ответ → НЕ empty
        answersMeta: {},
        settings: {
            applyRiskFactors: false, vatEnabled: false, vatRate: 0,
            planningHorizonYears: 1, phaseDurationMonths: 12,
            standSizeRatio: { DEV: 0.16, IFT: 0.4, PSI: 0.5, LOAD: 0.8, PROD: 1.0 },
            resourceRatio: {},
            aiStandFactor: { DEV: 0.02, IFT: 0.2, PSI: 0.5, PROD: 1.0, LOAD: 1.0 }
        },
        dictionaries: { questions: [], items: [], settings: {} },
        view: { disabledStands: [] },
        ...overrides
    };
}

function ctxOk(overrides = {}) {
    return {
        healthResult: { findings: [], score: 100, counts: { error: 0, warning: 0, recommendation: 0, info: 0 } },
        riskyCount: 0,
        ...overrides
    };
}

/* ============================================================
 * 1. Verdicts: empty / ready / needs_clarification
 * ============================================================ */

describe('evaluateCalculationReadiness — VERDICTS', () => {
    it('null calc → verdict=empty', () => {
        const r = evaluateCalculationReadiness(null);
        assert.equal(r.verdict, READINESS_VERDICTS.EMPTY);
        assert.deepEqual(r.blockers, []);
        assert.deepEqual(r.warnings, []);
    });

    it('пустой calc.answers → verdict=empty + blocker calc_empty', () => {
        const r = evaluateCalculationReadiness(makeCalc({ answers: {} }), ctxOk());
        assert.equal(r.verdict, READINESS_VERDICTS.EMPTY);
        assert.equal(r.blockers.length, 1);
        assert.equal(r.blockers[0].id, 'calc_empty');
    });

    it('answers содержат только null/empty/array[] → empty', () => {
        const calc = makeCalc({ answers: { a: null, b: '', c: [], d: undefined } });
        const r = evaluateCalculationReadiness(calc, ctxOk());
        assert.equal(r.verdict, READINESS_VERDICTS.EMPTY);
    });

    it('один meaningful ответ + budget set + health 100 → verdict=ready', () => {
        const calc = makeCalc({ answers: { foo: 'bar', target_capex_rub: 1_000_000 } });
        const r = evaluateCalculationReadiness(calc, ctxOk());
        assert.equal(r.verdict, READINESS_VERDICTS.READY);
        assert.deepEqual(r.blockers, []);
    });

    it('blocker есть → verdict=needs_clarification', () => {
        // нет budget = блокер
        const calc = makeCalc({ answers: { foo: 'bar' } });
        const r = evaluateCalculationReadiness(calc, ctxOk());
        assert.equal(r.verdict, READINESS_VERDICTS.NEEDS_CLARIFICATION);
    });
});

/* ============================================================
 * 2. BLOCKER: health_errors
 * ============================================================ */

describe('BLOCKER health_errors — counts.error > 0', () => {
    it('counts.error=1 → blocker', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({ answers: { foo: 'bar', target_capex_rub: 1000 } }),
            ctxOk({ healthResult: { findings: [], score: 80, counts: { error: 1, warning: 0, recommendation: 0, info: 0 } } })
        );
        assert.equal(r.blockers.find(b => b.id === 'health_errors')?.title, 'Критические ошибки: 1');
    });

    it('counts.error=0 → НЕ blocker', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({ answers: { foo: 'bar', target_capex_rub: 1000 } }),
            ctxOk()
        );
        assert.equal(r.blockers.find(b => b.id === 'health_errors'), undefined);
    });
});

/* ============================================================
 * 3. BLOCKER: health_score_low — НЕ дублирует health_errors
 * ============================================================ */

describe('BLOCKER health_score_low — score < 60', () => {
    it('score=59 + 0 errors → blocker health_score_low', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({ answers: { foo: 'bar', target_capex_rub: 1000 } }),
            ctxOk({ healthResult: { findings: [], score: 59, counts: { error: 0, warning: 5, recommendation: 0, info: 0 } } })
        );
        assert.ok(r.blockers.find(b => b.id === 'health_score_low'),
            'score=59 < 60 должен дать health_score_low blocker.');
    });

    it('score=60 → НЕ blocker (ровно граница)', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({ answers: { foo: 'bar', target_capex_rub: 1000 } }),
            ctxOk({ healthResult: { findings: [], score: 60, counts: { error: 0, warning: 0, recommendation: 0, info: 0 } } })
        );
        assert.equal(r.blockers.find(b => b.id === 'health_score_low'), undefined);
    });

    it('score=30 + есть errors → ТОЛЬКО health_errors (не дублируем low_score)', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({ answers: { foo: 'bar', target_capex_rub: 1000 } }),
            ctxOk({ healthResult: { findings: [], score: 30, counts: { error: 3, warning: 0, recommendation: 0, info: 0 } } })
        );
        assert.ok(r.blockers.find(b => b.id === 'health_errors'));
        assert.equal(r.blockers.find(b => b.id === 'health_score_low'), undefined,
            'При errors > 0 health_score_low не дублируется — суть та же.');
    });
});

/* ============================================================
 * 4. BLOCKER: budget_missing
 * ============================================================ */

describe('BLOCKER budget_missing — оба target отсутствуют', () => {
    it('нет ни capex, ни opex → blocker', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({ answers: { foo: 'bar' } }),
            ctxOk()
        );
        assert.ok(r.blockers.find(b => b.id === 'budget_missing'));
    });

    it('задан только capex → НЕ blocker', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({ answers: { foo: 'bar', target_capex_rub: 5_000_000 } }),
            ctxOk()
        );
        assert.equal(r.blockers.find(b => b.id === 'budget_missing'), undefined);
    });

    it('задан только opex → НЕ blocker', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({ answers: { foo: 'bar', target_opex_monthly_rub: 100_000 } }),
            ctxOk()
        );
        assert.equal(r.blockers.find(b => b.id === 'budget_missing'), undefined);
    });

    it('capex=0 → считаем как «не задан»', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({ answers: { foo: 'bar', target_capex_rub: 0, target_opex_monthly_rub: 0 } }),
            ctxOk()
        );
        assert.ok(r.blockers.find(b => b.id === 'budget_missing'));
    });
});

/* ============================================================
 * 5. WARNING: risky_assumptions
 * ============================================================ */

describe('WARNING risky_assumptions — count >= 3', () => {
    it('riskyCount=2 → НЕ warning', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({ answers: { foo: 'bar', target_capex_rub: 1000 } }),
            ctxOk({ riskyCount: 2 })
        );
        assert.equal(r.warnings.find(w => w.id === 'risky_assumptions'), undefined);
    });

    it('riskyCount=3 → warning', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({ answers: { foo: 'bar', target_capex_rub: 1000 } }),
            ctxOk({ riskyCount: 3 })
        );
        assert.ok(r.warnings.find(w => w.id === 'risky_assumptions'));
    });

    it('warning один — не блокер. verdict остаётся ready', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({ answers: { foo: 'bar', target_capex_rub: 1000 } }),
            ctxOk({ riskyCount: 5 })
        );
        assert.equal(r.verdict, READINESS_VERDICTS.READY,
            'Risky assumptions — warning, не блокер. С ним verdict=ready остаётся.');
    });
});

/* ============================================================
 * 6. WARNING: provider_stale
 * ============================================================ */

describe('WARNING provider_stale', () => {
    it('providerVersion.stale=true → warning', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({
                answers: { foo: 'bar', target_capex_rub: 1000 },
                providerVersion: { stale: true, version: '1.0' }
            }),
            ctxOk()
        );
        assert.ok(r.warnings.find(w => w.id === 'provider_stale'));
    });

    it('stale=false → НЕ warning', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({
                answers: { foo: 'bar', target_capex_rub: 1000 },
                providerVersion: { stale: false, version: '1.0' }
            }),
            ctxOk()
        );
        assert.equal(r.warnings.find(w => w.id === 'provider_stale'), undefined);
    });

    it('verdict с одним только provider_stale = ready (warning, не блокер)', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({
                answers: { foo: 'bar', target_capex_rub: 1000 },
                providerVersion: { stale: true }
            }),
            ctxOk()
        );
        assert.equal(r.verdict, READINESS_VERDICTS.READY);
    });
});

/* ============================================================
 * 7. THRESHOLDS — числа из spec'а зафиксированы
 * ============================================================ */

describe('READINESS_THRESHOLDS — Stage 17.6 spec', () => {
    it('HEALTH_SCORE_MIN = 60', () => {
        assert.equal(READINESS_THRESHOLDS.HEALTH_SCORE_MIN, 60);
    });

    it('RISKY_ASSUMPTIONS_WARN = 3', () => {
        assert.equal(READINESS_THRESHOLDS.RISKY_ASSUMPTIONS_WARN, 3);
    });
});

/* ============================================================
 * 8. Combined scenarios
 * ============================================================ */

describe('Combined: реалистичные сценарии', () => {
    it('PO ранний расчёт: бюджет не задан + 5 risky → needs_clarification + 1 blocker + 1 warning', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({ answers: { foo: 'bar' } }),
            ctxOk({ riskyCount: 5 })
        );
        assert.equal(r.verdict, READINESS_VERDICTS.NEEDS_CLARIFICATION);
        assert.equal(r.blockers.length, 1);
        assert.equal(r.blockers[0].id, 'budget_missing');
        assert.equal(r.warnings.length, 1);
        assert.equal(r.warnings[0].id, 'risky_assumptions');
    });

    it('Готов к ревью: budget set + score 100 + 0 risky + provider fresh → ready', () => {
        const r = evaluateCalculationReadiness(
            makeCalc({
                answers: { foo: 'bar', target_capex_rub: 5_000_000, target_opex_monthly_rub: 200_000 },
                providerVersion: { stale: false }
            }),
            ctxOk()
        );
        assert.equal(r.verdict, READINESS_VERDICTS.READY);
        assert.equal(r.blockers.length, 0);
        assert.equal(r.warnings.length, 0);
    });
});
