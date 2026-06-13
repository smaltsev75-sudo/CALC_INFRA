/**
 * CSV-экспорт детализации расчёта.
 *
 * Особенности:
 *   - Разделитель по умолчанию `;` (Excel в RU-локали).
 *   - BOM (﻿) в начале файла для корректного отображения кириллицы в Excel.
 *   - Числовые значения форматируются с запятой как десятичным разделителем
 *     (RU-локаль), без символа валюты — Excel сможет считать это числом.
 *   - Текстовые поля экранируются: при наличии разделителя/кавычки/перевода
 *     строки оборачиваются в двойные кавычки, внутренние кавычки удваиваются.
 */

import { STAND_IDS, STAND_LABELS, CATEGORY_LABELS, BILLING_INTERVAL_LABELS, COST_TYPE_LABELS, MONTHS_PER_YEAR, URL_REVOKE_DELAY_MS } from '../utils/constants.js';
import { getCostType } from '../domain/costType.js';
import { getCalculationProviderPriceActuality } from '../domain/providerPriceTrust.js';
import { percent, dateForFilename, formatDateTime } from './format.js';

/**
 * Сформировать CSV-строку из расчёта.
 *
 * @param {Object} calc — активный расчёт
 * @param {Object} result — результат calculate(calc)
 * @param {Object} [opts] — { delimiter, includeFormulas }
 * @returns {string}
 */
export function buildDetailsCsv(calc, result, opts = {}) {
    const delimiter = opts.delimiter || ';';
    const includeFormulas = !!opts.includeFormulas;

    const rows = [];

    // Заголовок-метаданные расчёта (закомментированный для читаемости в Excel — пустые ячейки)
    rows.push([
        `Расчёт`, calc.name || '',
        `Валюта`, '₽',
        `Длительность фазы (мес)`, String(calc.settings?.phaseDurationMonths ?? 12)
    ]);
    rows.push([
        `Задачный буфер`, fmtPct(calc.settings?.bufferTask ?? 0),
        `Проектный буфер`, fmtPct(calc.settings?.bufferProject ?? 0),
        `Инфляция (год)`, fmtPct(calc.settings?.kInflation ?? 0)
    ]);
    rows.push([
        `Сезонный коэф.`, fmtPct(calc.settings?.kSeasonal ?? 0),
        `Сдвиг расписания`, fmtPct(calc.settings?.kScheduleShift ?? 0),
        `Резерв на риски`, fmtPct(calc.settings?.kContingency ?? 0)
    ]);
    rows.push([
        `НДС`, calc.settings?.vatEnabled ? fmtPct(calc.settings?.vatRate ?? 0) : 'выкл.',
        `Горизонт планирования (лет)`, String(calc.settings?.planningHorizonYears ?? 1),
        `Дней в месяце`, String(calc.settings?.daysPerMonth ?? 30)
    ]);
    const priceActuality = getCalculationProviderPriceActuality(calc);
    rows.push([
        `Прайс расчёта`, priceActuality.providerLabel,
        `Актуальность прайса`, priceActuality.date || 'дата не указана',
        `Версия прайса`, priceActuality.version || '—'
    ]);
    // Сводка CAPEX / OPEX (на основе агрегата result.byCostType, который посчитан калькулятором).
    const capexMonthly = result?.byCostType?.capex || 0;
    const opexMonthly  = result?.byCostType?.opex  || 0;
    rows.push([
        `ИТОГО CAPEX, ₽/мес`, fmtNumber(capexMonthly),
        `ИТОГО CAPEX, ₽/год`, fmtNumber(capexMonthly * MONTHS_PER_YEAR),
        ``, ``
    ]);
    rows.push([
        `ИТОГО OPEX, ₽/мес`, fmtNumber(opexMonthly),
        `ИТОГО OPEX, ₽/год`, fmtNumber(opexMonthly * MONTHS_PER_YEAR),
        ``, ``
    ]);
    rows.push([]); // пустая строка-разделитель

    // Заголовки таблицы детализации
    const headerRow = [
        'Категория',
        'Элемент',
        'Поставщик',
        'Тариф',
        'Тип расхода',
        'Ед.изм.',
        'Цена за ед.',
        ...STAND_IDS.map(s => `${STAND_LABELS[s]}, qty`),
        ...STAND_IDS.map(s => `${STAND_LABELS[s]}, ₽/мес`),
        'ИТОГО, ₽/мес',
        'ИТОГО, ₽/год'
    ];
    if (includeFormulas) {
        headerRow.push(...STAND_IDS.map(s => `Формула ${STAND_LABELS[s]}`));
    }
    rows.push(headerRow);

    // Строки данных
    const items = calc.dictionaries.items || [];
    const totals = {
        qty: Object.fromEntries(STAND_IDS.map(s => [s, 0])),
        cost: Object.fromEntries(STAND_IDS.map(s => [s, 0])),
        monthly: 0,
        annual: 0
    };

    for (const item of items) {
        const r = result.items[item.id];
        if (!r) continue;
        const ct = getCostType(item);
        const row = [
            CATEGORY_LABELS[item.category] || item.category,
            item.name,
            item.vendor || '',
            BILLING_INTERVAL_LABELS[item.billingInterval] || item.billingInterval || '',
            COST_TYPE_LABELS[ct] || ct,
            item.unit,
            fmtNumber(item.pricePerUnit),
            ...STAND_IDS.map(s => {
                const cell = r.stands[s];
                if (cell.error) return `#ERR ${cell.error}`;
                totals.qty[s] += cell.qty;
                return fmtNumber(cell.qty);
            }),
            ...STAND_IDS.map(s => {
                const cell = r.stands[s];
                if (cell.error) return '';
                totals.cost[s] += cell.costFinal;
                return fmtNumber(cell.costFinal);
            }),
            fmtNumber(r.totalMonthly),
            fmtNumber(r.totalAnnual)
        ];
        totals.monthly += r.totalMonthly;
        totals.annual += r.totalAnnual;
        if (includeFormulas) {
            row.push(...STAND_IDS.map(s => item.qtyFormulas?.[s] || ''));
        }
        rows.push(row);
    }

    // Строка ИТОГО (7 пустых колонок: Категория..Цена за ед. + Тип расхода)
    const totalsRow = [
        'ИТОГО', '', '', '', '', '', '',
        ...STAND_IDS.map(s => fmtNumber(totals.qty[s])),
        ...STAND_IDS.map(s => fmtNumber(totals.cost[s])),
        fmtNumber(totals.monthly),
        fmtNumber(totals.annual)
    ];
    if (includeFormulas) totalsRow.push(...STAND_IDS.map(() => ''));
    rows.push([]);
    rows.push(totalsRow);

    return '﻿' + rows.map(r => r.map(c => quote(c, delimiter)).join(delimiter)).join('\r\n');
}

