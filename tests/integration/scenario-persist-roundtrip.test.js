/**
 * Sprint 3.0 / Stage 3: persist roundtrip activeScenarioId.
 *
 * Тестируется, что активный scenario переживает full save/load цикл:
 *   1. createCalc → save → load → activeScenarioId сохраняется
 *   2. switchScenario → save → load → активным остаётся выбранный
 *   3. addScenario+switchScenario → save → load → новый scenario активен
 *   4. JSON-export через JSON.stringify ↔ JSON.parse + миграция
 *      сохраняет activeScenarioId
 *
 * НЕ заводим отдельного STORAGE_KEYS для scenario — activeScenarioId хранится
 * как поле calc, идёт через commitActiveCalc атомарно с остальной calc-data.
 * Этот тест — гарантия, что инвариант не сломается при будущих рефакторах.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

let store, calcList, calcCtl, persist, migrations, validation;

before(async () => {
    installLocalStorage();
    store = (await import('../../js/state/store.js')).store;
    calcList = await import('../../js/controllers/calcListController.js');
    calcCtl = await import('../../js/controllers/calcController.js');
    persist = await import('../../js/state/persistence.js');
    migrations = await import('../../js/state/migrations.js');
    validation = await import('../../js/domain/validation.js');
});

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
});

describe('Stage 3: activeScenarioId roundtrip через persistence (localStorage)', () => {
    it('новый calc: activeScenarioId сохраняется в save → load', () => {
        const c = calcList.createCalc('R1');
        const initialActive = c.activeScenarioId;
        assert.ok(initialActive, 'у нового calc должен быть activeScenarioId');

        persist.saveCalc(c);
        const reloaded = persist.loadCalc(c.id);
        assert.equal(reloaded.activeScenarioId, initialActive,
            'activeScenarioId переносится через save → load');
        assert.equal(reloaded.scenarios.length, 1, 'scenarios массив сохранился');
        assert.equal(reloaded.scenarios[0].id, initialActive,
            'единственный scenario имеет тот же id, что и activeScenarioId');
    });

    it('после addScenario+switchScenario новый scenario активен после save → load', () => {
        const c = calcList.createCalc('R2');
        store.setActiveCalc(c);
        const result = calcCtl.addScenario('С GPU');
        // addScenario автопереключает активный — это часть Stage 1 controller'а.
        const live = store.getState().activeCalc;
        assert.equal(live.activeScenarioId, result.scenarioId,
            'addScenario переключил активный на новый');

        persist.saveCalc(live);
        const reloaded = persist.loadCalc(live.id);
        assert.equal(reloaded.activeScenarioId, result.scenarioId,
            'после save → load активен тот же новый scenario');
        assert.equal(reloaded.scenarios.length, 2, 'оба сценария сохранены');
    });

    it('switchScenario: явное переключение переживает save → load', () => {
        const c = calcList.createCalc('R3');
        store.setActiveCalc(c);
        calcCtl.addScenario('Эконом');
        // После addScenario активен «Эконом». Переключаемся обратно на «Базовый».
        const initialId = c.scenarios[0].id;
        calcCtl.switchScenario(initialId);
        const live = store.getState().activeCalc;
        assert.equal(live.activeScenarioId, initialId, 'switch на initialId сработал');

        persist.saveCalc(live);
        const reloaded = persist.loadCalc(live.id);
        assert.equal(reloaded.activeScenarioId, initialId,
            'после save → load активен «Базовый», не «Эконом»');
    });
});

describe('Stage 3: activeScenarioId roundtrip через JSON-export', () => {
    it('JSON.stringify → JSON.parse → migrate сохраняет activeScenarioId', () => {
        const c = calcList.createCalc('JsonR1');
        store.setActiveCalc(c);
        calcCtl.addScenario('Альтернативный');
        const live = store.getState().activeCalc;
        const expectedActive = live.activeScenarioId;
        const expectedScenarioCount = live.scenarios.length;

        // Эмулируем downloadJson + readJsonFile: stringify → parse → migrate.
        const json = JSON.stringify(live);
        const parsed = JSON.parse(json);
        const migrated = migrations.migrateCalculation(parsed);

        assert.equal(migrated.activeScenarioId, expectedActive,
            'activeScenarioId переносится через JSON-roundtrip');
        assert.equal(migrated.scenarios.length, expectedScenarioCount,
            'количество сценариев сохранилось');

        const errors = [];
        validation.validateCalculation(migrated, errors);
        assert.equal(errors.length, 0,
            `validation должна пройти: ${JSON.stringify(errors)}`);
    });

    it('JSON-import legacy (без scenarios) — migration v14→v15 создаёт scenarios[0] и activeScenarioId', () => {
        // Создаём calc, потом руками удаляем scenarios — эмулируем старый JSON.
        const c = calcList.createCalc('Legacy');
        const live = store.getState().activeCalc;
        const json = JSON.stringify(live);
        const parsed = JSON.parse(json);
        delete parsed.scenarios;
        delete parsed.activeScenarioId;
        // Указываем старую версию схемы — миграция должна догнать.
        parsed.schemaVersion = 14;

        const migrated = migrations.migrateCalculation(parsed);
        assert.ok(Array.isArray(migrated.scenarios) && migrated.scenarios.length === 1,
            'migration создала scenarios[0]');
        assert.ok(migrated.activeScenarioId,
            'migration выставила activeScenarioId');
        assert.equal(migrated.scenarios[0].id, migrated.activeScenarioId,
            'единственный scenario имеет тот же id, что и activeScenarioId');
        assert.equal(migrated.scenarios[0].label, 'Базовый',
            'дефолтный label «Базовый» при миграции');
    });
});

describe('Stage 3: persist отдельного STORAGE_KEYS для scenario НЕТ (анти-регрессия)', () => {
    /* Stage 3 явно решает: activeScenarioId — поле calc, persist'ится через
       commitActiveCalc вместе с остальной calc-data. Отдельного ключа не
       заводим, чтобы избежать рассогласования (разные calc'и, одинаковый
       scenarioId, restore'ит «не тот»). Этот тест — анти-регрессия:
       проверяет что в STORAGE_KEYS не появилось ACTIVE_SCENARIO_ID
       или похожего ключа. */
    it('STORAGE_KEYS не содержит ACTIVE_SCENARIO_ID или SCENARIO_TAB', async () => {
        const constants = await import('../../js/utils/constants.js');
        const keys = constants.STORAGE_KEYS;
        // Ни один ключ из whitelist не должен напрямую персистить activeScenarioId.
        // PATCH 2.7.3: regex сужен до конкретного anti-pattern (activeScenario / scenarioTab),
        // чтобы НЕ ловить ложно-positive семантически другие ключи: например,
        // `scenarioComparisonSelectedProviders` (Stage 14.5 — cross-provider сравнение,
        // не имеет отношения к активной scenario-вкладке).
        const allValues = Object.values(keys);
        const suspicious = allValues.filter(v =>
            /activeScenarioId|scenarioTab|scenarioSwitcher/i.test(v));
        assert.equal(suspicious.length, 0,
            `STORAGE_KEYS не должен персистить scenario отдельно (нашлось: ${suspicious.join(', ')})`);
    });
});
