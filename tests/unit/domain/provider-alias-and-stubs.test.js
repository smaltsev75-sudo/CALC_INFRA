/**
 * 14.U8 / Stage 4.5.1 unit-тесты: provider overlays.
 *
 * Stage 4.5.1 (hot-fix дубля): entry `cloud_ru` удалена из PROVIDER_OVERLAYS.
 * Раньше она была alias на sbercloud, но показывалась в UI dropdown'е как
 * отдельный провайдер — пользователь видел дубль. Теперь label у sbercloud =
 * «Cloud.ru (бывший SberCloud)» — отражает текущее имя бренда (ребрендинг 2024).
 *
 * Проверяем:
 *   1. cloud_ru НЕ существует в PROVIDER_OVERLAYS (anti-regression).
 *   2. sbercloud label = «Cloud.ru (бывший SberCloud)».
 *   3. yandex = active со stub-prices (отличаются от SberCloud).
 *   4. vk / onprem = inactive — overlay НЕ применяется (фоллбэк на seed).
 *   5. getActiveProviders возвращает 2 active: sbercloud, yandex.
 *   6. listProviders возвращает 4 провайдера (sbercloud, yandex, vk, onprem).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    PROVIDER_OVERLAYS,
    applyProviderOverlay,
    getActiveProviders,
    listProviders,
    getEffectivePrices,
    DEFAULT_PROVIDER
} from '../../../js/domain/providerOverlay.js';
import { SEED_ITEMS } from '../../../js/domain/seed.js';

const TEST_ITEMS = SEED_ITEMS.map(i => ({ id: i.id, pricePerUnit: i.pricePerUnit }));

describe('Stage 4.5.1 hot-fix: cloud_ru дубль устранён', () => {
    it('cloud_ru НЕ существует в PROVIDER_OVERLAYS (anti-regression)', () => {
        assert.equal(PROVIDER_OVERLAYS.cloud_ru, undefined,
            'Раньше cloud_ru был aliasOf:"sbercloud" и показывался в dropdown как ' +
            'отдельный пункт — пользователь видел два пункта одного провайдера. ' +
            'Hot-fix Stage 4.5.1: entry удалена.');
    });

    it('sbercloud label обновлён на «Cloud.ru (бывший SberCloud)»', () => {
        assert.equal(PROVIDER_OVERLAYS.sbercloud.label, 'Cloud.ru (бывший SberCloud)',
            'Label отражает текущее имя бренда (ребрендинг 2024). id остаётся ' +
            '"sbercloud" для backward-compat с persisted calc\'ами.');
    });

    it('applyProviderOverlay для "cloud_ru" возвращает items без изменений (silent fallback)', () => {
        // После удаления entry — providerId='cloud_ru' становится «неизвестным»,
        // overlay не применяется, items без изменений. Persisted расчёты с
        // 'cloud_ru' переводятся миграцией v15→v16 на 'sbercloud' — но здесь
        // тестируем, что unknown id безопасно фоллбэкается.
        const result = applyProviderOverlay(TEST_ITEMS, 'cloud_ru');
        assert.deepEqual(result, TEST_ITEMS,
            'unknown providerId не должен ломать расчёт.');
    });
});

describe('14.U8 Yandex Cloud (active stub с правдоподобными ценами)', () => {
    it('yandex активен с непустым prices', () => {
        assert.equal(PROVIDER_OVERLAYS.yandex.active, true);
        assert.ok(Object.keys(PROVIDER_OVERLAYS.yandex.prices).length > 0,
            'yandex prices должны быть заполнены');
    });

    it('yandex покрывает непустой набор цен (после Phase 4 source = bundled JSON)', () => {
        /* Stage VAT-2 Phase 4: coverage больше не жёстко-фиксированный 14 —
         * отражает текущий yandex.cloud/ru/prices Q3-2026 (15 SKU). */
        assert.ok(Object.keys(PROVIDER_OVERLAYS.yandex.prices).length >= 10);
    });

    it('vendor у каждой записи Yandex начинается с "Yandex Cloud"', () => {
        /* Bundled v2 расширяет vendor пометкой platform/region:
         * "Yandex Cloud (Compute Cloud, Intel Ice Lake regular VM)". */
        for (const [, entry] of Object.entries(PROVIDER_OVERLAYS.yandex.prices)) {
            assert.ok(entry.vendor.startsWith('Yandex Cloud'),
                `vendor должен начинаться с "Yandex Cloud", получено "${entry.vendor}"`);
        }
    });

    it('priceSource для Yandex непустой и ссылается на yandex.cloud (source-level)', () => {
        /* Phase 4: bundled yandex имеет confidence='source-level' (публичные
         * тарифы yandex.cloud/pricing). Раньше overlay был помечен «stub» —
         * теперь это полноценный source-level прайс. */
        for (const [, entry] of Object.entries(PROVIDER_OVERLAYS.yandex.prices)) {
            assert.ok(entry.priceSource.length > 0,
                `priceSource должен быть непустой строкой`);
            assert.match(entry.priceSource, /yandex\.cloud/i,
                `priceSource "${entry.priceSource}" должен содержать ссылку на yandex.cloud`);
        }
    });

    it('Yandex prices отличаются от SberCloud (где есть пересечение по ID)', () => {
        const sberPrices = PROVIDER_OVERLAYS.sbercloud.prices;
        const yandexPrices = PROVIDER_OVERLAYS.yandex.prices;
        const overlap = Object.keys(sberPrices).filter(id => id in yandexPrices);
        assert.ok(overlap.length >= 5,
            `должно быть минимум 5 общих SKU у sbercloud/yandex, найдено ${overlap.length}`);
        let differCount = 0;
        for (const id of overlap) {
            if (yandexPrices[id].pricePerUnit !== sberPrices[id].pricePerUnit) {
                differCount++;
            }
        }
        assert.ok(differCount >= 3,
            `минимум 3 из ${overlap.length} общих цен Yandex должны отличаться от SberCloud, отличается ${differCount}`);
    });

    it('applyProviderOverlay для yandex реально подменяет seed', () => {
        const result = applyProviderOverlay(TEST_ITEMS, 'yandex');
        /* Phase 4: 'service-sms-per-1k' нет в bundled yandex. Используем
         * 'cpu-vcpu-shared' — core SKU, который есть в bundled у всех 3. */
        const cpu = result.find(i => i.id === 'cpu-vcpu-shared');
        assert.equal(cpu.pricePerUnit, PROVIDER_OVERLAYS.yandex.prices['cpu-vcpu-shared'].pricePerUnit);
    });
});

