import { STAND_IDS, DASHBOARD_AI_METRIC_LABELS } from '../utils/constants.js';
import { formatNumber } from '../services/format.js';
import { SEED_ITEMS } from '../domain/seed.js';

// 12.U5: индекс dashboardResource из актуального SEED_ITEMS — fallback для
// расчётов, dictionary которых был сохранён до добавления поля. UI-only.
const SEED_ITEM_BY_ID = new Map(SEED_ITEMS.map(it => [it.id, it]));

/**
 * 12.U5: фиксированный порядок ресурсов на дашборде (CPU → GPU → RAM → SSD → HDD → S3).
 * Если в seed появятся новые ресурсы (LICENSE, NETWORK, ...) — добавить сюда.
 * Метки используются как заголовки колонок в блоке «Объёмы ресурсов».
 */
export const DASHBOARD_RESOURCE_ORDER = ['CPU', 'GPU', 'RAM', 'SSD', 'HDD', 'S3'];

/* ---------- 12.U5: агрегаты объёмов ресурсов (qty в нативных единицах) ---------- */

/**
 * Собирает агрегаты qty по dashboardResource. Структура:
 *   { perStand: { DEV: { CPU: {qty, unit}, ... }, ... },
 *     total:    { CPU: {qty, unit}, RAM: ..., SSD: ..., HDD: ..., S3: ... } }
 * Учитываются только ЭК с заполненным dashboardResource (либо в dictionary,
 * либо в SEED — fallback). qty per stand суммируется по всем ЭК с одной меткой.
 *
 * 12.U7: применяет тот же mode-toggle `applyRiskFactors`, что и стоимости.
 * При applyRisks=true qty домножается на capacity-буфер из cell.riskBreakdown:
 * bufferTask × bufferProject × seasonal × schedule × contingency.
 * VAT и inflation НЕ применяются (это финансовые множители, не capacity).
 */
export function aggregateResources(result, dictionaryItems, disabledStands, applyRisks) {
    const out = { perStand: {}, total: {} };

    const itemMap = new Map(dictionaryItems.map(it => [it.id, it]));

    /* 12.U10: pre-pass — для КАЖДОЙ метки из DASHBOARD_RESOURCE_ORDER собираем
       (a) множество применимых стендов (объединение `applicableStands` всех ЭК
       с этой меткой; для legacy без поля — fallback из SEED), (b) единицу
       измерения. Это нужно, чтобы потом отрисовать «—» с правильным tooltip:
       «не предусмотрено для этого стенда» vs «значение 0 при текущих ответах». */
    const labelInfo = {};
    for (const item of dictionaryItems) {
        const seedItem = SEED_ITEM_BY_ID.get(item.id);
        const label = item.dashboardResource ?? seedItem?.dashboardResource;
        if (!label) continue;
        if (!labelInfo[label]) labelInfo[label] = { stands: new Set(), unit: '' };
        const stands = (item.applicableStands && item.applicableStands.length > 0)
            ? item.applicableStands
            : (seedItem?.applicableStands || STAND_IDS);
        for (const sid of stands) labelInfo[label].stands.add(sid);
        if (!labelInfo[label].unit) labelInfo[label].unit = item.unit || '';
    }

    /* Инициализируем entry для ВСЕХ меток на каждом стенде — даже там, где
       qty останется 0. UI потом показывает либо число, либо «—» с tooltip
       по `applicable`. Это убирает «молчаливое скрытие»: пользователь видит
       полную картину «какие ресурсы вообще есть и где их нет». */
    for (const sid of STAND_IDS) {
        out.perStand[sid] = {};
        for (const label of DASHBOARD_RESOURCE_ORDER) {
            const info = labelInfo[label];
            out.perStand[sid][label] = {
                qty: 0,
                unit: info?.unit || '',
                applicable: info ? info.stands.has(sid) : false,
            };
        }
    }
    /* ИТОГО — метка применима, если есть АКТИВНЫЙ стенд (не disabled), на котором
       она применима. Если все применимые стенды отключены — на Hero «—» со ссылкой
       на toolbar «включите соответствующий стенд». */
    const activeStands = STAND_IDS.filter(sid => !disabledStands.includes(sid));
    for (const label of DASHBOARD_RESOURCE_ORDER) {
        const info = labelInfo[label];
        out.total[label] = {
            qty: 0,
            unit: info?.unit || '',
            applicable: info ? activeStands.some(sid => info.stands.has(sid)) : false,
        };
    }

    for (const [itemId, itemRes] of Object.entries(result.items || {})) {
        const item = itemMap.get(itemId) || SEED_ITEM_BY_ID.get(itemId);
        if (!item) continue;
        const label = item.dashboardResource ?? SEED_ITEM_BY_ID.get(itemId)?.dashboardResource;
        if (!label) continue;
        if (!out.total[label]) continue;  // метки нет в DASHBOARD_RESOURCE_ORDER

        for (const sid of STAND_IDS) {
            const cell = itemRes.stands?.[sid];
            if (!cell) continue;
            const baseQty = Number(cell.qty) || 0;
            if (baseQty <= 0) continue;

            // 12.U7: capacity-буфер для qty = всё кроме VAT и инфляции.
            // - bufferTask/bufferProject = «нужно больше vCPU/ГБ для запаса»
            // - seasonal/schedule = «нужно больше для пиков и сдвига»
            // - contingency = «резерв на непредвиденное»
            // - inflation = цена растёт, а не объём → исключаем
            // - VAT = налог, не capacity → исключаем
            const br = cell.riskBreakdown;
            const capacityMul = (applyRisks && br)
                ? br.bufferFactor * br.seasonalMul * br.scheduleMul * br.contingencyMul
                : 1;
            const q = baseQty * capacityMul;

            out.perStand[sid][label].qty += q;

            // ИТОГО — суммируем по всем стендам, кроме отключённых.
            if (!disabledStands.includes(sid)) {
                out.total[label].qty += q;
            }
        }
    }
    return out;
}

