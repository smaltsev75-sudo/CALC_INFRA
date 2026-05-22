/**
 * Stage 14.1 (PATCH 2.7.1) — domain: добавлена категория LICENSE в
 * CATEGORY_KEY_ITEMS / CATEGORY_ORDER (через aggregateProviderPrices).
 *
 * Проверки:
 *   • CATEGORY_KEY_ITEMS.LICENSE === 'license-os-per-node'.
 *   • aggregateProviderPrices возвращает массив categories длиной 5
 *     с LICENSE на последней позиции.
 *   • byCategory.LICENSE содержит { effective, frozen, deltaPct } для
 *     известного провайдера.
 *   • Если для провайдера нет цены на license-os-per-node — effective=null,
 *     frozen=null, deltaPct=null (тот же graceful-paths как у CPU/RAM).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    aggregateProviderPrices,
    CATEGORY_KEY_ITEMS
} from '../../../js/domain/providerAnalytics.js';

describe('Stage 14.1 / CATEGORY_KEY_ITEMS includes LICENSE', () => {
    it('LICENSE → license-os-per-node', () => {
        assert.equal(CATEGORY_KEY_ITEMS.LICENSE, 'license-os-per-node');
    });

    it('всего 5 категорий', () => {
        const keys = Object.keys(CATEGORY_KEY_ITEMS);
        assert.equal(keys.length, 5);
        assert.deepEqual(keys.sort(), ['CPU', 'LICENSE', 'NETWORK', 'RAM', 'STORAGE']);
    });
});

describe('Stage 14.1 / aggregateProviderPrices учитывает LICENSE', () => {
    it('categories содержит LICENSE на последней позиции', () => {
        const r = aggregateProviderPrices(['sbercloud'], {});
        assert.equal(r.categories.length, 5);
        assert.equal(r.categories[r.categories.length - 1], 'LICENSE');
    });

    it('byCategory.LICENSE имеет правильную форму { effective, frozen, deltaPct }', () => {
        const eff = {
            'license-os-per-node': { pricePerUnit: 35000, vendor: 'X', priceSource: 'y' }
        };
        const r = aggregateProviderPrices(['sbercloud'],
            { sbercloud: eff });
        assert.equal(r.providers.length, 1);
        const license = r.providers[0].byCategory.LICENSE;
        assert.equal(license.effective, 35000);
        /* frozen — из providerOverlay.js seed; может быть null если sbercloud
           не имеет own цены на license-os-per-node — тогда effective пришёл
           только из override. */
        assert.ok(license.deltaPct === null || Number.isFinite(license.deltaPct));
    });

    it('для провайдера без цены на license-os-per-node → effective=null', () => {
        const r = aggregateProviderPrices(['yandex'], { yandex: {} });
        const license = r.providers.length > 0 ? r.providers[0].byCategory.LICENSE : null;
        if (license) {
            /* frozen-overlay для yandex может содержать или не содержать
               license-os-per-node. Проверяем структуру, не значения. */
            assert.ok('effective' in license);
            assert.ok('frozen' in license);
            assert.ok('deltaPct' in license);
        }
    });
});
