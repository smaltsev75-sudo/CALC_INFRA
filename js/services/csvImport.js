/**
 * CSV-импорт цен ЭК.
 *
 * Сценарий: пользователь правит цены в Excel/Numbers/LibreOffice Calc и
 * загружает обновлённый CSV. Импорт обновляет ТОЛЬКО `pricePerUnit` у
 * существующих ЭК, найденных по `id`. Структура и формулы НЕ меняются.
 *
 * Минимальный обязательный формат:
 *   id;pricePerUnit
 *
 * Полный формат (с расширенными колонками — лишние игнорируются):
 *   id;name;vendor;unit;category;resourceClass;billingInterval;pricePerUnit
 *
 * Разделитель: автодетект из первой строки (`;` или `,`).
 * Кодировка: UTF-8 (с BOM или без).
 * Десятичный разделитель в pricePerUnit: `.` или `,` (RU-локаль Excel).
 */

import { pickFile } from './json.js';
import { formatNumber } from './format.js';
import { VALIDATION, COST_TYPE_IDS, CSV_IMPORT_MAX_BYTES } from '../utils/constants.js';

/** Множитель «аномального» скачка цены: новая ≥ 10× старой ИЛИ ≤ 1/10 старой → warning. */
export const ANOMALY_MULTIPLIER = 10;

/**
 * Прочитать CSV-файл и распарсить в массив объектов { <header>: <value>, ... }.
 *
 * @returns Promise<{ rows, headers, delimiter, fileName }>
 * @throws Error при I/O или structural ошибках
 */
export function readCsvFile(file) {
    return new Promise((resolve, reject) => {
        if (!file) return reject(new Error('Файл не выбран'));
        if (file.size > CSV_IMPORT_MAX_BYTES) return reject(new Error('Файл слишком большой (> 5 МБ)'));
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
        reader.onload = () => {
            try {
                const text = stripBom(String(reader.result || ''));
                const { rows, headers, delimiter } = parseCsv(text);
                resolve({ rows, headers, delimiter, fileName: file.name });
            } catch (e) {
                reject(e);
            }
        };
        reader.readAsText(file, 'utf-8');
    });
}

function stripBom(s) {
    return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

/**
 * Парсер CSV, поддерживающий:
 *   - Авто-детект разделителя из первой строки (`;` приоритетнее, иначе `,`).
 *   - Кавычки `"..."` (внутри удвоенная `""` → `"`), CRLF/LF/CR.
 *   - Пустые строки игнорируются.
 *   - Заголовки берутся из первой непустой строки и нормализуются (trim).
 *
 * Возвращает массив объектов: каждая строка — `{ <header>: <value>, ... }`.
 *
 * @throws Error если входной CSV пуст или нет хотя бы одной data-строки.
 */
export function parseCsv(text) {
    if (!text || !text.trim()) throw new Error('Файл пуст');
    const delimiter = detectDelimiter(text);
    const rawRows = tokenize(text, delimiter);
    if (rawRows.length === 0) throw new Error('Не найдены строки CSV');
    const headers = rawRows[0].map(h => h.trim());
    if (headers.length === 0) throw new Error('Не найдены заголовки CSV');
    const dataRows = rawRows.slice(1);
    const rows = dataRows
        .filter(r => r.some(cell => cell.trim() !== ''))
        .map(r => {
            const obj = {};
            for (let i = 0; i < headers.length; i++) {
                obj[headers[i]] = (r[i] ?? '').trim();
            }
            return obj;
        });
    return { rows, headers, delimiter };
}

function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const semi = (firstLine.match(/;/g) || []).length;
    const comma = (firstLine.match(/,/g) || []).length;
    return semi >= comma ? ';' : ',';
}

/**
 * Низкоуровневый токенизатор CSV: возвращает массив строк, каждая строка — массив ячеек.
 * Учитывает кавычки и экранированные кавычки внутри полей.
 */
function tokenize(text, delimiter) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; }
                else inQuotes = false;
            } else {
                cell += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === delimiter) {
                row.push(cell); cell = '';
            } else if (ch === '\n' || ch === '\r') {
                row.push(cell); cell = '';
                rows.push(row); row = [];
                if (ch === '\r' && text[i + 1] === '\n') i++; // CRLF
            } else {
                cell += ch;
            }
        }
    }
    if (cell !== '' || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}

