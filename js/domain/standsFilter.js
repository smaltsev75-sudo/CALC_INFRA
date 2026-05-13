/**
 * Фильтрация агрегатов калькулятора по подмножеству активных стендов.
 *
 * Пользователь может временно «выключить» отдельные стенды на дашборде/детализации
 * (calc.view.disabledStands), чтобы посмотреть бюджет без, например, LOAD-стенда.
 *
 * applyStandFilter принимает result calculate() и список выключенных стендов,
 * возвращает объект с пересчитанными ИТОГО / byCategory / byCostType только по
 * активным стендам. Поля stands и items копируются как есть — UI решает, как
 * их отображать (напр., приглушать выключенные).
 *
 * Если все стенды активны — возвращается исходный result без копий (short-circuit).
 */

import { STAND_IDS, CATEGORY_IDS, COST_TYPE_IDS } from '../utils/constants.js';

/**
 * @param {Object} result — результат calculate(calc, revision)
 * @param {string[]} [disabledStands=[]] — id стендов из STAND_IDS, исключённых из ИТОГО
 * @returns {Object} новый result с пересчитанными агрегатами; либо исходный, если ничего не выключено
 */
export function applyStandFilter(result, disabledStands = []) {
    if (!result) return result;
    const disabled = Array.isArray(disabledStands)
        ? disabledStands.filter(s => STAND_IDS.includes(s))
        : [];
    const active = STAND_IDS.filter(s => !disabled.includes(s));
    if (active.length === STAND_IDS.length) return result;

    const filtered = {
        // Поля стендов и итемов копируем по ссылке — UI решает, как показывать
        // выключенные (напр., приглушать или перечёркивать суммы).
        stands: result.stands,
        items: result.items,
        totalDaily: 0,
        totalMonthly: 0,
        totalAnnual: 0,
        byCategory: Object.fromEntries(CATEGORY_IDS.map(c => [c, 0])),
        byCostType: Object.fromEntries(COST_TYPE_IDS.map(c => [c, 0])),
        // Метаданные — какие стенды учтены и какие выключены (для UI).
        activeStands: active,
        disabledStands: disabled
    };

    for (const sid of active) {
        const b = result.stands?.[sid];
        if (!b) continue;
        filtered.totalDaily   += b.totalDaily   || 0;
        filtered.totalMonthly += b.totalMonthly || 0;
        filtered.totalAnnual  += b.totalAnnual  || 0;
        if (b.byCategory) {
            for (const cat of CATEGORY_IDS) {
                filtered.byCategory[cat] += b.byCategory[cat] || 0;
            }
        }
        if (b.byCostType) {
            for (const ct of COST_TYPE_IDS) {
                filtered.byCostType[ct] += b.byCostType[ct] || 0;
            }
        }
    }

    return filtered;
}
