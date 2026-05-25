import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { prepareLoadedCalc } from '../../../js/services/loadedCalc.js';

function makeLegacyHddCalc() {
    const dictionaries = buildSeedDictionaries();
    const hdd = dictionaries.items.find(item => item.id === 'storage-hdd-tb');
    hdd.qtyFormulas = {
        ...hdd.qtyFormulas,
        LOAD: 'max(0.5, (max(Q.db_size_initial_gb + Q.db_growth_gb_month * 12, Q.users_total * 0.00005) * Q.db_count * Q.backup_retention_days / 30 / 1024) * S.standSizeRatio.LOAD)'
    };

    return {
        id: 'legacy-hdd',
        name: 'Legacy HDD',
        schemaVersion: 12,
        createdAt: '2026-05-25T00:00:00.000Z',
        updatedAt: '2026-05-25T00:00:00.000Z',
        settings: {
            ...structuredClone(SEED_SETTINGS),
            applyRiskFactors: false,
            vatEnabled: false,
            vatRate: 0
        },
        answers: {
            ...defaultAnswersFrom(dictionaries.questions),
            users_total: 55000,
            db_size_initial_gb: 100,
            db_growth_gb_month: 10,
            db_count: 2,
            backup_retention_days: 90,
            file_storage_volume_tb: 5,
            file_storage_growth_tb_year: 1,
            hot_data_share_percent: 30
        },
        dictionaries,
        view: {}
    };
}

describe('prepareLoadedCalc: legacy HDD formula refresh', () => {
    it('обновляет LOAD HDD, чтобы Нагрузка 120% масштабировала полную PROD-базу', () => {
        const loaded = prepareLoadedCalc(makeLegacyHddCalc());

        assert.equal(loaded.error, null);
        assert.equal(loaded.needsPersist, true);

        const hdd = loaded.calc.dictionaries.items.find(item => item.id === 'storage-hdd-tb');
        assert.match(hdd.qtyFormulas.LOAD, /file_storage_volume_tb/,
            'LOAD HDD должен включать холодную долю файлов, как PROD');

        const result = calculate(loaded.calc);
        const prodHdd = result.items['storage-hdd-tb'].stands.PROD.qty;
        const loadHdd = result.items['storage-hdd-tb'].stands.LOAD.qty;

        assert.ok(loadHdd > prodHdd,
            `После refresh LOAD HDD должен быть больше PROD при ratio 1.2: PROD=${prodHdd}, LOAD=${loadHdd}`);
        assert.ok(Math.abs(loadHdd - prodHdd * 1.2) < 1e-9,
            `LOAD HDD должен равняться PROD HDD × 1.2: expected=${prodHdd * 1.2}, got=${loadHdd}`);
    });
});
