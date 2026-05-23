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

import {
    PROVIDER_OVERLAYS,
    DEFAULT_PROVIDER,
    applyProviderOverlay,
    getProviderPriceBundleMeta
} from './providerOverlay.js';
import {
    getProviderPriceTrust,
    getProviderPriceWarnings,
    getProviderCapabilityTrust,
    PROVIDER_TRUST_MATRIX_CAPABILITIES
} from './providerPriceTrust.js';

/**
 * Fallback-режим Прайс-бенчмарка, когда нет активного расчёта. Для реального
 * расчёта UI передаёт top-6 ЭК по месячному вкладу, см.
 * buildProviderBenchmarkItems().
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

export const CATEGORY_LABELS_FOR_UI = Object.freeze({
    CPU:     'Процессоры',
    RAM:     'Память',
    STORAGE: 'SSD-диски',
    NETWORK: 'Балансировщик',
    LICENSE: 'ОС-лицензия'
});

/**
 * Stage 14.5 — короткое описание ЧТО именно измеряется в каждой колонке
 * (для tooltip'а у заголовка). Раскрывает, какой key-item представляет
 * категорию (cpu-vcpu-shared, ram-gb, ...).
 */
export const CATEGORY_DESCRIPTIONS_FOR_UI = Object.freeze({
    CPU:     'Цена 1 виртуального ядра shared в месяц',
    RAM:     'Цена 1 ГБ оперативной памяти в месяц',
    STORAGE: 'Цена 1 ТБ SSD-хранилища в месяц',
    NETWORK: 'Цена 1 балансировщика HTTP/HTTPS (L7) в месяц',
    LICENSE: 'Цена ОС-лицензии за 1 узел в год'
});

const CATEGORY_ORDER = Object.freeze(['CPU', 'RAM', 'STORAGE', 'NETWORK', 'LICENSE']);
export const PROVIDER_BENCHMARK_TOP_LIMIT = 6;

const BENCHMARK_ITEM_LABELS_FOR_UI = Object.freeze({
    'cpu-vcpu-shared': 'CPU shared',
    'cpu-vcpu-dedicated': 'CPU dedicated',
    'cpu-vcpu-gpu': 'GPU CPU',
    'ram-gb': 'RAM',
    'storage-ssd-tb': 'SSD',
    'storage-hdd-tb': 'HDD',
    'storage-object-tb': 'Объектное',
    'storage-secure-gb': '152-ФЗ SSD',
    'network-lb-l7': 'Балансировщик L7',
    'network-waf': 'WAF',
    'license-db-per-vcpu': 'СУБД',
    'license-os-per-node': 'ОС',
    'license-siem-edr-per-node': 'SIEM/EDR',
    'service-email-per-1k': 'Email',
    'service-sms-per-1k': 'SMS',
    'service-push-per-1m': 'Push',
    'traffic-egress-tb': 'Исходящий трафик',
    'traffic-ingress-tb': 'Входящий трафик',
    'llm-tokens-input-1m': 'LLM input',
    'llm-tokens-output-1m': 'LLM output',
    'rag-embeddings-1m': 'RAG embeddings',
    'rag-vector-db-gb': 'Vector DB',
    'rag-managed-knowledge-base-gb': 'RAG база знаний',
    'ai-agent-sandbox-vcpu': 'CPU агентов',
    'ai-agent-memory-storage-tb': 'Память агентов',
    'one-pentest-external': 'Внешний пентест',
    'one-pentest-internal': 'Внутренний пентест',
    'one-load-test-prelaunch': 'НТ перед релизом',
    'one-load-test-regular': 'Регулярное НТ',
    'one-pentest-regular': 'Регулярный пентест',
    'one-security-audit': 'Аудит ИБ',
    'one-fstec-certification': 'Сертификация ФСТЭК',
    'one-deployment': 'Внедрение',
    'one-staff-training': 'Обучение',
    'one-source-code-audit': 'Аудит кода',
    'res-georedundancy': 'Георезерв',
    'res-dr-active': 'DR-кластер'
});

const BILLING_INTERVAL_UNIT_LABELS = Object.freeze({
    daily: 'день',
    monthly: 'мес',
    annual: 'год'
});

