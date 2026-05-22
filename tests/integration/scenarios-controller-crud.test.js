/**
 * Sprint 3.0 Stage 1 integration: scenario CRUD через calcController + sync через store.
 *
 * Покрывает реальный flow:
 *   - createCalc → calc.scenarios[0] на месте сразу после создания
 *   - setAnswer → mirror подтянул scenarios[active].answers
 *   - addScenario → новый scenario с пустым answers, активный переключается
 *   - duplicateScenario → клон активного с новым id, активный переключается
 *   - deleteScenario → нельзя удалить последний; удаление активного → переключение
 *   - renameScenario → label правится
 *   - switchScenario → root зеркалит scenarios[newId].answers
 *
 * Используется реальный store + локальный mock localStorage.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

let store, calcList, calcCtl;

before(async () => {
    installLocalStorage();
    store = (await import('../../js/state/store.js')).store;
    calcList = await import('../../js/controllers/calcListController.js');
    calcCtl = await import('../../js/controllers/calcController.js');
});

beforeEach(() => {
    installLocalStorage();
    /* Сбрасываем active calc через store.setActiveCalc(null) — не идеальный
       reset, но достаточный для изоляции тестов в одной сессии импортов. */
    store.setActiveCalc(null);
});

describe('Sprint 3.0 Stage 1: createCalc → scenarios[0] готов', () => {
    it('новый расчёт сразу содержит scenarios[0] и activeScenarioId', () => {
        const c = calcList.createCalc('A');
        assert.ok(Array.isArray(c.scenarios) && c.scenarios.length === 1,
            'у нового calc сразу есть scenarios[0]');
        assert.equal(c.activeScenarioId, c.scenarios[0].id);
        assert.equal(c.scenarios[0].label, 'Базовый');
    });

    it('createCalcFromWizard: scenarios[0] синхронизирован после применения wizard\'а', () => {
        const wiz = { product_type: 'b2b', industry: 'corporate', scale: 'm',
                      geography: 'ru', pdn: false, activity: 'medium', ai_used: false };
        const c = calcList.createCalcFromWizard('Wiz', wiz);
        assert.deepEqual(c.scenarios[0].wizard, wiz, 'wizard в scenarios[0] = тому что на root');
        /* Wizard заполнил answers — scenarios[0].answers тоже непуст. */
        assert.ok(Object.keys(c.scenarios[0].answers).length > 0,
            'scenarios[0].answers непуст после wizard');
    });
});

describe('Sprint 3.0 Stage 1: setAnswer держит mirror', () => {
    it('setAnswer обновляет root.answers И scenarios[active].answers (через commit)', async () => {
        const c = calcList.createCalc('B');
        store.setActiveCalc(c);
        calcCtl.setAnswer('peak_rps', 1234);
        /* commit() debounce'нут — но syncActiveScenarioBeforePersist синхронен
           внутри commit() и обновляет store ДО debounced persist. */
        const updated = store.getState().activeCalc;
        assert.equal(updated.answers.peak_rps, 1234, 'root обновлён');
        const active = updated.scenarios.find(s => s.id === updated.activeScenarioId);
        assert.equal(active.answers.peak_rps, 1234, 'scenarios[active] зеркалирует root');
    });
});

describe('Sprint 3.0 Stage 1: addScenario', () => {
    it('добавляет новый scenario и переключает на него', () => {
        const c = calcList.createCalc('Add');
        store.setActiveCalc(c);
        calcCtl.setAnswer('peak_rps', 100);
        const beforeId = store.getState().activeCalc.activeScenarioId;
        const result = calcCtl.addScenario('Альтернативный');
        const after = store.getState().activeCalc;
        assert.equal(after.scenarios.length, 2);
        assert.notEqual(after.activeScenarioId, beforeId, 'переключились на новый');
        assert.equal(after.activeScenarioId, result.scenarioId);
        const newScenario = after.scenarios.find(s => s.id === result.scenarioId);
        assert.equal(newScenario.label, 'Альтернативный');
        assert.deepEqual(newScenario.answers, {}, 'у нового пустой answers');
        assert.deepEqual(after.answers, {}, 'root зеркалит новый (пустой) scenario');
    });
});

