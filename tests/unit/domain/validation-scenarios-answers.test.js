/**
 * PATCH 2.18.3 (внешний аудит #10, 2026-05-19, P1.1):
 * `validateCalculation` обязан проверять `scenarios[*].answers` тем же
 * per-question type-check + range + options whitelist, что и root.answers.
 *
 * До фикса: inactive scenario с `users_total: "not-a-number"` и
 * `product_type: "???"` давал `validationErrors 0`, а `switchScenario`
 * затем копировал эти значения в root.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateCalculation } from '../../../js/domain/validation.js';

function makeCalcWithBadScenarioAnswer(extraAnswers) {
    return {
        id: 'c1',
        name: 'Test',
        version: '2.18.3',
        schemaVersion: 19,
        settings: {
            vatEnabled: true,
            vatRate: 0.22,
            vatRateMode: 'manual',
            vatEffectiveDate: '2026-01-01',
            applyRiskFactors: true,
            kInflation: 0.05,
            kSeasonal: 0.05,
            kScheduleShift: 0.05,
            kContingency: 0.05,
            bufferTask: 0.10,
            bufferProject: 0.15,
            planningHorizonYears: 1,
            phaseDurationMonths: 6,
            daysPerMonth: 30,
            standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 0.80, PROD: 1.00 },
            resourceRatio: {},
            aiStandFactor: { DEV: 0.02, IFT: 0.20, PSI: 0.50, LOAD: 1.00, PROD: 1.00 },
            period: 'monthly'
        },
        answers: {},
        dictionaries: {
            items: [],
            questions: [
                { id: 'registered_users_total', section: 'business', order: 1, type: 'number', title: 'L', min: 1, max: 1_000_000_000, defaultValue: 1000 },
                { id: 'product_type', section: 'business', order: 2, type: 'select', title: 'Type', options: ['internal', 'b2b', 'b2c', 'b2g'], defaultValue: 'b2b' }
            ]
        },
        activeScenarioId: 's1',
        scenarios: [
            { id: 's1', label: 'Active', answers: {}, answersMeta: {} },
            { id: 's2', label: 'Inactive bad', answers: extraAnswers, answersMeta: {} }
        ]
    };
}

describe('validateCalculation: scenarios[*].answers', () => {
    it('ловит number-вопрос со строкой в inactive scenario', () => {
        const calc = makeCalcWithBadScenarioAnswer({ registered_users_total: 'not-a-number' });
        const errors = [];
        validateCalculation(calc, errors);
        const matching = errors.filter(e =>
            e.path && e.path.includes('scenarios[1].answers.registered_users_total')
        );
        assert.ok(matching.length > 0,
            `ожидалась ошибка про scenarios[1].answers.registered_users_total, получено: ${JSON.stringify(errors)}`);
    });

    it('ловит select-вопрос со значением вне options в inactive scenario', () => {
        const calc = makeCalcWithBadScenarioAnswer({ product_type: '???' });
        const errors = [];
        validateCalculation(calc, errors);
        const matching = errors.filter(e =>
            e.path && e.path.includes('scenarios[1].answers.product_type')
        );
        assert.ok(matching.length > 0,
            `ожидалась ошибка про scenarios[1].answers.product_type, получено: ${JSON.stringify(errors)}`);
    });

    it('ловит number-вопрос out-of-range (> max) в inactive scenario', () => {
        const calc = makeCalcWithBadScenarioAnswer({ registered_users_total: 10_000_000_000 });
        const errors = [];
        validateCalculation(calc, errors);
        const matching = errors.filter(e =>
            e.path && e.path.includes('scenarios[1].answers.registered_users_total')
        );
        assert.ok(matching.length > 0,
            `ожидалась ошибка про range, получено: ${JSON.stringify(errors)}`);
    });

    it('legacy calc без scenarios — не падает', () => {
        const calc = makeCalcWithBadScenarioAnswer({});
        delete calc.scenarios;
        delete calc.activeScenarioId;
        const errors = [];
        validateCalculation(calc, errors);
        // Может быть других ошибок, но не падение с throw.
        assert.ok(Array.isArray(errors));
    });

    it('чистый scenario не даёт ложных срабатываний', () => {
        const calc = makeCalcWithBadScenarioAnswer({ registered_users_total: 5000, product_type: 'b2c' });
        const errors = [];
        validateCalculation(calc, errors);
        const matching = errors.filter(e =>
            e.path && e.path.includes('scenarios[1].answers')
        );
        assert.equal(matching.length, 0,
            `чистый scenario не должен давать ошибок, получено: ${JSON.stringify(matching)}`);
    });
});
