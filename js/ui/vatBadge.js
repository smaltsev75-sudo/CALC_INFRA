/**
 * 12.U23: VAT-бейдж и расчёт суммы НДС из итога.
 *
 * НДС — независимая ось от риск-коэффициентов (12.U20). Пользователь хочет
 * видеть на Дашборде и в Детализации:
 *   - Включён НДС или нет («С НДС 20%» / «БЕЗ НДС»).
 *   - Сколько ₽ из итога — это сам НДС.
 *
 * `vatMul` одинаков для всех ячеек расчёта (берётся из settings.vatRate +
 * settings.vatEnabled), поэтому VAT-доля в любой агрегированной сумме =
 * `total × (1 − 1/vatMul) = total × vatRate / (1 + vatRate)`. Если НДС
 * выключен — `vatMul = 1`, доля = 0.
 */

import { el } from './dom.js';
import { formatRub, formatRubThousands, percent } from '../services/format.js';
import { DEFAULT_VAT_ENABLED } from '../utils/constants.js';
import { getCurrentVatRate } from '../domain/vatRateTable.js';

/**
 * Базовая информация о НДС из настроек расчёта.
 *
 * @param {object} calc — активный расчёт; читается calc.settings.{vatEnabled,vatRate}
 * @returns {{ enabled: boolean, rate: number, vatMul: number }}
 */
export function vatInfo(calc) {
    const s = calc?.settings || {};
    const enabled = s.vatEnabled !== undefined ? !!s.vatEnabled : DEFAULT_VAT_ENABLED;
    const rate = Number.isFinite(s.vatRate) ? s.vatRate : getCurrentVatRate();
    const vatMul = enabled ? (1 + rate) : 1;
    return { enabled, rate, vatMul };
}

/**
 * Извлечь сумму НДС из итоговой стоимости (с НДС).
 *
 * Используется vatMul, общий для всех ячеек: VAT-доля = total × (1 − 1/vatMul).
 * При vatMul = 1 (НДС выключен) возвращает 0.
 *
 * @param {number} totalWithVat — итоговая сумма С НДС (`result.totalMonthly` и т.п.)
 * @param {number} vatMul — мультипликатор НДС (1 = выключен, 1.20 = 20% и т.д.)
 * @returns {number} VAT-доля в ₽ за тот же период, что и `totalWithVat`
 */
export function extractVatAmount(totalWithVat, vatMul) {
    if (!Number.isFinite(totalWithVat) || !Number.isFinite(vatMul) || vatMul <= 1) return 0;
    return totalWithVat * (1 - 1 / vatMul);
}

/**
 * DOM-бейдж «С НДС 20%» / «БЕЗ НДС» — единый стиль для Дашборда и Детализации.
 *
 * Цветовая семантика:
 *   - С НДС — зелёный «accent» (тот же, что у бейджа «С РИСКАМИ»).
 *   - БЕЗ НДС — нейтрально-серый (НЕ предупреждение: «без НДС» — частая
 *     валидная конфигурация для расчётов между ИП на УСН и т.п.).
 *
 * @param {object} calc — активный расчёт
 * @returns {HTMLElement}
 */
export function renderVatBadge(calc) {
    const { enabled, rate } = vatInfo(calc);
    if (enabled) {
        const ratePct = Math.round(rate * 100);
        return el('span', {
            class: 'vat-badge vat-badge-on',
            title: `Все суммы включают НДС ${ratePct}%. Выключить — в Опроснике, подгруппа «НДС». ` +
                   'НДС применяется независимо от риск-коэффициентов.',
            text: `С НДС ${ratePct}%`
        });
    }
    return el('span', {
        class: 'vat-badge vat-badge-off',
        title: 'Все суммы — БЕЗ НДС. Включить — в Опроснике, подгруппа «НДС».',
        text: 'БЕЗ НДС'
    });
}

/**
 * Текстовая строка «НДС: 200 000 ₽ /мес» — сумма налога в ₽.
 *
 * 12.U24: НЕ дублирует процент НДС с бейджем (принцип «один маркер на одну
 * грань состояния»). Бейдж даёт статус+ставку, строка — конкретную сумму.
 * При выключенном НДС возвращает `null` — бейдж «БЕЗ НДС» уже всё сказал,
 * сумма не нужна (она нулевая).
 *
 * @param {object} calc — активный расчёт
 * @param {number} totalWithVat — итог С НДС за выбранный период
 * @param {string} slash — «/мес», «/год», «/день» (для подписи)
 * @param {object} [opts]
 * @param {boolean} [opts.useThousands=false] — формат «X тыс. ₽» вместо
 *        полных рублей; используется на Дашборде (точность до тысяч),
 *        в Детализации остаётся false (полные рубли).
 * @returns {HTMLElement|null}
 */
export function renderVatBreakdownLine(calc, totalWithVat, slash, opts = {}) {
    const { enabled, rate, vatMul } = vatInfo(calc);
    if (!enabled) return null;  // бейдж «БЕЗ НДС» — единственный маркер.
    const ratePct = Math.round(rate * 100);
    const vatAmount = extractVatAmount(totalWithVat, vatMul);
    const fmt = opts.useThousands ? formatRubThousands : formatRub;
    return el('div', {
        class: 'vat-breakdown vat-breakdown-on',
        title: `Сумма налога НДС в этом итоге: ${formatRub(vatAmount)} ${slash} (ставка ${ratePct}%). ` +
               `Итог без НДС был бы ${formatRub(totalWithVat / vatMul)} ${slash}.`
    },
        el('span', { class: 'vat-breakdown-label', text: 'НДС:' }),
        el('span', { class: 'vat-breakdown-amount', text: `${fmt(vatAmount)} ${slash}` })
    );
}
