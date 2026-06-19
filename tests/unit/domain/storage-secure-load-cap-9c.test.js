import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import {
    buildSeedDictionaries,
    defaultAnswersFrom,
    SEED_SETTINGS
} from '../../../js/domain/seed.js';

function makeCalc(answerPatch = {}) {
    const dictionaries = buildSeedDictionaries();
    return {
        id: `storage-secure-load-cap-${Math.random()}`,
        name: 'Package 9C secure storage load cap',
        answers: {
            ...defaultAnswersFrom(dictionaries.questions),
            users_total: 0,
            registered_users_total: 0,
            db_size_per_user_kb: 50,
            db_count: 2,
            db_size_initial_gb: 100,
            db_growth_gb_month: 0,
            pdn_152fz: true,
            encryption_at_rest: false,
            audit_logging_required: false,
            ...answerPatch
        },
        dictionaries,
        settings: structuredClone(SEED_SETTINGS)
    };
}

function secureQty(answerPatch = {}) {
    clearCalculationCache();
    const result = calculate(makeCalc(answerPatch));
    const item = result.items['storage-secure-gb'];
    return {
        PSI: item.stands.PSI.qty,
        PROD: item.stands.PROD.qty,
        LOAD: item.stands.LOAD.qty
    };
}

describe('Package 9C-A: protected storage LOAD cap', () => {
    it('does not let protected storage LOAD exceed PROD when DB has no growth', () => {
        assert.deepEqual(secureQty(), {
            PSI: 100,
            PROD: 200,
            LOAD: 200
        });
    });

    it('keeps LOAD at or below PROD when protected storage has yearly growth', () => {
        const qty = secureQty({ db_growth_gb_month: 10 });

        assert.equal(qty.PSI, 100);
        assert.equal(qty.PROD, 440);
        assert.equal(qty.LOAD, 200);
        assert.ok(qty.LOAD <= qty.PROD);
    });

    it('keeps gate behavior: no PDn/encryption means zero protected storage', () => {
        assert.deepEqual(secureQty({
            pdn_152fz: false,
            encryption_at_rest: false
        }), {
            PSI: 0,
            PROD: 0,
            LOAD: 0
        });
    });

    it('source guard: LOAD formula uses min(S.standSizeRatio.LOAD, 1)', () => {
        const item = buildSeedDictionaries().items.find(i => i.id === 'storage-secure-gb');

        assert.match(item.qtyFormulas.LOAD, /min\(S\.standSizeRatio\.LOAD,\s*1\)/);
        assert.doesNotMatch(item.qtyFormulas.PSI, /min\(S\.standSizeRatio\.LOAD/);
        assert.doesNotMatch(item.qtyFormulas.PROD, /min\(S\.standSizeRatio\.LOAD/);
    });

    it('formula help explains that load testing does not buy extra protected storage', () => {
        const item = buildSeedDictionaries().items.find(i => i.id === 'storage-secure-gb');

        assert.match(item.formulaHelp, /НТ/);
        assert.match(item.formulaHelp, /не увеличивает защищённый объём сверх ПРОМ/i);
    });
});
