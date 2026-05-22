/**
 * Stage 16.2 (PATCH 2.9.1) — Price Import Mapping Assistant.
 *
 * Pure-domain логика. Без DOM, store, services, fetch. Принимает уже распарсенные
 * данные (CSV-rows или JSON-array) и помогает сопоставить произвольные строки
 * с внутренними ЭК.
 *
 * Pipeline:
 *   1. detectShape(parsed)        → 'provider-json' | 'json-array' | 'unknown'
 *   2. normalizeRows(rows)        → массив NormalizedRow с детектом полей
 *   3. suggestItemMappings()      → { rowId → { itemId, confidence, reason } }
 *   4. validatePriceMappings()    → { ok, errors, warnings }
 *   5. buildProviderPriceJson()   → { ok, data | reason, message }
 *
 * Final apply делает controller через существующие primitives
 * (validateProviderPriceJson + saveProviderOverride + pushProviderOverrideHistory).
 *
 * НЕ дублирует csvImport.js: тот flow для CSV с готовыми internal ID
 * (id;pricePerUnit). Stage 16.2 — для CSV/JSON БЕЗ internal ID, где требуется
 * mapping assistant.
 */

import { VALIDATION } from '../utils/constants.js';

export {
    KNOWN_ALIASES,
    detectShape,
    normalizeRows
} from './priceImportMappingRows.js';
export { suggestItemMappings } from './priceImportMappingSuggest.js';

