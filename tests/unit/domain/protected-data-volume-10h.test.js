import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import {
    buildSeedDictionaries,
    defaultAnswersFrom,
    SEED_QUESTIONS,
    SEED_SETTINGS
} from '../../../js/domain/seed.js';

function makeCalc(answerPatch = {}) {
    const dictionaries = buildSeedDictionaries();
    return {
        id: `protected-data-volume-10h-${Math.random()}`,
        name: 'Package 10H protected data volume',
        answers: {
            ...defaultAnswersFrom(dictionaries.questions),
            users_total: 0,
            registered_users_total: 0,
            db_size_per_user_kb: 50,
            db_count: 2,
            db_size_initial_gb: 100,
            db_growth_gb_month: 0,
            protected_data_volume_gb: 0,
            protected_data_growth_gb_year: 0,
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

function q(id) {
    return SEED_QUESTIONS.find(entry => entry.id === id);
}

describe('10H / прямой объём защищаемых данных', () => {
    it('добавляет два опциональных вопроса с нейтральным default=0', () => {
        for (const id of ['protected_data_volume_gb', 'protected_data_growth_gb_year']) {
            const question = q(id);
            assert.ok(question, `${id} должен быть в SEED_QUESTIONS`);
            assert.equal(question.section, 'data_storage');
            assert.equal(question.allowUnknown, true);
            assert.equal(question.defaultValue, 0);
            assert.equal(question.defaultIfUnknown, 0);
        }
    });

    it('при нулевых прямых полях сохраняет старую грубую оценку от БД', () => {
        assert.deepEqual(secureQty(), {
            PSI: 100,
            PROD: 200,
            LOAD: 200
        });
    });

    it('явный объём защищаемых данных не умножается на число БД', () => {
        assert.deepEqual(secureQty({
            protected_data_volume_gb: 30,
            protected_data_growth_gb_year: 0,
            db_count: 99,
            db_size_initial_gb: 1000
        }), {
            PSI: 15,
            PROD: 30,
            LOAD: 30
        });
    });

    it('годовой прирост защищаемых данных добавляется только к ПРОМ', () => {
        assert.deepEqual(secureQty({
            protected_data_volume_gb: 30,
            protected_data_growth_gb_year: 10
        }), {
            PSI: 15,
            PROD: 40,
            LOAD: 30
        });
    });

    it('гейт ПДн/шифрования сохраняется', () => {
        assert.deepEqual(secureQty({
            protected_data_volume_gb: 30,
            protected_data_growth_gb_year: 10,
            pdn_152fz: false,
            encryption_at_rest: false
        }), {
            PSI: 0,
            PROD: 0,
            LOAD: 0
        });
    });

    it('формула явно использует новые поля и сохраняет ограничение НТ', () => {
        const item = buildSeedDictionaries().items.find(entry => entry.id === 'storage-secure-gb');
        const allFormulas = Object.values(item.qtyFormulas).join('\n');

        assert.match(allFormulas, /Q\.protected_data_volume_gb/);
        assert.match(allFormulas, /Q\.protected_data_growth_gb_year/);
        assert.match(item.qtyFormulas.LOAD, /min\(S\.standSizeRatio\.LOAD,\s*1\)/);
        assert.match(item.formulaHelp, /если задан прямой объём защищаемых данных/i);
        assert.match(item.formulaHelp, /годовой прирост добавляется только к ПРОМ/i);
    });
});