/** Форматирует qty по единице измерения: все значения округлены до
 *  ближайшего целого (PATCH 2.14.16). На дашборде блок «Объёмы ресурсов»
 *  показывает агрегаты — дробные хвосты (100,64 ТБ / 9 068,76 ТБ) только
 *  отвлекают от порядка величины. Раньше ТБ выводились с 2 знаками после
 *  запятой, vCPU/ГБ — Math.ceil. Унифицировано на Math.round для всех.
 *
 *  PATCH 2.14.16-fixup: per-stand qty уже округлены через
 *  distributeRoundingPreservingSum (Hare/Hamilton) — здесь Math.round
 *  идемпотентен для уже-целых значений; нужен только как защита для
 *  потребителей, передающих сырые qty (тестов, в т.ч.). */
export function formatResourceQty(qty, unit) {
    if (!Number.isFinite(qty) || qty <= 0) return null;
    return formatNumber(Math.round(qty), { min: 0, max: 0 });
}

/**
 * PATCH 2.14.16-fixup: распределить округление per-stand так, чтобы
 * sum(active rounded per-stand) === Math.round(total). Независимое
 * Math.round per-cell нарушает инвариант: 5 × 0,4 = 2,0; раздельно
 * округлённые → 5 × 0 = 0; ИТОГО round(2,0) = 2. Пользователь видит
 * 0+0+0+0+0=0 при «ИТОГО 2» — расхождение.
 *
 * Используется Hare/Hamilton (largest-remainder) метод:
 *   1. Floor каждой per-stand qty.
 *   2. delta = round(total) - sum(floors) — сколько единиц нужно
 *      раздать сверху.
 *   3. Сортировка по убыванию дробного остатка; первые delta стендов
 *      получают +1.
 *
 * Disabled-стенды не входят в активную сумму — округляются независимо
 * через Math.round (показываются в стенд-карточках, но не участвуют
 * в ИТОГО, поэтому могут расходиться без нарушения инварианта).
 *
 * Мутирует переданный resources на месте, возвращает его же для chaining.
 *
 * @param {{perStand: object, total: object}} resources — из aggregateResources
 * @param {string[]} activeStands — стенды, входящие в ИТОГО (== !disabledStands)
 * @returns {object} тот же resources (мутирован)
 */
