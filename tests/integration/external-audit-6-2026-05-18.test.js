/**
 * Внешний аудит #6 (2026-05-18, шестой за день).
 *
 * 6 родственных к audit #5 пунктов того же класса — фокус смещён на
 * порядок (store-then-commit вместо commit-then-store), proverka return
 * у undo-callbacks, и дифференциация причин сбоя lock'а.
 *
 *   P1    app.js.deleteQuestion undo: saveQuestion(backup) persist'ит вопрос
 *         с default answer; backupAnswer применялся через голый
 *         store.updateActiveCalc без commitActiveCalc → answer в памяти,
 *         в storage default → F5 теряет восстановление.
 *   P2-1  deleteItem/deleteQuestion: store.updateActiveCalc ДО commitActiveCalc.
 *         При quota UI показывает «исчез», но возвращается {ok:false}.
 *   P2-2  renameCalc: commitCalcRename результат игнорируется; activeCalc
 *         мутируется на новое имя независимо от persist. F5 откатит.
 *   P2-3  Undo callbacks (deleteCalc/deleteItem) игнорируют restoreCalc/
 *         saveItem return — лживо показывают «Восстановлено».
 *   P3-1  deleteCalc void → caller (app.js) не отличает успех от persist-fail,
 *         показывает undo-snackbar для несуществующего удаления.
 *   P3-2  _enterUpdate маскирует lock.reason='persist' под 'locked-by-other-tab'.
 *
 * Все тесты должны падать на коде ДО фикса и проходить после.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const storageMod = await import('../../js/services/storage.js');
const persist = await import('../../js/state/persistence.js');
const { store } = await import('../../js/state/store.js');
const itemCtl = await import('../../js/controllers/itemController.js');
const questionCtl = await import('../../js/controllers/questionController.js');
const calcListCtl = await import('../../js/controllers/calcListController.js');
const providerCtl = await import('../../js/controllers/providerController.js');

function installSelectiveQuotaSpy() {
    const data = new Map();
    const failKeys = new Set();
    const ls = {
        get length() { return data.size; },
        key(i) { return Array.from(data.keys())[i] ?? null; },
        getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
        setItem(k, v) {
            const key = String(k);
            if (failKeys.has(key)) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            data.set(key, String(v));
        },
        removeItem(k) { data.delete(String(k)); },
        clear() { data.clear(); }
    };
    Object.defineProperty(globalThis, 'localStorage', {
        value: ls, configurable: true, writable: true
    });
    return {
        ls, data, failKeys,
        fail(key) { failKeys.add(key); },
        unfail(key) { failKeys.delete(key); }
    };
}

function seedCalc(spy, partial = {}) {
    const calc = {
        id: 'audit6-calc',
        name: 'Original',
        createdAt: '2026-05-18T10:00:00.000Z',
        updatedAt: '2026-05-18T10:00:00.000Z',
        schemaVersion: 18,
        settings: {},
        answers: {},
        answersMeta: {},
        dictionaries: { items: [], questions: [] },
        ...partial
    };
    spy.data.set('calc.' + calc.id, JSON.stringify(calc));
    spy.data.set('calc.list', JSON.stringify(
        [{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]
    ));
    store.setActiveCalc(calc);
    return calc;
}

beforeEach(() => {
    installLocalStorage();
    storageMod.__resetStorageMode();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setPersistStatus('idle');
});

/* ============================================================
 * P2-1: deleteItem inverse pattern (commit ДО store)
 * ============================================================ */