function makeDefaultColumns() {
    return CATEGORY_ORDER.map(cat => ({
        key: cat,
        itemId: CATEGORY_KEY_ITEMS[cat],
        label: CATEGORY_LABELS_FOR_UI[cat] || cat,
        unit: CATEGORY_UNITS[cat] || '',
        description: CATEGORY_DESCRIPTIONS_FOR_UI[cat] || cat,
        monthlyCost: null,
        monthlyUsageFactor: null,
        sharePct: null,
        dynamic: false
    }));
}

function normalizeBenchmarkColumns(benchmarkItems) {
    if (!Array.isArray(benchmarkItems) || benchmarkItems.length === 0) {
        return makeDefaultColumns();
    }

    const seen = new Set();
    const columns = [];
    for (const raw of benchmarkItems) {
        if (!raw || typeof raw !== 'object') continue;
        const itemId = String(raw.itemId || raw.id || raw.key || '').trim();
        if (!itemId || seen.has(itemId)) continue;
        seen.add(itemId);

        const key = String(raw.key || itemId);
        const monthlyCost = Number(raw.monthlyCost);
        const monthlyUsageFactor = Number(raw.monthlyUsageFactor);
        const sharePct = Number(raw.sharePct);
        columns.push({
            key,
            itemId,
            label: String(raw.label || raw.name || itemId),
            unit: String(raw.unit || ''),
            description: String(raw.description || raw.name || itemId),
            monthlyCost: Number.isFinite(monthlyCost) ? monthlyCost : null,
            monthlyUsageFactor: Number.isFinite(monthlyUsageFactor) && monthlyUsageFactor > 0
                ? monthlyUsageFactor
                : null,
            sharePct: Number.isFinite(sharePct) ? sharePct : null,
            dynamic: true
        });
    }

    return columns.length > 0 ? columns : makeDefaultColumns();
}

function benchmarkLabelForItem(item) {
    if (!item || typeof item !== 'object') return '';
    const mapped = BENCHMARK_ITEM_LABELS_FOR_UI[item.id];
    if (mapped) return mapped;

    switch (item.dashboardResource) {
        case 'CPU': return 'CPU';
        case 'GPU': return 'GPU';
        case 'RAM': return 'RAM';
        case 'SSD': return 'SSD';
        case 'HDD': return 'HDD';
        case 'S3':  return 'Объектное';
        default:    return item.name || item.id || '';
    }
}

function priceUnitForItem(item) {
    const unit = String(item?.unit || 'ед.').trim() || 'ед.';
    const interval = item?.billingInterval;
    if (interval === 'oneTime') return `₽/${unit}`;
    return `₽/${unit}/${BILLING_INTERVAL_UNIT_LABELS[interval] || 'мес'}`;
}

/**
 * Построить колонки Прайс-бенчмарка из конкретного расчёта: top-N ЭК по
 * месячному вкладу на всём расчётном горизонте. monthlyUsageFactor — это
 * «взвешенное количество в месяц»: qty × интервальный множитель × риски × НДС.
 * Умножая его на цену другого провайдера, получаем практическое влияние этой
 * цены на текущий расчёт, а не абстрактный unit-price.
 */
export function buildProviderBenchmarkItems(calculation, result, { limit = PROVIDER_BENCHMARK_TOP_LIMIT } = {}) {
    const rawItems = Array.isArray(calculation?.dictionaries?.items)
        ? calculation.dictionaries.items
        : [];
    const providerId = calculation?.settings?.provider || DEFAULT_PROVIDER;
    const items = calculation?.providerVersion
        ? rawItems
        : applyProviderOverlay(rawItems, providerId);
    const itemResults = result?.items && typeof result.items === 'object'
        ? result.items
        : {};
    const totalMonthly = Number(result?.totalMonthly) || 0;
    const n = Number.isInteger(limit) && limit > 0 ? limit : PROVIDER_BENCHMARK_TOP_LIMIT;

    return items
        .map(item => {
            const monthlyCost = Number(itemResults[item.id]?.totalMonthly) || 0;
            const price = Number(item.pricePerUnit);
            const monthlyUsageFactor = Number.isFinite(price) && price > 0 && monthlyCost > 0
                ? monthlyCost / price
                : null;
            return {
                key: item.id,
                itemId: item.id,
                label: benchmarkLabelForItem(item),
                name: item.name || item.id,
                unit: priceUnitForItem(item),
                description: item.name || item.id,
                category: item.category || '',
                monthlyCost,
                monthlyUsageFactor,
                sharePct: totalMonthly > 0 ? (monthlyCost / totalMonthly) * 100 : null
            };
        })
        .filter(item => item.monthlyCost > 0 && Number.isFinite(item.monthlyUsageFactor))
        .sort((a, b) => (b.monthlyCost - a.monthlyCost)
            || String(a.label).localeCompare(String(b.label), 'ru'))
        .slice(0, n);
}