/* ---------- Вспомогательные ---------- */

function fmtNumber(n) {
    if (n === null || n === undefined) return '';
    if (!Number.isFinite(Number(n))) return '';
    // Округляем до 4 знаков чтобы Excel видел число; разделитель — запятая (RU).
    const rounded = Math.round(Number(n) * 10000) / 10000;
    return String(rounded).replace('.', ',');
}

function fmtPct(v) {
    return percent(Number(v) || 0);
}

/**
 * Триггер-символы CSV-инъекции (Excel/Numbers/Calc интерпретируют ячейку,
 * начинающуюся с любого из них, как формулу/команду).
 *   `=`, `+`, `-`, `@` — стандартные префиксы формул.
 *   `\t` (tab), `\r` (CR) — также распознаются Excel'ом как начало формулы
 *      после авто-trim ведущих whitespace.
 * См. OWASP «CSV Injection» / CWE-1236.
 */
const CSV_INJECTION_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Безопасное экранирование значения для CSV-ячейки.
 *
 * Защищает от:
 *   - стандартных CSV-конфликтов (разделитель, кавычка, перевод строки,
 *     ведущие/висящие пробелы) — оборачивание в `"..."`, удвоение `"`.
 *   - CSV-инъекции (CWE-1236): если значение после `trim()` начинается
 *     с триггер-символа (`=`, `+`, `-`, `@`, `\t`, `\r`), префиксуем
 *     одинарной кавычкой `'` ВНУТРИ кавычек — Excel/Numbers/Calc
 *     отобразят значение как текст и не выполнят формулу.
 *
 * Компромисс round-trip: при последующем CSV-импорте префиксная `'`
 * остаётся в данных. Это документированное поведение — пользователь
 * увидит её при правке в редакторе и может удалить вручную, если уверен,
 * что значение безопасно.
 *
 * @param {*} value — значение ячейки (любого типа, преобразуется в String)
 * @param {string} delimiter — текущий CSV-разделитель (`,` или `;`)
 * @returns {string} готовая для записи CSV-ячейка
 */
