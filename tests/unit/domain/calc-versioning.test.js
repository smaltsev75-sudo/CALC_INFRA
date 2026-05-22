/**
 * Stage 8.3: pure domain helpers для версионирования calc'ов относительно
 * текущего provider price override.
 *
 * - `isCalcStale(calc, latestVersion)` — проверяет, отличается ли версия
 *   применённого override (`calc.providerVersion?.version`) от latest.
 * - `computePriceDeltas(oldItems, newItems)` — массив диффов
 *   { id, oldPrice, newPrice, delta, deltaPct } для item'ов с изменённой ценой.
 * - `applyOverrideToItems(items, effectivePrices)` — возвращает новый массив
 *   items с применёнными effective prices (для swap'а calc.dictionaries.items).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    isCalcStale,
    computePriceDeltas,
    applyOverrideToItems,
    makeProviderVersionFromOverride,
    summarizeDeltas,
    topDeltasByAbsPct
} from '../../../js/domain/calcVersioning.js';

const ITEMS_OLD = Object.freeze([
    Object.freeze({ id: 'cpu-vcpu-shared', pricePerUnit: 840 }),
    Object.freeze({ id: 'ram-gb',          pricePerUnit: 226 }),
    Object.freeze({ id: 'storage-ssd-tb',  pricePerUnit: 12378 })
]);

const EFFECTIVE_NEW = Object.freeze({
    'cpu-vcpu-shared': { pricePerUnit: 999, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q3' },
    'ram-gb':          { pricePerUnit: 226, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q2' }, // не изменилось
    'storage-ssd-tb':  { pricePerUnit: 13616, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q3' }
});

const OVERRIDE_SAMPLE = Object.freeze({
    schemaVersion: 1,
    providerId: 'sbercloud',
    version: '2026-Q3-test',
    timestamp: '2026-05-09T12:00:00.000Z',
    source: 'test',
    prices: { 'cpu-vcpu-shared': { pricePerUnit: 999, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q3' } }
});

describe('Stage 8.3 isCalcStale', () => {
    it('null latestVersion → fresh (нет override = нечего пересчитывать)', () => {
        assert.equal(isCalcStale({ providerVersion: null }, null), false);
        assert.equal(isCalcStale({ providerVersion: { version: '2026-Q1' } }, null), false);
    });

    it('calc БЕЗ providerVersion + latest есть → stale', () => {
        assert.equal(isCalcStale({}, '2026-Q3'), true);
        assert.equal(isCalcStale({ providerVersion: null }, '2026-Q3'), true);
    });

    it('версии совпадают → fresh', () => {
        const calc = { providerVersion: { version: '2026-Q3', id: 'sbercloud', timestamp: 't' } };
        assert.equal(isCalcStale(calc, '2026-Q3'), false);
    });

    it('версии различаются → stale', () => {
        const calc = { providerVersion: { version: '2026-Q1', id: 'sbercloud', timestamp: 't' } };
        assert.equal(isCalcStale(calc, '2026-Q3'), true);
    });
});

describe('Stage 8.3 computePriceDeltas', () => {
    it('возвращает массив дельт только для изменённых ЭК', () => {
        const newItems = applyOverrideToItems(ITEMS_OLD, EFFECTIVE_NEW);
        const deltas = computePriceDeltas(ITEMS_OLD, newItems);
        // ram-gb не изменился (226 → 226) — не должен попасть в deltas
        const ids = deltas.map(d => d.id).sort();
        assert.deepEqual(ids, ['cpu-vcpu-shared', 'storage-ssd-tb']);
    });

    it('каждая дельта содержит { id, oldPrice, newPrice, delta, deltaPct }', () => {
        const newItems = applyOverrideToItems(ITEMS_OLD, EFFECTIVE_NEW);
        const deltas = computePriceDeltas(ITEMS_OLD, newItems);
        const cpu = deltas.find(d => d.id === 'cpu-vcpu-shared');
        assert.equal(cpu.oldPrice, 840);
        assert.equal(cpu.newPrice, 999);
        assert.equal(cpu.delta, 159);
        assert.ok(Math.abs(cpu.deltaPct - (159 / 840 * 100)) < 0.01);
    });

    it('пустой массив при отсутствии изменений', () => {
        const deltas = computePriceDeltas(ITEMS_OLD, ITEMS_OLD);
        assert.deepEqual(deltas, []);
    });

    it('игнорирует item.id без соответствия в новом массиве', () => {
        const newItems = [{ id: 'cpu-vcpu-shared', pricePerUnit: 999 }];
        const deltas = computePriceDeltas(ITEMS_OLD, newItems);
        // Только один item совпал, остальные потеряны → они не считаются deltas (потеря, не дельта)
        assert.equal(deltas.length, 1);
        assert.equal(deltas[0].id, 'cpu-vcpu-shared');
    });
});

describe('Stage 8.3 applyOverrideToItems', () => {
    it('заменяет pricePerUnit/vendor, priceSource нормализуется в "provider" с сохранением ref (аудит #3)', () => {
        const newItems = applyOverrideToItems(ITEMS_OLD, EFFECTIVE_NEW);
        const cpu = newItems.find(i => i.id === 'cpu-vcpu-shared');
        assert.equal(cpu.pricePerUnit, 999);
        assert.equal(cpu.vendor, 'SberCloud');
        /* Внешний аудит #3 (2026-05-18, P1): сырой priceSource из overlay
         * («cloud.ru/2026-Q3») не проходит whitelist валидатора item'а
         * [manual|csv|seed|provider]. applyOverrideToItems теперь нормализует
         * priceSource→'provider', а оригинал кладёт в priceSourceRef для UI. */
        assert.equal(cpu.priceSource, 'provider');
        assert.equal(cpu.priceSourceRef, 'cloud.ru/2026-Q3');
    });

    it('item без записи в effectivePrices остаётся без изменений', () => {
        const partial = { 'cpu-vcpu-shared': { pricePerUnit: 999, vendor: 'X', priceSource: 'Y' } };
        const newItems = applyOverrideToItems(ITEMS_OLD, partial);
        const ram = newItems.find(i => i.id === 'ram-gb');
        assert.equal(ram.pricePerUnit, 226);  // оригинальная цена
    });

    it('пустой effectivePrices возвращает копию items', () => {
        const newItems = applyOverrideToItems(ITEMS_OLD, {});
        assert.deepEqual(newItems, ITEMS_OLD);
    });

    it('возвращает новые объекты (не мутирует оригинал)', () => {
        const newItems = applyOverrideToItems(ITEMS_OLD, EFFECTIVE_NEW);
        const cpu = newItems.find(i => i.id === 'cpu-vcpu-shared');
        const cpuOrig = ITEMS_OLD.find(i => i.id === 'cpu-vcpu-shared');
        assert.notEqual(cpu, cpuOrig);
        assert.equal(cpuOrig.pricePerUnit, 840);  // оригинал не тронут
    });
});