describe('Stage 4.7: VK Cloud (active overlay) и onprem (inactive stub)', () => {
    /* Stage 4.7: vk переключился с inactive stub на active overlay с 14 ЭК.
       onprem остаётся inactive — у него CAPEX-модель, overlay подменяет
       только pricePerUnit (OPEX). */

    it('vk active=true с непустым набором prices (Phase 4: 14 ЭК из bundled)', () => {
        assert.equal(PROVIDER_OVERLAYS.vk.active, true,
            'Stage 4.7: vk переключён с inactive stub на active overlay');
        assert.ok(Object.keys(PROVIDER_OVERLAYS.vk.prices).length >= 10,
            'VK Cloud overlay должен иметь непустой набор цен (после Phase 4 source = bundled JSON)');
    });

    it('vendor у каждой записи VK Cloud = "VK Cloud"', () => {
        for (const [, entry] of Object.entries(PROVIDER_OVERLAYS.vk.prices)) {
            assert.equal(entry.vendor, 'VK Cloud');
        }
    });

    it('priceSource для VK Cloud содержит «realistic-stub» маркер', () => {
        // Защита от трактовки «верифицированные публичные тарифы». Когда
        // появится реальный source — убрать маркер из priceSource'ов и из теста.
        for (const [, entry] of Object.entries(PROVIDER_OVERLAYS.vk.prices)) {
            assert.match(entry.priceSource, /realistic-stub/i,
                `priceSource "${entry.priceSource}" должен содержать «realistic-stub» — цены не верифицированы публичным прайсом VK`);
        }
    });

    it('VK prices отличаются от SberCloud по пересекающимся SKU', () => {
        const sberPrices = PROVIDER_OVERLAYS.sbercloud.prices;
        const vkPrices = PROVIDER_OVERLAYS.vk.prices;
        const overlap = Object.keys(sberPrices).filter(id => id in vkPrices);
        assert.ok(overlap.length >= 5,
            `должно быть минимум 5 общих SKU у sber/vk, найдено ${overlap.length}`);
        let differCount = 0;
        for (const id of overlap) {
            if (vkPrices[id].pricePerUnit !== sberPrices[id].pricePerUnit) {
                differCount++;
            }
        }
        assert.ok(differCount >= 3,
            `минимум 3 из ${overlap.length} общих цен VK должны отличаться от SberCloud, отличается ${differCount}`);
    });

    it('VK prices отличаются от Yandex по пересекающимся SKU', () => {
        const yandexPrices = PROVIDER_OVERLAYS.yandex.prices;
        const vkPrices = PROVIDER_OVERLAYS.vk.prices;
        const overlap = Object.keys(yandexPrices).filter(id => id in vkPrices);
        assert.ok(overlap.length >= 5);
        let differCount = 0;
        for (const id of overlap) {
            if (vkPrices[id].pricePerUnit !== yandexPrices[id].pricePerUnit) {
                differCount++;
            }
        }
        assert.ok(differCount >= 3,
            `минимум 3 из ${overlap.length} общих цен VK должны отличаться от Yandex, отличается ${differCount}`);
    });

    it('applyProviderOverlay для vk реально подменяет seed', () => {
        const result = applyProviderOverlay(TEST_ITEMS, 'vk');
        const ram = result.find(i => i.id === 'ram-gb');
        assert.equal(ram.pricePerUnit, PROVIDER_OVERLAYS.vk.prices['ram-gb'].pricePerUnit,
            'после Stage 4.7 vk overlay должен подменять pricePerUnit (раньше silent fallback на seed)');
    });

    it('onprem остаётся active=false с описанием про CAPEX', () => {
        assert.equal(PROVIDER_OVERLAYS.onprem.active, false);
        assert.match(PROVIDER_OVERLAYS.onprem.description, /capex/i,
            'описание onprem должно объяснять, почему он не overlay-модель');
    });

    it('applyProviderOverlay(items, "onprem") возвращает items без изменений', () => {
        const result = applyProviderOverlay(TEST_ITEMS, 'onprem');
        assert.deepEqual(result, TEST_ITEMS);
    });

    it('getEffectivePrices для onprem возвращает {} (inactive)', () => {
        assert.deepEqual(getEffectivePrices('onprem'), {});
    });

    it('getEffectivePrices для vk возвращает 14 цен (active после Stage 4.7)', () => {
        const prices = getEffectivePrices('vk');
        assert.equal(Object.keys(prices).length, 14);
    });
});

