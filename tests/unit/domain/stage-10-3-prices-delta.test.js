/**
 * Stage 10.3: computePricesDelta — pure helper, считает разницу между двумя
 * snapshot'ами prices (как в override JSON). Используется в DeltaHistoryPanel
 * для показа «было → стало» каждой исторической точки.
 *
 * API:
 *   computePricesDelta(oldPrices, newPrices) → {
 *     itemsChanged: number,        // сколько ЭК изменили цену
 *     itemsAdded:   number,        // сколько ЭК появилось в new (не было в old)
 *     itemsRemoved: number,        // сколько ЭК ушло из old (нет в new)
 *     deltas: Array<{id, oldPrice, newPrice, deltaPct, direction: 'up'|'down'|'same'}>,
 *     topUp:   Array<{id, deltaPct}>,  // top-3 наибольший рост
 *     topDown: Array<{id, deltaPct}>   // top-3 наибольшее снижение
 *   }
 *
 * Вход: prices map { id: { pricePerUnit, ... } } из applied JSON.
 * Невалидный вход (null/undefined) → пустой результат.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computePricesDelta } from '../../../js/domain/calcVersioning.js';

const oldPrices = Object.freeze({
    'cpu-vcpu-shared': { pricePerUnit: 800 },
    'ram-gb': { pricePerUnit: 200 },
    'storage-ssd-tb': { pricePerUnit: 12000 }
});

describe('Stage 10.3 computePricesDelta — базовая функциональность', () => {
    it('экспортируется как функция', () => {
        assert.equal(typeof computePricesDelta, 'function');
    });

    it('одинаковые prices → itemsChanged=0, deltas=[]', () => {
        const r = computePricesDelta(oldPrices, oldPrices);
        assert.equal(r.itemsChanged, 0);
        assert.equal(r.itemsAdded, 0);
        assert.equal(r.itemsRemoved, 0);
        assert.deepEqual(r.deltas, []);
        assert.deepEqual(r.topUp, []);
        assert.deepEqual(r.topDown, []);
    });

    it('+10% на одной позиции', () => {
        const newPrices = { ...oldPrices, 'cpu-vcpu-shared': { pricePerUnit: 880 } };
        const r = computePricesDelta(oldPrices, newPrices);
        assert.equal(r.itemsChanged, 1);
        assert.equal(r.deltas.length, 1);
        assert.equal(r.deltas[0].id, 'cpu-vcpu-shared');
        assert.equal(r.deltas[0].oldPrice, 800);
        assert.equal(r.deltas[0].newPrice, 880);
        assert.equal(Math.round(r.deltas[0].deltaPct), 10);
        assert.equal(r.deltas[0].direction, 'up');
    });

    it('−25% на одной позиции', () => {
        const newPrices = { ...oldPrices, 'ram-gb': { pricePerUnit: 150 } };
        const r = computePricesDelta(oldPrices, newPrices);
        assert.equal(r.itemsChanged, 1);
        assert.equal(r.deltas[0].direction, 'down');
        assert.equal(Math.round(r.deltas[0].deltaPct), -25);
    });

    it('добавление новой позиции (нет в old)', () => {
        const newPrices = { ...oldPrices, 'service-email-per-1k': { pricePerUnit: 50 } };
        const r = computePricesDelta(oldPrices, newPrices);
        assert.equal(r.itemsAdded, 1);
        assert.equal(r.itemsChanged, 0, 'добавление != change');
    });

    it('удаление позиции (нет в new)', () => {
        const { 'storage-ssd-tb': _, ...newPrices } = oldPrices;
        const r = computePricesDelta(oldPrices, newPrices);
        assert.equal(r.itemsRemoved, 1);
        assert.equal(r.itemsChanged, 0);
    });

    it('mixed: 2 changed + 1 added + 1 removed', () => {
        const newPrices = {
            'cpu-vcpu-shared': { pricePerUnit: 880 },     // +10% changed
            'ram-gb': { pricePerUnit: 150 },               // −25% changed
            // storage-ssd-tb removed
            'service-email-per-1k': { pricePerUnit: 50 }   // added
        };
        const r = computePricesDelta(oldPrices, newPrices);
        assert.equal(r.itemsChanged, 2);
        assert.equal(r.itemsAdded, 1);
        assert.equal(r.itemsRemoved, 1);
    });
});

describe('Stage 10.3 computePricesDelta — topUp / topDown', () => {
    it('topUp сортирован по убыванию deltaPct', () => {
        const newPrices = {
            'cpu-vcpu-shared': { pricePerUnit: 1600 }, // +100%
            'ram-gb': { pricePerUnit: 250 },            // +25%
            'storage-ssd-tb': { pricePerUnit: 18000 }   // +50%
        };
        const r = computePricesDelta(oldPrices, newPrices);
        assert.equal(r.topUp.length, 3);
        assert.equal(r.topUp[0].id, 'cpu-vcpu-shared'); // +100%
        assert.equal(r.topUp[1].id, 'storage-ssd-tb');  // +50%
        assert.equal(r.topUp[2].id, 'ram-gb');          // +25%
    });

    it('topDown сортирован по возрастанию (наибольшее по модулю снижение первым)', () => {
        const newPrices = {
            'cpu-vcpu-shared': { pricePerUnit: 400 },  // −50%
            'ram-gb': { pricePerUnit: 180 },            // −10%
            'storage-ssd-tb': { pricePerUnit: 9000 }    // −25%
        };
        const r = computePricesDelta(oldPrices, newPrices);
        assert.equal(r.topDown.length, 3);
        assert.equal(r.topDown[0].id, 'cpu-vcpu-shared'); // -50%
        assert.equal(r.topDown[1].id, 'storage-ssd-tb');  // -25%
        assert.equal(r.topDown[2].id, 'ram-gb');          // -10%
    });

    it('topUp / topDown ограничены по 3 элемента', () => {
        const oldP = {};
        const newP = {};
        for (let i = 0; i < 10; i++) {
            oldP['item-' + i] = { pricePerUnit: 100 };
            newP['item-' + i] = { pricePerUnit: 100 + (i + 1) * 10 };
        }
        const r = computePricesDelta(oldP, newP);
        assert.equal(r.topUp.length, 3);
        assert.equal(r.itemsChanged, 10);
    });

    it('only ups → topDown=[]', () => {
        const newPrices = { ...oldPrices, 'cpu-vcpu-shared': { pricePerUnit: 1000 } };
        const r = computePricesDelta(oldPrices, newPrices);
        assert.equal(r.topUp.length, 1);
        assert.equal(r.topDown.length, 0);
    });
});

describe('Stage 10.3 computePricesDelta — невалидные / edge', () => {
    it('null oldPrices → пустой результат', () => {
        const r = computePricesDelta(null, oldPrices);
        assert.equal(r.itemsAdded, 3);
        assert.equal(r.itemsChanged, 0);
        assert.equal(r.itemsRemoved, 0);
    });

    it('null newPrices → пустой результат', () => {
        const r = computePricesDelta(oldPrices, null);
        assert.equal(r.itemsRemoved, 3);
    });

    it('обе null → всё нули', () => {
        const r = computePricesDelta(null, null);
        assert.equal(r.itemsChanged, 0);
        assert.equal(r.itemsAdded, 0);
        assert.equal(r.itemsRemoved, 0);
    });

    it('oldPrice=0 → не делит на ноль (deltaPct=0 или skip)', () => {
        const o = { 'x': { pricePerUnit: 0 } };
        const n = { 'x': { pricePerUnit: 100 } };
        const r = computePricesDelta(o, n);
        /* Защита: deltaPct=0, либо отсутствует — главное чтобы не было Infinity. */
        assert.ok(r.deltas.every(d => Number.isFinite(d.deltaPct)));
    });

    it('threshold 0.1% — не считаем за change', () => {
        const o = { 'x': { pricePerUnit: 1000 } };
        const n = { 'x': { pricePerUnit: 1000.5 } }; // 0.05% → noise
        const r = computePricesDelta(o, n);
        assert.equal(r.itemsChanged, 0,
            'изменения <0.1% игнорим как float-шум');
    });
});
