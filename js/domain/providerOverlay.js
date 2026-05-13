/**
 * Provider overlay — подмена тарифов под выбранного провайдера.
 *
 * Архитектура:
 *
 *   В seed.js остаются БАЗОВЫЕ цены (микс провайдеров — historical default).
 *   Provider overlay — separate layer, который применяется ПЕРЕД расчётом и
 *   подменяет `pricePerUnit` для items, перечисленных в overlay.
 *
 * Поля провайдера:
 *
 *   - id, label, description — UI-метаданные.
 *   - active — true: применяется к расчёту; false: показан в dropdown как stub.
 *   - prices — { 'item-id': { pricePerUnit, vendor, priceSource, ... } }. Спред
 *     поверх seed-item: переопределяет pricePerUnit + метаданные.
 *   - aliasOf — id другого провайдера. Если задано, prices берутся из
 *     целевого. Используется для ребрендинга (Cloud.ru = SberCloud).
 *
 * Stage VAT-2 Phase 4 (текущее состояние):
 *
 *   Источник цен — `js/data/providers-bundled.generated.js`, который собирается
 *   `npm run generate:providers` из `data/providers/*-latest.json` (schema v2).
 *   Hardcoded SBERCLOUD_PRICES / YANDEX_PRICES / VK_CLOUD_PRICES (Stage 4.5
 *   / 4.7 era) удалены — они давали Q2-2026 baseline, который дублировал и
 *   расходился с источником в JSON.
 *
 *   `buildOverlayPricesFromBundled(providerId)` приводит v2-entry к runtime-
 *   формату: `pricePerUnit = pricePerUnitNet` (canonical для downstream
 *   calculator), плюс meta-поля для UI/audit (gross / vatRate / confidence /
 *   vatNormalized). НДС применяется calculator'ом ровно один раз через
 *   `vatMul` поверх net — главный VAT-2 invariant.
 *
 *   Items, отсутствующие в bundled (licenses / services / cpu-vcpu-dedicated),
 *   silent-fallback'ятся к SEED-цене в `applyProviderOverlay`.
 *
 * Линтеры:
 *   - [provider-overlay-coverage.test.js]: каждый ключ в `prices` для не-alias
 *     non-stub провайдеров существует в SEED_ITEMS.id.
 *   - [provider-overlay-uses-bundled.test.js]: overlay реально читает из
 *     generated module, не из литералов; pricePerUnit ≡ bundled.pricePerUnitNet.
 *   - [provider-overlay-net-price.test.js]: runtime контракт VAT-2.
 */

import { SEED_ITEMS } from './seed.js';
import { BUNDLED_PROVIDER_PRICES } from '../data/providers-bundled.generated.js';

/**
 * Stage VAT-2 Phase 4: приводит bundled v2 entries к runtime-формату overlay.
 *
 * Для каждой entry:
 *   - `pricePerUnit = pricePerUnitNet` (canonical net для calculator)
 *   - `vendor`, `priceSource` копируются
 *   - meta-поля сохраняются для UI / audit: `pricePerUnitGross`,
 *     `pricePerUnitNet`, `vatRate`, `vatPolicyConfidence` (из top-level
 *     `vatPolicy.confidence`), `vatNormalized: true`.
 *
 * @param {string} providerId
 * @returns {Object} Object.freeze({ <itemId>: Object.freeze({...}), ... })
 */
function buildOverlayPricesFromBundled(providerId) {
    const bundled = BUNDLED_PROVIDER_PRICES[providerId];
    if (!bundled || !bundled.prices) return Object.freeze({});
    const confidence = bundled.vatPolicy ? bundled.vatPolicy.confidence : undefined;
    const out = {};
    for (const [id, entry] of Object.entries(bundled.prices)) {
        out[id] = Object.freeze({
            pricePerUnit: entry.pricePerUnitNet,
            vendor: entry.vendor,
            priceSource: entry.priceSource,
            pricePerUnitGross: entry.pricePerUnitGross,
            pricePerUnitNet: entry.pricePerUnitNet,
            vatRate: entry.vatRate,
            vatPolicyConfidence: confidence,
            vatNormalized: true
        });
    }
    return Object.freeze(out);
}

const SBERCLOUD_PRICES = buildOverlayPricesFromBundled('sbercloud');
const YANDEX_PRICES = buildOverlayPricesFromBundled('yandex');
const VK_CLOUD_PRICES = buildOverlayPricesFromBundled('vk');

