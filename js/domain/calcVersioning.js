/**
 * Stage 8.3: pure domain helpers для версионирования calc'ов относительно
 * текущего provider price override.
 *
 * Маркер «calc применил какой-то override» — поле `calc.providerVersion`:
 *   { id, version, timestamp } | null
 *
 * Если поле отсутствует / null — calc работает на frozen-default ценах
 * провайдера (через `applyProviderOverlay` в calculator.js).
 *
 * Если поле есть — calc.dictionaries.items уже содержит actual prices
 * (применён snapshot эффективных цен на момент `applyNewProviderPrices`).
 * calculator пропускает `applyProviderOverlay` для таких calc'ов, чтобы
 * frozen-overlay не перезатёр сохранённые цены поверх override.
 */

/**
 * @param {Object} calc — расчёт (может содержать calc.providerVersion).
 * @param {string|null} latestVersion — текущая последняя version применённого
 *   override для провайдера calc'а (или null если override отсутствует).
 * @returns {boolean} — true если calc устарел относительно latest и
 *   требует пересчёта на новых ценах.
 */
export function isCalcStale(calc, latestVersion) {
    if (latestVersion === null || latestVersion === undefined) return false;
    const calcVer = calc?.providerVersion?.version;
    if (!calcVer) return true;
    return calcVer !== latestVersion;
}

/**
 * Применить эффективные цены к items. Pure: возвращает НОВЫЙ массив с НОВЫМИ
 * объектами. Item без записи в effectivePrices сохраняется без изменений.
 *
 * @param {Array<Object>} items — calc.dictionaries.items.
 * @param {Object<string, { pricePerUnit, vendor, priceSource }>} effectivePrices.
 * @returns {Array<Object>} — новый массив items.
 */
export function applyOverrideToItems(items, effectivePrices) {
    if (!Array.isArray(items)) return [];
    if (!effectivePrices || typeof effectivePrices !== 'object') return items.map(i => ({ ...i }));
    return items.map(item => {
        const override = effectivePrices[item.id];
        if (!override) return { ...item };
        /* Внешний аудит #3 (2026-05-18, P1): сырой priceSource из overlay
         * (`cloud.ru/2026-Q3-test`, `yandex.cloud/pricing` и т.п.) — это
         * vendor-specific marker документа, валидатор его не пропускает
         * (whitelist: manual | csv | seed | provider). Нормализуем к 'provider'
         * для контракта валидатора; оригинальный label кладём в priceSourceRef
         * (опциональное поле для UI tooltip'а). */
        const { priceSource: overlayRef, ...overrideRest } = override;
        return {
            ...item,
            ...overrideRest,
            priceSource: 'provider',
            ...(overlayRef ? { priceSourceRef: String(overlayRef) } : {})
        };
    });
}

/**
 * Подсчитать дельты цен между старым и новым набором items. Возвращает
 * только записи с изменённой ценой; ЭК с одинаковой ценой пропускаются.
 *
 * @param {Array<{id, pricePerUnit}>} oldItems
 * @param {Array<{id, pricePerUnit}>} newItems
 * @returns {Array<{ id, oldPrice, newPrice, delta, deltaPct }>}
 */
export function computePriceDeltas(oldItems, newItems) {
    if (!Array.isArray(oldItems) || !Array.isArray(newItems)) return [];
    const newById = new Map(newItems.map(i => [i.id, i]));
    const deltas = [];
    for (const oldItem of oldItems) {
        const newItem = newById.get(oldItem.id);
        if (!newItem) continue;
        const oldPrice = Number(oldItem.pricePerUnit);
        const newPrice = Number(newItem.pricePerUnit);
        if (!Number.isFinite(oldPrice) || !Number.isFinite(newPrice)) continue;
        if (oldPrice === newPrice) continue;
        const delta = newPrice - oldPrice;
        const deltaPct = oldPrice !== 0 ? (delta / oldPrice) * 100 : 0;
        deltas.push({ id: oldItem.id, oldPrice, newPrice, delta, deltaPct });
    }
    return deltas;
}

/**
 * Построить calc.providerVersion из applied override JSON. Используется при
 * `applyNewProviderPrices` для записи маркера «applied this version».
 *
 * @param {Object|null} override — applied JSON (см. validateProviderPriceJson).
 * @returns {{ id, version, timestamp } | null}
 */
export function makeProviderVersionFromOverride(override) {
    if (!override || typeof override !== 'object') return null;
    const { providerId, version, timestamp } = override;
    if (!providerId || !version || !timestamp) return null;
    return { id: providerId, version, timestamp };
}

