/**
 * Форматирование чисел, валют, процентов и дат для русской локали.
 * Десятичный разделитель — запятая, разделитель тысяч — неразрывный пробел.
 *
 * Калькулятор работает только в RUB. Знак рубля ставится после числа,
 * между группами разрядов — неразрывный пробел.
 *
 * Унификация (Этап 9.5):
 *   - Числа — `formatNumber()` / `integer()` / `formatRub()` (всегда с разделителем тысяч).
 *   - Даты  — `formatDate()` («dd.mm.yyyy»), `formatTime()` («hh:mi»),
 *             `formatDateTime()` («dd.mm.yyyy hh:mi»). Использовать ВЕЗДЕ в UI
 *             вместо `toLocaleString` / `toISOString().slice(...)`.
 */

import {
    LOCALE,
    MONEY_FRACTION_DIGITS,
    PERCENT_FRACTION_DIGITS
} from '../utils/constants.js';

const RUB_SIGN = '₽';
/* U+00A0 через escape, не литерал: ранее в исходнике стоял обычный SPACE (0x20),
   и тогда «75 тыс. ₽» переносится по середине даже под `white-space: nowrap`
   (NBSP по семантике характера всегда не-разрывен; обычный SPACE — точка слома). */
const NBSP = ' ';

const _moneyFmt = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: MONEY_FRACTION_DIGITS,
    maximumFractionDigits: MONEY_FRACTION_DIGITS,
    useGrouping: true
});

const _moneyFmtPrecise = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true
});

const _percentFmt = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: PERCENT_FRACTION_DIGITS,
    useGrouping: false
});

/** «1 234 567 ₽» — основной формат денег. */
export function formatRub(value) {
    if (!Number.isFinite(value)) return '—';
    return `${_moneyFmt.format(value)}${NBSP}${RUB_SIGN}`;
}

/** «1 234,56 ₽» — для маленьких сумм. */
export function formatRubPrecise(value) {
    if (!Number.isFinite(value)) return '—';
    return `${_moneyFmtPrecise.format(value)}${NBSP}${RUB_SIGN}`;
}

/* Формат тысяч — «1 234 тыс. ₽». Используется в Дашборде, где точность до
   рубля излишня (оперируем сотнями тысяч и больше) и сами рубли создают
   визуальный шум.

   12.U25-fix-10: `opts.fractionDigits` (по умолчанию 0) — для дневного периода,
   где числа маленькие (десятки/сотни тыс.) и «округление каждого слагаемого
   вниз» ломает сумму: 50 + 112 = 162, но round-of-sum = 163. С 1 знаком после
   запятой числа сходятся: 50,4 + 112,3 = 162,7. Округление — half-away-from-zero. */
export function formatRubThousands(value, opts = {}) {
    if (!Number.isFinite(value)) return '—';
    const fd = Number.isInteger(opts.fractionDigits) && opts.fractionDigits >= 0
        ? opts.fractionDigits : 0;
    const fmt = new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: fd,
        maximumFractionDigits: fd,
        useGrouping: true
    });
    const sign = value < 0 ? '-' : '';
    const thousands = Math.abs(value) / 1000;
    return `${sign}${fmt.format(thousands)}${NBSP}тыс.${NBSP}${RUB_SIGN}`;
}

/** Старое имя — оставлено как алиас для обратной совместимости. */
export function money(value) {
    return formatRub(value);
}

/** Старое имя — оставлено как алиас для обратной совместимости. */
export function moneyPrecise(value) {
    return formatRubPrecise(value);
}

/**
 * Универсальный форматтер чисел в локали ru-RU.
 *   formatNumber(1234567)              → «1 234 567»
 *   formatNumber(1234.56)              → «1 234,56»
 *   formatNumber(1234.567, { max: 1 }) → «1 234,6»
 *
 * Параметры (необязательны):
 *   min — минимум знаков после запятой (по умолчанию 0).
 *   max — максимум знаков после запятой (по умолчанию 3, чтобы не плодить мусор).
 *   useGrouping — по умолчанию true (разделитель тысяч).
 */
export function formatNumber(value, opts = {}) {
    if (!Number.isFinite(value)) return '—';
    const min = Number.isFinite(opts.min) ? opts.min : 0;
    const max = Number.isFinite(opts.max) ? opts.max : 3;
    const useGrouping = opts.useGrouping !== false;
    const fmt = new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: min,
        maximumFractionDigits: Math.max(min, max),
        useGrouping
    });
    return fmt.format(value);
}

/** 1 234,5 — обобщённое число (старый API; делегирует formatNumber). */
export function num(value, fractionDigits = 2) {
    return formatNumber(value, { min: 0, max: fractionDigits });
}

