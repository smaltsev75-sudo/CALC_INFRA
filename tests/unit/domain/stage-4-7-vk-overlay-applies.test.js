/**
 * Sprint 4 Stage 4.7 — VK Cloud overlay реально применяется в расчёте.
 *
 * Stage 4.5.1 hot-fix убрал alias-дубль, Stage 4.7 переключил VK Cloud
 * с inactive stub на active overlay. С PATCH 2.20.29 VK использует публичный
 * source-level subset: WAF/DDoS в прайсе "по запросу" и не входят в bundle.
 * Этот файл проверяет, что
 * выбор `provider='vk'` в settings меняет cell.pricePerUnit, totalMonthly
 * и пр. — overlay действительно доходит до calculator, а не остаётся в
 * UI-компоненте сводки тарифов.
 *
 * Все три active-провайдера (sbercloud / yandex / vk) должны давать
 * различающиеся итоги при идентичных answers — иначе пользователь не увидит
 * эффекта переключения.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_ITEMS } from '../../../js/domain/seed.js';
import { PROVIDER_OVERLAYS, applyProviderOverlay } from '../../../js/domain/providerOverlay.js';

const VK_PUBLIC_CORE_IDS = Object.freeze([
    'cpu-vcpu-shared',
    'cpu-vcpu-gpu',
    'ram-gb',
    'storage-ssd-tb',
    'storage-hdd-tb',
    'storage-object-tb',
    'network-lb-l7'
]);

function sumPricePerUnit(items) {
    return items.reduce((sum, it) => sum + (Number(it.pricePerUnit) || 0), 0);
}

describe('Stage 4.7 / Overlay действительно доходит до items', () => {
    it('applyProviderOverlay(SEED_ITEMS, "vk") меняет ≥10 pricePerUnit', () => {
        const overlaid = applyProviderOverlay(SEED_ITEMS, 'vk');
        let changedCount = 0;
        for (let i = 0; i < SEED_ITEMS.length; i++) {
            if (overlaid[i].pricePerUnit !== SEED_ITEMS[i].pricePerUnit) {
                changedCount++;
            }
        }
        assert.ok(changedCount >= 10,
            `VK overlay должен подменить pricePerUnit для ≥10 ЭК (нашли ${changedCount})`);
    });

    it('vendor у подменённых ЭК становится "VK Cloud"', () => {
        const overlaid = applyProviderOverlay(SEED_ITEMS, 'vk');
        const ram = overlaid.find(i => i.id === 'ram-gb');
        assert.equal(ram.vendor, 'VK Cloud',
            'overlay должен подменить и vendor — иначе CSV-экспорт покажет смешанные vendor\'ы.');
    });

    it('Сумма pricePerUnit различается у sbercloud / yandex / vk', () => {
        // Прокси для «итоги расчёта различаются»: если суммы pricePerUnit разные,
        // то и любой downstream consumer (Dashboard / Detalization / Comparison /
        // PDF / CSV) увидит разные числа. Не требует setup'а answers.
        const sber = sumPricePerUnit(applyProviderOverlay(SEED_ITEMS, 'sbercloud'));
        const yandex = sumPricePerUnit(applyProviderOverlay(SEED_ITEMS, 'yandex'));
        const vk = sumPricePerUnit(applyProviderOverlay(SEED_ITEMS, 'vk'));
        assert.notEqual(vk, sber, 'VK ≠ SberCloud — иначе пользователь не видит эффекта переключения');
        assert.notEqual(vk, yandex, 'VK ≠ Yandex — разные провайдеры дают разные итоги');
        assert.notEqual(yandex, sber, 'Yandex ≠ SberCloud');
    });

    it('onprem (inactive) НЕ меняет pricePerUnit — silent fallback на seed', () => {
        const overlaid = applyProviderOverlay(SEED_ITEMS, 'onprem');
        const seedSum = sumPricePerUnit(SEED_ITEMS);
        const onpremSum = sumPricePerUnit(overlaid);
        assert.equal(onpremSum, seedSum,
            'onprem inactive — overlay silent fallback на seed, цены не меняются.');
    });
});

describe('Stage VAT-2 Phase 4: VK ЭК-coverage пересекается с SberCloud / Yandex по публичным core SKU', () => {
    /* Stage VAT-2 Phase 4: source-of-truth для каждого провайдера — собственный
     * `data/providers/*-latest.json`. Coverage больше НЕ обязан быть
     * идентичным между провайдерами — отражает их реальный прайс-лист (sber
     * имеет AI/LLM/RAG, vk имеет лицензии/services, yandex смесь). Для UI
     * Comparison это значит: missing SKU silent-fallback'ится на SEED. */

    it('VK и SberCloud имеют общее публичное ядро compute/storage/network SKU', () => {
        const sberIds = new Set(Object.keys(PROVIDER_OVERLAYS.sbercloud.prices));
        const vkIds = new Set(Object.keys(PROVIDER_OVERLAYS.vk.prices));
        const missing = VK_PUBLIC_CORE_IDS.filter(id => !sberIds.has(id) || !vkIds.has(id));
        assert.deepEqual(missing, []);
        assert.equal(vkIds.has('network-waf'), false,
            'VK Cloud WAF в публичном прайсе идёт по запросу; его отсутствие должно ловиться freshness quality gate как MISSING_CORE');
    });

    it('VK и Yandex имеют общее публичное ядро core SKU', () => {
        const yandexIds = new Set(Object.keys(PROVIDER_OVERLAYS.yandex.prices));
        const vkIds = new Set(Object.keys(PROVIDER_OVERLAYS.vk.prices));
        const missing = VK_PUBLIC_CORE_IDS.filter(id => !yandexIds.has(id) || !vkIds.has(id));
        assert.deepEqual(missing, []);
    });
});
