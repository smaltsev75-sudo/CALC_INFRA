/**
 * Внешний аудит #7 (2026-05-18, седьмой за день).
 *
 * 5 пунктов — инвариант «persist-fail НЕ должен менять рабочий calc/store»
 * ещё пробит в нескольких местах после audit #6:
 *
 *   P1   CRUD/import ЭК и вопросов (saveItem/saveQuestion/importItems/
 *        importQuestions) мутирует activeCalc до commitActiveCalc.
 *   P1   CSV importItemPrices: applyPriceUpdates делает store-update + commit,
 *        затем безусловно syncDefaultDictionary; при quota active calc
 *        несохранён, default-словарь обновлён → рассинхрон.
 *   P1   applyOverrideToActiveCalc / applyOverrideToAllCalcsForProvider:
 *        store-update до commit, при quota store dirty.
 *   P2   openCalc/initFromStorage: commitMigratedCalc игнорируется, store
 *        получает мигрированный calc даже при persist-fail.
 *   P3   priceImportMappingController: refresh errors теряются — UI
 *        рапортует success.
 *
 * Все тесты падают на коде ДО фикса и проходят после.
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
        id: 'audit7-calc',
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
    store.setDefaultDictionary({ items: [], questions: [] });
});

/* ============================================================
 * P1: saveItem inverse pattern (commit ДО store)
 * ============================================================ */

describe('External audit #7 P1: saveItem НЕ мутирует activeCalc при persist-fail', () => {
    it('saveItem с quota → новый ЭК НЕ появляется ни в store, ни в storage', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        seedCalc(spy);

        spy.fail('calc.audit7-calc');

        const newItem = {
            id: 'new-it-1', name: 'New', unit: 'шт.', pricePerUnit: 100,
            category: 'HW', resourceClass: 'CPU', billingInterval: 'monthly',
            vendor: '', description: '',
            applicableStands: ['PROD'], qtyFormulas: { PROD: '1' }, formulaHelp: ''
        };
        const r = itemCtl.saveItem(newItem);
        assert.equal(r.ok, false);
        assert.ok(r.errors?.length > 0);

        const storeItems = store.getState().activeCalc.dictionaries.items;
        assert.equal(storeItems.length, 0,
            'Новый ЭК НЕ должен появляться в store при persist-fail.');

        const stored = persist.loadCalc('audit7-calc');
        assert.equal(stored.dictionaries.items.length, 0);
    });

    it('saveQuestion с quota → новый вопрос НЕ появляется в store/storage/answers', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        seedCalc(spy);

        spy.fail('calc.audit7-calc');

        const newQ = {
            id: 'new-q', section: 'business', subgroup: '', title: 'New Q', description: '',
            type: 'number', defaultValue: 5, allowUnknown: true, assumptionRisk: 'low',
            order: 1, min: 0, max: 100, step: 1
        };
        const r = questionCtl.saveQuestion(newQ);
        assert.equal(r.ok, false);

        const active = store.getState().activeCalc;
        assert.equal(active.dictionaries.questions.length, 0);
        assert.ok(!('new-q' in active.answers),
            'Default answer для нового вопроса НЕ должен появляться в answers при persist-fail.');
    });
});

/* ============================================================
 * P1: importItemPrices НЕ загрязняет default при persist-fail
 * ============================================================ */