describe('External audit #6 P2-1: deleteItem НЕ мутирует store при persist-fail', () => {
    it('deleteItem с quota → элемент остаётся в store И в storage', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        const items = [{
            id: 'it-keep', name: 'Keep Me', unit: 'шт.', pricePerUnit: 100,
            category: 'HW', resourceClass: 'CPU', billingInterval: 'monthly',
            vendor: '', description: '',
            applicableStands: ['PROD'], qtyFormulas: { PROD: '1' }, formulaHelp: ''
        }];
        seedCalc(spy, { dictionaries: { items, questions: [] } });

        spy.fail('calc.audit6-calc');

        const r = itemCtl.deleteItem('it-keep');
        assert.equal(r?.ok, false);
        assert.equal(r?.reason, 'persist');

        /* КРИТИЧНО: элемент остаётся И в store, И в storage. */
        const storeItems = store.getState().activeCalc.dictionaries.items;
        assert.equal(storeItems.length, 1, 'элемент НЕ должен исчезать из store при persist-fail');
        assert.equal(storeItems[0].id, 'it-keep');

        const stored = persist.loadCalc('audit6-calc');
        assert.equal(stored.dictionaries.items.length, 1,
            'элемент в storage не тронут (не было успешного commit)');
    });

    it('deleteQuestion с quota → вопрос остаётся в store И в storage', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        const questions = [{
            id: 'q-keep', section: 'business', subgroup: '', title: 'Q', description: '',
            type: 'number', defaultValue: 0, allowUnknown: true, assumptionRisk: 'low',
            order: 1, min: 0, max: 100, step: 1
        }];
        seedCalc(spy, { dictionaries: { items: [], questions }, answers: { 'q-keep': 42 } });

        spy.fail('calc.audit6-calc');

        const r = questionCtl.deleteQuestion('q-keep');
        assert.equal(r?.ok, false);
        assert.equal(r?.reason, 'persist');

        const storeQs = store.getState().activeCalc.dictionaries.questions;
        assert.equal(storeQs.length, 1);
        assert.equal(store.getState().activeCalc.answers['q-keep'], 42,
            'answer не удалён в store при persist-fail');
    });
});

/* ============================================================
 * P2-2: renameCalc не мутирует activeCalc при fail
 * ============================================================ */

describe('External audit #6 P2-2: renameCalc возвращает {ok, reason} + НЕ мутирует activeCalc при fail', () => {
    it('renameCalc с quota на calc.<id> → activeCalc остаётся с прежним именем', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        const calc = seedCalc(spy);

        spy.fail('calc.audit6-calc');

        const r = calcListCtl.renameCalc(calc.id, 'BrandNewName');
        assert.equal(r?.ok, false);
        assert.equal(r?.reason, 'persist');

        const active = store.getState().activeCalc;
        assert.equal(active.name, 'Original',
            'activeCalc.name НЕ должен меняться при persist-fail — иначе расхождение с storage.');
    });

    it('renameCalc happy-path → {ok:true} + activeCalc обновлён', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        const calc = seedCalc(spy);

        const r = calcListCtl.renameCalc(calc.id, 'BrandNewName');
        assert.equal(r?.ok, true);
        assert.equal(store.getState().activeCalc.name, 'BrandNewName');
    });
});

/* ============================================================
 * P3-1: deleteCalc возвращает {ok, reason}
 * ============================================================ */

describe('External audit #6 P3-1: deleteCalc возвращает {ok, reason}', () => {
    it('deleteCalc с quota на calc.list → {ok:false, reason:"persist"}', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        const calc = seedCalc(spy);

        spy.fail('calc.list');

        const r = calcListCtl.deleteCalc(calc.id);
        assert.equal(r?.ok, false);
        assert.equal(r?.reason, 'persist');
        assert.match(String(r.message || ''), /не удал|quota|хранилищ/i);

        /* calc.<id> должен остаться в storage. */
        const stored = persist.loadCalc(calc.id);
        assert.ok(stored, 'calc.<id> в storage должен остаться при сбое saveCalcList');
    });

    it('deleteCalc happy-path → {ok:true}', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        const calc = seedCalc(spy);

        const r = calcListCtl.deleteCalc(calc.id);
        assert.equal(r?.ok, true);
        assert.equal(persist.loadCalc(calc.id), null);
    });
});

/* ============================================================
 * P3-2: _enterUpdate дифференцирует persist vs locked
 * ============================================================ */

describe('External audit #6 P3-2: provider lock fail с quota → reason="persist", не locked-by-other-tab', () => {
    it('quota на calc.providerTabLocks → updateProviderPricesFromFile возвращает reason="persist"', async () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        spy.fail('calc.providerTabLocks');

        /* Используем DI _pickFile/_readJsonFile чтобы НЕ открывать реальный file-picker.
         * При persist-fail на locks ENTER-фаза провалится ДО pickFile, поэтому DI не критично. */
        const result = await providerCtl.updateProviderPricesFromFile('sbercloud', {
            _pickFile: async () => null,
            _readJsonFile: async () => ({ data: {} })
        });

        /* Раньше: reason=='locked-by-other-tab' (маскирует quota). Теперь: 'persist'. */
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'persist',
            'Quota на providerTabLocks НЕ должно маскироваться под "другая вкладка". ' +
            'Текущий reason: ' + result.reason);
        assert.match(String(result.message || ''), /quota|хранилищ|lock/i);
    });
});