/**
 * Stage 8.5: суммировать массив деталей дельт в один объект статистики.
 * Используется для post-update report'а в UI.
 *
 * @param {Array<{ id, oldPrice, newPrice, delta, deltaPct }>} deltas
 * @returns {{
 *   total: number,         // всего изменений
 *   ups: number,           // подорожало
 *   downs: number,         // подешевело
 *   maxUpPct: number,      // максимальный % роста (0 если нет ups)
 *   maxDownPct: number,    // минимальный % (отрицательный) — самое сильное падение
 *   avgPct: number         // средний % изменения
 * }}
 */
export function summarizeDeltas(deltas) {
    if (!Array.isArray(deltas) || deltas.length === 0) {
        return { total: 0, ups: 0, downs: 0, maxUpPct: 0, maxDownPct: 0, avgPct: 0 };
    }
    let ups = 0, downs = 0, maxUpPct = 0, maxDownPct = 0, sumPct = 0;
    for (const d of deltas) {
        if (d.delta > 0) ups++;
        else if (d.delta < 0) downs++;
        if (d.deltaPct > maxUpPct) maxUpPct = d.deltaPct;
        if (d.deltaPct < maxDownPct) maxDownPct = d.deltaPct;
        sumPct += d.deltaPct;
    }
    return {
        total: deltas.length,
        ups, downs,
        maxUpPct,
        maxDownPct,
        avgPct: sumPct / deltas.length
    };
}

/**
 * Stage 8.5: получить top-N дельт по абсолютной величине % изменения.
 * Используется для показа «самые крупные изменения цены» в UI report.
 *
 * @param {Array<{ id, oldPrice, newPrice, delta, deltaPct }>} deltas
 * @param {number} [n=3]
 * @returns {Array} sorted by |deltaPct| desc.
 */
export function topDeltasByAbsPct(deltas, n = 3) {
    if (!Array.isArray(deltas)) return [];
    return [...deltas]
        .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
        .slice(0, n);
}

/**
 * Stage 10.3: считать разницу между двумя prices-map'ами (как в applied
 * override JSON: `prices: { id: { pricePerUnit, ... } }`).
 *
 * Используется в DeltaHistoryPanel для показа «было → стало» каждой
 * исторической точки. Threshold 0.1% игнорим как float-шум.
 *
 * @param {Object<string, {pricePerUnit:number}> | null} oldPrices
 * @param {Object<string, {pricePerUnit:number}> | null} newPrices
 * @returns {{
 *   itemsChanged: number,
 *   itemsAdded:   number,
 *   itemsRemoved: number,
 *   deltas: Array<{id, oldPrice, newPrice, deltaPct, direction: 'up'|'down'|'same'}>,
 *   topUp:   Array<{id, deltaPct}>,
 *   topDown: Array<{id, deltaPct}>
 * }}
 */
export function computePricesDelta(oldPrices, newPrices) {
    const empty = {
        itemsChanged: 0, itemsAdded: 0, itemsRemoved: 0,
        deltas: [], topUp: [], topDown: []
    };
    const o = (oldPrices && typeof oldPrices === 'object') ? oldPrices : {};
    const n = (newPrices && typeof newPrices === 'object') ? newPrices : {};

    const oldIds = new Set(Object.keys(o));
    const newIds = new Set(Object.keys(n));

    let itemsAdded = 0, itemsRemoved = 0, itemsChanged = 0;
    const deltas = [];

    for (const id of newIds) {
        if (!oldIds.has(id)) { itemsAdded++; continue; }
        const oldPrice = Number(o[id]?.pricePerUnit);
        const newPrice = Number(n[id]?.pricePerUnit);
        if (!Number.isFinite(oldPrice) || !Number.isFinite(newPrice)) continue;
        if (oldPrice === 0) {
            /* Защита: при oldPrice=0 deltaPct = Infinity. Пропускаем как
               невычислимый — UI на это не рассчитан. */
            continue;
        }
        const deltaPct = ((newPrice - oldPrice) / oldPrice) * 100;
        if (Math.abs(deltaPct) < 0.1) continue; // float-шум
        const direction = deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'same';
        itemsChanged++;
        deltas.push({ id, oldPrice, newPrice, deltaPct, direction });
    }
    for (const id of oldIds) {
        if (!newIds.has(id)) itemsRemoved++;
    }

    const ups = deltas.filter(d => d.direction === 'up')
        .sort((a, b) => b.deltaPct - a.deltaPct);
    const downs = deltas.filter(d => d.direction === 'down')
        .sort((a, b) => a.deltaPct - b.deltaPct);

    return {
        itemsChanged, itemsAdded, itemsRemoved, deltas,
        topUp:   ups.slice(0, 3).map(d => ({ id: d.id, deltaPct: d.deltaPct })),
        topDown: downs.slice(0, 3).map(d => ({ id: d.id, deltaPct: d.deltaPct }))
    };
}