export function csvSafeQuote(value, delimiter) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (s === '') return '';

    // Срезаем только пробелы (не \t / \r — они сами триггеры),
    // чтобы " =foo" → `=foo` распознавался, а "\tfoo" — оставался "\tfoo".
    let leadSpaces = 0;
    while (leadSpaces < s.length && s.charAt(leadSpaces) === ' ') leadSpaces++;
    const firstSignificant = s.charAt(leadSpaces);
    const isInjection = firstSignificant !== '' && CSV_INJECTION_TRIGGERS.includes(firstSignificant);

    if (isInjection) {
        // Префиксуем `'` ПЕРЕД триггер-символом (внутри кавычек).
        // Сохраняем ведущие пробелы (если были) — чтобы не терять оригинальные данные.
        const lead = s.slice(0, leadSpaces);
        const rest = s.slice(leadSpaces);
        const safe = lead + "'" + rest;
        return '"' + safe.replace(/"/g, '""') + '"';
    }

    if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r') ||
        s.startsWith(' ') || s.endsWith(' ')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

/**
 * Внутренний алиас на `csvSafeQuote` — сохраняет имя `quote()` для соседних вызовов.
 */
function quote(value, delimiter) {
    return csvSafeQuote(value, delimiter);
}

/**
 * Скачать CSV-файл с заданным именем.
 */
export function downloadCsv(filename, content) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    let url = null;
    let a = null;
    try {
        url = URL.createObjectURL(blob);
        a = document.createElement('a');
        a.href = url;
        a.download = sanitizeFilename(filename);
        document.body.appendChild(a);
        a.click();
    } finally {
        if (a?.parentNode) a.parentNode.removeChild(a);
        if (url) setTimeout(() => URL.revokeObjectURL(url), URL_REVOKE_DELAY_MS);
    }
}

function sanitizeFilename(name) {
    return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 200);
}

export function buildCalcCsvFilename(calc) {
    const baseName = (calc?.name || 'calc').replace(/\s+/g, '-').slice(0, 80);
    return `${baseName}-detail-${dateForFilename()}.csv`;
}

/* ============================================================
 * ЭКСПОРТ ПРАЙСА ЭК
 * ============================================================
 * Формат CSV — пригоден для round-trip: правка в Excel/Numbers/Calc и обратный
 * импорт через importPricesFromCsv (см. csvImport.js).
 *
 * Колонки: id, name, vendor, unit, category, resourceClass, billingInterval, pricePerUnit
 *
 * id обязателен и не должен меняться — по нему идёт match при импорте.
 */

export function buildPricesCsv(items, opts = {}) {
    const delimiter = opts.delimiter || ';';
    const rows = [];

    rows.push([
        'id', 'name', 'vendor', 'unit', 'category', 'resourceClass',
        'billingInterval', 'pricePerUnit', 'priceUpdatedAt', 'priceSource', 'costType'
    ]);

    for (const it of items || []) {
        // costType: пустая строка = «авто», явный 'capex'|'opex' экспортируется как есть.
        const ct = (it && (it.costType === 'capex' || it.costType === 'opex')) ? it.costType : '';
        rows.push([
            it.id || '',
            it.name || '',
            it.vendor || '',
            it.unit || '',
            it.category || '',
            it.resourceClass || '',
            it.billingInterval || '',
            fmtNumber(it.pricePerUnit),
            it.priceUpdatedAt || '',
            it.priceSource || 'seed',
            ct
        ]);
    }

    return '﻿' + rows
        .map(line => line.map(v => quote(v, delimiter)).join(delimiter))
        .join('\r\n');
}

export function buildPricesCsvFilename() {
    return `prices-${dateForFilename()}.csv`;
}

export function buildComparisonCsvFilename() {
    return `comparison-${dateForFilename()}.csv`;
}