export const PROVIDER_OVERLAYS = Object.freeze({
    /* id остаётся 'sbercloud' для backward-совместимости с persisted calc'ами
       и архитектурой alias-resolver'а. Label отражает текущее имя бренда —
       Cloud.ru — с пояснением «бывший SberCloud» для пользователей, помнящих
       старое название. */
    sbercloud: Object.freeze({
        id: 'sbercloud',
        label: 'Cloud.ru (бывший SberCloud)',
        active: true,
        description: 'Платформа Cloud.ru — продолжение SberCloud после ребрендинга 2024. Договорные приложения 2026-Q3 (verified).',
        prices: SBERCLOUD_PRICES
    }),
    yandex: Object.freeze({
        id: 'yandex',
        label: 'Yandex Cloud',
        active: true,
        description: 'Yandex Cloud — расчётные ориентиры тарифов 2026-Q3 (source-level: публичные тарифы yandex.cloud/pricing).',
        prices: YANDEX_PRICES
    }),
    /* Stage 4.7: VK Cloud был переключён с inactive stub на active overlay.
       После Stage VAT-2 Phase 3 VK source vatPolicy.confidence='assumed' —
       это realistic-stub, не верифицированный прайс. */
    vk: Object.freeze({
        id: 'vk',
        label: 'VK Cloud',
        active: true,
        description: 'VK Cloud — realistic-stub Q3-2026 (assumed: не верифицированный публичный прайс).',
        prices: VK_CLOUD_PRICES
    }),
    /* On-prem НЕ overlay-модель: у on-prem CAPEX (железо + амортизация + DC),
       а overlay подменяет только pricePerUnit (OPEX). Для on-prem нужна
       отдельная модель расчёта (планируется в Sprint 3+). Сейчас — stub. */
    onprem: Object.freeze({
        id: 'onprem',
        label: 'On-premises',
        active: false,
        description: 'On-prem использует CAPEX-модель (железо + амортизация + DC). Поддержка планируется отдельно.'
    })
});

export const DEFAULT_PROVIDER = 'sbercloud';

/**
 * Развернуть aliasOf-цепочку до конечного провайдера с prices.
 * Защищён от циклов (max 3 hop) и от orphan alias.
 */
function resolveOverlay(providerId, depth = 0) {
    if (depth > 3) return null;
    const overlay = PROVIDER_OVERLAYS[providerId];
    if (!overlay) return null;
    if (overlay.aliasOf) return resolveOverlay(overlay.aliasOf, depth + 1);
    return overlay;
}

/**
 * Применить provider overlay к каталогу items.
 *
 * Если provider не найден, не active или его prices пусты — items возвращаются
 * без изменений (silent fallback на base-цены seed.js). aliasOf разворачивается
 * до целевого провайдера; флаг active проверяется на ИСХОДНОМ запросе, не на
 * целевом (alias может быть active=true даже если цели нет).
 *
 * Items, отсутствующие в overlay.prices — также silent fallback на SEED-цену.
 * Это нормальный сценарий после Phase 4: bundled JSON покрывает ~15 SKU,
 * остальные 20+ items расчёта используют SEED-defaults как раньше.
 */
export function applyProviderOverlay(items, providerId) {
    const requested = PROVIDER_OVERLAYS[providerId];
    if (!requested || !requested.active) return items;

    const resolved = resolveOverlay(providerId);
    if (!resolved) return items;

    const priceMap = resolved.prices;
    if (!priceMap || Object.keys(priceMap).length === 0) return items;

    return items.map(item => {
        const override = priceMap[item.id];
        if (!override) return item;
        return { ...item, ...override };
    });
}

/**
 * Получить эффективные prices провайдера (с разворачиванием aliasOf).
 * Используется UI-сводкой и тестами. Возвращает {} для inactive/orphan.
 */
export function getEffectivePrices(providerId) {
    const requested = PROVIDER_OVERLAYS[providerId];
    if (!requested || !requested.active) return {};
    const resolved = resolveOverlay(providerId);
    return resolved?.prices || {};
}

export function getActiveProviders() {
    return Object.values(PROVIDER_OVERLAYS).filter(p => p.active).map(p => p.id);
}

export function listProviders() {
    return Object.values(PROVIDER_OVERLAYS).map(p => ({
        id: p.id,
        label: p.label,
        active: p.active,
        description: p.description,
        aliasOf: p.aliasOf || null
    }));
}
