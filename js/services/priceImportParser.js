/**
 * Stage 16.2 (PATCH 2.9.1) — Price Import Parser.
 *
 * Тонкий слой над FileReader / parseCsv / JSON.parse. Распознаёт расширение,
 * читает файл, отдаёт нормализованный результат:
 *
 *   { ok: true, kind: 'csv', rows, headers, fileName }
 *   { ok: true, kind: 'json-array', rows, fileName }
 *   { ok: true, kind: 'provider-json', data, fileName }
 *   { ok: false, reason, message }
 *
 * reason: extension | size | parse | empty | shape | read.
 *
 * НЕ применяет файл, НЕ валидирует против provider schema. Caller
 * (priceImportMappingController) делает следующие шаги: detectShape →
 * normalizeRows → suggestItemMappings → ... → buildProviderPriceJson →
 * validateProviderPriceJson → save.
 */

import {
    CSV_IMPORT_MAX_BYTES,
    JSON_IMPORT_MAX_BYTES,
    PROVIDER_PRICE_SCHEMA_VERSION
} from '../utils/constants.js';
import { parseCsv } from './csvImport.js';

/** Максимум строк для preview/mapping — защита от случайного загрузки 10MB-CSV. */
export const PRICE_IMPORT_MAX_ROWS = 1000;

/**
 * Прочитать файл и определить kind.
 *
 * @param {File} file
 * @returns {Promise<{ ok: true, kind, rows?, headers?, data?, fileName }
 *                 | { ok: false, reason, message }>}
 */
export async function readPriceImportFile(file) {
    if (!file) return { ok: false, reason: 'read', message: 'Файл не выбран.' };
    const name = file.name || '';
    const ext = name.split('.').pop().toLowerCase();
    if (ext !== 'csv' && ext !== 'json' && ext !== 'txt') {
        return {
            ok: false, reason: 'extension',
            message: 'Поддерживаются только CSV и JSON. Расширение: .' + ext
        };
    }
    const isJson = ext === 'json';
    const limit = isJson ? JSON_IMPORT_MAX_BYTES : CSV_IMPORT_MAX_BYTES;
    if (file.size > limit) {
        const limitMb = Math.round(limit / 1024 / 1024);
        return {
            ok: false, reason: 'size',
            message: `Файл слишком большой (> ${limitMb} МБ).`
        };
    }

    let text;
    try {
        text = await readAsText(file);
    } catch (e) {
        return { ok: false, reason: 'read', message: e.message || 'Ошибка чтения файла.' };
    }
    text = stripBom(text);
    if (!text || !text.trim()) {
        return { ok: false, reason: 'empty', message: 'Файл пустой.' };
    }

    if (isJson) return parseJsonContent(text, name);
    return parseCsvContent(text, name);
}

/* ============================================================
 * Internal: parsers
 * ============================================================ */

function parseCsvContent(text, fileName) {
    let parsed;
    try {
        parsed = parseCsv(text);
    } catch (e) {
        return {
            ok: false, reason: 'parse',
            message: 'Не удалось распарсить CSV: ' + (e.message || String(e))
        };
    }
    const { rows, headers, delimiter } = parsed;
    if (!rows || rows.length === 0) {
        return { ok: false, reason: 'empty', message: 'CSV не содержит строк данных.' };
    }
    if (rows.length > PRICE_IMPORT_MAX_ROWS) {
        return {
            ok: false, reason: 'size',
            message: `Слишком много строк (${rows.length} > ${PRICE_IMPORT_MAX_ROWS}). ` +
                'Разделите файл на части.'
        };
    }
    return { ok: true, kind: 'csv', rows, headers, delimiter, fileName };
}

function parseJsonContent(text, fileName) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        return {
            ok: false, reason: 'parse',
            message: 'Невалидный JSON: ' + (e.message || String(e))
        };
    }

    /* Provider-JSON shape: schemaVersion=1 (legacy) ИЛИ
     * PROVIDER_PRICE_SCHEMA_VERSION (текущая, =2 после Stage VAT-2 Phase 1).
     * Внешний аудит 2026-05-18 (P2-1): раньше принимался только ===1, и
     * актуальный v2-прайс (например, сгенерированный provider-bundled-pipeline)
     * через этот импорт отвергался как 'shape'. validateProviderPriceJson
     * принимает оба schemaVersion'а, parser обязан быть консистентен. */
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            && (parsed.schemaVersion === 1 || parsed.schemaVersion === PROVIDER_PRICE_SCHEMA_VERSION)
            && typeof parsed.providerId === 'string'
            && parsed.prices && typeof parsed.prices === 'object') {
        return { ok: true, kind: 'provider-json', data: parsed, fileName };
    }

    // Plain JSON array
    if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
            return { ok: false, reason: 'empty', message: 'JSON-массив пустой.' };
        }
        if (parsed.length > PRICE_IMPORT_MAX_ROWS) {
            return {
                ok: false, reason: 'size',
                message: `Слишком много элементов (${parsed.length} > ${PRICE_IMPORT_MAX_ROWS}).`
            };
        }
        // Все элементы должны быть объектами
        for (let i = 0; i < parsed.length; i++) {
            if (!parsed[i] || typeof parsed[i] !== 'object' || Array.isArray(parsed[i])) {
                return {
                    ok: false, reason: 'shape',
                    message: `Элемент ${i} не является объектом — ожидается массив объектов.`
                };
            }
        }
        return { ok: true, kind: 'json-array', rows: parsed, fileName };
    }

    return {
        ok: false, reason: 'shape',
        message: `JSON должен быть массивом объектов или provider-JSON со schemaVersion=1 либо ${PROVIDER_PRICE_SCHEMA_VERSION}.`
    };
}

/* ============================================================
 * Helpers
 * ============================================================ */

function readAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('FileReader error'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsText(file, 'utf-8');
    });
}

function stripBom(s) {
    return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

/**
 * Удобный helper для unit-тестов: распарсить CSV-string напрямую (без File).
 * Возвращает тот же контракт, что readPriceImportFile.
 */
export function parsePriceImportText(text, kind, fileName = 'inline') {
    if (kind === 'csv') return parseCsvContent(stripBom(text), fileName);
    if (kind === 'json') return parseJsonContent(stripBom(text), fileName);
    return { ok: false, reason: 'parse', message: 'Unknown kind: ' + kind };
}