describe('Stage 4.5.1: getActiveProviders / listProviders', () => {
    it('getActiveProviders возвращает 3 active: sbercloud, vk, yandex (Stage 4.7)', () => {
        const ids = getActiveProviders().sort();
        assert.deepEqual(ids, ['sbercloud', 'vk', 'yandex'],
            'Stage 4.7: vk переключён с inactive stub на active overlay. Активны: SberCloud (Cloud.ru), Yandex Cloud, VK Cloud.');
    });

    it('listProviders возвращает 4 провайдера с метаданными', () => {
        const list = listProviders();
        assert.equal(list.length, 4, 'sbercloud + yandex + vk + onprem (без cloud_ru дубля)');
        const ids = list.map(p => p.id).sort();
        assert.deepEqual(ids, ['onprem', 'sbercloud', 'vk', 'yandex']);
    });

    it('listProviders для sbercloud возвращает aliasOf=null (не alias сам по себе)', () => {
        const list = listProviders();
        const sbercloud = list.find(p => p.id === 'sbercloud');
        assert.equal(sbercloud.aliasOf, null);
    });
});

describe('14.U8 robustness: orphan alias, неизвестный provider', () => {
    it('неизвестный providerId → applyProviderOverlay возвращает items без изменений', () => {
        const result = applyProviderOverlay(TEST_ITEMS, 'no-such-provider');
        assert.deepEqual(result, TEST_ITEMS);
    });

    it('неизвестный providerId → getEffectivePrices = {}', () => {
        assert.deepEqual(getEffectivePrices('no-such-provider'), {});
    });

    it('DEFAULT_PROVIDER остаётся sbercloud', () => {
        assert.equal(DEFAULT_PROVIDER, 'sbercloud');
    });
});

/* Stage 14.U7 tests удалены в Phase 4: service-sms-per-1k больше нет в
 * bundled sbercloud (Cloud.ru договорные приложения Q3-2026 не содержат
 * SMS-сервиса как отдельной SKU — он отдавался legacy hardcoded baseline
 * через SberTech Exolve). Расчёт продолжает работать через SEED-fallback. */
