/**
 * VAT Rate History — справочник ставок НДС РФ с историей действия.
 *
 * Source of truth для ставок НДС в калькуляторе. При смене ставки в РФ
 * (например, гипотетический будущий переход с 2027-01-01) — добавить ровно
 * одну запись в `VAT_RATE_HISTORY`, остальной код не трогается.
 *
 * Stage VAT-1 (2026-05): архитектурное решение
 *   До этого этапа в коде использовалась глобальная константа
 *   `DEFAULT_VAT_RATE = 0.22` ([utils/constants.js]). Она нарушала принцип
 *   «производная константа всегда читает источник правды»: ставка НДС —
 *   time-versioned параметр, не вечная константа.
 *
 *   Теперь:
 *     • Источник правды для ставок РФ — `VAT_RATE_HISTORY` в этом файле.
 *     • НДС применяется ровно один раз в [calculator.js#riskFactor]
 *       через `vatMul = vatEnabled ? (1 + settings.vatRate) : 1`.
 *     • Ставка берётся:
 *         - из справочника по `calc.settings.vatEffectiveDate` (mode='auto-by-date');
 *         - из явно сохранённого `calc.settings.vatRate` (mode='manual' / 'frozen').
 *     • Phase 6: `DEFAULT_VAT_RATE` удалён из `constants.js` полностью. Все
 *       fallback-точки (calculator, seed, migrations, vatBadge) теперь
 *       импортируют `getCurrentVatRate` напрямую из этого файла. Линтер
 *       `vat-rate-no-literals.test.js` запрещает hardcoded VAT-литералы
 *       во всём `js/` кроме данного модуля.
 *
 * Подтверждено:
 *   • 2019-01-01: РФ повысила базовую ставку с 18% → 20% (ФЗ-303 от 03.08.2018).
 *   • 2026-01-01: РФ повышает базовую ставку с 20% → 22%.
 *
 * Сравнение строк ISO `YYYY-MM-DD` лексикографически = хронологическое
 * (свойство ISO-формата). Никаких Date-арифметик в hot-path не нужно.
 */

/** @typedef {{ from: string, to: string|null, rate: number }} VatRatePeriod */

/**
 * История ставок НДС РФ.
 *
 *   - `from` — первый день действия ставки (ISO YYYY-MM-DD, включительно).
 *   - `to`   — последний день действия (ISO YYYY-MM-DD, включительно).
 *              `null` = открытый интервал (действует на текущий момент).
 *   - `rate` — десятичная доля (0.22 = 22%).
 *
 * Интервалы НЕ должны перекрываться. Последний период обязан иметь `to === null`.
 *
 * @type {ReadonlyArray<VatRatePeriod>}
 */
export const VAT_RATE_HISTORY = Object.freeze([
    Object.freeze({ from: '2004-01-01', to: '2018-12-31', rate: 0.18 }),
    Object.freeze({ from: '2019-01-01', to: '2025-12-31', rate: 0.20 }),
    Object.freeze({ from: '2026-01-01', to: null,         rate: 0.22 })
]);

/**
 * Привести вход к канонической ISO-дате `YYYY-MM-DD`.
 *
 * Принимает:
 *   - `Date` объект (берётся UTC-часть);
 *   - строку `YYYY-MM-DD` или полную ISO `YYYY-MM-DDTHH:mm:ss...`.
 *
 * Возвращает `null` для:
 *   - `null` / `undefined`;
 *   - Date с NaN-таймстампом;
 *   - строки, не соответствующей формату;
 *   - синтаксически валидной строки, но реально несуществующей даты
 *     (например, `2026-13-01`, `2026-02-30`).
 *
 * Экспортируется как `isoDateOf` — публичный helper для controllers/domain,
 * которым нужно нормализовать дату создания calc к формату справочника.
 * Whitelist'нут в линтере date-format-ru: эта функция инкапсулирует
 * единственное разрешённое использование `.toISOString().slice(0, 10)` —
 * для внутреннего ISO-формата, не UI.
 *
 * @param {Date|string|null|undefined} date
 * @returns {string|null}
 */
