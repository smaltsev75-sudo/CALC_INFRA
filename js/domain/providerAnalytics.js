/**
 * Stage 10.4: Cross-provider analytics — pure helpers для модалки сравнения
 * провайдеров. Отделены от providerOverlay.js, чтобы тот остался узко-целевым
 * (применение overlay к items), а аналитика жила здесь.
 *
 * **Чистый domain**: НЕ ходит в services/state/IO. Эффективные цены принимает
 * как inject-параметр (DI) — caller (controller или UI через ctx) собирает их
 * перед вызовом. Это держит domain тестируемым без localStorage-mock'а и
 * предотвращает layer violation domain → services.
 */

import { PROVIDER_OVERLAYS } from './providerOverlay.js';
import {
    getProviderPriceTrust,
    getProviderPriceWarnings
} from './providerPriceTrust.js';

/**
 * Stage 10.4: какой ЭК взять как «представителя» категории при сравнении
 * провайдеров. Выбраны самые ёмкие в денежном вкладе позиции — у любого
 * провайдера они присутствуют, и движение их цены отражает общий тренд.
 *
 * При желании в будущем можно расширить — например, считать medianPrice
 * нескольких ЭК в категории. Пока — single-key-item для простоты UI.
 */
export const CATEGORY_KEY_ITEMS = Object.freeze({
    CPU:     'cpu-vcpu-shared',
    RAM:     'ram-gb',
    STORAGE: 'storage-ssd-tb',
    NETWORK: 'network-lb-l7',
    /* Stage 14.1 (PATCH 2.7.1): добавлена категория LICENSE.
       Представитель — `license-os-per-node` как самая универсальная лицензия
       (ОС требуется на каждом узле любой инфраструктуры; альтернативы —
       license-db-per-vcpu и license-siem-edr-per-node — применимы выборочно). */
    LICENSE: 'license-os-per-node'
});

/**
 * Stage 14.5 (PATCH 2.7.3) — единицы измерения per-category для UI-шапки.
 * Источник: PROVIDER_PRICE_CATEGORIES в providerPriceSummary.js (single
 * source of truth — прайсы из seed.js + overlay).
 *
 * Без этого пользователь видел в модалке колонки «CPU 720, RAM 200,
 * STORAGE 10800, NETWORK 1600, LICENSE 29500, Итого 42820» БЕЗ единиц —
 * не понимал, что 720 это ₽/мес за 1 vCPU, а 29500 это ₽/узел/год за ОС-лицензию.
 * «Итого» при разных единицах — арифметически бессмысленно (это просто
 * скоринг для ранжирования провайдеров, не реальная сумма).
 */
export const CATEGORY_UNITS = Object.freeze({
    CPU:     '₽/vCPU/мес',
    RAM:     '₽/ГБ/мес',
    STORAGE: '₽/ТБ/мес',
    NETWORK: '₽/мес',
    LICENSE: '₽/узел/год'
});

/**
 * Stage 14.5 — короткое описание ЧТО именно измеряется в каждой колонке
 * (для tooltip'а у заголовка). Раскрывает, какой key-item представляет
 * категорию (cpu-vcpu-shared, ram-gb, ...).
 */
export const CATEGORY_DESCRIPTIONS_FOR_UI = Object.freeze({
    CPU:     'Цена 1 vCPU shared в месяц',
    RAM:     'Цена 1 ГБ оперативной памяти в месяц',
    STORAGE: 'Цена 1 ТБ SSD-хранилища в месяц',
    NETWORK: 'Цена 1 балансировщика HTTP/HTTPS (L7) в месяц',
    LICENSE: 'Цена ОС-лицензии за 1 узел в год'
});

const CATEGORY_ORDER = Object.freeze(['CPU', 'RAM', 'STORAGE', 'NETWORK', 'LICENSE']);

/**
 * Stage 10.4: построить per-provider × per-category матрицу для модалки
 * Cross-Provider Analytics.
 *
 * @param {string[]} providerIds — массив id провайдеров; неизвестные/inactive
 *     пропускаются.
 * @param {Object<string, Record<string, {pricePerUnit:number}>>} [effectivePricesByProvider]
 *     Опциональный map effective-цен per-provider. Если для providerId map'а
 *     нет — используем frozen-цены overlay (без override). Domain не ходит в
 *     localStorage; caller (controller/ctx) подгружает effective-цены и
 *     передаёт сюда.
 * @returns {{
 *   providers: Array<{
 *     id: string,
 *     label: string,
 *     active: boolean,
 *     byCategory: Record<string, { effective: number|null, frozen: number|null, deltaPct: number|null, trust: object }>,
 *     warnings: Array<{ id: string, label: string, title: string }>,
 *     totalCost: number
 *   }>,
 *   categories: string[]
 * }}
 */
export function aggregateProviderPrices(providerIds, effectivePricesByProvider) {
    if (!Array.isArray(providerIds)) {
        return { providers: [], categories: [...CATEGORY_ORDER] };
    }
    const effMap = (effectivePricesByProvider && typeof effectivePricesByProvider === 'object')
        ? effectivePricesByProvider : {};

    const providers = [];

    for (const id of providerIds) {
        const overlay = PROVIDER_OVERLAYS[id];
        if (!overlay || !overlay.active) continue;

        const frozenPrices = overlay.prices || {};
        const effectivePrices = effMap[id] || frozenPrices;

        const byCategory = {};
        let totalCost = 0;

        for (const cat of CATEGORY_ORDER) {
            const itemId = CATEGORY_KEY_ITEMS[cat];
            const effectiveEntry = effectivePrices[itemId] || null;
            const frozenEntry = frozenPrices[itemId] || null;
            const effective = Number(effectiveEntry?.pricePerUnit);
            const frozen = Number(frozenEntry?.pricePerUnit);

            const eff = Number.isFinite(effective) ? effective : null;
            const fro = Number.isFinite(frozen) ? frozen : null;

            let deltaPct = null;
            if (eff !== null && fro !== null && fro !== 0) {
                const pct = ((eff - fro) / fro) * 100;
                /* Threshold 0.1% — игнорим float-шум (тот же что в Stage 9.1 и 10.3). */
                deltaPct = Math.abs(pct) < 0.1 ? 0 : pct;
            }

            byCategory[cat] = {
                effective: eff,
                frozen: fro,
                deltaPct,
                trust: getProviderPriceTrust({
                    providerId: id,
                    itemId,
                    effectiveEntry,
                    frozenEntry
                })
            };
            if (eff !== null) totalCost += eff;
        }

        providers.push({
            id,
            label: overlay.label,
            active: overlay.active,
            byCategory,
            warnings: getProviderPriceWarnings(id),
            totalCost
        });
    }

    return { providers, categories: [...CATEGORY_ORDER] };
}
