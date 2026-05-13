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

/** YYYY-MM-DD из Date через явные геттеры (без toISOString().slice — запрещено линтером). */
function isoDateOnly(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/* ============================================================
 * Известные синонимы заголовков и алиасы наименований
 * ============================================================ */

/** Возможные имена колонки с идентификатором ЭК (приоритет). */
const ID_KEYS = ['id'];

/** Возможные имена колонки с названием ЭК (БЕЗ 'id' — name+id могут жить в одной строке). */
const NAME_KEYS = ['name', 'service', 'service_name', 'title', 'item',
    'product', 'наименование', 'название', 'сервис'];

/** Возможные имена колонки с ценой. */
const PRICE_KEYS = ['pricePerUnit', 'price', 'value', 'amount', 'cost',
    'цена', 'стоимость', 'тариф'];

/** Возможные имена колонки с категорией. */
const CATEGORY_KEYS = ['category', 'group', 'категория', 'группа'];

/** Возможные имена колонки с единицей измерения. */
const UNIT_KEYS = ['unit', 'interval', 'period', 'единица', 'период'];

/** Возможные имена колонки с поставщиком. */
const VENDOR_KEYS = ['vendor', 'provider', 'поставщик', 'производитель'];

/** Возможные имена колонки с ссылкой на источник цены (URL/документ). */
const PRICE_SOURCE_KEYS = ['priceSource', 'price_source', 'source', 'источник',
    'ссылка', 'url'];

/**
 * Известные алиасы наименований → internal item id. Расширяемый словарь:
 * новые синонимы добавлять в same shape (label → itemId). Сравнение
 * case-insensitive после normalize().
 */
export const KNOWN_ALIASES = Object.freeze({
    // CPU
    'vcpu shared':          'cpu-vcpu-shared',
    'cpu vcore':            'cpu-vcpu-shared',
    'cpu shared':           'cpu-vcpu-shared',
    'shared vcpu':          'cpu-vcpu-shared',
    'vcpu dedicated':       'cpu-vcpu-dedicated',
    'cpu dedicated':        'cpu-vcpu-dedicated',
    'dedicated vcpu':       'cpu-vcpu-dedicated',
    'gpu':                  'cpu-vcpu-gpu',
    'gpu vcpu':             'cpu-vcpu-gpu',
    'gpu compute':          'cpu-vcpu-gpu',
    // RAM
    'ram':                  'ram-gb',
    'ram 1 gb':             'ram-gb',
    'memory':               'ram-gb',
    'оперативная память':   'ram-gb',
    // Storage
    'ssd':                  'storage-ssd-tb',
    'ssd storage':          'storage-ssd-tb',
    'storage ssd':          'storage-ssd-tb',
    'hdd':                  'storage-hdd-tb',
    'hdd storage':          'storage-hdd-tb',
    'storage hdd':          'storage-hdd-tb',
    'object storage':       'storage-object-tb',
    's3':                   'storage-object-tb',
    's3 storage':           'storage-object-tb',
    'хранилище объектов':   'storage-object-tb',
    // Network
    'load balancer':        'network-lb-l7',
    'lb l7':                'network-lb-l7',
    'l7 load balancer':     'network-lb-l7',
    'балансировщик':        'network-lb-l7',
    'waf':                  'network-waf',
    'web application firewall': 'network-waf',
    // License
    'db license':           'license-db-per-vcpu',
    'database license':     'license-db-per-vcpu',
    'os license':           'license-os-per-node',
    'siem':                 'license-siem-edr-per-node',
    'edr':                  'license-siem-edr-per-node',
    'siem edr':             'license-siem-edr-per-node',
    // Services
    'email':                'service-email-per-1k',
    'email service':        'service-email-per-1k',
    'sms':                  'service-sms-per-1k',
    'sms service':          'service-sms-per-1k'
});

/* ============================================================
 * String utilities
 * ============================================================ */

/** Нормализация строки: lowercase, trim, схлопывание пробелов и пунктуации. */
function normalize(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .toLowerCase()
        .trim()
        .replace(/[._/\-,;:!?()]+/g, ' ')
        .replace(/\s+/g, ' ');
}

/** Токенизация для overlap-метрики. Слова длиной ≥ 2. */
function tokenize(s) {
    return normalize(s).split(' ').filter(t => t.length >= 2);
}

/** Jaccard-overlap двух массивов токенов. */
function jaccard(a, b) {
    const setA = new Set(a);
    const setB = new Set(b);
    if (setA.size === 0 || setB.size === 0) return 0;
    let inter = 0;
    for (const t of setA) if (setB.has(t)) inter++;
    const union = setA.size + setB.size - inter;
    return union === 0 ? 0 : inter / union;
}

/** Парсер числа с RU-локалью (запятая) и пробелами-разделителями. */
function parseNum(value) {
    if (value === null || value === undefined) return NaN;
    if (typeof value === 'number') return value;
    const cleaned = String(value).replace(/\s+/g, '').replace(',', '.');
    if (cleaned === '') return NaN;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : NaN;
}

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * Определяет форму распарсенных данных.
 *
 * @param {*} parsed — результат JSON.parse() или parseCsv().rows wrapper.
 * @returns {'provider-json' | 'json-array' | 'unknown'}
 */
export function detectShape(parsed) {
    if (!parsed || typeof parsed !== 'object') return 'unknown';
    if (Array.isArray(parsed)) return parsed.length > 0 ? 'json-array' : 'unknown';
    if (parsed.schemaVersion === 1 && typeof parsed.providerId === 'string'
            && parsed.prices && typeof parsed.prices === 'object') {
        return 'provider-json';
    }
    return 'unknown';
}

/**
 * Нормализует массив строк (из CSV или JSON-array) в единый формат с детектом
 * полей. Возвращает массив NormalizedRow:
 *
 *   {
 *     rowId: string,
 *     raw: object,
 *     sourceId:    string | null,
 *     sourceName:  string | null,
 *     sourceCategory: string | null,
 *     sourceUnit:  string | null,
 *     sourceVendor: string | null,
 *     sourcePriceSource: string | null,
 *     price: number | null,
 *     detectedFields: { nameKey, priceKey, idKey, ... }
 *   }
 *
 * Строки без распознанной цены остаются с price=null — caller решает,
 * показывать ли их в mapping-таблице.
 */
export function normalizeRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map((raw, idx) => normalizeOne(raw, idx));
}

