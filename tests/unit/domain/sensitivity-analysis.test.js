/**
 * Unit-тесты Stage 15.3 — Sensitivity Analysis.
 *
 * Покрывает: simulateNumericPerturbation (ноль/null → N/A, позитив → ok, immutability),
 * simulateTogglePerturbation (переключение, зависимые defaults, immutability),
 * runSensitivityAnalysis (разделение results/notAvailable),
 * rankSensitivityDrivers (сортировка по costType, category filter).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    simulateNumericPerturbation,
    simulateTogglePerturbation,
    runSensitivityAnalysis,
    rankSensitivityDrivers
} from '../../../js/domain/sensitivityAnalysis.js';

/* ---------- Минимальная фабрика расчёта ---------- */

function makeCalc(answers = {}, overrides = {}) {
    return {
        id: 'sa-t1',
        name: 'SA Test',
        schemaVersion: 12,
        answers: { pcu_target: 1000, ai_llm_used: false, ...answers },
        answersMeta: {},
        settings: {
            applyRiskFactors: false,
            vatEnabled: false,
            planningHorizonYears: 1,
            phaseDurationMonths: 3,
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
                  defaultValue: 500, defaultIfUnknown: 500 },
                { id: 'ai_llm_used', type: 'boolean', title: 'Использовать LLM?',
                  defaultValue: false }
            ],
            items: [
                {
                    id: 'sa-vcpu', name: 'SA vCPU',
                    category: 'HW', resourceClass: 'COMPUTE',
                    billingInterval: 'monthly', pricePerUnit: 100,
                    qtyFormulas: {
                        DEV: '0', IFT: '0', PSI: '0',
                        PROD: 'Q.pcu_target', LOAD: '0'
                    },
                    applicableStands: ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']
                }
            ],
            settings: {}
        },
        view: { disabledStands: [] },
        providerVersion: null
    };
}

/* ============================================================
 * simulateNumericPerturbation — N/A cases
 * ============================================================ */

describe('simulateNumericPerturbation: N/A при нулевом значении', () => {
    it('возвращает status na при pcu_target=0', () => {
        const r = simulateNumericPerturbation(makeCalc({ pcu_target: 0 }), 'pcu_target');
        assert.equal(r.status, 'na');
        assert.ok(typeof r.reason === 'string');
    });

    it('возвращает status na при pcu_target=null', () => {
        const r = simulateNumericPerturbation(makeCalc({ pcu_target: null }), 'pcu_target');
        assert.equal(r.status, 'na');
    });

    it('содержит fieldId и label при N/A', () => {
        const r = simulateNumericPerturbation(makeCalc({ pcu_target: 0 }), 'pcu_target');
        assert.equal(r.fieldId, 'pcu_target');
        assert.ok(typeof r.label === 'string');
    });
});

/* ============================================================
 * simulateNumericPerturbation — ok case
 * ============================================================ */

describe('simulateNumericPerturbation: корректный результат для положительного значения', () => {
    it('возвращает status ok', () => {
        const r = simulateNumericPerturbation(makeCalc(), 'pcu_target');
        assert.equal(r.status, 'ok');
    });

    it('содержит поля baseline, simulated, delta', () => {
        const r = simulateNumericPerturbation(makeCalc(), 'pcu_target');
        assert.ok(r.baseline, 'baseline missing');
        assert.ok(r.simulated, 'simulated missing');
        assert.ok(r.delta, 'delta missing');
    });

    it('delta.total ненулевое при изменении pcu_target', () => {
        const r = simulateNumericPerturbation(makeCalc(), 'pcu_target');
        assert.notEqual(r.delta.total, 0);
    });

    it('simulatedValue больше baselineValue на +10%', () => {
        const r = simulateNumericPerturbation(makeCalc(), 'pcu_target', 10);
        assert.ok(Math.abs(r.simulatedValue - r.baselineValue * 1.1) < 0.001);
    });

    it('не мутирует исходный расчёт', () => {
        const calc = makeCalc();
        const originalPcu = calc.answers.pcu_target;
        simulateNumericPerturbation(calc, 'pcu_target', 10);
        assert.equal(calc.answers.pcu_target, originalPcu);
    });
});

/* ============================================================
 * simulateNumericPerturbation — settings fields
 * ============================================================ */

describe('simulateNumericPerturbation: settings-поля', () => {
    it('обрабатывает planningHorizonYears из settings', () => {
        const calc = makeCalc({}, {
            settings: { applyRiskFactors: true, vatEnabled: false, planningHorizonYears: 2,
                        bufferTask: 0, bufferProject: 0, kInflation: 0.1,
                        kSeasonal: 0, kScheduleShift: 0, kContingency: 0, vatRate: 0,
                        standSizeRatio: { DEV: 0.1, IFT: 0.4, PSI: 0.5, PROD: 1.0, LOAD: 0.8 },
                        resourceRatio: {},
                        aiStandFactor: { DEV: 0.02, IFT: 0.2, PSI: 0.5, PROD: 1.0, LOAD: 1.0 } }
        });
        const r = simulateNumericPerturbation(calc, 'planningHorizonYears', 10);
        // должен вернуть ok или na (если 0/null), не бросать ошибку
        assert.ok(r.status === 'ok' || r.status === 'na');
    });
});

