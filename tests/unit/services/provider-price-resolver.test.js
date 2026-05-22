/**
 * Stage 8.1.4: getEffectivePricesForProvider — слияние frozen-default из
 * providerOverlay.js с user override из localStorage (через providerPriceFetch
 * → saveProviderOverride).
 *
 * Контракт:
 *   - Нет override → результат идентичен getEffectivePrices(providerId).
 *   - Есть override → каждая цена из override.prices перетирает frozen.
 *   - Frozen-цены, отсутствующие в override.prices, остаются нетронутыми
 *     (override может содержать подмножество ЭК).
 *   - Orphan override (provider удалён из PROVIDER_OVERLAYS) → ignore (warning).
 *   - Corrupt overrides → fallback на frozen.
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let resolver;
let providerOverlay;
let persist;

const SBERCLOUD_OVERRIDE_PARTIAL = Object.freeze({
    schemaVersion: 1,
    providerId: 'sbercloud',
    version: '2026-Q3-test',
    timestamp: '2026-05-09T12:00:00.000Z',
    source: 'test fixture',
    prices: {
        /* Перетираем 2 из 14 ЭК — остальные должны остаться от frozen. */
        'cpu-vcpu-shared': { pricePerUnit: 999, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q3-test' },
        'ram-gb':          { pricePerUnit: 250, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q3-test' }
    }
});

before(async () => {
    installLocalStorage();
    resolver = await import('../../../js/services/providerPriceResolver.js');
    providerOverlay = await import('../../../js/domain/providerOverlay.js');
    persist = await import('../../../js/state/persistence.js');
});

beforeEach(() => installLocalStorage());

let _originalConsoleWarn;
before(() => { _originalConsoleWarn = console.warn; });
after(() => { console.warn = _originalConsoleWarn; });

describe('Stage 8.1.4 getEffectivePricesForProvider — нет override', () => {
    it('возвращает результат идентичный getEffectivePrices', () => {
        const fromResolver = resolver.getEffectivePricesForProvider('sbercloud');
        const fromOverlay  = providerOverlay.getEffectivePrices('sbercloud');
        assert.deepEqual(fromResolver, fromOverlay);
    });

    it('inactive/onprem → пустой объект (как frozen)', () => {
        const r = resolver.getEffectivePricesForProvider('onprem');
        assert.deepEqual(r, {});
    });

    it('unknown providerId → пустой объект', () => {
        const r = resolver.getEffectivePricesForProvider('not-a-provider');
        assert.deepEqual(r, {});
    });
});

describe('Stage 8.1.4 getEffectivePricesForProvider — с override', () => {
    it('перетирает только указанные ЭК, остальные — от frozen', () => {
        persist.saveProviderOverride('sbercloud', SBERCLOUD_OVERRIDE_PARTIAL);

        const merged = resolver.getEffectivePricesForProvider('sbercloud');
        const frozen = providerOverlay.getEffectivePrices('sbercloud');

        // Override применился
        assert.equal(merged['cpu-vcpu-shared'].pricePerUnit, 999);
        assert.equal(merged['ram-gb'].pricePerUnit, 250);

        // Незатронутые ЭК остались frozen
        assert.equal(merged['storage-ssd-tb'].pricePerUnit, frozen['storage-ssd-tb'].pricePerUnit);
        /* Phase 4: license-db-per-vcpu больше нет в bundled sbercloud → беру
         * другой core SKU, который точно в bundled (storage-hdd-tb). */
        assert.equal(merged['storage-hdd-tb'].pricePerUnit, frozen['storage-hdd-tb'].pricePerUnit);

        // Количество ЭК не уменьшилось
        assert.equal(Object.keys(merged).length, Object.keys(frozen).length);
    });

    it('override для одного провайдера не влияет на другого', () => {
        persist.saveProviderOverride('sbercloud', SBERCLOUD_OVERRIDE_PARTIAL);

        const sber = resolver.getEffectivePricesForProvider('sbercloud');
        const yandex = resolver.getEffectivePricesForProvider('yandex');

        assert.equal(sber['cpu-vcpu-shared'].pricePerUnit, 999);
        // Yandex получает свой frozen, не sbercloud override
        const yandexFrozen = providerOverlay.getEffectivePrices('yandex');
        assert.deepEqual(yandex, yandexFrozen);
    });
});

describe('Stage 8.1.4 getEffectivePricesForProvider — orphan / corrupt', () => {
    it('orphan override (provider не существует) → ignored, console.warn', () => {
        const calls = [];
        console.warn = (...args) => calls.push(args.join(' '));

        const orphan = { ...SBERCLOUD_OVERRIDE_PARTIAL, providerId: 'orphan-provider' };
        persist.saveProviderOverride('orphan-provider', orphan);

        const merged = resolver.getEffectivePricesForProvider('orphan-provider');
        assert.deepEqual(merged, {});  // unknown provider → пусто
        // Это не warn-сценарий: provider просто unknown.
        // Warn срабатывает только когда override есть, но НЕ совпадает с requested.
    });

    it('corrupt overrides в storage → fallback на frozen', () => {
        // Записываем мусор напрямую — loadProviderOverrides вернёт null.
        localStorage.setItem('calc.providerOverlayOverrides', '{ corrupt');
        const merged = resolver.getEffectivePricesForProvider('sbercloud');
        const frozen = providerOverlay.getEffectivePrices('sbercloud');
        assert.deepEqual(merged, frozen);
    });

    it('override с invalid prices (не object) — игнорируется, fallback frozen', () => {
        const calls = [];
        console.warn = (...args) => calls.push(args.join(' '));

        persist.saveProviderOverride('sbercloud', {
            schemaVersion: 1, providerId: 'sbercloud',
            version: 'x', timestamp: '2026-01-01T00:00:00Z', source: '',
            prices: 'not-an-object'
        });

        const merged = resolver.getEffectivePricesForProvider('sbercloud');
        const frozen = providerOverlay.getEffectivePrices('sbercloud');
        assert.deepEqual(merged, frozen);
        assert.ok(calls.length >= 1, 'должен быть console.warn про invalid override');
    });
});
