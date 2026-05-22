/**
 * Integration: метки источника цены (priceSource + priceUpdatedAt)
 * проставляются автоматически при ручном сохранении ЭК и при CSV-импорте.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const { store } = await import('../../js/state/store.js');
const calcList = await import('../../js/controllers/calcListController.js');
const itemCtl = await import('../../js/controllers/itemController.js');
const { diffPricesFromCsv } = await import('../../js/services/csvImport.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
});

describe('Метки источника цены: ручное сохранение (saveItem)', () => {
    it('новый ЭК с ценой > 0 → priceSource=manual, priceUpdatedAt задан', () => {
        calcList.createCalc('test');
        const before = Date.now();
        const r = itemCtl.saveItem({
            id: 'manual-item-1', name: 'Manual', unit: 'шт.', pricePerUnit: 5000,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1', LOAD: '' }
        });
        assert.equal(r.ok, true);
        const it = store.getState().activeCalc.dictionaries.items.find(i => i.id === 'manual-item-1');
        assert.equal(it.priceSource, 'manual');
        assert.ok(it.priceUpdatedAt);
        assert.ok(Date.parse(it.priceUpdatedAt) >= before);
    });

    it('правка цены существующего ЭК → priceSource=manual, новая дата', () => {
        calcList.createCalc('test');
        const items = store.getState().activeCalc.dictionaries.items;
        const sample = items[0];
        const oldPrice = sample.pricePerUnit;
        const newPrice = oldPrice + 999;
        const before = Date.now();
        const r = itemCtl.saveItem({ ...sample, pricePerUnit: newPrice });
        assert.equal(r.ok, true);
        const updated = store.getState().activeCalc.dictionaries.items.find(i => i.id === sample.id);
        assert.equal(updated.pricePerUnit, newPrice);
        assert.equal(updated.priceSource, 'manual');
        assert.ok(Date.parse(updated.priceUpdatedAt) >= before);
    });

    it('правка ТОЛЬКО названия (цена та же) → метку источника не трогаем', () => {
        calcList.createCalc('test');
        const items = store.getState().activeCalc.dictionaries.items;
        const sample = items[0];
        const originalSource = sample.priceSource;        // обычно 'seed' или undefined
        const originalUpdatedAt = sample.priceUpdatedAt;  // обычно undefined для seed
        const r = itemCtl.saveItem({ ...sample, name: sample.name + ' (renamed)' });
        assert.equal(r.ok, true);
        const updated = store.getState().activeCalc.dictionaries.items.find(i => i.id === sample.id);
        assert.equal(updated.priceSource, originalSource);
        assert.equal(updated.priceUpdatedAt, originalUpdatedAt);
    });

    it('новый ЭК с pricePerUnit = 0 → метку не ставим (нет фактической цены)', () => {
        calcList.createCalc('test');
        itemCtl.saveItem({
            id: 'zero-price', name: 'Zero', unit: 'шт.', pricePerUnit: 0,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1', LOAD: '' }
        });
        const it = store.getState().activeCalc.dictionaries.items.find(i => i.id === 'zero-price');
        assert.equal(it.priceSource, undefined);
        assert.equal(it.priceUpdatedAt, undefined);
    });
});

describe('Метки источника цены: CSV-импорт (apply diff)', () => {
    it('обновление через CSV → priceSource=csv, новая дата', () => {
        calcList.createCalc('test');
        const items = store.getState().activeCalc.dictionaries.items;
        const sample = items[0];
        const oldPrice = sample.pricePerUnit;
        const newPrice = oldPrice + 777;

        // Симулируем то, что делает importItemPrices после diff'а:
        const diff = diffPricesFromCsv([{ id: sample.id, pricePerUnit: String(newPrice) }], items);
        assert.equal(diff.safeUpdates.length, 1);

        // Применяем как контроллер
        const before = Date.now();
        const now = new Date().toISOString();
        const byId = new Map(diff.safeUpdates.map(u => [u.id, u.newPrice]));
        const newItems = items.map(it => byId.has(it.id)
            ? { ...it, pricePerUnit: byId.get(it.id), priceUpdatedAt: now, priceSource: 'csv' }
            : it);
        store.updateActiveCalc({ dictionaries: { ...store.getState().activeCalc.dictionaries, items: newItems } });

        const updated = store.getState().activeCalc.dictionaries.items.find(i => i.id === sample.id);
        assert.equal(updated.priceSource, 'csv');
        assert.equal(updated.pricePerUnit, newPrice);
        assert.ok(Date.parse(updated.priceUpdatedAt) >= before);
    });
});
