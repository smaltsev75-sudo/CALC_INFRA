/**
 * Stage VAT-2 Phase 4 — Runtime: provider overlay отдаёт net-prices в downstream.
 *
 * Главный инвариант VAT-2 на runtime-уровне:
 *
 *   PROVIDER_OVERLAYS[providerId].prices[entryId].pricePerUnit === net
 *   downstream calculator применяет vatMul поверх этого net — НДС учитывается
 *   ровно один раз.
 *
 * Также проверяется:
 *   - SEED fallback для items, отсутствующих в конкретном bundled JSON
 *     (например, license/service SKU у Cloud.ru).
 *   - Metadata preservation (vendor, priceSource, vatRate, vatPolicyConfidence).
 *   - Идентичность applyProviderOverlay → getEffectivePrices.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    PROVIDER_OVERLAYS,
    applyProviderOverlay,
    getEffectivePrices
} from '../../../js/domain/providerOverlay.js';
import { BUNDLED_PROVIDER_PRICES } from '../../../js/data/providers-bundled.generated.js';
import { SEED_ITEMS } from '../../../js/domain/seed.js';

describe('Phase 4.1: pricePerUnit == net для всех активных провайдеров', () => {
    it('sbercloud / cpu-vcpu-shared: pricePerUnit ≈ 583.61 (= 712 gross / 1.22)', () => {
        const entry = PROVIDER_OVERLAYS.sbercloud.prices['cpu-vcpu-shared'];
        assert.ok(entry, 'cpu-vcpu-shared должен быть в sbercloud overlay');
        assert.equal(entry.pricePerUnit, 583.61);
        /* Защита от обратного движения — pricePerUnit НЕ должен совпадать с gross. */
        assert.notEqual(entry.pricePerUnit, 712);
    });

    it('yandex / cpu-vcpu-shared: pricePerUnit равен net из bundled', () => {
        const overlayEntry = PROVIDER_OVERLAYS.yandex.prices['cpu-vcpu-shared'];
        const bundledEntry = BUNDLED_PROVIDER_PRICES.yandex.prices['cpu-vcpu-shared'];
        assert.ok(overlayEntry);
        assert.equal(overlayEntry.pricePerUnit, bundledEntry.pricePerUnitNet);
    });

    it('vk / cpu-vcpu-shared: pricePerUnit ≈ 695.90 (= 849 gross / 1.22)', () => {
        const entry = PROVIDER_OVERLAYS.vk.prices['cpu-vcpu-shared'];
        assert.equal(entry.pricePerUnit, 695.9);
        assert.notEqual(entry.pricePerUnit, 849);
    });
});

describe('Phase 4.2: metadata из bundled сохранена в overlay', () => {
    it('vendor + priceSource переносятся из bundled', () => {
        const o = PROVIDER_OVERLAYS.sbercloud.prices['cpu-vcpu-shared'];
        const b = BUNDLED_PROVIDER_PRICES.sbercloud.prices['cpu-vcpu-shared'];
        assert.equal(o.vendor, b.vendor);
        assert.equal(o.priceSource, b.priceSource);
    });

    it('VAT metadata доступна в overlay entry (gross, net, vatRate, confidence)', () => {
        const o = PROVIDER_OVERLAYS.sbercloud.prices['cpu-vcpu-shared'];
        assert.equal(o.pricePerUnitGross, 712, 'gross должен быть из bundled');
        assert.equal(o.pricePerUnitNet, 583.61, 'net должен быть из bundled');
        assert.equal(o.vatRate, 0.22, 'vatRate должен быть из bundled');
        assert.equal(o.vatPolicyConfidence, 'verified', 'confidence — из top-level vatPolicy');
        assert.equal(o.vatNormalized, true);
    });

    it('confidence per provider матчит ожидаемое', () => {
        assert.equal(
            PROVIDER_OVERLAYS.sbercloud.prices['cpu-vcpu-shared'].vatPolicyConfidence,
            'verified'
        );
        assert.equal(
            PROVIDER_OVERLAYS.yandex.prices['cpu-vcpu-shared'].vatPolicyConfidence,
            'verified'
        );
        assert.equal(
            PROVIDER_OVERLAYS.vk.prices['cpu-vcpu-shared'].vatPolicyConfidence,
            'source-level'
        );
    });
});