export function distributeRoundingPreservingSum(resources, activeStands) {
    if (!resources || !resources.total || !resources.perStand) return resources;
    for (const label of Object.keys(resources.total)) {
        const totalCell = resources.total[label];
        const totalRaw = Number(totalCell.qty) || 0;
        const targetSum = Math.max(0, Math.round(totalRaw));

        const items = activeStands
            .filter(sid => resources.perStand[sid] && resources.perStand[sid][label])
            .map(sid => {
                const raw = Math.max(0, Number(resources.perStand[sid][label].qty) || 0);
                const floor = Math.floor(raw);
                return { sid, floor, remainder: raw - floor };
            });
        const sumOfFloors = items.reduce((s, it) => s + it.floor, 0);
        let delta = targetSum - sumOfFloors;
        if (delta > 0) {
            items.sort((a, b) => b.remainder - a.remainder);
            for (let i = 0; i < Math.min(delta, items.length); i++) items[i].floor += 1;
        } else if (delta < 0) {
            // Защитная ветка — математически невозможна для positive qty
            // (sum(floor) ≤ sum(raw) ≤ round(sum) для неотрицательных).
            items.sort((a, b) => a.remainder - b.remainder);
            for (let i = 0; i < Math.min(-delta, items.length); i++) {
                items[i].floor = Math.max(0, items[i].floor - 1);
            }
        }
        for (const it of items) {
            const cell = resources.perStand[it.sid][label];
            cell.qty = it.floor;
        }
        // Disabled — независимое округление; не влияют на инвариант суммы
        for (const sid of Object.keys(resources.perStand)) {
            if (activeStands.includes(sid)) continue;
            const cell = resources.perStand[sid][label];
            if (cell && Number.isFinite(cell.qty)) {
                cell.qty = Math.max(0, Math.round(cell.qty));
            }
        }
        totalCell.qty = targetSum;
    }
    return resources;
}

/* ============================================================
 * Этап 13.U6: AI / RAG / агенты — отдельная секция дашборда
 * ============================================================ */
export function aggregateAiMetrics(result, dictionaryItems, disabledStands, applyRisks) {
    const out = { perStand: {}, total: {} };
    const itemMap = new Map(dictionaryItems.map(it => [it.id, it]));

    /* pre-pass — applicable-стенды и unit на метку. */
    const labelInfo = {};
    for (const item of dictionaryItems) {
        const seedItem = SEED_ITEM_BY_ID.get(item.id);
        const label = item.dashboardAiMetric ?? seedItem?.dashboardAiMetric;
        if (!label) continue;
        if (!labelInfo[label]) labelInfo[label] = { stands: new Set(), unit: '' };
        const stands = (item.applicableStands && item.applicableStands.length > 0)
            ? item.applicableStands
            : (seedItem?.applicableStands || STAND_IDS);
        for (const sid of stands) labelInfo[label].stands.add(sid);
        if (!labelInfo[label].unit) labelInfo[label].unit = item.unit || '';
    }

    /* инициализация всех меток на всех стендах. */
    for (const sid of STAND_IDS) {
        out.perStand[sid] = {};
        for (const label of DASHBOARD_AI_METRIC_LABELS) {
            const info = labelInfo[label];
            out.perStand[sid][label] = {
                qty: 0,
                unit: info?.unit || '',
                applicable: info ? info.stands.has(sid) : false,
            };
        }
    }
    const activeStands = STAND_IDS.filter(sid => !disabledStands.includes(sid));
    for (const label of DASHBOARD_AI_METRIC_LABELS) {
        const info = labelInfo[label];
        out.total[label] = {
            qty: 0,
            unit: info?.unit || '',
            applicable: info ? activeStands.some(sid => info.stands.has(sid)) : false,
        };
    }

    for (const [itemId, itemRes] of Object.entries(result.items || {})) {
        const item = itemMap.get(itemId) || SEED_ITEM_BY_ID.get(itemId);
        if (!item) continue;
        const label = item.dashboardAiMetric ?? SEED_ITEM_BY_ID.get(itemId)?.dashboardAiMetric;
        if (!label) continue;
        if (!out.total[label]) continue;

        for (const sid of STAND_IDS) {
            const cell = itemRes.stands?.[sid];
            if (!cell) continue;
            const baseQty = Number(cell.qty) || 0;
            if (baseQty <= 0) continue;

            const br = cell.riskBreakdown;
            const capacityMul = (applyRisks && br)
                ? br.bufferFactor * br.seasonalMul * br.scheduleMul * br.contingencyMul
                : 1;
            const q = baseQty * capacityMul;

            out.perStand[sid][label].qty += q;
            if (!disabledStands.includes(sid)) {
                out.total[label].qty += q;
            }
        }
    }

    return distributeRoundingPreservingSum(out, activeStands);
}
