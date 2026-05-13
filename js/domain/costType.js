/**
 * Тип расхода ЭК для бюджетного планирования: CAPEX или OPEX.
 *
 * Правило по умолчанию:
 *   billingInterval === 'oneTime'  → 'capex' (разовые работы, оборудование, лицензии-перпетуал)
 *   остальные интервалы            → 'opex'  (monthly / annual / daily — регулярные)
 *
 * Пользователь может вручную переопределить тип в форме редактирования ЭК
 * (item.costType = 'capex' | 'opex'). Если поле не задано — применяется правило
 * по умолчанию. Это сохраняет обратную совместимость со старыми JSON-файлами.
 */

import { COST_TYPE_IDS } from '../utils/constants.js';

/**
 * Определить тип расхода ЭК.
 *
 * @param {Object} item — элемент конфигурации
 * @returns {'capex'|'opex'}
 */
export function getCostType(item) {
    const explicit = item?.costType;
    if (explicit === 'capex' || explicit === 'opex') return explicit;
    return item?.billingInterval === 'oneTime' ? 'capex' : 'opex';
}

/**
 * Создать пустой агрегатор по типам расхода.
 */
export function makeZeroCostTypeMap() {
    return Object.fromEntries(COST_TYPE_IDS.map(t => [t, 0]));
}
