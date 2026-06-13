import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from '../../../js/domain/calculator.js';
import { buildProdPassport } from '../../../js/domain/prodPassport.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { prepareLoadedCalc } from '../../../js/services/loadedCalc.js';

function makeRawCalc() {
    const dictionaries = buildSeedDictionaries();
    return {
        id: 'repair-attribution-import-test',
        name: 'Repair attribution import test',
        schemaVersion: 20,
        settings: {
            ...SEED_SETTINGS,
            applyRiskFactors: false,
            vatEnabled: true,
            vatRate: 0.22
        },
        answers: {
            ...defaultAnswersFrom(dictionaries.questions || []),
            registered_users_total: 500,
            dau_share_of_registered_percent: 0.7,
            ai_users_share: 30,
            ai_requests_per_user_day: 30,
            ai_avg_input_tokens: 3000,
            ai_avg_output_tokens: 500,
            ai_llm_used: true,
            rag_needed: true,
            rag_managed_used: false,
            rag_embeddings_million: 1,
            peak_rps: 50,
            microservices_count: 5,
            async_workers_count: 3,
            ram_per_vcpu_ratio: 4,
            cache_size_gb: null
        },
        answersMeta: {},
        dictionaries,
        view: {}
    };
}

describe('prepareLoadedCalc: repair attribution для Паспорта ПРОМ', () => {
    it('после импорта JSON автоисправленное поле попадает в repairedItemsCount', () => {
        const loaded = prepareLoadedCalc(JSON.parse(JSON.stringify(makeRawCalc())));

        assert.equal(loaded.error, null);
        assert.equal(loaded.repairs.length, 1);
        assert.ok(loaded.repairs.some(repair => repair.fieldId === 'cache_size_gb'));
        assert.equal(loaded.calc.answersMeta.cache_size_gb.source, 'repair');
        assert.equal(loaded.calc.answersMeta.cache_size_gb.fallbackSource, 'defaultIfUnknown');

        const passport = buildProdPassport(loaded.calc, {
            result: calculate(loaded.calc),
            stand: 'PROD'
        });
        const repairedRows = passport.items.filter(row => row.markers.some(marker => marker.type === 'repair'));

        assert.equal(passport.summary.repairedItemsCount, 1);
        assert.deepEqual(repairedRows.map(row => row.itemId), ['ram-gb']);
        assert.equal(
            repairedRows[0].inputs.questions.find(input => input.id === 'cache_size_gb').sourceLabel,
            'автоисправлено при загрузке'
        );
    });
});
