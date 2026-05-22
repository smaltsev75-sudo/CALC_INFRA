/**
 * PATCH 2.18.3 (внешний аудит #10, 2026-05-19, P2.2):
 * `openCalc` обязан сохранять результат sanitize в storage, даже если
 * schemaVersion и VAT не изменились.
 *
 * До фикса: stale snapshot на schemaVersion=LATEST с deprecated id
 * очищался в памяти, но НЕ записывался обратно — `buildStateBundle`
 * затем экспортировал raw stored (с stale данными), и при следующем
 * openCalc цикл повторялся.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

const STALE = 'mau_growth_rate_percent';

function makeStaleSnapshot(id, latestSchemaVersion) {
    return {
        id, name: 'Stale',
        version: '2.18.3',
        schemaVersion: latestSchemaVersion,
        settings: {
            vatEnabled: true, vatRate: 0.22, vatRateMode: 'manual',
            vatEffectiveDate: '2026-01-01',
            applyRiskFactors: true, kInflation: 0.05, kSeasonal: 0.05,
            kScheduleShift: 0.05, kContingency: 0.05,
            bufferTask: 0.10, bufferProject: 0.15,
            planningHorizonYears: 1, phaseDurationMonths: 6, daysPerMonth: 30,
            standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 0.80, PROD: 1.00 },
            resourceRatio: {},
            aiStandFactor: { DEV: 0.02, IFT: 0.20, PSI: 0.50, LOAD: 1.00, PROD: 1.00 },
            period: 'monthly'
        },
        answers: { [STALE]: 25, registered_users_total: 1000 },
        answersMeta: { [STALE]: { source: 'manual' } },
        dictionaries: {
            items: [],
            questions: [
                { id: STALE, section: 'business', order: 1, type: 'number', title: 'Stale', defaultValue: 10 },
                { id: 'registered_users_total', section: 'business', order: 2, type: 'number', title: 'L', defaultValue: 1000 }
            ]
        },
        activeScenarioId: 's1',
        scenarios: [
            { id: 's1', label: 'Базовый', answers: { [STALE]: 30 }, answersMeta: { [STALE]: { source: 'wizard' } } }
        ]
    };
}

describe('openCalc: sanitize results persisted to storage', () => {
    beforeEach(() => {
        installLocalStorage();
    });

    it('stale snapshot на LATEST schemaVersion → sanitize ПИШЕТСЯ в storage', async () => {
        const { LATEST_SCHEMA_VERSION } = await import('../../js/state/migrations.js');
        const persist = await import('../../js/state/persistence.js');
        const { openCalc } = await import('../../js/controllers/calcListController.js');

        const id = `stale-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const stale = makeStaleSnapshot(id, LATEST_SCHEMA_VERSION);
        persist.saveCalc(stale);
        persist.saveCalcList([{ id, name: 'Stale', updatedAt: Date.now() }]);

        // Подтверждаем что stale действительно в storage до open.
        const before = persist.loadCalc(id);
        assert.equal(before.answers[STALE], 25, 'предусловие: stale в storage до open');

        const opened = openCalc(id);
        assert.ok(opened, 'openCalc вернул calc');
        assert.equal(opened.answers[STALE], undefined, 'in-memory: stale удалён');

        // Главная проверка: storage тоже очищен.
        const persisted = persist.loadCalc(id);
        assert.equal(persisted.answers[STALE], undefined,
            'storage: root.answers очищен после openCalc (persist-after-sanitize)');
        assert.equal(persisted.answersMeta?.[STALE], undefined,
            'storage: root.answersMeta очищен');
        assert.equal(persisted.scenarios[0].answers[STALE], undefined,
            'storage: scenarios[0].answers очищен');
        assert.ok(!persisted.dictionaries.questions.some(q => q.id === STALE),
            'storage: stale вопрос удалён из dictionary');
    });

    it('повторный openCalc после первого open не дёргает запись (idempotent)', async () => {
        const { LATEST_SCHEMA_VERSION } = await import('../../js/state/migrations.js');
        const persist = await import('../../js/state/persistence.js');
        const { openCalc } = await import('../../js/controllers/calcListController.js');

        const id = `clean-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const stale = makeStaleSnapshot(id, LATEST_SCHEMA_VERSION);
        persist.saveCalc(stale);
        persist.saveCalcList([{ id, name: 'Stale', updatedAt: Date.now() }]);

        // Первый open чистит и сохраняет.
        openCalc(id);
        const afterFirst = persist.loadCalc(id);
        const beforeSecondJson = JSON.stringify(afterFirst);

        // Второй open — calc уже чистый, hasDeprecatedQuestions=false → НЕ commit.
        openCalc(id);
        const afterSecond = persist.loadCalc(id);
        const afterSecondJson = JSON.stringify(afterSecond);

        // Контент идентичен (updatedAt не меняется, потому что commitMigratedCalc не вызван).
        assert.equal(afterSecondJson, beforeSecondJson,
            'идемпотентно: повторный open уже-чистого calc не меняет storage');
    });
});