describe('Phase 4.3: SEED fallback для items, отсутствующих в bundled', () => {
    /* В bundled.sbercloud нет license/service/cpu-vcpu-dedicated SKU — они
     * должны fallback'нуться к SEED-цене (silent fallback в applyProviderOverlay). */
    const ITEMS_NOT_IN_BUNDLED = [
        'cpu-vcpu-dedicated',
        'license-db-per-vcpu',
        'license-os-per-node',
        'license-siem-edr-per-node',
        'service-email-per-1k',
        'service-sms-per-1k'
    ];

    it('items не в bundled.sbercloud.prices — отсутствуют в overlay.sbercloud.prices', () => {
        const sbercloudIds = new Set(Object.keys(PROVIDER_OVERLAYS.sbercloud.prices));
        for (const id of ITEMS_NOT_IN_BUNDLED) {
            assert.equal(sbercloudIds.has(id), false,
                `${id} не должен быть в overlay (его нет в bundled v2)`);
        }
    });

    it('applyProviderOverlay сохраняет SEED-цену для items не из bundled', () => {
        const seedDedicated = SEED_ITEMS.find(i => i.id === 'cpu-vcpu-dedicated');
        if (!seedDedicated) return;  /* skip if SEED не содержит item */
        const seedPrice = seedDedicated.pricePerUnit;
        assert.ok(Number.isFinite(seedPrice) && seedPrice > 0,
            'SEED должен иметь pricePerUnit для cpu-vcpu-dedicated');

        const overlayed = applyProviderOverlay(SEED_ITEMS, 'sbercloud');
        const overlayedDedicated = overlayed.find(i => i.id === 'cpu-vcpu-dedicated');
        assert.ok(overlayedDedicated);
        assert.equal(overlayedDedicated.pricePerUnit, seedPrice,
            'item не из bundled → должен использовать SEED-цену (silent fallback)');
        assert.ok(Number.isFinite(overlayedDedicated.pricePerUnit),
            'НИ В КОЕМ случае не 0/NaN/Infinity');
    });
});

describe('Phase 4.4: SEED items, которые ЕСТЬ в bundled — перетираются overlay net-ценой', () => {
    it('sbercloud overlay → cpu-vcpu-shared становится 583.61 (не SEED-default)', () => {
        const seedShared = SEED_ITEMS.find(i => i.id === 'cpu-vcpu-shared');
        const overlayed = applyProviderOverlay(SEED_ITEMS, 'sbercloud');
        const overlayedShared = overlayed.find(i => i.id === 'cpu-vcpu-shared');
        assert.equal(overlayedShared.pricePerUnit, 583.61);
        assert.notEqual(overlayedShared.pricePerUnit, seedShared.pricePerUnit,
            'overlay должен перетереть SEED, а не пропустить');
    });
});

describe('Phase 4.5: double-VAT regression через applyProviderOverlay', () => {
    it('overlay → calc формула: 1 × net × (1 + 0.20) = 120 для gross=122-эталона', () => {
        /* Этого item-а нет в bundled — используем синтетический SEED-replace. */
        const fakeItem = { id: 'cpu-vcpu-shared', pricePerUnit: 99999, vendor: '', priceSource: '' };
        const items = [fakeItem, ...SEED_ITEMS.filter(i => i.id !== 'cpu-vcpu-shared')];

        const overlayed = applyProviderOverlay(items, 'sbercloud');
        const cell = overlayed.find(i => i.id === 'cpu-vcpu-shared');
        const net = cell.pricePerUnit;            /* должно быть 583.61 */
        const calcVatRate = 0.20;
        const final = 1 * net * (1 + calcVatRate); /* симулируем calculator vatMul */

        /* Если бы overlay использовал gross (712), final был бы 854.4 (двойной НДС). */
        assert.ok(Math.abs(final - 583.61 * 1.20) < 0.001,
            `Ожидалось final ≈ 700.33 (= 583.61 × 1.20), получено ${final}`);
        assert.notEqual(final, 712 * 1.20,
            'CRITICAL: overlay использовал gross вместо net — double-VAT regression');
    });
});

describe('Phase 4.6: getEffectivePrices === PROVIDER_OVERLAYS[id].prices', () => {
    it('sbercloud: getEffectivePrices возвращает тот же объект, что PROVIDER_OVERLAYS', () => {
        const fromGetter = getEffectivePrices('sbercloud');
        const fromMap = PROVIDER_OVERLAYS.sbercloud.prices;
        assert.deepEqual(fromGetter, fromMap);
    });

    it('onprem (inactive): getEffectivePrices возвращает {}', () => {
        assert.deepEqual(getEffectivePrices('onprem'), {});
    });

    it('unknown providerId: getEffectivePrices возвращает {}', () => {
        assert.deepEqual(getEffectivePrices('not-a-provider'), {});
    });
});

describe('Phase 4.7: счёт записей по провайдерам', () => {
    it('sbercloud: 16 записей (соответствует bundled)', () => {
        const ids = Object.keys(PROVIDER_OVERLAYS.sbercloud.prices);
        assert.equal(ids.length, 16,
            `ожидалось 16 entries в sbercloud overlay (по bundled), получено ${ids.length}`);
    });

    it('yandex: 15 записей', () => {
        assert.equal(Object.keys(PROVIDER_OVERLAYS.yandex.prices).length, 15);
    });

    it('vk: 10 записей', () => {
        assert.equal(Object.keys(PROVIDER_OVERLAYS.vk.prices).length, 10);
    });

    it('onprem: prices отсутствуют (stub)', () => {
        assert.equal(PROVIDER_OVERLAYS.onprem.prices, undefined);
    });
});
