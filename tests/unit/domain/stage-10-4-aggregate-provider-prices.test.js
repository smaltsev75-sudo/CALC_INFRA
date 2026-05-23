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
let buildProviderBenchmarkItems;

before(async () => {
    installLocalStorage();
    ({ aggregateProviderPrices, buildProviderBenchmarkItems } = await import('../../../js/domain/providerAnalytics.js'));
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

describe('Stage 10.4 → calc-specific top-6 ЭК', () => {
    it('buildProviderBenchmarkItems выбирает ЭК по месячному вкладу и сохраняет HDD как колонку', () => {
        const calc = {
            dictionaries: {
                items: [
                    { id: 'cpu-vcpu-shared', name: 'vCPU (общий пул)', unit: 'шт.', billingInterval: 'monthly', pricePerUnit: 100, category: 'HW', dashboardResource: 'CPU' },
                    { id: 'ram-gb', name: 'Оперативная память (GB)', unit: 'ГБ', billingInterval: 'monthly', pricePerUnit: 10, category: 'HW', dashboardResource: 'RAM' },
                    { id: 'storage-hdd-tb', name: 'Хранилище HDD (холодное)', unit: 'ТБ', billingInterval: 'monthly', pricePerUnit: 100, category: 'HW', dashboardResource: 'HDD' }
                ]
            }
        };
        const result = {
            totalMonthly: 3_600,
            items: {
                'cpu-vcpu-shared': { totalMonthly: 100 },
                'ram-gb': { totalMonthly: 500 },
                'storage-hdd-tb': { totalMonthly: 3_000 }
            }
        };

        const top = buildProviderBenchmarkItems(calc, result, { limit: 2 });
        assert.deepEqual(top.map(i => i.itemId), ['storage-hdd-tb', 'ram-gb']);
        assert.equal(top[0].label, 'HDD');
        assert.equal(top[0].unit, '₽/ТБ/мес');
    });

    it('aggregateProviderPrices считает totalCost как месячный вклад top-ЭК на текущих объёмах', () => {
        const benchmarkItems = [
            {
                key: 'storage-hdd-tb',
                itemId: 'storage-hdd-tb',
                label: 'HDD',
                unit: '₽/ТБ/мес',
                description: 'Хранилище HDD',
                monthlyCost: 3_000,
                monthlyUsageFactor: 30
            },
            {
                key: 'ram-gb',
                itemId: 'ram-gb',
                label: 'RAM',
                unit: '₽/ГБ/мес',
                description: 'Оперативная память',
                monthlyCost: 500,
                monthlyUsageFactor: 50
            }
        ];

        const r = aggregateProviderPrices(['yandex'], {
            yandex: {
                'storage-hdd-tb': { pricePerUnit: 200, vendor: 'test', priceSource: 'test' },
                'ram-gb': { pricePerUnit: 12, vendor: 'test', priceSource: 'test' }
            }
        }, benchmarkItems);

        assert.deepEqual(r.categories, ['storage-hdd-tb', 'ram-gb']);
        assert.equal(r.categoryMeta['storage-hdd-tb'].label, 'HDD');
        assert.equal(r.providers[0].byCategory['storage-hdd-tb'].monthlyImpact, 6_000);
        assert.equal(r.providers[0].byCategory['ram-gb'].monthlyImpact, 600);
        assert.equal(r.providers[0].totalCost, 6_600);
    });
});