/**
 * Распарсить число из строки, толерантно к RU-локали (запятая) и пробелам.
 * Возвращает число или NaN.
 *
 * Внешний аудит #2 (2026-05-18, P3-2): раньше использовался `parseFloat`,
 * который принимает «100abc» → 100, «12O» (буква О, не цифра 0) → 12 и т.п.
 * Для прайсов это опасно: опечатка в CSV-цене проходит как валидное число
 * без сигнала пользователю. Теперь — strict-regex после нормализации:
 * допускаются только цифры с одним опциональным знаком и опциональной
 * десятичной частью. Любой «хвост» из букв/символов → NaN.
 */
export function parseNumber(value) {
    if (value === null || value === undefined) return NaN;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const cleaned = String(value).replace(/\s+/g, '').replace(',', '.');
    if (cleaned === '') return NaN;
    /* Strict: знак + цифры + опциональная десятичная часть, и ничего больше. */
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
}

/**
 * Применить CSV к каталогу ЭК: обновить pricePerUnit и (опционально) costType по match'у на id.
 * НЕ изменяет структуру, формулы, applicableStands и пр.
 *
 * Валидация и эвристики:
 *   - Числовое значение, конечное, не NaN.
 *   - В диапазоне [VALIDATION.PRICE_MIN, VALIDATION.PRICE_MAX].
 *   - Аномалия (warning, НЕ rejected): новая цена ≥ 10× старой ИЛИ ≤ старая/10
 *     при оба значения > 0. Это часто опечатки (ноль лишний / запятая не там).
 *     Аномальные обновления возвращаются ОТДЕЛЬНО в массиве `anomalies` и
 *     НЕ дублируются в `safeUpdates` (Этап 11.2.1) — контроллер должен
 *     применить `safeUpdates` сразу, а `anomalies` — только после явного
 *     подтверждения пользователем через UI.
 *   - costType (опционально): 'capex' | 'opex' | пусто (= не менять). Любое другое значение
 *     попадает в `costTypeRejected` и не влияет на ЭК.
 *
 * @param {Array} rows — результат parseCsv (массив объектов с ключом 'id' и 'pricePerUnit')
 * @param {Array} items — текущий каталог ЭК
 * @returns {{
 *   safeUpdates: Array<{id, oldPrice, newPrice, name, oldCostType?, newCostType?}>,
 *   anomalies: Array<{id, oldPrice, newPrice, name, ratio, reason, oldCostType?, newCostType?}>,
 *   rejected: Array<{rowIndex, id?, reason}>,
 *   unchanged: number,
 *   costTypeChanges: number,
 *   costTypeRejected: Array<{rowIndex, id, value}>
 * }}
 */
