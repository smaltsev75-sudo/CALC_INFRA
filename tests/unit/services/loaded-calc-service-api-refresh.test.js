import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { prepareLoadedCalc } from '../../../js/services/loadedCalc.js';

function makeLegacyExternalApiCalc() {
    const dictionaries = buildSeedDictionaries();
    const item = dictionaries.items.find(row => row.id === 'service-external-api-calls-1m');
    item.qtyFormulas.LOAD =
        'if(Q.external_api_calls_per_month > 0, max(1, round((Q.external_api_calls_per_month / 1000000) * S.standSizeRatio.LOAD)), 0)';

    return {
        id: 'legacy-external-api-load-round',
        name: 'Legacy external API LOAD round',
        schemaVersion: 20,
        createdAt: '2026-05-26T00:00:00.000Z',
        updatedAt: '2026-05-26T00:00:00.000Z',
        settings: {
            ...structuredClone(SEED_SETTINGS),
            standSizeRatio: { ...SEED_SETTINGS.standSizeRatio, LOAD: 1 }
        },
        answers: {
            ...defaultAnswersFrom(dictionaries.questions),
            external_api_calls_per_month: 1_400_000
        },
        dictionaries,
        view: {}
    };
}

describe('prepareLoadedCalc: external API service formula refresh', () => {
    it('обновляет legacy LOAD round() до ceil(), чтобы не занижать пакеты API-вызовов', () => {
        const loaded = prepareLoadedCalc(makeLegacyExternalApiCalc());

        assert.equal(loaded.error, null);
        assert.equal(loaded.needsPersist, true);

        const item = loaded.calc.dictionaries.items
            .find(row => row.id === 'service-external-api-calls-1m');
        assert.match(item.qtyFormulas.LOAD, /ceil\(/);
        assert.doesNotMatch(item.qtyFormulas.LOAD, /round\(/);

        const result = calculate(loaded.calc);
        assert.equal(result.items['service-external-api-calls-1m'].stands.LOAD.qty, 2);
    });
});
