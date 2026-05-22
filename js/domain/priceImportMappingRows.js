/**
 * Row detection and normalization for Price Import Mapping Assistant.
 * Pure helpers for parsed CSV/JSON-array input; no DOM, store, or persistence.
 */

import { PROVIDER_PRICE_SCHEMA_VERSION } from '../utils/constants.js';

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
export function normalize(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .toLowerCase()
        .trim()
        .replace(/[._/\-,;:!?()]+/g, ' ')
        .replace(/\s+/g, ' ');
}

/** Токенизация для overlap-метрики. Слова длиной ≥ 2. */
export function tokenize(s) {
    return normalize(s).split(' ').filter(t => t.length >= 2);
}

/** Jaccard-overlap двух массивов токенов. */
export function jaccard(a, b) {
    const setA = new Set(a);
    const setB = new Set(b);
    if (setA.size === 0 || setB.size === 0) return 0;
    let inter = 0;
    for (const t of setA) if (setB.has(t)) inter++;
    const union = setA.size + setB.size - inter;
    return union === 0 ? 0 : inter / union;
}

/** Парсер числа с RU-локалью (запятая) и пробелами-разделителями.
 *  Внешний аудит #2 (2026-05-18, P3-2): strict-regex против «100abc» → 100. */
function parseNum(value) {
    if (value === null || value === undefined) return NaN;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const cleaned = String(value).replace(/\s+/g, '').replace(',', '.');
    if (cleaned === '') return NaN;
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
}

/* ============================================================
 * Row shape / normalization API
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
    /* Audit P2-1: detectShape должен принимать оба schemaVersion'а — иначе
     * v2 provider-JSON попадает в 'unknown' и UI mapping-flow начинает
     * предлагать пользователю ручное сопоставление полей для уже
     * структурированного прайса. Парный фикс с priceImportParser.js. */
    if ((parsed.schemaVersion === 1 || parsed.schemaVersion === PROVIDER_PRICE_SCHEMA_VERSION)
            && typeof parsed.providerId === 'string'
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
