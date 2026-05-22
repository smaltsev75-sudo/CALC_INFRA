/**
 * Round-trip JSON-экспорта/импорта расчёта в части view.disabledStands —
 * признака конкретного расчёта (Этап 9.7.1).
 *
 * Браузерный downloadJson/pickFile не вызываем (нет DOM в node:test);
 * вместо них используем сериализацию через JSON.stringify ↔ JSON.parse +
 * валидацию/миграцию из доменного слоя — то же, что выполняется в
 * importCalcFromFile после чтения файла.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const { store } = await import('../../js/state/store.js');
const calcList = await import('../../js/controllers/calcListController.js');
const persist = await import('../../js/state/persistence.js');
const { migrateCalculation } = await import('../../js/state/migrations.js');
const { validateCalculation } = await import('../../js/domain/validation.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
});

/** Имитировать пайплайн importCalcFromFile (без файлового IO). */
function importFromObject(parsed) {
    let data = JSON.parse(JSON.stringify(parsed));
    data = migrateCalculation(data);
    if (!data.view || typeof data.view !== 'object') data.view = { disabledStands: [] };
    else if (!Array.isArray(data.view.disabledStands)) data.view.disabledStands = [];
    const errors = [];
    validateCalculation(data, errors);
    return { ok: errors.length === 0, errors, calc: data };
}

describe('view.disabledStands: round-trip JSON', () => {
    it('новый расчёт содержит view.disabledStands = []', () => {
        const c = calcList.createCalc('Базовый');
        assert.deepEqual(c.view?.disabledStands, []);
    });

    it('переносит disabledStands через JSON.stringify → JSON.parse → import', () => {
        const c = calcList.createCalc('С отключёнными стендами');
        // Эмулируем установку через ctx.toggleStand: меняем view в активном расчёте.
        store.updateActiveCalc({
            view: { ...(c.view || {}), disabledStands: ['LOAD'] }
        });
        const live = store.getState().activeCalc;
        assert.deepEqual(live.view.disabledStands, ['LOAD']);

        // Экспорт = сериализация всего объекта расчёта (что и делает downloadJson).
        const json = JSON.stringify(live);
        const parsed = JSON.parse(json);

        // Импорт = миграция + валидация (что делает importCalcFromFile после readJsonFile).
        const r = importFromObject(parsed);
        assert.equal(r.ok, true, JSON.stringify(r.errors));
        assert.deepEqual(r.calc.view.disabledStands, ['LOAD']);
    });

    it('переносит несколько отключённых стендов', () => {
        const c = calcList.createCalc('Несколько стендов');
        store.updateActiveCalc({
            view: { disabledStands: ['DEV', 'IFT', 'LOAD'] }
        });
        const live = store.getState().activeCalc;
        const json = JSON.stringify(live);
        const r = importFromObject(JSON.parse(json));
        assert.equal(r.ok, true, JSON.stringify(r.errors));
        assert.deepEqual([...r.calc.view.disabledStands].sort(), ['DEV', 'IFT', 'LOAD']);
    });

    it('старый JSON без view — импортируется и получает view.disabledStands = []', () => {
        const c = calcList.createCalc('Старый формат');
        const live = store.getState().activeCalc;
        // Снимок «до» — без view (как у пользователя со старым экспортом).
        const legacy = JSON.parse(JSON.stringify(live));
        delete legacy.view;
        assert.equal(legacy.view, undefined);

        const r = importFromObject(legacy);
        assert.equal(r.ok, true, JSON.stringify(r.errors));
        assert.deepEqual(r.calc.view.disabledStands, []);
    });

    it('JSON с view, но без disabledStands — импортируется и получает []', () => {
        const c = calcList.createCalc('Частичный view');
        const live = store.getState().activeCalc;
        const partial = JSON.parse(JSON.stringify(live));
        partial.view = {}; // view есть, поля нет
        const r = importFromObject(partial);
        assert.equal(r.ok, true, JSON.stringify(r.errors));
        assert.deepEqual(r.calc.view.disabledStands, []);
    });

    it('JSON с неизвестным стендом в view.disabledStands — отклоняется валидацией', () => {
        const c = calcList.createCalc('С битым view');
        const live = store.getState().activeCalc;
        const broken = JSON.parse(JSON.stringify(live));
        broken.view = { disabledStands: ['UNKNOWN'] };
        const r = importFromObject(broken);
        assert.equal(r.ok, false);
        assert.ok(r.errors.some(e => /Неизвестный стенд/.test(e.message)),
            JSON.stringify(r.errors));
    });

    it('persistence: расчёт с disabledStands сохраняется в localStorage и читается', () => {
        const c = calcList.createCalc('Persistence');
        store.updateActiveCalc({ view: { disabledStands: ['PSI'] } });
        const live = store.getState().activeCalc;
        // Сохраняем через persist (это делает controller автоматически в подписке;
        // здесь дублируем явно, т.к. в node:test нет subscribers).
        persist.saveCalc(live);

        const reloaded = persist.loadCalc(live.id);
        assert.deepEqual(reloaded.view.disabledStands, ['PSI']);
    });
});