function normalizeOne(raw, idx) {
    const rowId = `row-${idx + 1}`;
    if (!raw || typeof raw !== 'object') {
        return {
            rowId, raw,
            sourceId: null, sourceName: null,
            sourceCategory: null, sourceUnit: null,
            sourceVendor: null, sourcePriceSource: null,
            price: null,
            detectedFields: {}
        };
    }
    const detectedFields = {};
    const idKey       = pickKey(raw, ID_KEYS);
    const nameKey     = pickKey(raw, NAME_KEYS);
    const priceKey    = pickKey(raw, PRICE_KEYS);
    const categoryKey = pickKey(raw, CATEGORY_KEYS);
    const unitKey     = pickKey(raw, UNIT_KEYS);
    const vendorKey   = pickKey(raw, VENDOR_KEYS);
    const sourceKey   = pickKey(raw, PRICE_SOURCE_KEYS);
    if (idKey) detectedFields.idKey = idKey;
    if (nameKey) detectedFields.nameKey = nameKey;
    if (priceKey) detectedFields.priceKey = priceKey;
    if (categoryKey) detectedFields.categoryKey = categoryKey;
    if (unitKey) detectedFields.unitKey = unitKey;
    if (vendorKey) detectedFields.vendorKey = vendorKey;
    if (sourceKey) detectedFields.sourceKey = sourceKey;

    const sourceId = idKey ? String(raw[idKey] || '').trim() || null : null;
    const sourceName = nameKey ? String(raw[nameKey] || '').trim() || null : null;
    const price = priceKey ? parseNum(raw[priceKey]) : NaN;

    return {
        rowId,
        raw,
        sourceId,
        sourceName,
        sourceCategory: categoryKey ? String(raw[categoryKey] || '').trim() || null : null,
        sourceUnit: unitKey ? String(raw[unitKey] || '').trim() || null : null,
        sourceVendor: vendorKey ? String(raw[vendorKey] || '').trim() || null : null,
        sourcePriceSource: sourceKey ? String(raw[sourceKey] || '').trim() || null : null,
        price: Number.isFinite(price) ? price : null,
        detectedFields
    };
}