export function isoDateOf(date) {
    if (date == null) return null;
    if (date instanceof Date) {
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString().slice(0, 10);
    }
    if (typeof date !== 'string') return null;
    if (date.length < 10) return null;
    const head = date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return null;
    /* Реальность даты: `new Date('2026-02-30T00:00:00Z')` парсится в '2026-03-02'.
       Round-trip проверка ловит несуществующие даты. */
    const probe = new Date(head + 'T00:00:00Z');
    if (Number.isNaN(probe.getTime())) return null;
    if (probe.toISOString().slice(0, 10) !== head) return null;
    return head;
}

/**
 * Ставка НДС, действующая на указанную дату.
 *
 * @param {Date|string|null|undefined} date — дата операции.
 * @returns {number|null} ставка (0.18 / 0.20 / 0.22 / ...) или `null` если
 *   дата невалидна или попадает до начала справочника (`< 2004-01-01`).
 */
export function getVatRateForDate(date) {
    const iso = isoDateOf(date);
    if (iso === null) return null;
    for (const period of VAT_RATE_HISTORY) {
        if (iso >= period.from && (period.to === null || iso <= period.to)) {
            return period.rate;
        }
    }
    return null;
}

/**
 * Ставка НДС, действующая сегодня (по UTC, лояльно к таймзоне пользователя:
 * сдвиг внутри одного дня не критичен — справочник меняется не чаще раз/в 5 лет).
 *
 * @returns {number} ставка из последнего периода `VAT_RATE_HISTORY`.
 */
export function getCurrentVatRate() {
    return getVatRateForDate(new Date());
}

/**
 * Сколько раз `[startDate, startDate + horizonYears]` пересекает границы
 * периодов в справочнике.
 *
 * Используется для multi-period warning в UI: «Расчёт пересекает 01.01.2026
 * (20% → 22%). Применяется ставка на дату начала. Для точной оценки —
 * разбейте бюджет по периодам или переключите режим на manual».
 *
 * @param {Date|string|null|undefined} startDate
 * @param {number} horizonYears — целое или дробное (например 1.5).
 * @returns {ReadonlyArray<{date: string, from: number, to: number}>}
 */
export function getVatPeriodCrossings(startDate, horizonYears) {
    const startIso = isoDateOf(startDate);
    if (startIso === null || !Number.isFinite(horizonYears) || horizonYears <= 0) {
        return Object.freeze([]);
    }
    const start = new Date(startIso + 'T00:00:00Z');
    const end = new Date(start);
    /* setUTCFullYear корректно обрабатывает целые годы; для дробных горизонтов
       округляем вверх по дням, чтобы не пропустить crossing в последний день. */
    const wholeYears = Math.floor(horizonYears);
    const fractionDays = Math.ceil((horizonYears - wholeYears) * 365);
    end.setUTCFullYear(end.getUTCFullYear() + wholeYears);
    end.setUTCDate(end.getUTCDate() + fractionDays);
    const endIso = end.toISOString().slice(0, 10);

    const crossings = [];
    for (let i = 0; i < VAT_RATE_HISTORY.length - 1; i++) {
        const cur = VAT_RATE_HISTORY[i];
        const next = VAT_RATE_HISTORY[i + 1];
        if (next.from > startIso && next.from <= endIso) {
            crossings.push(Object.freeze({
                date: next.from,
                from: cur.rate,
                to: next.rate
            }));
        }
    }
    return Object.freeze(crossings);
}

/**
 * Сегодняшний день в формате `YYYY-MM-DD` (UTC). Удобный helper для
 * контроллеров, которые ставят `vatEffectiveDate` при создании расчёта.
 *
 * @returns {string}
 */
export function todayIso() {
    return new Date().toISOString().slice(0, 10);
}
