/**
 * Stage 10.4: aggregateProviderPrices(providerIds) — pure helper, который
 * собирает per-provider × per-category матрицу для cross-provider analytics.
 *
 * Для каждого провайдера из списка возвращает effective prices (frozen ∪ override),
 * группирует по 4 категориям (CPU, RAM, STORAGE, NETWORK) и возвращает
 * representative-price (key-item) + frozen-baseline для дельты.
 *
 * Контракт ответа:
 *   {
 *     providers: Array<{
 *       id, label, active,
 *       byCategory: { CPU: { effective, frozen, deltaPct }, RAM: ..., STORAGE: ..., NETWORK: ... },
 *       totalCost: number  // sum of representative prices (для default-сортировки)
 *     }>,
 *     categories: ['CPU', 'RAM', 'STORAGE', 'NETWORK']
 *   }
 *
 * Inactive провайдеры пропускаются (не входят в `.providers`).
 * Если для провайдера нет цены конкретного key-item'а → effective=null, deltaPct=null.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let aggregateProviderPrices;

before(async () => {
    installLocalStorage();
    ({ aggregateProviderPrices } = await import('../../../js/domain/providerAnalytics.js'));
});

describe('Stage 10.4 aggregateProviderPrices — базовый API', () => {
    it('экспортируется как функция', () => {
        assert.equal(typeof aggregateProviderPrices, 'function');
    });

    it('пустой массив → providers=[]', () => {
        const r = aggregateProviderPrices([]);
        assert.deepEqual(r.providers, []);
        /* Stage 14.1 (PATCH 2.7.1): добавлена 5-я категория LICENSE. */
        assert.deepEqual(r.categories, ['CPU', 'RAM', 'STORAGE', 'NETWORK', 'LICENSE']);
    });

    it('non-array → providers=[]', () => {
        const r = aggregateProviderPrices(null);
        assert.deepEqual(r.providers, []);
    });

    it('3 active providers (sbercloud/yandex/vk) → providers.length=3', () => {
        const r = aggregateProviderPrices(['sbercloud', 'yandex', 'vk']);
        assert.equal(r.providers.length, 3);
        assert.equal(r.providers[0].id, 'sbercloud');
        assert.equal(r.providers[1].id, 'yandex');
        assert.equal(r.providers[2].id, 'vk');
    });

    it('inactive провайдер (onprem) пропускается', () => {
        const r = aggregateProviderPrices(['sbercloud', 'onprem']);
        assert.equal(r.providers.length, 1);
        assert.equal(r.providers[0].id, 'sbercloud');
    });

    it('неизвестный providerId пропускается без throw', () => {
        const r = aggregateProviderPrices(['sbercloud', 'nonexistent']);
        assert.equal(r.providers.length, 1);
    });
});

describe('Stage 10.4 aggregateProviderPrices — структура данных', () => {
    it('каждый provider имеет id, label, active, byCategory, totalCost', () => {
        const r = aggregateProviderPrices(['sbercloud']);
        const p = r.providers[0];
        assert.equal(typeof p.id, 'string');
        assert.equal(typeof p.label, 'string');
        assert.equal(typeof p.active, 'boolean');
        assert.equal(typeof p.byCategory, 'object');
        assert.ok(Number.isFinite(p.totalCost));
    });

    it('byCategory содержит все 5 категорий (Stage 14.1: + LICENSE)', () => {
        const r = aggregateProviderPrices(['sbercloud']);
        const cats = Object.keys(r.providers[0].byCategory);
        assert.deepEqual(cats.sort(), ['CPU', 'LICENSE', 'NETWORK', 'RAM', 'STORAGE']);
    });

    it('каждая категория имеет effective, frozen, deltaPct', () => {
        const r = aggregateProviderPrices(['sbercloud']);
        const cpu = r.providers[0].byCategory.CPU;
        assert.ok('effective' in cpu);
        assert.ok('frozen' in cpu);
        assert.ok('deltaPct' in cpu);
    });

    it('CPU effective > 0 для sbercloud (есть в frozen overlay)', () => {
        const r = aggregateProviderPrices(['sbercloud']);
        assert.ok(r.providers[0].byCategory.CPU.effective > 0);
    });

    it('totalCost = sum of effective значений всех 5 категорий (Stage 14.1: + LICENSE)', () => {
        const r = aggregateProviderPrices(['sbercloud']);
        const p = r.providers[0];
        const sum = (p.byCategory.CPU.effective || 0)
            + (p.byCategory.RAM.effective || 0)
            + (p.byCategory.STORAGE.effective || 0)
            + (p.byCategory.NETWORK.effective || 0)
            + (p.byCategory.LICENSE.effective || 0);
        assert.equal(p.totalCost, sum);
    });
});

describe('Stage 10.4 aggregateProviderPrices — deltaPct', () => {
    it('без override → deltaPct=null или 0 (effective === frozen)', () => {
        const r = aggregateProviderPrices(['yandex']);
        const cpu = r.providers[0].byCategory.CPU;
        /* В свежем localStorage override отсутствует — effective === frozen. */
        if (cpu.effective !== null && cpu.frozen !== null) {
            assert.equal(cpu.effective, cpu.frozen);
            assert.ok(cpu.deltaPct === 0 || cpu.deltaPct === null);
        }
    });
});

describe('Stage 10.4 aggregateProviderPrices — категории-индекс', () => {
    it('exposed: CATEGORY_KEY_ITEMS из providerAnalytics.js', async () => {
        const m = await import('../../../js/domain/providerAnalytics.js');
        assert.equal(typeof m.CATEGORY_KEY_ITEMS, 'object');
        assert.equal(m.CATEGORY_KEY_ITEMS.CPU, 'cpu-vcpu-shared');
        assert.equal(m.CATEGORY_KEY_ITEMS.RAM, 'ram-gb');
    });
});