/** YYYY-MM-DD из Date через явные геттеры (без toISOString().slice — запрещено линтером). */
function isoDateOnly(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/* ============================================================
 * Validate mappings
 * ============================================================ */

/**
 * Валидирует mappings перед сборкой provider JSON.
 *
 * @param {Object} mappings — { [rowId]: itemId } (явно подтверждённый mapping)
 * @param {Array} normalizedRows — результат normalizeRows()
 * @param {Array<{id}>} knownItems
 * @returns {{ ok: boolean, errors: Array<{rowId?, itemId?, reason, message}>,
 *             warnings: Array<{rowId?, message}> }}
 */
export function validatePriceMappings(mappings, normalizedRows, knownItems) {
    const errors = [];
    const warnings = [];
    if (!mappings || typeof mappings !== 'object') {
        errors.push({ reason: 'no-mappings', message: 'Mappings не заданы.' });
        return { ok: false, errors, warnings };
    }
    if (!Array.isArray(normalizedRows)) {
        errors.push({ reason: 'no-rows', message: 'Строки не заданы.' });
        return { ok: false, errors, warnings };
    }
    const itemIds = new Set((knownItems || []).map(it => it.id));
    const rowsById = new Map(normalizedRows.map(r => [r.rowId, r]));

    // Per-row checks
    const usedItemIds = new Map(); // itemId → [rowId] (для обнаружения duplicates)
    let mappedCount = 0;
    for (const [rowId, itemId] of Object.entries(mappings)) {
        if (!itemId) continue;
        mappedCount++;
        const row = rowsById.get(rowId);
        if (!row) {
            errors.push({ rowId, reason: 'unknown-row', message: `Строка ${rowId} не найдена.` });
            continue;
        }
        if (!itemIds.has(itemId)) {
            errors.push({ rowId, itemId, reason: 'unknown-item',
                message: `ЭК «${itemId}» не существует в текущем справочнике.` });
            continue;
        }
        // price validation
        if (row.price === null || !Number.isFinite(row.price)) {
            errors.push({ rowId, itemId, reason: 'invalid-price',
                message: `Цена не распознана как число.` });
            continue;
        }
        if (row.price <= 0) {
            errors.push({ rowId, itemId, reason: 'invalid-price',
                message: `Цена должна быть > 0 (получено ${row.price}).` });
            continue;
        }
        if (VALIDATION && row.price > VALIDATION.PRICE_MAX) {
            errors.push({ rowId, itemId, reason: 'price-too-high',
                message: `Цена ${row.price} превышает лимит ${VALIDATION.PRICE_MAX}.` });
            continue;
        }
        // duplicates
        const prev = usedItemIds.get(itemId);
        if (prev) prev.push(rowId);
        else usedItemIds.set(itemId, [rowId]);
    }

    // Duplicate mapping check
    for (const [itemId, rows] of usedItemIds.entries()) {
        if (rows.length > 1) {
            errors.push({
                itemId,
                rowIds: rows,
                reason: 'duplicate-mapping',
                message: `${rows.length} строк сопоставлены с одним ЭК «${itemId}». ` +
                    'Оставьте только одну.'
            });
        }
    }

    // Warning: ничего не сопоставлено
    if (mappedCount === 0) {
        warnings.push({ message: 'Ни одна строка не сопоставлена с ЭК.' });
    }

    return { ok: errors.length === 0, errors, warnings };
}

/* ============================================================
 * Build provider JSON
 * ============================================================ */

/**
 * Собирает provider price JSON в формате, который примет
 * validateProviderPriceJson из providerPriceFetch.js.
 *
 * @param {Object} args
 * @param {string} args.providerId
 * @param {string} [args.version]   — например '2026-Q3-import' (default = ISO-дата)
 * @param {string} [args.source]    — описание источника (file name + UI hint)
 * @param {Array} args.normalizedRows
 * @param {Object} args.mappings    — { rowId: itemId }
 * @param {string} [args.defaultVendor]
 * @returns {{ ok: true, data } | { ok: false, reason, message }}
 */
export function buildProviderPriceJson({
    providerId, version, source, normalizedRows, mappings, defaultVendor
}) {
    if (!providerId || typeof providerId !== 'string') {
        return { ok: false, reason: 'invalid-provider', message: 'Не указан providerId.' };
    }
    if (!Array.isArray(normalizedRows) || normalizedRows.length === 0) {
        return { ok: false, reason: 'empty-rows', message: 'Нет строк для сборки JSON.' };
    }
    if (!mappings || typeof mappings !== 'object') {
        return { ok: false, reason: 'no-mappings', message: 'Mappings не заданы.' };
    }

    const rowsById = new Map(normalizedRows.map(r => [r.rowId, r]));
    const prices = {};
    let mappedCount = 0;

    for (const [rowId, itemId] of Object.entries(mappings)) {
        if (!itemId) continue;
        const row = rowsById.get(rowId);
        if (!row || row.price === null || !Number.isFinite(row.price) || row.price <= 0) continue;
        prices[itemId] = {
            pricePerUnit: row.price,
            vendor: row.sourceVendor || defaultVendor || providerId,
            priceSource: row.sourcePriceSource || source || `import-${isoDateOnly()}`
        };
        mappedCount++;
    }

    if (mappedCount === 0) {
        return { ok: false, reason: 'empty-prices', message: 'Не получено ни одной валидной цены.' };
    }

    const data = {
        schemaVersion: 1,
        providerId,
        version: version || `import-${isoDateOnly()}`,
        timestamp: new Date().toISOString(),
        source: source || 'CSV/JSON импорт',
        prices
    };
    return { ok: true, data };
}

/* ============================================================
 * Convenience: full-pipeline summary builder
 * ============================================================ */

/**
 * Возвращает summary текущего state mapping'а: сколько сопоставлено,
 * сколько unmapped, сколько с ошибками. Используется UI в шаге Validate.
 *
 * @param {Array} normalizedRows
 * @param {Object} mappings
 * @param {Object} validationResult — { errors, warnings } из validatePriceMappings
 * @returns {{ total, mapped, unmapped, withErrors, duplicates }}
 */
export function getMappingSummary(normalizedRows, mappings, validationResult) {
    const total = (normalizedRows || []).length;
    const mappedRowIds = new Set(
        Object.entries(mappings || {}).filter(([_, v]) => !!v).map(([k]) => k)
    );
    const errorRowIds = new Set();
    let duplicates = 0;
    if (validationResult && Array.isArray(validationResult.errors)) {
        for (const e of validationResult.errors) {
            if (e.rowId) errorRowIds.add(e.rowId);
            if (Array.isArray(e.rowIds)) e.rowIds.forEach(r => errorRowIds.add(r));
            if (e.reason === 'duplicate-mapping') duplicates++;
        }
    }
    return {
        total,
        mapped: mappedRowIds.size,
        unmapped: total - mappedRowIds.size,
        withErrors: errorRowIds.size,
        duplicates
    };
}