/* ============================================================
 * simulateTogglePerturbation
 * ============================================================ */

describe('simulateTogglePerturbation: переключение boolean', () => {
    it('переключает false → true', () => {
        const calc = makeCalc({ ai_llm_used: false });
        const r = simulateTogglePerturbation(calc, 'ai_llm_used');
        assert.equal(r.status === 'ok' || r.status === 'na', true);
        if (r.status === 'ok') {
            assert.equal(r.baselineValue, false);
            assert.equal(r.simulatedValue, true);
        }
    });

    it('не мутирует исходный расчёт при переключении', () => {
        const calc = makeCalc({ ai_llm_used: false });
        const originalValue = calc.answers.ai_llm_used;
        simulateTogglePerturbation(calc, 'ai_llm_used');
        assert.equal(calc.answers.ai_llm_used, originalValue);
    });

    it('содержит fieldId и label', () => {
        const calc = makeCalc({ ai_llm_used: false });
        const r = simulateTogglePerturbation(calc, 'ai_llm_used');
        assert.equal(r.fieldId, 'ai_llm_used');
        assert.ok(typeof r.label === 'string');
    });
});

/* ============================================================
 * runSensitivityAnalysis
 * ============================================================ */

describe('runSensitivityAnalysis: структура результата', () => {
    it('возвращает { results, notAvailable } для null calc', () => {
        const r = runSensitivityAnalysis(null);
        assert.deepEqual(r, { results: [], notAvailable: [] });
    });

    it('возвращает results и notAvailable массивы', () => {
        const r = runSensitivityAnalysis(makeCalc(), {
            numericFields: ['pcu_target'],
            toggleFields: [],
            settingsNumericFields: [],
            settingsToggleFields: []
        });
        assert.ok(Array.isArray(r.results));
        assert.ok(Array.isArray(r.notAvailable));
    });

    it('нулевые поля попадают в notAvailable', () => {
        const r = runSensitivityAnalysis(makeCalc({ pcu_target: 0 }), {
            numericFields: ['pcu_target'],
            toggleFields: [],
            settingsNumericFields: [],
            settingsToggleFields: []
        });
        assert.equal(r.results.length, 0);
        assert.equal(r.notAvailable.length, 1);
    });

    it('ненулевые поля попадают в results', () => {
        const r = runSensitivityAnalysis(makeCalc(), {
            numericFields: ['pcu_target'],
            toggleFields: [],
            settingsNumericFields: [],
            settingsToggleFields: []
        });
        assert.equal(r.results.length, 1);
        assert.equal(r.results[0].status, 'ok');
    });
});

/* ============================================================
 * rankSensitivityDrivers
 * ============================================================ */

describe('rankSensitivityDrivers: сортировка по delta', () => {
    function makeResult(fieldId, opex, capex, total) {
        return {
            fieldId, status: 'ok',
            category: 'infrastructure',
            delta: { opexMonthly: opex, capexMonthly: capex, total }
        };
    }

    it('сортирует по убыванию для costType opex', () => {
        const results = [
            makeResult('a', 100, 0, 100),
            makeResult('b', 500, 0, 500),
            makeResult('c', 200, 0, 200)
        ];
        const ranked = rankSensitivityDrivers(results, 'opex');
        assert.equal(ranked[0].fieldId, 'b');
        assert.equal(ranked[1].fieldId, 'c');
        assert.equal(ranked[2].fieldId, 'a');
    });

    it('использует capexMonthly для costType capex', () => {
        const results = [
            makeResult('a', 0, 300, 300),
            makeResult('b', 0, 100, 100)
        ];
        const ranked = rankSensitivityDrivers(results, 'capex');
        assert.equal(ranked[0].fieldId, 'a');
    });

    it('использует total для costType total', () => {
        const results = [
            makeResult('a', 100, 200, 300),
            makeResult('b', 200, 50, 250)
        ];
        const ranked = rankSensitivityDrivers(results, 'total');
        assert.equal(ranked[0].fieldId, 'a');
    });

    it('фильтрует по категориям', () => {
        const results = [
            { fieldId: 'a', status: 'ok', category: 'ai',
              delta: { opexMonthly: 1000, capexMonthly: 0, total: 1000 } },
            { fieldId: 'b', status: 'ok', category: 'storage',
              delta: { opexMonthly: 500, capexMonthly: 0, total: 500 } }
        ];
        const ranked = rankSensitivityDrivers(results, 'opex', ['ai']);
        assert.equal(ranked.length, 1);
        assert.equal(ranked[0].fieldId, 'a');
    });

    it('возвращает пустой массив для пустого списка', () => {
        assert.deepEqual(rankSensitivityDrivers([], 'opex'), []);
    });

    it('не изменяет исходный массив', () => {
        const results = [
            makeResult('a', 100, 0, 100),
            makeResult('b', 500, 0, 500)
        ];
        const copy = [...results];
        rankSensitivityDrivers(results, 'opex');
        assert.deepEqual(results, copy);
    });
});
