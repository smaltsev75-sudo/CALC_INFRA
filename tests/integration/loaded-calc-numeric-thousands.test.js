import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from '../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../js/domain/seed.js';
import { prepareLoadedCalc } from '../../js/services/loadedCalc.js';

describe('prepareLoadedCalc: числовые строки с пробелами тысяч', () => {
    it('импортированный peak_rps="1 000" чинится до 1000 до расчёта', () => {
        const dictionaries = buildSeedDictionaries();
        const calc = {
            id: 'numeric-thousands',
            name: 'Numeric thousands',
            version: '1.0',
            schemaVersion: 20,
            createdAt: '2026-06-14T00:00:00.000Z',
            updatedAt: '2026-06-14T00:00:00.000Z',
            settings: { ...SEED_SETTINGS, applyRiskFactors: false, vatEnabled: false },
            answers: {
                ...defaultAnswersFrom(dictionaries.questions),
                peak_rps: '1 000'
            },
            answersMeta: {},
            dictionaries
        };

        const prepared = prepareLoadedCalc(calc);
        assert.equal(prepared.error, null);
        assert.equal(prepared.calc.answers.peak_rps, 1000);
        assert.equal(prepared.needsPersist, true);
        assert.ok(prepared.repairs.some(r =>
            r.path === 'answers.peak_rps' &&
            r.reason === 'numeric-string' &&
            r.value === 1000
        ));

        const result = calculate(prepared.calc);
        assert.ok(result.items['cpu-vcpu-shared'].stands.PROD.qty > 1,
            'после repair формулы используют 1000 RPS, а не parseFloat("1 000") = 1');
    });
});