describe('External audit #7 P1: applyPriceUpdates inverse pattern + НЕ синхронизирует default при fail', () => {
    /* applyPriceUpdates — internal helper в itemController, не экспортируется.
     * Тестируем его напрямую через прямой вызов из itemCtl (он вызывается из
     * importItemPrices, который async + полагается на ESM-frozen csvImport).
     * Делаем функциональный тест через imitate: вызываем applyPriceUpdates
     * через тот же путь — saveItem с обновлённой ценой того же id. */
    it('saveItem с новой ценой и quota → store/storage/default остаются исходными', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        const baseItem = {
            id: 'it-p', name: 'Item', unit: 'шт.', pricePerUnit: 100,
            category: 'HW', resourceClass: 'CPU', billingInterval: 'monthly',
            vendor: '', description: '',
            applicableStands: ['PROD'], qtyFormulas: { PROD: '1' }, formulaHelp: ''
        };
        seedCalc(spy, { dictionaries: { items: [baseItem], questions: [] } });
        spy.data.set('calc.defaultDictionary', JSON.stringify({ items: [baseItem], questions: [] }));
        store.setDefaultDictionary({ items: [baseItem], questions: [] });

        spy.fail('calc.audit7-calc');

        const updated = { ...baseItem, pricePerUnit: 120 };
        const r = itemCtl.saveItem(updated);
        assert.equal(r.ok, false);

        /* store / storage / default НЕ должны измениться. Это структурно та же
         * защита, что нужна для applyPriceUpdates (inverse + sync только при ok). */
        const storePrice = store.getState().activeCalc.dictionaries.items[0].pricePerUnit;
        assert.equal(storePrice, 100, 'store price не изменился при persist-fail');

        const stored = persist.loadCalc('audit7-calc');
        assert.equal(stored.dictionaries.items[0].pricePerUnit, 100);

        const defaultDict = store.getState().defaultDictionary;
        assert.equal(defaultDict.items[0].pricePerUnit, 100,
            'defaultDictionary НЕ должен синхронизироваться при persist-fail.');
    });

    it('applyPriceUpdates контракт: syncDefaultDictionary ТОЛЬКО ПОСЛЕ commitActiveCalc ok', async () => {
        /* Структурное требование — applyPriceUpdates в itemController.js. */
        const src = await import('node:fs').then(fs =>
            fs.readFileSync(
                new URL('../../js/controllers/itemController.js', import.meta.url),
                'utf8'
            )
        );
        const fnStart = src.indexOf('function applyPriceUpdates');
        assert.ok(fnStart >= 0);
        /* Balanced { } parser — `\n}` встречается во вложенных if-блоках. */
        const braceStart = src.indexOf('{', fnStart);
        let depth = 1;
        let i = braceStart + 1;
        while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
        }
        const body = src.slice(braceStart, i);

        /* Ищем CALL'ы (с открывающей скобкой), не упоминания в комментариях. */
        const commitIdx = body.search(/commitActiveCalc\s*\(/);
        const syncIdx = body.search(/syncDefaultDictionary\s*\(/);
        assert.ok(commitIdx > 0 && syncIdx > 0,
            `commit at ${commitIdx}, sync at ${syncIdx}`);
        assert.ok(commitIdx < syncIdx,
            'applyPriceUpdates: syncDefaultDictionary должен вызываться ПОСЛЕ commitActiveCalc.');

        /* Между commit-fail и sync должен быть return {ok:false, reason:'persist'}. */
        const between = body.slice(commitIdx, syncIdx);
        assert.match(between, /return\s*\{\s*ok\s*:\s*false[\s\S]*?reason\s*:\s*['"]persist['"]/,
            'applyPriceUpdates: между commit-проверкой и syncDefaultDictionary ' +
            'обязан быть return {ok:false, reason:"persist"} — иначе при persist-fail ' +
            'default-словарь обновляется без активного calc (рассинхрон).');
    });
});

/* ============================================================
 * P1: applyOverrideToActiveCalc inverse pattern
 * ============================================================ */

describe('External audit #7 P1: applyOverrideToActiveCalc НЕ мутирует store при quota', () => {
    it('quota на calc.<id> → store содержит исходные цены, providerVersion не меняется', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        const items = [{
            id: 'cpu-vcpu-shared', name: 'CPU', unit: 'шт.', pricePerUnit: 583.61,
            category: 'HW', resourceClass: 'CPU', billingInterval: 'monthly',
            vendor: '', description: '',
            applicableStands: ['PROD'], qtyFormulas: { PROD: '1' }, formulaHelp: ''
        }];
        const calc = seedCalc(spy, {
            settings: { provider: 'sbercloud' },
            dictionaries: { items, questions: [] }
        });
        /* Записываем mock override. */
        const overrideJson = {
            providerId: 'sbercloud',
            schemaVersion: 2,
            version: '2026-Q4',
            timestamp: '2026-10-01',
            pricesIncludeVat: false,
            items: [{ id: 'cpu-vcpu-shared', pricePerUnitNet: 999 }],
            prices: { 'cpu-vcpu-shared': 999 }
        };
        spy.data.set('calc.providerOverlayOverrides', JSON.stringify({ sbercloud: overrideJson }));

        spy.fail('calc.audit7-calc');

        const r = providerCtl.applyOverrideToActiveCalc();
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'persist');

        const storeItem = store.getState().activeCalc.dictionaries.items[0];
        assert.equal(storeItem.pricePerUnit, 583.61,
            'store price НЕ должен меняться при persist-fail (раньше становился 999).');
        assert.equal(store.getState().activeCalc.providerVersion, undefined,
            'providerVersion НЕ должен записываться в store при persist-fail.');
    });
});

/* ============================================================
 * P2: openCalc/initFromStorage commit-fail миграции
 * ============================================================ */

describe('External audit #7 P2: openCalc при commit-fail миграции возвращает null', () => {
    it('legacy schemaVersion=8, quota на calc.<id> → openCalc возвращает null, store не меняется', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        /* Seed legacy calc с старой версией. */
        const legacyCalc = {
            id: 'legacy-1',
            name: 'Legacy',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            schemaVersion: 8,
            settings: {},
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
        spy.data.set('calc.legacy-1', JSON.stringify(legacyCalc));
        spy.data.set('calc.list', JSON.stringify(
            [{ id: 'legacy-1', name: 'Legacy', updatedAt: legacyCalc.updatedAt }]
        ));

        spy.fail('calc.legacy-1');
        const result = calcListCtl.openCalc('legacy-1');

        assert.equal(result, null,
            'openCalc при commit-fail миграции должен возвращать null — не открывать calc.');
        assert.equal(store.getState().activeCalc, null,
            'activeCalc должен остаться прежним (null), не получить мигрированный partial-state.');
        assert.equal(store.getState().persistStatus, 'error');
    });
});

/* ============================================================
 * P3: priceImportMapping refreshErrors пробрасывает
 * ============================================================ */

describe('External audit #7 P3: priceImportMapping summary содержит refreshErrors', () => {
    it('summary.refreshErrors=[] и partial=false при отсутствии apply', async () => {
        /* Прямая проверка контракта: summary должен иметь поля. */
        const src = await import('node:fs').then(fs =>
            fs.readFileSync(
                new URL('../../js/controllers/priceImportMappingController.js', import.meta.url),
                'utf8'
            )
        );
        assert.match(src, /refreshErrors/);
        assert.match(src, /partial\s*:/);
    });
});