describe('Sprint 3.0 Stage 1: duplicateScenario', () => {
    it('копия содержит answers исходного, переключение на копию', () => {
        const c = calcList.createCalc('Dup');
        store.setActiveCalc(c);
        calcCtl.setAnswer('peak_rps', 999);
        const sourceId = store.getState().activeCalc.activeScenarioId;
        const result = calcCtl.duplicateScenario(sourceId);
        const after = store.getState().activeCalc;
        assert.equal(after.scenarios.length, 2);
        assert.equal(after.activeScenarioId, result.scenarioId);
        const copy = after.scenarios.find(s => s.id === result.scenarioId);
        assert.equal(copy.answers.peak_rps, 999, 'у копии те же ответы');
        assert.match(copy.label, /\(копия\)/);
    });
});

describe('Sprint 3.0 Stage 1: deleteScenario', () => {
    it('блокирует удаление последнего scenario', () => {
        const c = calcList.createCalc('OneOnly');
        store.setActiveCalc(c);
        const onlyId = store.getState().activeCalc.activeScenarioId;
        const result = calcCtl.deleteScenario(onlyId);
        assert.equal(result.removed, false);
        assert.equal(store.getState().activeCalc.scenarios.length, 1);
    });

    it('удаление неактивного → активный остаётся прежним', () => {
        const c = calcList.createCalc('Multi');
        store.setActiveCalc(c);
        const firstId = store.getState().activeCalc.activeScenarioId;
        const newRes = calcCtl.addScenario('Second');
        /* Сейчас активный — newRes (addScenario переключает). Переключим обратно. */
        calcCtl.switchScenario(firstId);
        /* Удаляем НЕАКТИВНЫЙ (newRes.scenarioId). */
        const result = calcCtl.deleteScenario(newRes.scenarioId);
        assert.equal(result.removed, true);
        const after = store.getState().activeCalc;
        assert.equal(after.scenarios.length, 1);
        assert.equal(after.activeScenarioId, firstId, 'активный не менялся');
    });

    it('удаление активного → переключение на оставшийся', () => {
        const c = calcList.createCalc('DelActive');
        store.setActiveCalc(c);
        const firstId = store.getState().activeCalc.activeScenarioId;
        const newRes = calcCtl.addScenario('Second');
        /* Сейчас активный = newRes.scenarioId. Удаляем именно его. */
        const result = calcCtl.deleteScenario(newRes.scenarioId);
        assert.equal(result.removed, true);
        const after = store.getState().activeCalc;
        assert.equal(after.scenarios.length, 1);
        assert.equal(after.activeScenarioId, firstId, 'переключились на оставшийся');
    });
});

describe('Sprint 3.0 Stage 1: renameScenario', () => {
    it('правит label существующего scenario', () => {
        const c = calcList.createCalc('Ren');
        store.setActiveCalc(c);
        const id = store.getState().activeCalc.activeScenarioId;
        const result = calcCtl.renameScenario(id, 'Новое имя');
        assert.equal(result.renamed, true);
        const after = store.getState().activeCalc;
        const sc = after.scenarios.find(s => s.id === id);
        assert.equal(sc.label, 'Новое имя');
    });
});

describe('Sprint 3.0 Stage 1: switchScenario', () => {
    it('переключение между сценариями зеркалит answers в root', () => {
        const c = calcList.createCalc('Switch');
        store.setActiveCalc(c);
        const firstId = store.getState().activeCalc.activeScenarioId;
        calcCtl.setAnswer('peak_rps', 100);  // ответы scenario A
        const newRes = calcCtl.addScenario('B');  // активный → B (пусто)
        calcCtl.setAnswer('peak_rps', 200);  // ответы scenario B
        /* Switch обратно на A. */
        const result = calcCtl.switchScenario(firstId);
        assert.equal(result.switched, true);
        const after = store.getState().activeCalc;
        assert.equal(after.activeScenarioId, firstId);
        assert.equal(after.answers.peak_rps, 100, 'root показывает answers из A');
        /* Switch на B. */
        calcCtl.switchScenario(newRes.scenarioId);
        assert.equal(store.getState().activeCalc.answers.peak_rps, 200, 'root показывает answers из B');
    });

    it('switch на тот же activeScenarioId — no-op', () => {
        const c = calcList.createCalc('NoSwitch');
        store.setActiveCalc(c);
        const id = store.getState().activeCalc.activeScenarioId;
        const result = calcCtl.switchScenario(id);
        assert.equal(result.switched, false);
    });
});
