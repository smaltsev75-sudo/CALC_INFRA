/**
 * Stage 14.5 (PATCH 2.7.3) — cross-provider scenario сравнение.
 *
 * Внутренний helper. Stage 16.6 (decommission): удалена сопутствующая
 * функция `simulateProviderPriceImpact` (использовалась только What-if UI,
 * orphaned после удаления), здесь остались только функции для сценарного
 * сравнения, которое работает в Stage 14.5 ProviderScenarioComparisonModal.
 */

import { calculate } from './calculator.js';
import { applyOverrideToItems } from './calcVersioning.js';

/**
 * Stage 14.5 (PATCH 2.7.3) — cross-provider scenario сравнение.
 *
 * Для одного активного calc: «как изменился бы totalMonthly + per-item
 * стоимость, если бы этот же calc работал на другом провайдере?». Используется
 * в `providerScenarioComparisonModal` — таблице items × providers.
 *
 * Pure domain (DI): caller передаёт effective-цены для всех сравниваемых
 * провайдеров через ctx.effectivePricesByProvider — domain не ходит в
 * services.
 *
 * Стратегия: для каждого provider'а собираем sim-calc с его effective ценами +
 * `__sim__` маркер в providerVersion (чтобы applyProviderOverlay не перетёр
 * items). Дельты считаем относительно current provider (calc.settings.provider).
 *
 * @param {Object} calc — расчёт; calc.settings.provider — текущий провайдер.
 * @param {string[]} providerIds — массив id провайдеров для сравнения.
 *   Должен включать текущий, чтобы UI показал deltaAbs=0 для baseline.
 * @param {Object} ctx
 * @param {Object<string, Object<string,{pricePerUnit:number,vendor?:string,priceSource?:string}>>}
 *   ctx.effectivePricesByProvider — { [pid]: { [itemId]: priceEntry } }
 * @param {Object<string,string>} [ctx.providerLabels] — { [pid]: 'human label' }
 * @returns {{
 *   currentProviderId: string|null,
 *   providers: Array<{
 *     id: string, label: string,
 *     totalMonthly: number, deltaAbs: number, deltaPct: number,
 *     perItem: Array<{ itemId:string, name:string, category:string,
 *                       pricePerUnit:number, totalMonthly:number,
 *                       deltaAbs:number, deltaPct:number }>
 *   }>
 * }}
 */
export function compareCalcAcrossProviders(calc, providerIds, ctx) {
    const empty = { currentProviderId: null, providers: [] };
    if (!calc || typeof calc !== 'object') return empty;
    const currentProviderId = calc.settings?.provider || null;

    if (!Array.isArray(providerIds)) {
        return { currentProviderId, providers: [] };
    }

    const effectivePricesByProvider = (ctx?.effectivePricesByProvider
        && typeof ctx.effectivePricesByProvider === 'object')
        ? ctx.effectivePricesByProvider : {};
    const providerLabels = (ctx?.providerLabels
        && typeof ctx.providerLabels === 'object')
        ? ctx.providerLabels : {};

    const simStamp = `__sim__@${Date.now()}`;

    /* Helper: посчитать sim-calc для конкретного provider'а и вернуть
       totalMonthly + per-item totalMonthly. */
    const simulateForProvider = (providerId) => {
        const effectivePrices = effectivePricesByProvider[providerId] || {};
        const baseItems = calc.dictionaries?.items || [];
        const simItems = applyOverrideToItems(baseItems, effectivePrices);
        const simCalc = {
            ...calc,
            settings: { ...calc.settings, provider: providerId },
            dictionaries: { ...calc.dictionaries, items: simItems },
            providerVersion: {
                id: providerId, version: simStamp,
                timestamp: new Date().toISOString()
            }
        };
        const res = calculate(simCalc);
        const total = Number(res?.totalMonthly) || 0;

        /* Per-item totalMonthly: calculate() уже возвращает агрегаты per item
           в result.items[itemId].totalMonthly (сумма по всем стендам). */
        const perItem = [];
        const itemsResult = res?.items || {};
        for (const item of simItems) {
            const itemAgg = itemsResult[item.id];
            const itemTotal = Number(itemAgg?.totalMonthly) || 0;
            perItem.push({
                itemId: item.id,
                name: item.name || item.id,
                category: item.category || '',
                pricePerUnit: Number(item.pricePerUnit) || 0,
                totalMonthly: itemTotal
            });
        }
        return { total, perItem };
    };

    /* Расчёт baseline — current provider. Используется для deltaAbs всех
       остальных. Если currentProviderId не в списке providerIds, baseline
       всё равно считаем из calc.settings.provider — это «point of view». */
    const baselineProviderId = currentProviderId;
    const baseline = baselineProviderId
        ? simulateForProvider(baselineProviderId)
        : { total: 0, perItem: [] };
    const baselineByItem = new Map(baseline.perItem.map(i => [i.itemId, i]));

    const providers = [];
    for (const pid of providerIds) {
        if (typeof pid !== 'string' || !pid) continue;
        const sim = simulateForProvider(pid);
        const deltaAbs = sim.total - baseline.total;
        const deltaPct = baseline.total !== 0
            ? (deltaAbs / baseline.total) * 100 : 0;

        const perItem = sim.perItem.map(it => {
            const baseItem = baselineByItem.get(it.itemId);
            const baseTotal = baseItem ? baseItem.totalMonthly : 0;
            const itDeltaAbs = it.totalMonthly - baseTotal;
            const itDeltaPct = baseTotal !== 0
                ? (itDeltaAbs / baseTotal) * 100 : 0;
            return { ...it, deltaAbs: itDeltaAbs, deltaPct: itDeltaPct };
        });

        providers.push({
            id: pid,
            label: providerLabels[pid] || pid,
            totalMonthly: sim.total,
            deltaAbs,
            deltaPct,
            perItem
        });
    }

    return { currentProviderId, providers };
}