export function diffPricesFromCsv(rows, items) {
    const safeUpdates = [];
    const anomalies = [];
    const rejected = [];
    const costTypeRejected = [];
    let unchanged = 0;
    let costTypeChanges = 0;

    if (!Array.isArray(rows)) {
        return {
            safeUpdates, anomalies,
            rejected: [{ rowIndex: -1, reason: 'Нет строк для обработки' }],
            unchanged: 0, costTypeChanges: 0, costTypeRejected: []
        };
    }

    const itemById = new Map(items.map(it => [it.id, it]));

    rows.forEach((row, idx) => {
        const id = (row.id || '').trim();
        if (!id) {
            rejected.push({ rowIndex: idx + 2, reason: 'Пустой id' }); // +2: 1 за 0-based, 1 за header
            return;
        }
        const item = itemById.get(id);
        if (!item) {
            rejected.push({ rowIndex: idx + 2, id, reason: `Нет ЭК с id="${id}" в текущем справочнике` });
            return;
        }
        if (!('pricePerUnit' in row)) {
            rejected.push({ rowIndex: idx + 2, id, reason: 'Нет колонки pricePerUnit' });
            return;
        }
        const newPrice = parseNumber(row.pricePerUnit);
        if (!Number.isFinite(newPrice)) {
            rejected.push({ rowIndex: idx + 2, id, reason: `Некорректная цена: "${row.pricePerUnit}"` });
            return;
        }
        if (newPrice < VALIDATION.PRICE_MIN) {
            rejected.push({ rowIndex: idx + 2, id, reason: `Цена ${newPrice} < ${VALIDATION.PRICE_MIN} (минимум)` });
            return;
        }
        if (newPrice > VALIDATION.PRICE_MAX) {
            rejected.push({ rowIndex: idx + 2, id,
                reason: `Цена ${formatNumber(newPrice, { min: 0, max: 2 })} > ` +
                        `${formatNumber(VALIDATION.PRICE_MAX, { min: 0, max: 0 })} ` +
                        `(максимум). Проверьте размер числа.` });
            return;
        }

        // costType (опциональная колонка). Пустая строка / отсутствие = не трогаем.
        // Допустимые значения: 'capex' | 'opex'. Иное — в costTypeRejected.
        let newCostType; // undefined = не менять
        if ('costType' in row) {
            const raw = String(row.costType || '').trim().toLowerCase();
            if (raw === '') {
                newCostType = undefined;
            } else if (COST_TYPE_IDS.includes(raw)) {
                newCostType = raw;
            } else {
                costTypeRejected.push({ rowIndex: idx + 2, id, value: row.costType });
                newCostType = undefined;
            }
        }
        const oldCostType = (item.costType === 'capex' || item.costType === 'opex') ? item.costType : undefined;
        const costTypeChanged = newCostType !== undefined && newCostType !== oldCostType;

        const oldPrice = Number(item.pricePerUnit) || 0;
        const priceChanged = Math.abs(newPrice - oldPrice) >= 1e-9;
        if (!priceChanged && !costTypeChanged) {
            unchanged++;
            return;
        }

        const update = { id, oldPrice, newPrice, name: item.name };
        if (costTypeChanged) {
            update.oldCostType = oldCostType;
            update.newCostType = newCostType;
            costTypeChanges++;
        }

        // Эвристика аномалий по цене — только если цена реально менялась.
        // (Этап 11.2.1) Аномалии НЕ попадают в safeUpdates — их применение
        // требует явного UI-подтверждения, иначе контроллер их игнорирует.
        if (priceChanged && oldPrice > 0 && newPrice > 0) {
            const ratio = newPrice / oldPrice;
            if (ratio >= ANOMALY_MULTIPLIER) {
                anomalies.push({
                    ...update, ratio,
                    reason: `Цена выросла в ${formatNumber(ratio, { min: 1, max: 1 })}× ` +
                            `(было ${formatNumber(oldPrice, { min: 0, max: 2 })}, ` +
                            `стало ${formatNumber(newPrice, { min: 0, max: 2 })}). Возможна опечатка.`
                });
                return;
            }
            if (ratio <= 1 / ANOMALY_MULTIPLIER) {
                anomalies.push({
                    ...update, ratio,
                    reason: `Цена упала в ${formatNumber(1 / ratio, { min: 1, max: 1 })}× ` +
                            `(было ${formatNumber(oldPrice, { min: 0, max: 2 })}, ` +
                            `стало ${formatNumber(newPrice, { min: 0, max: 2 })}). Возможна опечатка.`
                });
                return;
            }
        }
        safeUpdates.push(update);
    });

    return { safeUpdates, anomalies, rejected, unchanged, costTypeChanges, costTypeRejected };
}

/**
 * Полный сценарий: открыть файл-пикер, прочитать CSV, посчитать diff.
 * НЕ применяет изменения сам — это делает контроллер после подтверждения.
 *
 * @returns Promise<{ ok, diff?, headers?, fileName?, reason?, message? }>
 */
export async function pickAndParsePricesCsv() {
    const file = await pickFile('.csv,text/csv');
    if (!file) return { ok: false, reason: 'cancelled' };
    try {
        const { rows, headers, fileName } = await readCsvFile(file);
        if (!headers.includes('id') || !headers.includes('pricePerUnit')) {
            return {
                ok: false, reason: 'invalid',
                message: 'CSV должен содержать колонки `id` и `pricePerUnit`. ' +
                    'Найдены: ' + headers.join(', ')
            };
        }
        return { ok: true, rows, headers, fileName };
    } catch (e) {
        return { ok: false, reason: 'parse', message: e.message };
    }
}