/** Найти первый ключ объекта, чьё имя совпадает (case-insensitive) с одним из candidates. */
function pickKey(obj, candidates) {
    const keys = Object.keys(obj);
    const norm = new Map(keys.map(k => [k.toLowerCase().trim(), k]));
    for (const c of candidates) {
        const hit = norm.get(c.toLowerCase());
        if (hit !== undefined) return hit;
    }
    return null;
}

/* ============================================================
 * Suggest mappings — auto-match rows к internal items
 * ============================================================ */

/**
 * Для каждой нормализованной строки предлагает internal item id с уровнем
 * уверенности. Возвращает Map<rowId, { itemId, confidence, reason }> | null
 * (если совпадений нет).
 *
 * Правила:
 *   high   — exact id match | exact alias match | exact name match (нормализованный)
 *   medium — token overlap ≥ 0.5 + same category/unit hint
 *   low    — token overlap ≥ 0.3
 *   none   — ниже порога (rowId не попадает в результат)
 *
 * @param {Array} normalizedRows — результат normalizeRows()
 * @param {Array<{ id, name, category? }>} knownItems — список internal ЭК
 * @returns {Object} map rowId → suggestion
 */
export function suggestItemMappings(normalizedRows, knownItems) {
    const result = {};
    if (!Array.isArray(normalizedRows) || !Array.isArray(knownItems)) return result;
    if (knownItems.length === 0) return result;

    // Индексы для быстрого matching
    const itemById   = new Map(knownItems.map(it => [it.id, it]));
    const itemByName = new Map(knownItems.map(it => [normalize(it.name || ''), it]));
    const itemTokens = knownItems.map(it => ({
        item: it,
        tokens: tokenize(`${it.name || ''} ${it.category || ''}`)
    }));

    for (const row of normalizedRows) {
        const sug = suggestForRow(row, itemById, itemByName, itemTokens);
        if (sug && sug.confidence !== 'none') {
            result[row.rowId] = sug;
        }
    }
    return result;
}

function suggestForRow(row, itemById, itemByName, itemTokens) {
    // 1. Exact id match
    if (row.sourceId && itemById.has(row.sourceId)) {
        return { itemId: row.sourceId, confidence: 'high', reason: 'exact-id' };
    }
    // 2. Exact alias match
    const candidate = row.sourceName || row.sourceId;
    if (candidate) {
        const aliasKey = normalize(candidate);
        const aliased = KNOWN_ALIASES[aliasKey];
        if (aliased && itemById.has(aliased)) {
            return { itemId: aliased, confidence: 'high', reason: 'alias' };
        }
    }
    // 3. Exact name match (normalized)
    if (candidate) {
        const nameKey = normalize(candidate);
        const namedItem = itemByName.get(nameKey);
        if (namedItem) {
            return { itemId: namedItem.id, confidence: 'high', reason: 'exact-name' };
        }
    }
    // 4. Token overlap
    const rowTokens = tokenize(`${row.sourceName || ''} ${row.sourceCategory || ''} ${row.sourceUnit || ''}`);
    if (rowTokens.length === 0) {
        return { itemId: null, confidence: 'none', reason: 'no-tokens' };
    }
    let best = { itemId: null, score: 0 };
    for (const { item, tokens } of itemTokens) {
        if (tokens.length === 0) continue;
        const score = jaccard(rowTokens, tokens);
        if (score > best.score) {
            best = { itemId: item.id, score };
        }
    }
    if (best.score >= 0.5) {
        return { itemId: best.itemId, confidence: 'medium', reason: `token-overlap-${best.score.toFixed(2)}` };
    }
    if (best.score >= 0.3) {
        return { itemId: best.itemId, confidence: 'low', reason: `token-overlap-${best.score.toFixed(2)}` };
    }
    return { itemId: null, confidence: 'none', reason: 'no-match' };
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
