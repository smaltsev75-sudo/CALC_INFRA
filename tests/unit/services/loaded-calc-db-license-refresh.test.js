import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { prepareLoadedCalc } from '../../../js/services/loadedCalc.js';

const OLD_UNCONDITIONAL_PROD_FORMULA = 'ceil(Q.db_count * (1 + Q.db_replicas_count) * 4)';

function makeLegacyDbLicenseCalc(answerOverride = {}) {
    const dictionaries = buildSeedDictionaries();
    dictionaries.questions = dictionaries.questions
        .filter(row => row.id !== 'db_commercial_license_required');
    const answers = defaultAnswersFrom(dictionaries.questions);
    delete answers.db_commercial_license_required;

    const item = dictionaries.items.find(row => row.id === 'license-db-per-vcpu');
    item.qtyFormulas.PROD = OLD_UNCONDITIONAL_PROD_FORMULA;

    return {
        id: 'legacy-db-license-unconditional',
        name: 'Legacy DB license unconditional',
        schemaVersion: 20,
        createdAt: '2026-05-26T00:00:00.000Z',
        updatedAt: '2026-05-26T00:00:00.000Z',
        settings: {
            ...structuredClone(SEED_SETTINGS),
            applyRiskFactors: false,
            vatEnabled: false,
            vatRate: 0
        },
        answers: {
            ...answers,
            db_count: 2,
            db_replicas_count: 1,
            ...answerOverride
        },
        dictionaries,
        view: {}
    };
}

describe('prepareLoadedCalc: DB commercial license formula refresh', () => {
    it('добавляет вопрос и обновляет legacy unconditional формулу; без opt-in qty=0', () => {
        const loaded = prepareLoadedCalc(makeLegacyDbLicenseCalc());

        assert.equal(loaded.error, null);
        assert.equal(loaded.needsPersist, true);

        const question = loaded.calc.dictionaries.questions
            .find(row => row.id === 'db_commercial_license_required');
        assert.equal(question?.defaultValue, false);

        const item = loaded.calc.dictionaries.items
            .find(row => row.id === 'license-db-per-vcpu');
        assert.match(item.qtyFormulas.PROD, /db_commercial_license_required/);
        assert.notEqual(item.qtyFormulas.PROD, OLD_UNCONDITIONAL_PROD_FORMULA);

        const result = calculate(loaded.calc);
        assert.equal(result.items['license-db-per-vcpu'].stands.PROD.qty, 0);
    });

    it('сохраняет расчёт коммерческой СУБД при явном opt-in', () => {
        const loaded = prepareLoadedCalc(makeLegacyDbLicenseCalc({
            db_commercial_license_required: true
        }));

        assert.equal(loaded.error, null);

        const result = calculate(loaded.calc);
        assert.equal(result.items['license-db-per-vcpu'].stands.PROD.qty, 16);
    });
});
