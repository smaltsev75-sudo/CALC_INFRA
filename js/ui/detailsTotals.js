/**
 * Shared totals helpers for the Details tab.
 *
 * Kept DOM-free so sorting/filtering math can evolve independently from table
 * rendering.
 */

import { STAND_IDS } from '../utils/constants.js';
import { getCostType } from '../domain/costType.js';

/**
 * Считает ИТОГО ₽/мес для ЭК по активным стендам.
 * Используется для определения «не влияет ли на бюджет».
 * В режиме «без рисков» суммы уже на costBase — функция работает прозрачно.
 */
export function itemMonthlyOnActiveStands(itemId, result, disabledStands) {
    const r = result.items[itemId];
    if (!r) return 0;
    let m = 0;
    for (const sid of STAND_IDS) {
        if (disabledStands.includes(sid)) continue;
        m += r.stands[sid]?.costFinal || 0;
    }
    return m;
}

/**
 * Сумма по отфильтрованному набору ЭК и активным стендам (для строки ИТОГО).
 * Возвращает структуру со всеми агрегатами, нужными footer'у.
 *
 * Колонки выключенных стендов сохраняют свои частичные суммы — UI приглушает
 * их визуально, но строка-сумма по стенду остаётся видимой; сами агрегаты
 * totalMonthly / byCostType — только по активным.
 */
export function computeTotalsForItems(items, result, disabledStands = []) {
    const disabled = new Set(disabledStands);
    const stands = {};
    const byCostType = { capex: 0, opex: 0 };
    let totalMonthly = 0;
    // Сумма «вклада риск-коэф. в ₽» по активным стендам — для footer'а.
    // Считаем по cell.costBase x (riskBreakdown.total - 1) — это наценка в рублях,
    // независимо от applyRisks (в режиме без рисков показывается потенциальная).
    let riskAmountTotal = 0;
    for (const sid of STAND_IDS) stands[sid] = { totalMonthly: 0 };
    for (const it of items) {
        const r = result.items[it.id];
        if (!r) continue;
        const ct = getCostType(it);
        let itemActive = 0;
        for (const sid of STAND_IDS) {
            const cell = r.stands[sid];
            const cf = cell?.costFinal || 0;
            stands[sid].totalMonthly += cf;
            if (!disabled.has(sid)) {
                itemActive += cf;
                if (cell?.costBase > 0) {
                    const totalRisk = cell.riskBreakdown?.total || 1;
                    riskAmountTotal += cell.costBase * (totalRisk - 1);
                }
            }
        }
        totalMonthly += itemActive;
        byCostType[ct] += itemActive;
    }
    return { stands, totalMonthly, byCostType, riskAmountTotal };
}