/* ============================================================
 * 12.U15: ЗАКАЗ ЭК ДЛЯ DEVOPS (Procurement export) — УДАЛЕНО (12.U27)
 * ============================================================
 * Кнопка «Заказ ЭК» убрана из toolbar Детализации (UX: семантический дубль
 * кнопки CSV для пользователя — генерирует тот же CSV-формат, лишняя нагрузка
 * на UI). Если эта функциональность понадобится снова — восстановить из
 * git-истории до коммита удаления (искать `buildProcurementCsv` /
 * `buildProcurementCsvFilename` / `RESOURCE_CLASS_LABELS_LOCAL`).
 */

/* ============================================================
 * СРАВНЕНИЕ РАСЧЁТОВ
 * ============================================================
 * Формирует CSV для side-by-side сравнения нескольких расчётов.
 *
 * Структура файла:
 *   1. Шапка-заголовок: «Сравнение расчётов» + ISO-дата.
 *   2. Пустая строка-разделитель.
 *   3. Header-строка: «Метрика» + N имён расчётов.
 *   4. Сводные метрики (ИТОГО/мес, ИТОГО/год, по категориям, по стендам).
 *   5. Пустая строка.
 *   6. Постатейный блок: header + строка на каждый уникальный ЭК.
 *
 * Все числовые ячейки форматируются с запятой как десятичным разделителем
 * (RU-локаль). Текстовые поля идут через `csvSafeQuote` — защита от
 * CSV-инъекции (CWE-1236). BOM `﻿` в начале файла — для корректного
 * отображения кириллицы в Excel.
 *
 * @param {Object[]} calcs    — массив расчётов в порядке отображения колонок
 * @param {Object[]} results  — соответствующие результаты `calculate(calc)`
 * @param {Object}   [opts]   — { delimiter } (по умолчанию `;`)
 * @returns {string} CSV-контент с BOM
 */
export function buildComparisonCsv(calcs, results, opts = {}) {
    const delimiter = opts.delimiter || ';';
    // Локальный форматер числа: 2 знака после запятой, RU-разделитель.
    // Используется отдельно от общего fmtNumber (4 знака) — для сравнения
    // достаточно копеечной точности.
    const fmt = n => Number.isFinite(Number(n))
        ? String(Math.round(Number(n) * 100) / 100).replace('.', ',')
        : '';

    const lines = [];
    lines.push(['Сравнение расчётов', formatDateTime(new Date())]);
    lines.push(['Актуальность прайса', ...calcs.map(c => {
        const info = getCalculationProviderPriceActuality(c);
        return `${info.providerLabel}: ${info.date || 'дата не указана'}${info.version ? ` · ${info.version}` : ''}`;
    })]);
    lines.push([]);

    // Header: Метрика | calc1 | calc2 | ...
    lines.push(['Метрика', ...calcs.map(c => `${c.name} (₽)`)]);

    const metrics = [
        { label: 'ИТОГО / мес', get: r => r.totalMonthly },
        { label: 'ИТОГО / год', get: r => r.totalAnnual }
    ];
    // Категории
    for (const cat of ['HW', 'LICENSE', 'TRAFFIC', 'SERVICES', 'RESERVES', 'SECURITY', 'AI']) {
        metrics.push({ label: 'Категория ' + cat, get: r => r.byCategory[cat] || 0 });
    }
    // Стенды
    for (const sid of ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']) {
        metrics.push({ label: 'Стенд ' + sid, get: r => r.stands[sid].totalMonthly });
    }
    for (const m of metrics) {
        lines.push([m.label, ...results.map(r => fmt(m.get(r)))]);
    }

    // Постатейно
    lines.push([]);
    lines.push(['Постатейно (₽/мес)', ...calcs.map(c => c.name)]);
    const itemMap = new Map();
    for (const c of calcs) {
        for (const it of c.dictionaries.items) {
            if (!itemMap.has(it.id)) itemMap.set(it.id, { id: it.id, name: it.name });
        }
    }
    for (const meta of itemMap.values()) {
        const row = [meta.name];
        for (let i = 0; i < calcs.length; i++) {
            const inCalc = calcs[i].dictionaries.items.find(x => x.id === meta.id);
            if (!inCalc) { row.push(''); continue; }
            const cost = results[i].items[meta.id]?.totalMonthly || 0;
            row.push(fmt(cost));
        }
        lines.push(row);
    }

    return '﻿' + lines
        .map(line => line.map(v => csvSafeQuote(v, delimiter)).join(delimiter))
        .join('\r\n');
}
