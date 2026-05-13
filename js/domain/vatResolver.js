/**
 * Stage VAT-1 Phase 3: pure resolver для эффективной ставки НДС расчёта.
 *
 * Контракт vatRateMode (см. [vatRateTable.js] + миграция 16→17):
 *
 *   - 'auto-by-date' — vatRate пересчитывается из VAT_RATE_HISTORY каждый раз
 *     при открытии расчёта по vatEffectiveDate (либо calc.createdAt, либо today
 *     как fallback). Если в РФ сменилась ставка, и vatEffectiveDate попал в
 *     прошлый период — ставка останется прежней (effectiveDate замораживает
 *     срез истории), не сегодняшней.
 *
 *   - 'manual' — пользователь явно задал особую ставку (нерезидент, льгота,
 *     спецрежим). vatRate сохраняется как есть, vatEffectiveDate=null.
 *
 *   - 'frozen' — согласованный/исторический бюджет. vatRate И vatEffectiveDate
 *     сохраняются ровно как есть. Любые обновления справочника / приложения
 *     НЕ должны менять сумму расчёта.
 *
 * Этот модуль НЕ мутирует calc и не имеет side effects: возвращает
 * resolved-структуру либо новый calc-объект через `applyVatResolver`.
 * Вызывается из calcController.openCalc после migration + enrichment.
 */

import { getVatRateForDate, todayIso, isoDateOf } from './vatRateTable.js';

/** @typedef {{ vatRate: number, vatEffectiveDate: string|null, vatRateMode: string }} ResolvedVat */

/**
 * Pure: посчитать эффективные `vatRate` + `vatEffectiveDate` для calc.
 *
 * Не мутирует вход. Не выбрасывает — для невалидных входов возвращает
 * безопасный default (auto-by-date на текущую ставку).
 *
 * @param {object} calc
 * @returns {ResolvedVat}
 */
export function resolveVatSettingsForCalc(calc) {
    if (!calc || typeof calc !== 'object') {
        const today = todayIso();
        return {
            vatRate: getVatRateForDate(today),
            vatEffectiveDate: today,
            vatRateMode: 'auto-by-date'
        };
    }
    const s = (calc.settings && typeof calc.settings === 'object') ? calc.settings : {};
    const mode = s.vatRateMode;

    if (mode === 'manual') {
        return {
            vatRate: s.vatRate,
            vatEffectiveDate: null,
            vatRateMode: 'manual'
        };
    }

    if (mode === 'frozen') {
        return {
            vatRate: s.vatRate,
            vatEffectiveDate: (typeof s.vatEffectiveDate === 'string' && s.vatEffectiveDate) || null,
            vatRateMode: 'frozen'
        };
    }

    /* mode === 'auto-by-date' ИЛИ undefined / неизвестный — безопасный default
       одинаков: пересчитать из справочника. Это покрывает случаи:
       (1) migration оставила mode=auto-by-date с vatEffectiveDate=null
           (legacy без createdAt и без vatRate);
       (2) калькуляция, которая ещё не была мигрирована (defensive). */
    let effective = (typeof s.vatEffectiveDate === 'string' && s.vatEffectiveDate)
        ? s.vatEffectiveDate
        : null;
    if (!effective && typeof calc.createdAt === 'string' && calc.createdAt.length >= 10) {
        effective = isoDateOf(new Date(calc.createdAt));
    }
    if (!effective) {
        effective = todayIso();
    }
    const rate = getVatRateForDate(effective);
    return {
        vatRate: rate !== null ? rate : s.vatRate,
        vatEffectiveDate: effective,
        vatRateMode: 'auto-by-date'
    };
}

/**
 * Применить resolver к calc. Возвращает:
 *   - тот же объект, если эффективные значения уже совпадают с calc.settings
 *     (no-op для manual/frozen и для auto-by-date, где vatRate не изменился);
 *   - новый объект (shallow clone settings) с обновлёнными vatRate /
 *     vatEffectiveDate / vatRateMode иначе.
 *
 * Использование: после migration в `calcController.openCalc` и в
 * `makeNewCalculation` для гарантии, что новый calc сразу имеет согласованную
 * пару (mode, effectiveDate, rate).
 *
 * @param {object} calc
 * @returns {object}
 */
export function applyVatResolver(calc) {
    if (!calc || typeof calc !== 'object' || !calc.settings || typeof calc.settings !== 'object') {
        return calc;
    }
    const resolved = resolveVatSettingsForCalc(calc);
    const s = calc.settings;
    const currentEffective = (typeof s.vatEffectiveDate === 'string' && s.vatEffectiveDate) || null;
    const sameRate = resolved.vatRate === s.vatRate;
    const sameDate = resolved.vatEffectiveDate === currentEffective;
    const sameMode = resolved.vatRateMode === s.vatRateMode;
    if (sameRate && sameDate && sameMode) return calc;

    return {
        ...calc,
        settings: {
            ...s,
            vatRate: resolved.vatRate,
            vatEffectiveDate: resolved.vatEffectiveDate,
            vatRateMode: resolved.vatRateMode
        }
    };
}