function buildProviderTrustMatrix(providerIds, effMap) {
    const providers = [];
    for (const id of providerIds) {
        const overlay = PROVIDER_OVERLAYS[id];
        if (!overlay || !overlay.active) continue;

        const frozenPrices = overlay.prices || {};
        const effectivePrices = effMap[id] || frozenPrices;
        const byCapability = {};
        for (const capability of PROVIDER_TRUST_MATRIX_CAPABILITIES) {
            byCapability[capability.key] = getProviderCapabilityTrust({
                providerId: id,
                itemIds: capability.itemIds,
                effectivePrices,
                frozenPrices
            });
        }

        providers.push({
            id,
            label: overlay.label,
            priceMeta: getProviderPriceBundleMeta(id),
            warnings: getProviderPriceWarnings(id),
            byCapability
        });
    }
    return {
        capabilities: [...PROVIDER_TRUST_MATRIX_CAPABILITIES],
        providers
    };
}

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
export function aggregateProviderPrices(providerIds, effectivePricesByProvider, benchmarkItems = null) {
    const columns = normalizeBenchmarkColumns(benchmarkItems);
    const categories = columns.map(c => c.key);
    const categoryMeta = Object.fromEntries(columns.map(c => [c.key, {
        key: c.key,
        itemId: c.itemId,
        label: c.label,
        unit: c.unit,
        description: c.description,
        monthlyCost: c.monthlyCost,
        sharePct: c.sharePct,
        dynamic: c.dynamic
    }]));
    const hasDynamicImpact = columns.some(c => Number.isFinite(c.monthlyUsageFactor));

    if (!Array.isArray(providerIds)) {
        return {
            providers: [],
            categories,
            categoryMeta,
            trustMatrix: { capabilities: [...PROVIDER_TRUST_MATRIX_CAPABILITIES], providers: [] }
        };
    }
    const effMap = (effectivePricesByProvider && typeof effectivePricesByProvider === 'object')
        ? effectivePricesByProvider : {};

    const providers = [];
    const trustMatrix = buildProviderTrustMatrix(providerIds, effMap);

    for (const id of providerIds) {
        const overlay = PROVIDER_OVERLAYS[id];
        if (!overlay || !overlay.active) continue;

        const frozenPrices = overlay.prices || {};
        const effectivePrices = effMap[id] || frozenPrices;

        const byCategory = {};
        let totalCost = 0;

        for (const column of columns) {
            const cat = column.key;
            const itemId = column.itemId;
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

            const monthlyImpact = (eff !== null && Number.isFinite(column.monthlyUsageFactor))
                ? eff * column.monthlyUsageFactor
                : null;

            byCategory[cat] = {
                effective: eff,
                frozen: fro,
                deltaPct,
                monthlyImpact,
                trust: getProviderPriceTrust({
                    providerId: id,
                    itemId,
                    effectiveEntry,
                    frozenEntry
                })
            };
            if (hasDynamicImpact) {
                if (monthlyImpact !== null) totalCost += monthlyImpact;
            } else if (eff !== null) {
                totalCost += eff;
            }
        }

        providers.push({
            id,
            label: overlay.label,
            active: overlay.active,
            byCategory,
            priceMeta: getProviderPriceBundleMeta(id),
            warnings: getProviderPriceWarnings(id),
            totalCost
        });
    }

    return { providers, categories, categoryMeta, trustMatrix };
}
