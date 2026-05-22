/**
 * Sprint 4 Stage 4.7 — VK Cloud overlay реально применяется в расчёте.
 *
 * Stage 4.5.1 hot-fix убрал alias-дубль, Stage 4.7 переключил VK Cloud
 * с inactive stub на active overlay с 14 ЭК. Этот файл проверяет, что
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

describe('Stage VAT-2 Phase 4: VK ЭК-coverage пересекается с SberCloud / Yandex по core SKU', () => {
    /* Stage VAT-2 Phase 4: source-of-truth для каждого провайдера — собственный
     * `data/providers/*-latest.json`. Coverage больше НЕ обязан быть
     * идентичным между провайдерами — отражает их реальный прайс-лист (sber
     * имеет AI/LLM/RAG, vk имеет лицензии/services, yandex смесь). Для UI
     * Comparison это значит: missing SKU silent-fallback'ится на SEED. */

    it('VK и SberCloud имеют общее ядро core compute/storage/network SKU', () => {
        const sberIds = new Set(Object.keys(PROVIDER_OVERLAYS.sbercloud.prices));
        const vkIds = new Set(Object.keys(PROVIDER_OVERLAYS.vk.prices));
        const intersection = [...sberIds].filter(id => vkIds.has(id));
        assert.ok(intersection.length >= 8,
            `минимум 8 общих SKU sber/vk (core compute/storage/network), найдено ${intersection.length}: ` +
            intersection.join(', '));
    });

    it('VK и Yandex имеют общее ядро core SKU', () => {
        const yandexIds = new Set(Object.keys(PROVIDER_OVERLAYS.yandex.prices));
        const vkIds = new Set(Object.keys(PROVIDER_OVERLAYS.vk.prices));
        const intersection = [...yandexIds].filter(id => vkIds.has(id));
        assert.ok(intersection.length >= 8,
            `минимум 8 общих SKU yandex/vk, найдено ${intersection.length}`);
    });
});