/** Целое число с разделителем тысяч. */
export function integer(value) {
    return formatNumber(value, { min: 0, max: 0 });
}

/** 0,30 → «30%». */
export function percent(value) {
    if (!Number.isFinite(value)) return '—';
    return `${_percentFmt.format(value * 100)}%`;
}

/**
 * Парсинг ввода с запятой/точкой/пробелами.
 * Возвращает число или NaN.
 *
 * Внешний аудит #2 (2026-05-18, P3-2): strict-regex против parseFloat-ловушки
 * («100abc» → 100). Хвост из букв → NaN; ввод обязан быть только числом.
 */
export function parseNumberInput(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (value === null || value === undefined) return NaN;
    const cleaned = String(value).replace(/\s+/g, '').replace(',', '.');
    if (cleaned === '') return NaN;
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
}

/* ============================================================
 * ДАТЫ И ВРЕМЯ
 *
 * Используем ручное форматирование вместо `toLocaleString` —
 * это:
 *   а) даёт детерминированный формат «dd.mm.yyyy» / «hh:mi»
 *      независимо от локали ОС и от версии ICU в node;
 *   б) проще для тестов (не нужно учитывать спец-символы U+202F
 *      между датой и временем, которые в новых Node добавляет ICU);
 *   в) совпадает с тем, как пользователь привык вводить даты.
 *
 * Время выводится в локальном поясе пользователя (так же, как
 * это делал прежний `toLocaleString('ru-RU')`).
 * ============================================================ */

function _toDate(input) {
    if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
    if (input === null || input === undefined || input === '') return null;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
}

function _pad2(n) {
    return n < 10 ? '0' + n : String(n);
}

/** «dd.mm.yyyy». Невалидный вход → пустая строка. */
export function formatDate(input) {
    const d = _toDate(input);
    if (!d) return '';
    return `${_pad2(d.getDate())}.${_pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** «hh:mi». Невалидный вход → пустая строка. */
export function formatTime(input) {
    const d = _toDate(input);
    if (!d) return '';
    return `${_pad2(d.getHours())}:${_pad2(d.getMinutes())}`;
}

/** «dd.mm.yyyy hh:mi». Невалидный вход → пустая строка. */
export function formatDateTime(input) {
    const d = _toDate(input);
    if (!d) return '';
    return `${formatDate(d)} ${formatTime(d)}`;
}

/** ISO-строка → «dd.mm.yyyy hh:mi». Старый API; «—» при невалидном входе. */
export function dateTime(iso) {
    const s = formatDateTime(iso);
    return s || '—';
}

/** ISO-строка → «dd.mm.yyyy». Старый API; «—» при невалидном входе. */
export function dateOnly(iso) {
    const s = formatDate(iso);
    return s || '—';
}

/**
 * «dd.mm.yyyy» для использования в имени экспортируемого файла
 * (`comparison-07.05.2026.csv` и т.д.). RU-формат единообразно с UI/PDF;
 * расширение всегда стоит ПОСЛЕ этой части (`.csv`/`.json`), поэтому точки
 * внутри даты не сбивают парсер расширений на Windows/macOS.
 * Невалидный вход → текущая дата.
 */
export function dateForFilename(input) {
    return formatDate(input ?? new Date()) || formatDate(new Date());
}

/**
 * Stage 10.2: humanize ISO-timestamp в относительный текст для UI.
 *
 *   <60 сек → 'только что'
 *   <60 мин → 'N мин назад'
 *   <24 ч  → 'N ч назад'
 *   <7 дн  → 'N дн назад'
 *   ≥7 дн  → fallback на formatDate (dd.mm.yyyy)
 *
 * Используется для индикатора свежести applied провайдер-прайса
 * (provider-update-row). RU-pluralization упрощённая: «мин» / «ч» / «дн»
 * одинаково для 1, 5, 21 — короткие сокращения в UI читаются естественно.
 *
 * @param {string|Date|null|undefined} input — ISO-string или Date.
 * @param {number} [nowMs] — текущее время в ms (для тестов, дефолт Date.now()).
 * @returns {string} — '' при невалидном входе, иначе человекочитаемый текст.
 */
export function formatTimeAgo(input, nowMs) {
    const d = _toDate(input);
    if (!d) return '';
    const now = typeof nowMs === 'number' ? nowMs : Date.now();
    const deltaMs = Math.max(0, now - d.getTime());

    const sec = Math.floor(deltaMs / 1000);
    if (sec < 60) return 'только что';

    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} мин назад`;

    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} ч назад`;

    const days = Math.floor(hr / 24);
    if (days < 7) return `${days} дн назад`;

    return formatDate(d);
}