describe('Stage 8.3 makeProviderVersionFromOverride', () => {
    it('возвращает { id, version, timestamp } из override JSON', () => {
        const v = makeProviderVersionFromOverride(OVERRIDE_SAMPLE);
        assert.deepEqual(v, {
            id: 'sbercloud',
            version: '2026-Q3-test',
            timestamp: '2026-05-09T12:00:00.000Z'
        });
    });

    it('null/undefined → null', () => {
        assert.equal(makeProviderVersionFromOverride(null), null);
        assert.equal(makeProviderVersionFromOverride(undefined), null);
    });
});

describe('Stage 8.5 summarizeDeltas', () => {
    it('пустой массив → нулевая статистика', () => {
        const s = summarizeDeltas([]);
        assert.deepEqual(s, { total: 0, ups: 0, downs: 0, maxUpPct: 0, maxDownPct: 0, avgPct: 0 });
    });

    it('mixed ups/downs: считает обе стороны', () => {
        const s = summarizeDeltas([
            { id: 'a', oldPrice: 100, newPrice: 120, delta: 20, deltaPct: 20 },
            { id: 'b', oldPrice: 200, newPrice: 180, delta: -20, deltaPct: -10 },
            { id: 'c', oldPrice: 100, newPrice: 110, delta: 10, deltaPct: 10 }
        ]);
        assert.equal(s.total, 3);
        assert.equal(s.ups, 2);
        assert.equal(s.downs, 1);
        assert.equal(s.maxUpPct, 20);
        assert.equal(s.maxDownPct, -10);
        assert.ok(Math.abs(s.avgPct - (20 - 10 + 10) / 3) < 0.01);
    });

    it('все ups → maxDownPct=0', () => {
        const s = summarizeDeltas([
            { id: 'a', oldPrice: 100, newPrice: 110, delta: 10, deltaPct: 10 }
        ]);
        assert.equal(s.ups, 1);
        assert.equal(s.downs, 0);
        assert.equal(s.maxDownPct, 0);
    });
});

describe('Stage 8.5 topDeltasByAbsPct', () => {
    it('сортирует по |deltaPct| desc', () => {
        const deltas = [
            { id: 'a', deltaPct: 5 },
            { id: 'b', deltaPct: -50 },
            { id: 'c', deltaPct: 30 },
            { id: 'd', deltaPct: -15 }
        ];
        const top = topDeltasByAbsPct(deltas, 3);
        assert.deepEqual(top.map(d => d.id), ['b', 'c', 'd']);
    });

    it('n больше длины → возвращает все элементы', () => {
        const deltas = [{ id: 'a', deltaPct: 1 }];
        assert.equal(topDeltasByAbsPct(deltas, 10).length, 1);
    });

    it('пустой → []', () => {
        assert.deepEqual(topDeltasByAbsPct([], 3), []);
    });
});
