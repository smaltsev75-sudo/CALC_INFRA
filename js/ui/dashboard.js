/**
 * Дашборд — Hynex-стиль (Этап 9.6).
 *
 * Структура (асимметричная сетка):
 *   1) Hero — крупная hero-метрика ИТОГО за выбранный период + sparkline
 *      по 5 стендам. Соседние периоды (день/мес/год) — мелкими подписями.
 *   2) Структура расходов — donut по категориям + легенда (ИТОГО).
 *   3) 5 карточек стендов — компактные, per-stand цветовой акцент.
 *   4) Распределение по категориям — горизонтальные progress-bars
 *      (ИТОГО или по N активным стендам).
 *   5) Вклад рисков — pills с компонентами наценки.
 *
 * Все иконки — из icons.js (Lucide line-SVG). Эмодзи не используются.
 */

import { el } from './dom.js';
import {
    STAND_IDS, STAND_LABELS, STAND_DESCRIPTIONS,
    CATEGORY_IDS, CATEGORY_LABELS, CATEGORY_COLORS, CATEGORY_DESCRIPTIONS,
    PERIOD_IDS, PERIOD_LABELS, DEFAULT_PERIOD,
    COST_TYPE_LABELS, MONTHS_PER_YEAR
} from '../utils/constants.js';
/* 12.U11: на Дашборде все суммы — в тыс. ₽ без десятичных. Точность до рубля
   избыточна (оперируем сотнями тысяч и больше), сами рубли создают визуальный
   шум на крупных числах. В детализации/CSV/экспорте используется обычный
   formatRub — точность сохраняется там, где она нужна.
   12.U30-fix: пользователь явно требует «БЕЗ десятичных знаков на всех
   карточках Дашборда» (в т.ч. для дневного периода). Раньше day-период
   отображался с 1 знаком после запятой (50,4 + 112,3 = 162,7), чтобы
   суммы по компонентам сходились с total. Теперь все периоды округляются
   до целых тыс. — компромисс: на день (мелкие числа) capex+opex может
   расходиться с total на ±1 тыс. ₽ из-за независимых округлений. Ради
   единообразия отображения принято. */
import { formatNumber, formatRubThousands, percent } from '../services/format.js';
function fmtRubForPeriod(value, period) {
    return formatRubThousands(value, { fractionDigits: 0 });
}
const formatRub = formatRubThousands;
import { calculate } from '../domain/calculator.js';
import { applyStandFilter } from '../domain/standsFilter.js';
import { renderStandToggles } from './standToggles.js';
import { icon } from './icons.js';
import { infoIcon } from './dom.js';
import { renderVatBadge, renderVatBreakdownLine } from './vatBadge.js';
import { renderRiskBreakdownLine } from './riskBreakdown.js';
import { SEED_ITEMS } from '../domain/seed.js';
import {
    DASHBOARD_AI_METRIC_LABELS,
    DASHBOARD_AI_METRIC_TITLES,
    DASHBOARD_AI_METRIC_DESCRIPTIONS,
    DASHBOARD_AI_METRIC_GROUP_TITLE,
    DASHBOARD_AI_METRIC_GROUP_HINT,
    DASHBOARD_AI_METRIC_UNIT_SUFFIX
} from '../utils/constants.js';
import {
    PRODUCT_TYPE_LABELS, INDUSTRY_LABELS, SCALE_LABELS,
    GEOGRAPHY_LABELS, ACTIVITY_LABELS
} from '../domain/wizardProfiles.js';
import { renderCalculationStateSummary } from './calculationStateSummary.js';
import { renderScenarioBadge } from './scenarioBadge.js';

// 12.U5: индекс dashboardResource из актуального SEED_ITEMS — fallback для
// расчётов, dictionary которых был сохранён до добавления поля. UI-only.
const SEED_ITEM_BY_ID = new Map(SEED_ITEMS.map(it => [it.id, it]));

/**
 * 12.U5: фиксированный порядок ресурсов на дашборде (CPU → GPU → RAM → SSD → HDD → S3).
 * Если в seed появятся новые ресурсы (LICENSE, NETWORK, ...) — добавить сюда.
 * Метки используются как заголовки колонок в блоке «Объёмы ресурсов».
 */
const DASHBOARD_RESOURCE_ORDER = ['CPU', 'GPU', 'RAM', 'SSD', 'HDD', 'S3'];

/* ---------- Период ---------- */

function getPeriod(state) {
    const p = state.ui?.dashboardPeriod;
    return PERIOD_IDS.includes(p) ? p : DEFAULT_PERIOD;
}

function pickTotal(bucket, period) {
    if (!bucket) return 0;
    if (period === 'daily')  return bucket.totalDaily  || 0;
    if (period === 'annual') return bucket.totalAnnual || 0;
    return bucket.totalMonthly || 0;
}

function periodSubtitle(period) {
    return period === 'daily' ? 'в день' : period === 'annual' ? 'в год' : 'в месяц';
}

function periodSlash(period) {
    return period === 'daily' ? '/ день' : period === 'annual' ? '/ год' : '/ мес';
}

function periodMul(period) {
    return period === 'daily' ? 1 / 30 : period === 'annual' ? MONTHS_PER_YEAR : 1;
}

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
function aggregateResources(result, dictionaryItems, disabledStands, applyRisks) {
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

/**
 * Рендерит блок «Объёмы ресурсов» — список Label : qty unit.
 * @param {boolean} showModeBadge — показывать ли бейдж «С РИСКАМИ» / «БЕЗ РИСКОВ».
 *   На Hero (ИТОГО) — true (бейдж режима виден один раз для всего дашборда).
 *   На стенд-карточках — false (Hero уже показал бейдж, дублировать на каждой
 *   карточке = визуальный шум). Tooltip всё равно объясняет режим.
 */
function renderResourcesBlock(resourceMap, titleText, applyRisks = true, showModeBadge = false) {
    const rows = [];
    /* Tooltip несёт только режимную часть — НЕ дублирует видимое
       «CPU 100 vCPU». Объясняет, что объём ВКЛЮЧАЕТ или НЕ включает
       capacity-буферы (информация, которой нет в самой строке). */
    const modeNote = applyRisks
        ? 'Объём с capacity-буферами: задачи / проект / сезон / сдвиг / контингент. Без VAT и инфляции — это финансовые факторы, не capacity.'
        : 'Объём без capacity-буферов — голый расчёт. Включите «Учитывать риск-коэффициенты» в Опроснике для оценки с буферами.';
    for (const label of DASHBOARD_RESOURCE_ORDER) {
        const entry = resourceMap[label];
        if (!entry) continue;
        const formatted = formatResourceQty(entry.qty, entry.unit);
        if (formatted === null) {
            /* 12.U10: метка известна (есть ЭК с такой меткой в каталоге), но qty=0.
               Показываем «—» вместо silent skip — иначе пользователь не поймёт,
               есть ли вообще такой ресурс или это баг. Tooltip объясняет ПОЧЕМУ:
               - applicable=false → стенд не предусмотрен (HDD на DEV/IFT/LOAD).
               - applicable=true → стенд предусмотрен, но input-данные = 0. */
            const tooltip = entry.applicable
                ? 'При текущих ответах Опросника объём = 0. Заполните соответствующие вопросы (объёмы БД, файлов, пиковая нагрузка), чтобы появилась оценка.'
                : 'Для этого стенда не предусмотрено. Например, холодное хранилище (HDD) каталог закладывает только на ПРОМ и ПСИ — там реальные данные, нуждающиеся в архивных копиях.';
            rows.push(el('div', { class: 'dash-resource-row dash-resource-row-empty', title: tooltip },
                el('span', { class: 'dash-resource-row-label', text: label }),
                el('span', { class: 'dash-resource-row-value' },
                    el('span', { class: 'dash-resource-row-qty dash-resource-row-qty-empty', text: '—' })
                )
            ));
            continue;
        }
        rows.push(el('div', { class: 'dash-resource-row', title: modeNote },
            el('span', { class: 'dash-resource-row-label', text: label }),
            el('span', { class: 'dash-resource-row-value' },
                el('span', { class: 'dash-resource-row-qty', text: formatted }),
                el('span', { class: 'dash-resource-row-unit', text: entry.unit })
            )
        ));
    }
    if (rows.length === 0) return null;
    const modeBadge = (showModeBadge && applyRisks)
        ? el('span', { class: 'dash-resources-badge dash-resources-badge-risk',
            title: 'Объёмы включают capacity-буферы (задачи/проект/сезон/сдвиг/контингент). VAT и инфляция к объёмам не применяются — это финансовые, не capacity-факторы.',
            text: 'С РИСКАМИ' })
        : (showModeBadge ? el('span', { class: 'dash-resources-badge dash-resources-badge-base',
            title: 'Объёмы показаны без capacity-буферов — голый расчёт. Включите «Учитывать риск-коэффициенты в бюджете» в Опроснике, чтобы увидеть объёмы с буферами.',
            text: 'БЕЗ РИСКОВ' }) : null);
    return el('div', { class: 'dash-resources' },
        el('div', { class: 'dash-resources-header' },
            el('span', { class: 'dash-resources-title', text: titleText || 'Объёмы ресурсов' }),
            modeBadge
        ),
        el('div', { class: 'dash-resources-grid' }, ...rows)
    );
}

/* ============================================================
 * Этап 13.U6: AI / RAG / агенты — отдельная секция дашборда
 * ============================================================
 *
 * Аналог aggregateResources, но по полю `dashboardAiMetric` (а не
 * `dashboardResource`). Hardware-метрики (CPU/GPU/RAM/...) и AI-метрики
 * (TOKENS/RAG_VECTORS/EMBEDDINGS/AGENT_CPU) — две независимые оси.
 *
 * Один ЭК может иметь оба поля одновременно. Например, `ai-agent-sandbox-vcpu`
 * учтён и в `dashboardResource: 'CPU'` (часть общего CPU-агрегата), и в
 * `dashboardAiMetric: 'AGENT_CPU'` (информационная подсветка). Tooltip метрики
 * AGENT_CPU обязан явно написать «уже учтено в CPU», чтобы пользователь
 * не складывал дважды.
 */
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

            // Ровно тот же capacity-буфер что и для hardware-метрик: всё кроме VAT и инфляции.
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
    return out;
}

/**
 * Sub-block «Метрики AI / RAG / агентов» — параллельный блок к
 * renderResourcesBlock. Возвращает null, если в текущем scope (ИТОГО или
 * конкретный стенд) нет ни одной AI-ЭК с qty>0 — для не-AI расчётов и для
 * стендов, на которых AI не разворачивается, блок не появляется.
 *
 * Встраивается:
 *   - в Hero — через scope `aiMetrics.total` ниже «Объёмов ресурсов · ИТОГО»;
 *   - в каждую стенд-карточку — через `aiMetrics.perStand[sid]` ниже
 *     «Объёмов ресурсов» этого стенда.
 *
 * Бейдж режима НЕ показывается — он живёт в шапке родительской карточки
 * (Hero / стенд-карточка), дубль на той же карточке = визуальный шум
 * (принцип «DRY ВНУТРИ scope», CLAUDE.md §11).
 *
 * @param {object} metricMap — { TOKENS: {qty, unit, applicable}, ... }
 * @param {string} titleText — заголовок блока
 * @param {boolean} applyRisks — режим расчёта (для tooltip-хинтов)
 * @param {object} ctx — нужен openMessageModal для info-кнопок
 */
/* Sub-block AI-метрик. period влияет ТОЛЬКО на flow-метрики (TOKENS,
   EMBEDDINGS — поток в течение периода): qty масштабируется на periodMul,
   suffix меняется с «/мес» на «/день» или «/год». Capacity-метрики
   (RAG_VECTORS — размер индекса в ГБ, AGENT_CPU — кол-во vCPU) от
   периода не зависят: размер на стенде сегодня = такой же завтра. */
function renderAiMetricsBlock(metricMap, titleText, applyRisks, ctx, period = 'monthly') {
    // Скрываем блок, если в этом scope (total или per-stand) нет ни одной AI-ЭК.
    const hasAnyValue = DASHBOARD_AI_METRIC_LABELS.some(label => {
        const e = metricMap[label];
        return e && (e.qty > 0 || e.applicable);
    });
    if (!hasAnyValue) return null;

    const modeNote = applyRisks
        ? ' (с capacity-буферами: задачи/проект/сезон/сдвиг/контингент; без VAT и инфляции — финансовые факторы, не capacity)'
        : ' (без capacity-буферов — голый объём; включите «Учитывать риск-коэффициенты» в Опроснике для оценки с буферами)';

    /* period влияет только на flow-метрики (наличие непустого
       UNIT_SUFFIX = поток-семантика). Для capacity (пустой suffix)
       qty и unit остаются как есть, независимо от периода. */
    const periodMultiplier = periodMul(period);  // day=1/30, month=1, annual=12
    const periodSuffixText = periodSlash(period); // '/ день' | '/ мес' | '/ год'

    const rows = [];
    for (const label of DASHBOARD_AI_METRIC_LABELS) {
        const entry = metricMap[label];
        if (!entry) continue;
        const title = DASHBOARD_AI_METRIC_TITLES[label] || label;
        const desc = DASHBOARD_AI_METRIC_DESCRIPTIONS[label] || '';
        // Flow-метрика — есть непустой суффикс в DASHBOARD_AI_METRIC_UNIT_SUFFIX
        // (TOKENS, EMBEDDINGS). Capacity — пустой (RAG_VECTORS, AGENT_CPU).
        const isFlow = (DASHBOARD_AI_METRIC_UNIT_SUFFIX[label] || '').length > 0;

        // qty в periodMap всегда монтлы (агрегируется через capacity-буферы
        // по тому же правилу что hardware). Для flow-метрик умножаем на
        // periodMul, чтобы значение совпадало с выбранным периодом дашборда.
        const displayQty = isFlow ? entry.qty * periodMultiplier : entry.qty;
        const displaySuffix = isFlow ? ' ' + periodSuffixText : '';
        const fullUnit = entry.unit + displaySuffix;

        const intervalNote = isFlow
            ? ` Поток ${periodSuffixText.replace('/ ', 'за ')} — синхронен с переключателем периода.`
            : ' Размер на стенде — не зависит от интервала времени.';

        const openHint = (ev) => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            if (typeof ctx.openMessageModal === 'function') {
                ctx.openMessageModal({ title, message: desc });
            }
        };

        const formatted = formatResourceQty(displayQty, entry.unit);
        const isEmpty = formatted === null;

        /* Tooltip даёт ТОЛЬКО ту инфу, которой нет в видимой строке:
           для пустого qty — почему «—», для непустого — нюанс периода
           (поток vs. ёмкость) и режим расчёта (с буферами / без). Без
           префикса «Токены: 517 млн / мес» — это уже видно в самой строке. */
        const cellTooltip = isEmpty
            ? (entry.applicable
                ? 'При текущих ответах Опросника объём = 0. Заполните соответствующие вопросы про AI и поиск по корпоративной базе знаний, чтобы появилась оценка.'
                : 'На этом стенде эта нагрузка не предусмотрена (например, токены модели AI не закладываются на стенд разработки, если разработческие запросы не учитываются).')
            : `${intervalNote.trim()} ${modeNote.trim()}`.trim();

        const valueNode = isEmpty
            ? el('span', { class: 'dash-ai-metric-row-qty dash-ai-metric-row-qty-empty', text: '—' })
            : el('span', { class: 'dash-ai-metric-row-value' },
                el('span', { class: 'dash-ai-metric-row-qty', text: formatted }),
                el('span', { class: 'dash-ai-metric-row-unit', text: fullUnit })
            );

        rows.push(el('div', {
            class: ['dash-ai-metric-row', isEmpty && 'dash-ai-metric-row-empty'],
            title: cellTooltip
        },
            el('span', { class: 'dash-ai-metric-row-label-wrap' },
                el('span', { class: 'dash-ai-metric-row-label', text: title }),
                infoIcon(openHint, 'Подробное описание метрики')
            ),
            valueNode
        ));
    }

    const headerInfo = (typeof ctx.openMessageModal === 'function')
        ? infoIcon(
            (ev) => {
                ev?.preventDefault?.();
                ev?.stopPropagation?.();
                ctx.openMessageModal({
                    title: DASHBOARD_AI_METRIC_GROUP_TITLE,
                    message: DASHBOARD_AI_METRIC_GROUP_HINT
                });
            },
            'Что это за секция'
        )
        : null;

    return el('div', { class: 'dash-ai-metrics' },
        el('div', { class: 'dash-ai-metrics-header' },
            el('span', { class: 'dash-ai-metrics-title', text: titleText || DASHBOARD_AI_METRIC_GROUP_TITLE }),
            headerInfo
        ),
        el('div', { class: 'dash-ai-metrics-grid' }, ...rows)
    );
}

/* ---------- Допущения ---------- */

function countAssumptions(calc) {
    const questions = calc?.dictionaries?.questions || [];
    const answers = calc?.answers || {};
    let n = 0;
    for (const q of questions) {
        if (!q.allowUnknown) continue;
        const a = answers[q.id];
        if (a === null || a === undefined) { n++; continue; }
        const def = q.defaultIfUnknown;
        if (def === undefined) continue;
        if (Array.isArray(def) && Array.isArray(a)) {
            if (def.length === a.length && def.every((v, i) => v === a[i])) n++;
        } else if (a === def) {
            n++;
        }
    }
    return n;
}

/* ---------- Public render ---------- */

export function renderDashboard(state, ctx) {
    const calc = state.activeCalc;
    if (!calc) {
        return el('section', { class: 'tab-pane' },
            el('div', { class: 'dashboard-empty' },
                el('p', { text: 'Создайте расчёт во вкладке «Расчёты».' })
            )
        );
    }

    const result = calculate(calc, state.calcRevision);
    const disabledStands = calc.view?.disabledStands || [];
    const period = getPeriod(state);
    const assumptionCount = countAssumptions(calc);
    const activeStands = STAND_IDS.filter(s => !disabledStands.includes(s));
    // Режим определяется параметром расчёта в Опроснике, а не UI-toggle'ом.
    // По умолчанию — TRUE (с рисками); FALSE — «голая» базовая стоимость.
    const applyRisks = calc.settings?.applyRiskFactors !== false;
    const filtered = applyStandFilter(result, disabledStands);
    // 12.U5: агрегаты qty по dashboardResource (для блока «Объёмы ресурсов»).
    // 12.U7: применяется тот же mode-toggle applyRiskFactors что и для стоимостей —
    // при «С рисками» qty включает capacity-буферы (буфер задач/проекта/сезонный/
    // сдвиг/контингент); VAT и инфляция к qty не применяются (это финансовые,
    // не capacity-факторы).
    const resources = aggregateResources(result, calc.dictionaries?.items || [], disabledStands, applyRisks);
    // PATCH 2.14.16-fixup: распределяем округление так, чтобы
    // sum(active per-stand displayed) === total displayed для каждого ресурса.
    const _activeStandsForSum = STAND_IDS.filter(sid => !disabledStands.includes(sid));
    distributeRoundingPreservingSum(resources, _activeStandsForSum);
    // 13.U6: AI-метрики (TOKENS / RAG_VECTORS / EMBEDDINGS / AGENT_CPU) — параллельная
    // ось к hardware-агрегатам. Встраивается как sub-block в Hero (total) и в каждую
    // стенд-карточку (perStand[sid]) — рядом с «Объёмами ресурсов». Блок возвращает
    // null когда в этом scope нет ни одной AI-ЭК с qty>0 — для не-AI расчётов
    // ничего не появляется.
    const aiMetrics = aggregateAiMetrics(result, calc.dictionaries?.items || [], disabledStands, applyRisks);

    return el('section', { class: 'tab-pane' },

        /* === Toolbar === */
        el('div', { class: 'tab-toolbar' },
            el('div', { class: 'tab-title-group' },
                el('h2', { class: 'tab-title', text: 'Дэшборд' }),
                renderScenarioBadge(calc)
            ),
            el('div', { class: 'tab-toolbar-actions' },
                renderPeriodSwitcher(period, ctx),
                renderStandToggles(disabledStands, ctx),
                renderAssumptionsBtn(assumptionCount, ctx)
            )
        ),

        /* === Profile banner (14.U3) — только для wizard-расчётов === */
        renderProfileBanner(calc, ctx),

        /* === Grid === */
        el('div', { class: 'dashboard-grid' },
            renderHero(filtered, period, ctx, applyRisks, resources.total, calc, aiMetrics.total),
            // Stage 18.2 (PATCH 2.14.12): «Сводка состояния расчёта» —
            // композитный блок, объединяющий бывшие 4 карточки (Готовность /
            // Качество / Бюджет / Следующие шаги). presentation-only, читает
            // те же domain-источники, ctx-methods и getActiveNextSteps[0].
            renderCalculationStateSummary(calc, ctx),
            renderCategoriesCard(filtered, period, activeStands.length, ctx),
            renderRiskCard(filtered, calc, period, applyRisks),
            // Stage 18.2.x (PATCH 2.14.13): отдельная карточка «План оптимизации
            // стоимости» удалена — entry point встроен как secondary-action
            // внутри composite-сводки (renderCostOptimizationTeaser в
            // calculationStateSummary.js). Domain / контроллер / модалка не тронуты.
            renderStandsRow(result, period, disabledStands, ctx, resources.perStand, applyRisks, calc,
                state.ui?.standCardsCatsExpanded || [], aiMetrics.perStand)
        )
    );
}

/* ---------- Profile banner (14.U3 / Sprint 2.2 пункт 2) ----------
   Показывается ТОЛЬКО для расчётов, созданных через Quick Start Wizard
   (calc.wizard !== null). Для legacy-расчётов и созданных через «Новый расчёт»
   баннер отсутствует — это намеренный выбор пользователя (см. DECISIONS 14.U3).

   Содержимое:
     1) ⚡ «Профиль: {industryLabel} ({scaleLabel})» — компактная сводка.
     2) Три мини-счётчика источников полей: manual / profile / scale.
        Видимый сразу summary «насколько глубоко расчёт уже посещён»: пользователь
        видит, что он, например, изменил вручную 3 поля поверх 23-х предзаполненных
        из профиля и 14-ти от масштаба. Это ключевой сигнал перед re-apply
        (Sprint 2.2 пункт 3) — заранее понимать, сколько manual'ок пострадает.
     3) Кнопка «Изменить параметры» — открывает Quick Start в режиме edit
        с предзаполненным draft из calc.wizard.

   Tooltip всех элементов — полный состав wizard-параметров. */

/* Считает количество полей по каждому source. ~7 источников возможны
   (см. wizardProfiles.js: scale / profile / wizard / product_type /
   geography / activity / derived / sla_preset / compliance + manual).
   Группы для бейджа в баннере: manual, profile (объединяет profile/wizard/
   product_type/geography/activity), scale. Остальные (derived/sla_preset/
   compliance) — в общую группу «auto».

   PATCH 2.18.3 (audit-10, P2.1 defensive): опциональный второй аргумент `calc`
   фильтрует orphan-meta-keys — id, для которого нет ни вопроса в dictionary,
   ни валидного ответа в answers (типичный случай — stale meta после удаления
   вопроса миграцией). Без calc — backward-compatible поведение «count all». */
export function countAnswerSources(answersMeta, calc) {
    const counts = { manual: 0, profile: 0, scale: 0, auto: 0 };
    if (!answersMeta || typeof answersMeta !== 'object') return counts;

    // Orphan-filter активен только когда передан calc (новый API).
    let liveIds = null;
    if (calc && typeof calc === 'object') {
        const answers = calc.answers || {};
        const qIds = new Set(
            (calc.dictionaries?.questions || [])
                .filter(q => q && typeof q.id === 'string')
                .map(q => q.id)
        );
        liveIds = new Set();
        for (const [id, value] of Object.entries(answers)) {
            if (!qIds.has(id)) continue;
            if (value === null || value === undefined) continue;
            if (Array.isArray(value) && value.length === 0) continue;
            if (value === '') continue;
            liveIds.add(id);
        }
    }

    for (const [id, meta] of Object.entries(answersMeta)) {
        if (liveIds && !liveIds.has(id)) continue; // orphan — нет вопроса/ответа
        const s = meta?.source;
        if (s === 'manual') counts.manual++;
        else if (s === 'scale') counts.scale++;
        else if (s === 'profile' || s === 'wizard' || s === 'product_type'
              || s === 'geography' || s === 'activity') counts.profile++;
        else if (s === 'derived' || s === 'sla_preset' || s === 'compliance') counts.auto++;
    }
    return counts;
}

export function renderProfileBanner(calc, ctx) {
    const w = calc?.wizard;
    if (!w) return renderProfileBannerEmptyState(calc, ctx);

    const industry = INDUSTRY_LABELS[w.industry] || w.industry || '—';
    const scale    = SCALE_LABELS[w.scale]       || w.scale    || '—';
    const type     = PRODUCT_TYPE_LABELS[w.product_type] || w.product_type || '—';
    const geo      = GEOGRAPHY_LABELS[w.geography]       || w.geography    || '—';
    const activity = ACTIVITY_LABELS[w.activity]         || w.activity     || '—';
    const pdn      = w.pdn ? 'да' : 'нет';
    const ai       = w.ai_used ? 'используется' : 'нет';

    const counts = countAnswerSources(calc.answersMeta, calc);

    /* Sprint 3.0 Stage 2: scenario-aware label. Если у calc есть scenarios[]
       (миграция v15+), показываем активный scenario.label рядом с профилем —
       пользователь видит «Корпоративный SaaS · сценарий Базовый». Для legacy
       calc без scenarios скрываем — нет смысла показывать одну вкладку. */
    const scenarios = Array.isArray(calc.scenarios) ? calc.scenarios : [];
    const activeScenario = scenarios.length > 0
        ? (scenarios.find(s => s.id === calc.activeScenarioId) || scenarios[0])
        : null;
    const scenarioLabel = activeScenario && scenarios.length >= 1 ? activeScenario.label : null;
    /* Re-apply целит в активный scenario; manualCount тоже считается по
       answersMeta активного scenario (mirror на root, который читает
       countAnswerSources). */
    const manualCount = counts.manual;

    const tooltip = [
        `Тип продукта: ${type}`,
        `География: ${geo}`,
        `Активность: ${activity}`,
        `ПДн: ${pdn}`,
        `AI: ${ai}`,
        scenarioLabel ? '' : null,
        scenarioLabel ? `Активный сценарий: ${scenarioLabel}` : null,
        '',
        `Полей из профиля/мастера: ${counts.profile}`,
        `Полей из масштаба: ${counts.scale}`,
        `Изменено вручную: ${counts.manual}`,
        '',
        '7 макро-ответов задают предзаполнение полей опросника.',
        'Нажмите «Изменить параметры», чтобы пересмотреть профиль.'
    ].filter(line => line !== null).join('\n');

    const headerLabel = scenarioLabel
        ? `Профиль: ${industry} (${scale}) · сценарий ${scenarioLabel}`
        : `Профиль: ${industry} (${scale})`;

    return el('div', { class: 'profile-banner', attrs: { 'aria-label': 'Информация о профиле расчёта' } },
        el('span', { class: 'profile-banner-icon', attrs: { title: tooltip, 'aria-hidden': 'true' } },
            icon('zap', { size: 14 })
        ),
        el('span', { class: 'profile-banner-label', attrs: { title: tooltip },
            text: headerLabel }),
        el('span', { class: 'profile-banner-counts', attrs: { 'aria-label': 'Происхождение полей расчёта' } },
            renderSourceCount('profile', counts.profile),
            renderSourceCount('scale',   counts.scale),
            renderSourceCount('manual',  counts.manual)
        ),
        el('button', {
            class: 'btn btn-ghost btn-sm profile-banner-edit',
            attrs: { type: 'button', title: 'Открыть Quick Start с текущими параметрами профиля для активного сценария' },
            onClick: () => { if (typeof ctx.openQuickStartForEdit === 'function') ctx.openQuickStartForEdit(); }
        },
            icon('settings', { size: 14 }),
            el('span', { text: 'Изменить параметры' })
        ),
        /* Sprint 3.0 Stage 2: Re-apply кнопка рядом с «Изменить». Scope = активный
           scenario, manualCount = из mirror на root (который зеркалит
           scenarios[active].answersMeta). */
        el('button', {
            class: 'btn btn-ghost btn-sm profile-banner-reapply',
            attrs: {
                type: 'button',
                /* Stage 5.2: явное «к АКТИВНОМУ сценарию» — пользователь должен
                   понимать, что re-apply через mirror-pattern не затронет другие
                   сценарии (calcController.js:227-244 описывает механику). */
                title: scenarioLabel
                    ? `Применить профиль повторно к активному сценарию «${scenarioLabel}». Другие сценарии не изменятся. Можно сохранить ${manualCount} ручных правок или перезаписать всё.`
                    : `Применить профиль повторно к активному расчёту. ${manualCount} ручных правок будет предложено сохранить или перезаписать.`
            },
            onClick: () => { if (typeof ctx.openReapplyConfirm === 'function') ctx.openReapplyConfirm(); }
        },
            icon('refresh-cw', { size: 14 }),
            el('span', { text: 'Применить заново' })
        )
    );
}

/**
 * Stage 18.2 (v2.13.1) — empty-state карточка для сценариев без profile-wizard'а.
 *
 * Когда показывается:
 *   - У активного сценария `wizard === null`. Это случается в двух кейсах:
 *     a) legacy-сценарии, добавленные через `+ Сценарий` до v2.13.1 (тогда
 *        addScenario создавал `wizard: null`).
 *     b) пользователь явно завёл «голый» сценарий программно/через импорт.
 *
 *   С v2.13.1 новые сценарии через `+ Сценарий` наследуют wizard от активного,
 *   поэтому таких case'ов становится меньше — но empty-state остаётся для
 *   legacy и явных пустых.
 *
 * Что показывает:
 *   - Подпись «Профиль сценария не задан».
 *   - Короткое объяснение почему это важно.
 *   - CTA «Задать профиль сценария» → openQuickStartForActiveScenarioProfile.
 *
 * Что НЕ показывает:
 *   - source-counts (нет wizard'а — нет «полей из профиля»).
 *   - кнопку «Применить заново» (нечего применять).
 */
function renderProfileBannerEmptyState(calc, ctx) {
    if (!calc) return null;

    /* Имя активного сценария — для подсказки пользователю, к какому именно
       сценарию применится профиль. Для legacy-calc'ов без scenarios[] —
       virtual «Базовый» из getActiveScenario. */
    const scenarios = Array.isArray(calc.scenarios) ? calc.scenarios : [];
    const activeScenario = scenarios.length > 0
        ? (scenarios.find(s => s.id === calc.activeScenarioId) || scenarios[0])
        : null;
    const scenarioLabel = activeScenario?.label || null;

    return el('div', {
        class: 'profile-banner profile-banner-empty',
        attrs: { 'aria-label': 'У активного сценария не задан профиль Quick Start' }
    },
        el('span', { class: 'profile-banner-icon', attrs: { 'aria-hidden': 'true' } },
            icon('settings', { size: 14 })
        ),
        el('div', { class: 'profile-banner-empty-text' },
            el('span', { class: 'profile-banner-empty-title',
                text: scenarioLabel
                    ? `Профиль сценария «${scenarioLabel}» не задан`
                    : 'Профиль сценария не задан' }),
            el('span', { class: 'profile-banner-empty-hint',
                text: 'Задайте профиль Quick Start, чтобы предзаполнить параметры продукта и пользоваться кнопкой «Изменить параметры».' })
        ),
        el('button', {
            class: 'btn btn-primary btn-sm profile-banner-empty-action',
            attrs: { type: 'button',
                title: scenarioLabel
                    ? `Открыть Quick Start и задать профиль для сценария «${scenarioLabel}»`
                    : 'Открыть Quick Start и задать профиль активного сценария' },
            onClick: () => {
                if (typeof ctx.openQuickStartForActiveScenarioProfile === 'function') {
                    ctx.openQuickStartForActiveScenarioProfile();
                }
            }
        },
            icon('sparkles', { size: 14 }),
            el('span', { text: 'Задать профиль сценария' })
        )
    );
}

/* Один счётчик-пилюля. Визуально совпадает с source-бейджами в Опроснике
   (forms.css → .field-source-badge--{cls}), чтобы пользователь сразу узнавал
   палитру: «зелёный = из профиля», «синий = из масштаба», «outlined = ручная правка». */
/* Чипы рядом с заголовком профиля показывают «откуда» взялись ответы
   опросника: из мастера Quick Start (профиль), по масштабу проекта или
   ручные правки. У каждого чипа visible short-label (Stage 4.7) и
   развёрнутый tooltip (3-4 строки), чтобы пользователь сразу понимал:
     1) Что именно лежит в этой группе.
     2) Откуда оно появилось (мастер / шкала / ручная правка).
     3) Как обновить или поменять (Quick Start / re-apply / Опросник). */
const PROFILE_COUNT_CONFIG = {
    profile: {
        shortLabel: 'Профиль',
        tooltipTitle: 'Из профиля',
        tooltipExplain:
            'Поля, заполненные автоматически по 7 макро-ответам Quick Start: тип продукта, ' +
            'индустрия, география, активность, ПДн, AI. ' +
            'Чтобы пересмотреть — нажмите «Изменить параметры» или «Применить заново».'
    },
    scale: {
        shortLabel: 'Масштаб',
        tooltipTitle: 'Из масштаба',
        tooltipExplain:
            'Поля, рассчитанные по выбранному в Quick Start масштабу проекта (число пользователей ' +
            'и нагрузка). Меняются при смене размера или профиля в Quick Start.'
    },
    manual: {
        shortLabel: 'Вручную',
        tooltipTitle: 'Вы изменили',
        tooltipExplain:
            'Поля, изменённые вручную в Опроснике. Имеют приоритет над профилем и масштабом — ' +
            'при «Применить заново» вам предложат сохранить эти правки или перезаписать.'
    }
};

function renderSourceCount(cls, count) {
    const cfg = PROFILE_COUNT_CONFIG[cls];
    if (!cfg) return null;
    const unit = count === 1 ? 'поле' : 'поля/полей';
    /* Native title atrabute разбивает '\n' на переводы строк во всех современных
       браузерах — даёт читаемый многострочный tooltip без кастомного popover'а. */
    const title = `${cfg.tooltipTitle}: ${count} ${unit}\n\n${cfg.tooltipExplain}`;
    return el('span', {
        class: ['profile-banner-count', `field-source-badge`, `field-source-badge--${cls}`],
        attrs: { title }
    },
        el('span', { class: 'profile-banner-count-label', text: cfg.shortLabel }),
        el('span', { class: 'profile-banner-count-num', text: String(count) })
    );
}

/* ---------- Toolbar ---------- */

function renderPeriodSwitcher(period, ctx) {
    return el('div', { class: 'period-switcher', attrs: { role: 'group', 'aria-label': 'Период отображения' } },
        ...PERIOD_IDS.map(p =>
            el('button', {
                class: ['period-btn', p === period && 'period-btn-active'],
                title: `Показывать суммы ${PERIOD_LABELS[p]}`,
                attrs: { type: 'button', 'aria-pressed': p === period ? 'true' : 'false' },
                onClick: () => { if (p !== period) ctx.setUi?.({ dashboardPeriod: p }); }
            }, PERIOD_LABELS[p])
        )
    );
}

function renderAssumptionsBtn(count, ctx) {
    const hasAssumptions = count > 0;
    return el('button', {
        class: ['btn', 'btn-ghost', 'btn-icon-text', hasAssumptions && 'btn-warning'],
        title: hasAssumptions
            ? `Реестр допущений: ${count} ${count === 1 ? 'вопрос' : 'вопрос(а/ов)'} с принятым значением по умолчанию. Откройте опросник, чтобы заполнить недостающие ответы.`
            : 'Все вопросы заполнены — расчёт без допущений.',
        attrs: { type: 'button' },
        onClick: () => {
            if (typeof ctx.openAssumptionsModal === 'function') {
                ctx.openAssumptionsModal();
            } else {
                ctx.confirm?.({
                    title: 'Реестр допущений',
                    message: `Сейчас расчёт использует ${count} значение(й) по умолчанию. ` +
                        `Откройте опросник, чтобы заполнить недостающие ответы.`,
                    confirmLabel: 'OK'
                });
            }
        }
    },
        icon('alert-triangle', { size: 16 }),
        el('span', { text: `Допущения${hasAssumptions ? ` (${count})` : ''}` })
    );
}

/* ---------- Hero ---------- */

function renderHero(result, period, ctx, applyRisks = true, totalResources = null, calc = null, totalAiMetrics = null) {
    // period передаётся в renderAiMetricsBlock ниже — flow-метрики (TOKENS,
    // EMBEDDINGS) пересчитаются в выбранный интервал (день/мес/год).
    const total = pickTotal(result, period);
    const sub = periodSubtitle(period);
    const mul = periodMul(period);
    const slash = periodSlash(period);

    // 12.U25-fix-6: cells активных стендов для подсчёта суммы рисков в Hero.
    // result.stands копируется по ссылке из filtered (см. applyStandFilter), поэтому
    // фильтруем по result.disabledStands (выставлен только при активном фильтре).
    const heroDisabled = result.disabledStands || [];
    const heroCells = STAND_IDS
        .filter(sid => !heroDisabled.includes(sid))
        .flatMap(sid => result.stands?.[sid]?.items || []);

    // Потенциальная наценка от риск-коэффициентов (всегда считается информационно
    // независимо от applyRisks). В режиме «с рисками» pill означает «уже включено
    // в итог»; в режиме «без рисков» — «было бы +X% если применить».
    // Берём через computeRiskContribution — он одинаково работает в обоих режимах.
    const riskInfo = computeRiskContribution(result, result.disabledStands || []);
    const surplusPct = riskInfo ? riskInfo.surplus * 100 : 0;

    const altPeriods = PERIOD_IDS
        .filter(p => p !== period)
        .map(p => ({
            id: p,
            label: periodSubtitle(p),
            value: p === 'daily' ? result.totalDaily : p === 'annual' ? result.totalAnnual : result.totalMonthly
        }));

    // CAPEX/OPEX из агрегата по активным стендам (filtered).
    const byCostType = result.byCostType || { capex: 0, opex: 0 };
    const ctSum = (byCostType.capex || 0) + (byCostType.opex || 0);
    const capexPct = ctSum > 0 ? byCostType.capex / ctSum : 0;
    const opexPct  = ctSum > 0 ? byCostType.opex  / ctSum : 0;

    return el('article', { class: ['dash-card', 'dash-card-hero', !applyRisks && 'dash-card-hero-base'] },
        el('div', { class: 'dash-card-header' },
            el('div', { class: 'dash-card-eyebrow' },
                icon('trending-up', { size: 14 }),
                el('span', { text: 'Итого по расчёту' }),
                applyRisks
                    ? el('span', { class: 'dash-card-eyebrow-tag',
                        title: 'Итог считается с учётом риск-коэффициентов (буферы, инфляция, сезонность, сдвиг, резерв). Переключатель — в Опроснике, поле «Учитывать риск-коэффициенты в бюджете».',
                        text: 'С РИСКАМИ' })
                    : el('span', { class: 'dash-card-eyebrow-tag dash-card-eyebrow-tag-warn',
                        title: 'Итог считается БЕЗ риск-коэффициентов — это «голая» базовая стоимость по прайс-листам. Переключатель — в Опроснике, поле «Учитывать риск-коэффициенты в бюджете».',
                        text: 'БЕЗ РИСКОВ' }),
                /* 12.U23: НДС — независимая ось от рисков. Бейдж рядом, чтобы пользователь
                   видел оба статуса одним взглядом и не путал «без рисков» с «без НДС». */
                calc ? renderVatBadge(calc) : null
            ),
            /* 12.U30-fix: унифицировано со стенд-карточками — иконка-кнопка
               `dash-stand-card-link` (arrow-up-right 14px без текста) вместо
               прежней `dash-hero-action` с подписью «Детали расчёта». Один
               UI-паттерн «открыть подробности» во всех карточках Дашборда.
               Информационная кнопка-формула (info-icon) — справа, как раньше. */
            el('div', { class: 'dash-hero-actions' },
                el('button', {
                    class: 'dash-stand-card-link',
                    title: 'Открыть постатейную детализацию расчёта',
                    attrs: { type: 'button', 'aria-label': 'Открыть детализацию' },
                    onClick: () => ctx.openStandDetails?.()
                }, icon('arrow-up-right', { size: 14 })),
                el('button', {
                    class: 'info-icon',
                    title: 'Как считается итог',
                    attrs: { type: 'button', 'aria-label': 'Показать формулу' },
                    onClick: () => ctx.openSummaryFormula?.()
                }, icon('info', { size: 12 }))
            )
        ),

        el('div', { class: 'dash-hero-body' },
            el('div', { class: 'dash-hero-main' },
                el('div', { class: 'dash-hero-value' },
                    el('span', { class: 'dash-hero-value-amount', text: fmtRubForPeriod(total, period) }),
                    el('span', { class: 'dash-hero-value-unit', text: slash })
                ),
                /* 12.U23: разбивка НДС — «НДС: X тыс. ₽ /мес» под главной суммой.
                   Когда НДС выключен — null (бейдж «БЕЗ НДС» сам всё сказал).
                   useThousands=true — на Дашборде все суммы с точностью до тысяч. */
                calc ? renderVatBreakdownLine(calc, total, slash, { useThousands: true }) : null,
                /* 12.U25-fix-6/8: разбивка суммы рисков — «Риски: Y тыс. ₽ /мес [+86.6% от базы]».
                   Inline-пилл с процентом передаётся ТОЛЬКО на Hero (для стенд-карточек
                   процент = шум, там просто «Риски: ₽»). Раньше пилл стоял отдельной
                   строкой над НДС/Рисками — теперь логически склеен с риск-наценкой. */
                renderRiskBreakdownLine(heroCells, applyRisks, mul, slash,
                    riskInfo ? riskInfo.surplus * 100 : null, { useThousands: true })
            ),
            /* Соседние периоды — один слева (меньший по таймскейлу: day < month < year),
               другой справа (больший). Симметрично смотрятся под главным числом. */
            altPeriods.length === 2
                ? el('div', { class: 'dash-hero-alt' },
                    el('div', { class: 'dash-hero-alt-item dash-hero-alt-item-left' },
                        el('span', { class: 'dash-hero-alt-value',
                            text: fmtRubForPeriod(altPeriods[0].value, altPeriods[0].id) }),
                        el('span', { class: 'dash-hero-alt-label', text: altPeriods[0].label })
                    ),
                    el('div', { class: 'dash-hero-alt-item dash-hero-alt-item-right' },
                        el('span', { class: 'dash-hero-alt-value',
                            text: fmtRubForPeriod(altPeriods[1].value, altPeriods[1].id) }),
                        el('span', { class: 'dash-hero-alt-label', text: altPeriods[1].label })
                    )
                )
                : null
        ),

        /* Структура расходов (CAPEX / OPEX) — 12.U25-fix-18:
         * - Eyebrow «СТРУКТУРА РАСХОДОВ» делает блок отдельной семантической секцией.
         * - Tabular alignment через grid-template-columns: dot|label|amount|pct.
         *   Все 4 ряда лежат в одной сетке, цифры выровнены по столбцу справа. */
        ctSum > 0
            ? el('div', { class: 'dash-hero-cost-types' },
                el('div', { class: 'dash-hero-cost-type-label', text: 'Структура расходов' }),
                /* 12.U25-fix-19: stacked progress bar — визуально показывает пропорцию
                   CAPEX/OPEX одной полосой (фиолетовый + бирюзовый сегменты). Под ней
                   идут две строки с суммами и % — числа лежат в одной grid-сетке. */
                el('div', {
                    class: 'dash-hero-cost-types-bar',
                    attrs: { role: 'img',
                        'aria-label': `CAPEX ${(capexPct * 100).toFixed(1)}%, OPEX ${(opexPct * 100).toFixed(1)}%` }
                },
                    el('span', {
                        class: 'dash-hero-cost-types-bar-capex',
                        style: { width: `${(capexPct * 100).toFixed(2)}%` }
                    }),
                    el('span', {
                        class: 'dash-hero-cost-types-bar-opex',
                        style: { width: `${(opexPct * 100).toFixed(2)}%` }
                    })
                ),
                el('div', { class: 'dash-cost-row dash-cost-row-capex',
                    title: 'CAPEX — капитальные (разовые) затраты: внедрение, аттестация, аудит, обучение, единоразовая закупка лицензий и оборудования.'
                },
                    el('span', { class: 'dash-cost-row-dot' }),
                    el('span', { class: 'dash-cost-row-label', text: 'CAPEX' }),
                    el('span', { class: 'dash-cost-row-amount',
                        text: `${fmtRubForPeriod((byCostType.capex || 0) * mul, period)} ${slash}` }),
                    el('span', { class: 'dash-cost-row-pct', text: percent(capexPct) })
                ),
                el('div', { class: 'dash-cost-row dash-cost-row-opex',
                    title: 'OPEX — операционные (регулярные) затраты: облако, лицензии-подписки, услуги, токены LLM, support.'
                },
                    el('span', { class: 'dash-cost-row-dot' }),
                    el('span', { class: 'dash-cost-row-label', text: 'OPEX' }),
                    el('span', { class: 'dash-cost-row-amount',
                        text: `${fmtRubForPeriod((byCostType.opex || 0) * mul, period)} ${slash}` }),
                    el('span', { class: 'dash-cost-row-pct', text: percent(opexPct) })
                )
            )
            : null,

        /* 12.U5/U7/U8: Объёмы ресурсов (CPU/RAM/SSD/HDD/S3 etc.) — ИТОГО по активным стендам.
           qty учитывает applyRiskFactors так же, как и стоимости в Hero. Бейдж режима НЕ
           показываем — он уже есть в шапке Hero «Итого по расчёту С РИСКАМИ / БЕЗ РИСКОВ»,
           дубль на той же карточке = визуальный шум (принцип №22). */
        totalResources ? renderResourcesBlock(totalResources, 'Объёмы ресурсов · ИТОГО', applyRisks, /*showModeBadge*/ false) : null,

        /* 13.U6: Метрики AI / RAG / агентов — отдельная ось, аналогично «Объёмам ресурсов».
           Блок возвращает null если AI-нагрузки в расчёте нет — секция не появляется
           для не-AI проектов и Hero остаётся компактным. */
        totalAiMetrics ? renderAiMetricsBlock(totalAiMetrics, 'Объёмы AI-нагрузки · ИТОГО', applyRisks, ctx, period) : null
    );
}

/* ---------- Стенды (5 карточек, отсортированных по убыванию суммы) ---------- */

function renderStandsRow(result, period, disabledStands, ctx, perStandResources = {}, applyRisks = true, calc = null, expandedCats = [], perStandAiMetrics = {}) {
    // Сортируем по убыванию `data.totalMonthly`. Disabled-стенды всё равно показываем
    // (приглушёнными), но в конце списка — чтобы сначала шли активные.
    const sorted = STAND_IDS.slice().sort((a, b) => {
        const aOff = disabledStands.includes(a) ? 1 : 0;
        const bOff = disabledStands.includes(b) ? 1 : 0;
        if (aOff !== bOff) return aOff - bOff;
        const am = result.stands?.[a]?.totalMonthly || 0;
        const bm = result.stands?.[b]?.totalMonthly || 0;
        return bm - am;
    });

    return el('section', { class: 'dash-stands-row' },
        el('div', { class: 'dash-section-title' },
            el('span', { text: 'Стенды' })
        ),
        el('div', { class: 'dash-stands-grid' },
            ...sorted.map(sid => renderStandCard(
                sid, result, period, ctx, disabledStands.includes(sid),
                perStandResources[sid] || {}, applyRisks, calc,
                expandedCats.includes(sid),
                perStandAiMetrics[sid] || {}
            ))
        )
    );
}

function renderStandCard(sid, result, period, ctx, isDisabled, standResources = {}, applyRisks = true, calc = null, catsExpanded = false, standAiMetrics = {}) {
    const data = result.stands?.[sid];
    if (!data) return null;
    const total = pickTotal(data, period);
    const share = result.totalMonthly > 0 ? data.totalMonthly / result.totalMonthly : 0;
    const slash = periodSlash(period);
    // alt-период: если основной — мес/день/год, alt берёт другой, отличный от него.
    // Месяц без дробных тыс. — нет смысла; день — 1 знак для согласованности сумм.
    const alt = period === 'monthly'
        ? `${fmtRubForPeriod(data.totalAnnual, 'annual')} / год`
        : `${fmtRubForPeriod(data.totalMonthly, 'monthly')} / мес`;

    const byCat = data.byCategory || {};
    const totalStandMonthly = data.totalMonthly || 0;
    const topCats = CATEGORY_IDS
        .filter(c => (byCat[c] || 0) > 0)
        .sort((a, b) => (byCat[b] || 0) - (byCat[a] || 0));

    const byCostType = data.byCostType || { capex: 0, opex: 0 };
    const ctSum = (byCostType.capex || 0) + (byCostType.opex || 0);
    const capexPct = ctSum > 0 ? byCostType.capex / ctSum : 0;
    const opexPct  = ctSum > 0 ? byCostType.opex  / ctSum : 0;

    const cardArticle = el('article', {
        class: ['dash-stand-card', `stand-card-${sid}`, isDisabled && 'dash-stand-card-disabled']
    },
        /* 12.U24-fix-3: explicit 2-row структура шапки.
         *   row1 (.dash-stand-card-header-top): icon + title-col + arrow
         *   row2 (.dash-stand-card-badges): risk-бейдж + VAT-бейдж
         * Header — flex-direction: column, поэтому ряды всегда лежат друг под другом
         * независимо от длины subtitle. Старая версия полагалась на flex-wrap +
         * `flex-basis: 100%` на бейджах: для коротких subtitle работало, но на
         * длинном (ИФТ — «Интеграционно-функциональное тестирование») arrow
         * переносился на отдельную строку, header растягивался на 3 ряда, числа
         * в разных карточках оказывались на разных вертикальных уровнях. */
        el('div', { class: 'dash-stand-card-header' },
            el('div', { class: 'dash-stand-card-header-top' },
                el('div', { class: 'dash-stand-card-title-wrap' },
                    el('span', { class: 'dash-stand-card-icon' }, icon('server', { size: 16 })),
                    el('div', { class: 'dash-stand-card-title-col' },
                        el('div', { class: 'dash-stand-card-title', text: STAND_LABELS[sid] }),
                        el('div', { class: 'dash-stand-card-subtitle', text: STAND_DESCRIPTIONS[sid] })
                    )
                ),
                el('button', {
                    class: 'dash-stand-card-link',
                    title: 'Открыть детализацию',
                    attrs: { type: 'button', 'aria-label': 'Открыть детализацию' },
                    onClick: () => ctx.openStandDetails?.(sid)
                }, icon('arrow-up-right', { size: 14 }))
            ),
            /* Бейджи в шапке: С РИСКАМИ + С НДС + Доля от итого. На отдельной строке
               под title-row (12.U24-fix-3 explicit 2-row).
               12.U9: бейдж режима — маркер scope ВСЕЙ карточки.
               12.U23: VAT-бейдж — независимый маркер (принцип №22 DRY ВНУТРИ scope).
               12.U25-fix-5: share-бейдж — третий пилл, показывает только %; полное
               пояснение «доля стоимости стенда в общей стоимости расчёта» — в title. */
            el('div', { class: 'dash-stand-card-badges' },
                applyRisks
                    ? el('span', { class: 'dash-stand-card-badge dash-resources-badge dash-resources-badge-risk',
                        title: 'Все суммы и объёмы карточки считаются с учётом риск-коэффициентов (буферы, инфляция, сезонность, сдвиг, резерв). НДС — отдельная ось, см. соседний бейдж. Переключатель рисков — в Опроснике.',
                        text: 'С РИСКАМИ' })
                    : el('span', { class: 'dash-stand-card-badge dash-resources-badge dash-resources-badge-base',
                        title: 'Все суммы и объёмы карточки — БЕЗ риск-коэффициентов (голая базовая стоимость по прайс-листам).',
                        text: 'БЕЗ РИСКОВ' }),
                calc ? renderVatBadge(calc) : null,
                el('span', {
                    class: 'dash-stand-card-share-badge',
                    title: `Доля стоимости этого стенда в общей стоимости расчёта по активным стендам. ` +
                           `Стенд ${STAND_LABELS[sid]} — ${percent(share)} от ИТОГО (${formatRub(result.totalMonthly || 0)} / мес).`,
                    text: percent(share)
                })
            )
        ),

        el('div', { class: 'dash-stand-card-numbers' },
            el('div', { class: 'dash-stand-card-total' },
                el('span', { class: 'dash-stand-card-total-value', text: fmtRubForPeriod(total, period) }),
                el('span', { class: 'dash-stand-card-total-unit', text: slash })
            ),
            /* 12.U25-fix-3: сумма НДС — прямая визуальная связь «total → НДС-составляющая».
               useThousands=true — на Дашборде все суммы с точностью до тысяч. */
            calc ? renderVatBreakdownLine(calc, total, slash, { useThousands: true }) : null,
            /* 12.U25-fix-6: сумма риск-наценки этого стенда — параллельно VAT, под ним.
               cells = data.items (все ячейки этого стенда). При applyRisks=false → null. */
            renderRiskBreakdownLine(data.items || [], applyRisks, periodMul(period), slash, null, { useThousands: true }),
            el('div', { class: 'dash-stand-card-alt', text: alt })
        ),

        /* 12.U26-fix: бейдж «Исключён из ИТОГО» вынесен ВЫШЕ карточки в slot-обёртку
           (см. renderStandCard) — иначе opacity: 0.4 у `.dash-stand-card-disabled`
           глушил его и пользователь не видел причину disabled-состояния. */

        /* CAPEX / OPEX — суммы с долями. Размещаем ВЫШЕ «По категориям»: тип расхода
           (капекс vs опекс) — более крупный финансовый разрез, чем разбивка по категориям
           ЭК. Пользователь сначала видит структуру бюджета, потом — детализацию категорий. */
        ctSum > 0
            ? el('div', { class: 'dash-stand-card-cost-types' },
                el('div', { class: 'dash-cost-row dash-cost-row-capex',
                    title: `${COST_TYPE_LABELS.capex}: капитальные (разовые) затраты`
                },
                    el('span', { class: 'dash-cost-row-dot' }),
                    el('span', { class: 'dash-cost-row-label', text: 'CAPEX' }),
                    /* 12.U30-fix: интервал времени (slash) обязателен — без него
                       пользователь не понимает период при переключении day/мес/год. */
                    el('span', { class: 'dash-cost-row-amount',
                        text: `${fmtRubForPeriod((byCostType.capex || 0) * periodMul(period), period)} ${slash}` }),
                    el('span', { class: 'dash-cost-row-pct', text: percent(capexPct) })
                ),
                el('div', { class: 'dash-cost-row dash-cost-row-opex',
                    title: `${COST_TYPE_LABELS.opex}: операционные (регулярные) затраты`
                },
                    el('span', { class: 'dash-cost-row-dot' }),
                    el('span', { class: 'dash-cost-row-label', text: 'OPEX' }),
                    el('span', { class: 'dash-cost-row-amount',
                        text: `${fmtRubForPeriod((byCostType.opex || 0) * periodMul(period), period)} ${slash}` }),
                    el('span', { class: 'dash-cost-row-pct', text: percent(opexPct) })
                )
            )
            : null,

        /* По категориям — collapsible (12.U25-fix-17). По умолчанию свёрнут;
         * раскрытое состояние per-stand сохраняется в state.ui.standCardsCatsExpanded
         * и переживает F5 (persist через subscriber в app.js).
         * Нажатие на header-кнопку → ctx.toggleStandCatsExpanded(sid). */
        topCats.length > 0
            ? el('div', { class: ['dash-stand-card-cats', catsExpanded && 'dash-stand-card-cats-expanded'] },
                el('button', {
                    class: 'dash-stand-card-cats-toggle',
                    attrs: {
                        type: 'button',
                        'aria-expanded': String(!!catsExpanded),
                        'aria-controls': `cats-body-${sid}`
                    },
                    title: catsExpanded
                        ? 'Свернуть распределение по категориям'
                        : 'Развернуть распределение по категориям',
                    onClick: e => { e.stopPropagation(); ctx.toggleStandCatsExpanded?.(sid); }
                },
                    el('span', { class: 'dash-stand-card-cats-title', text: 'По категориям' }),
                    /* Иконка одна, поворот ↑/↓ через CSS-transform на
                       `.dash-stand-card-cats-expanded .chevron`. Плавный rotate. */
                    el('span', { class: 'dash-stand-card-cats-chevron' },
                        icon('chevron-down', { size: 14 })
                    )
                ),
                catsExpanded
                    ? el('div', { class: 'dash-stand-card-cats-body', attrs: { id: `cats-body-${sid}` } },
                        el('div', { class: 'dash-stand-card-cats-bar', attrs: { role: 'img',
                            'aria-label': 'Распределение по категориям' } },
                            ...topCats.map(cat => {
                                const v = byCat[cat] || 0;
                                const w = totalStandMonthly > 0 ? (v / totalStandMonthly) * 100 : 0;
                                return el('span', {
                                    class: 'dash-stand-card-cats-seg',
                                    style: { width: `${w.toFixed(2)}%`, background: CATEGORY_COLORS[cat] },
                                    title: `${CATEGORY_LABELS[cat]}: ${formatRub(v)} ${slash} (${percent(v / totalStandMonthly)})`
                                });
                            })
                        ),
                        el('div', { class: 'dash-stand-card-cats-legend' },
                            ...topCats.map(cat => {
                                const v = byCat[cat] || 0;
                                const share = totalStandMonthly > 0 ? v / totalStandMonthly : 0;
                                /* Stand-карточки узкие (5 в ряд), label-колонка получает
                                   ~30-40px и обрезается до 3 символов. title= на самой
                                   строке legend-item — hover в любом месте показывает
                                   полное имя категории + точную сумму и долю. */
                                return el('div', {
                                    class: 'dash-stand-card-cats-legend-item',
                                    title: `${CATEGORY_LABELS[cat]}: ${fmtRubForPeriod(v * periodMul(period), period)} ${slash} (${percent(share)})`
                                },
                                    el('span', { class: 'dash-stand-card-cats-legend-dot',
                                        style: { background: CATEGORY_COLORS[cat] } }),
                                    el('span', { class: 'dash-stand-card-cats-legend-label', text: CATEGORY_LABELS[cat] }),
                                    /* 12.U30-fix: интервал (slash) — без него пользователь
                                       не понимает, в каком периоде сумма по категории. */
                                    el('span', { class: 'dash-stand-card-cats-legend-amount',
                                        text: `${fmtRubForPeriod(v * periodMul(period), period)} ${slash}` }),
                                    el('span', { class: 'dash-stand-card-cats-legend-pct',
                                        text: percent(share) })
                                );
                            })
                        )
                    )
                    : null
            )
            : null,

        /* 12.U5/U7/U8/U9: Объёмы ресурсов на этом стенде (qty с/без рисков по тому же
           toggle, что и стоимости карточки). Бейдж режима НЕ показываем здесь — он переехал
           в шапку карточки (рядом с названием стенда), потому что (1) это маркер scope ВСЕЙ
           карточки, (2) для вертикального выравнивания «Объёмов ресурсов» между карточками
           бейдж не должен жить ВНУТРИ выравниваемого блока. */
        renderResourcesBlock(standResources, 'Объёмы ресурсов', applyRisks, /*showModeBadge*/ false),

        /* 13.U6: Метрики AI / RAG / агентов на этом стенде. Возвращает null если на стенде
           нет ни одной AI-ЭК с qty>0 (например, на DEV токены не закладываются — блок
           автоматически скроется). */
        renderAiMetricsBlock(standAiMetrics, 'Объёмы AI-нагрузки', applyRisks, ctx, period)
    );

    /* 12.U26-fix: бейдж «Исключён из ИТОГО» — sibling карточки в slot-обёртке.
       Раньше бейдж жил ВНУТРИ карточки и его «съедал» opacity: 0.4 disabled-карточки. */
    if (!isDisabled) return cardArticle;
    return el('div', { class: 'dash-stand-card-slot' },
        el('div', {
            class: 'dash-stand-card-excluded-banner',
            title: 'Стенд исключён из ИТОГО. Чтобы вернуть — нажмите его кнопку в строке «Стенды:» в шапке Дашборда.',
            text: 'Исключён из ИТОГО'
        }),
        cardArticle
    );
}

/* ---------- Распределение по категориям · ИТОГО ---------- */

/* AI-strip с подметриками (TOKENS / RAG_VECTORS / EMBEDDINGS / AGENT_CPU)
   ранее рендерился под прогресс-баром AI-категории. Удалён, потому что
   та же информация уже есть в Hero-блоке «Метрики AI / RAG / агентов · ИТОГО»
   через renderAiMetricsBlock — дубль на одном экране визуально шумит. */

function renderCategoriesCard(result, period, activeStandsCount, ctx = {}) {
    const total = result.totalMonthly || 0;
    const byCat = result.byCategory || {};
    const slash = periodSlash(period);
    const sorted = CATEGORY_IDS
        .filter(c => (byCat[c] || 0) > 0)
        .sort((a, b) => (byCat[b] || 0) - (byCat[a] || 0));

    if (sorted.length === 0) {
        return el('article', { class: 'dash-card dash-card-categories' },
            el('div', { class: 'dash-card-header' },
                el('div', { class: 'dash-card-eyebrow' },
                    el('span', { text: 'Распределение по категориям' }),
                    el('span', { class: 'dash-card-eyebrow-tag', text: 'ИТОГО' })
                )
            ),
            el('div', { class: 'dash-card-body dash-categories-empty', text: 'Нет данных для отображения.' })
        );
    }

    return el('article', { class: 'dash-card dash-card-categories' },
        el('div', { class: 'dash-card-header' },
            el('div', { class: 'dash-card-eyebrow' },
                el('span', { text: 'Распределение по категориям' }),
                el('span', { class: 'dash-card-eyebrow-tag', text: 'ИТОГО' })
            ),
            el('div', { class: 'dash-card-eyebrow-sub',
                text: `Сумма по ${activeStandsCount} ${activeStandsCount === 1 ? 'активному стенду' : 'активным стендам'}`
            })
        ),
        el('div', { class: 'dash-card-body dash-categories-body' },
            ...sorted.map(cat => {
                const v = byCat[cat] || 0;
                const share = total > 0 ? v / total : 0;
                return el('div', { class: 'dash-category-row' },
                    el('div', { class: 'dash-category-row-head' },
                        el('span', { class: 'dash-category-row-dot', style: { background: CATEGORY_COLORS[cat] } }),
                        /* title= с расшифровкой содержания категории — что именно
                           попадает в эту группу расходов. Дополняет короткий ярлык
                           («Услуги», «Резервы»), не дублирует его. */
                        el('span', {
                            class: 'dash-category-row-label',
                            text: CATEGORY_LABELS[cat],
                            title: CATEGORY_DESCRIPTIONS[cat]
                        }),
                        /* 12.U25-fix-14: сначала сумма (главное число), затем % (вторичная метрика).
                           Раньше «34,3% 2 444 тыс. ₽» — цифры читались справа налево; теперь
                           «2 444 тыс. ₽ 34,3%» — типичный финансовый порядок (number → share). */
                        el('span', { class: 'dash-category-row-value',
                            text: `${fmtRubForPeriod(v * periodMul(period), period)} ${slash}` }),
                        el('span', { class: 'dash-category-row-pct', text: percent(share) })
                    ),
                    el('div', { class: 'dash-category-row-bar' },
                        el('span', { class: 'dash-category-row-bar-fill',
                            style: {
                                width: `${(share * 100).toFixed(2)}%`,
                                background: CATEGORY_COLORS[cat]
                            }
                        })
                    )
                );
            })
        )
    );
}

/* ---------- Вклад риск-коэффициентов ---------- */

/* 12.U20: НДС убран из карточки «Вклад риск-коэффициентов» — это налог, а не риск.
 * НДС применяется независимо от мастера `applyRiskFactors`, и смешивать его с
 * буферами/инфляцией в одной карточке семантически неверно. */
const RISK_COMPONENT_LABELS = Object.freeze({
    bufferFactor:   'Буферы (задачный + проектный)',
    inflationMul:   'Инфляция',
    seasonalMul:    'Сезонность',
    scheduleMul:    'Сдвиг расписания',
    contingencyMul: 'Резерв на риски'
});

function computeRiskContribution(result, disabledStands = []) {
    const components = ['bufferFactor', 'inflationMul', 'seasonalMul', 'scheduleMul', 'contingencyMul'];
    const sum = { totalBase: 0, totalFinal: 0 };
    const weightedComp = Object.fromEntries(components.map(c => [c, 0]));
    const disabled = Array.isArray(disabledStands) ? disabledStands : [];
    for (const sid of STAND_IDS) {
        if (disabled.includes(sid)) continue;
        const bucket = result.stands?.[sid];
        if (!bucket) continue;
        for (const cell of bucket.items || []) {
            const base = cell.costBase || 0;
            if (base <= 0 || !cell.riskBreakdown) continue;
            sum.totalBase  += base;
            // Используем потенциальный final = base × реальные коэффициенты,
            // независимо от cell.costFinal (который в режиме «без рисков» = base).
            // Это позволяет показать «потенциальную» наценку даже когда
            // applyRiskFactors=false и она не учтена в ИТОГО.
            const totalRisk = cell.riskBreakdown.total || 1;
            sum.totalFinal += base * totalRisk;
            for (const c of components) {
                const v = cell.riskBreakdown[c];
                if (Number.isFinite(v) && v > 0) weightedComp[c] += base * Math.log(v);
            }
        }
    }
    if (sum.totalBase <= 0) return null;
    const overall = sum.totalFinal / sum.totalBase;
    const surplus = overall - 1;
    if (!Number.isFinite(surplus) || Math.abs(surplus) < 1e-9) return null;
    const comp = {};
    let lnSum = 0;
    for (const c of components) {
        const ln = weightedComp[c] / sum.totalBase;
        comp[c] = Math.exp(ln);
        lnSum += ln;
    }
    const items = [];
    for (const c of components) {
        const ln = Math.log(comp[c]);
        const share = lnSum !== 0 ? ln / lnSum : 0;
        items.push({
            id: c,
            label: RISK_COMPONENT_LABELS[c],
            multiplier: comp[c],
            shareOfSurplus: share,
            contribution: share * surplus
        });
    }
    return { overall, surplus, items };
}

/**
 * Подробный tooltip-текст для строки риск-коэффициента.
 * Использует фактические значения настроек из расчёта, чтобы пользователь
 * видел расчёт собственного множителя, а не абстрактную формулу.
 *
 * Объясняет ключевую неинтуитивность мультипликативной модели:
 * НДС 20% от уже наценённого = больше +20% от базы, потому что
 * каждый коэффициент бьёт по результату всех предыдущих.
 */
function buildRiskRowTooltip(componentId, calc, contribPct, contribAmount, slash, multiplier) {
    const s = calc?.settings || {};
    const fmt2 = n => formatNumber(n, { min: 2, max: 2 });
    /* 12.U30-fix: ru-RU формат процентов (запятая) — согласован с UI карточек. */
    const pct1 = n => `${formatNumber(n * 100, { min: 1, max: 1 })}%`;
    const mulPct = (multiplier - 1) * 100;
    const tail = `\n\nСредний множитель ${fmt2(multiplier)} (+${formatNumber(mulPct, { min: 1, max: 1 })}% от базы).` +
                 `\nВклад в общую наценку: +${formatNumber(contribPct, { min: 1, max: 1 })}% (≈ ${formatRub(contribAmount)} ${slash}).` +
                 `\n\nПочему вклад больше номинала: коэффициенты применяются мультипликативно — каждый бьёт по уже наценённому числу. Например, НДС 20% от 130 ₽ (после буферов и инфляции) = +26 ₽, что больше +20% от базовой 100 ₽.`;

    switch (componentId) {
        case 'bufferFactor':
            return `Буферы — две запасные доли в стоимости:
• Буфер задачи: ${pct1(s.bufferTask || 0)} — на неучтённые работы внутри одного элемента.
• Буфер проекта: ${pct1(s.bufferProject || 0)} — на проектные риски (организационные, технические).

Расчёт: (1 + ${fmt2(s.bufferTask || 0)}) × (1 + ${fmt2(s.bufferProject || 0)}) = ${fmt2((1 + (s.bufferTask || 0)) * (1 + (s.bufferProject || 0)))}.

Применяется: ко всем элементам на всех стендах.${tail}`;

        case 'inflationMul':
            return `Инфляция — рост цен поставщиков за горизонт планирования.
• Годовая ставка: ${pct1(s.kInflation || 0)}.
• Горизонт планирования: ${s.planningHorizonYears || 1} ${(s.planningHorizonYears || 1) === 1 ? 'год' : 'лет'}.

Расчёт: ставка возводится в степень числа лет → ${fmt2(Math.pow(1 + (s.kInflation || 0), s.planningHorizonYears || 1))}.

Применяется: ко всем элементам на всех стендах.${tail}`;

        case 'seasonalMul':
            return `Сезонность — пиковая нагрузка в сезон.
• Множитель: ${pct1(s.kSeasonal || 0)} = коэффициент ${fmt2(1 + (s.kSeasonal || 0))}.

Применяется только к категориям с переменным потреблением: сетевые ресурсы, трафик, внешние сервисы, токены AI/LLM. Аппаратные ресурсы и лицензии не сезонят.${tail}`;

        case 'scheduleMul':
            return `Сдвиг расписания — простои и переработки на этапах нагрузочного тестирования и разовых работ.
• Множитель: ${pct1(s.kScheduleShift || 0)} = коэффициент ${fmt2(1 + (s.kScheduleShift || 0))}.

Применяется к стенду «Нагрузка» и ко всем элементам с разовым тарифом (внедрение, аудиты, сертификация).${tail}`;

        case 'contingencyMul':
            return `Резерв на риски — общая страховка на непредвиденные обстоятельства.
• Множитель: ${pct1(s.kContingency || 0)} = коэффициент ${fmt2(1 + (s.kContingency || 0))}.

Применяется: ко всем элементам на всех стендах.${tail}`;

        default:
            return `Множитель: ${fmt2(multiplier)} (+${formatNumber(mulPct, { min: 1, max: 1 })}%). Вклад: +${formatNumber(contribPct, { min: 1, max: 1 })}%.`;
    }
}

const RISK_OVERVIEW_TOOLTIP =
    'Как считается «Вклад риск-коэффициентов»\n\n' +
    'Пять риск-коэффициентов применяются МУЛЬТИПЛИКАТИВНО:\n' +
    '   итог = база × Буферы × Инфляция × Сезонность × Сдвиг × Резерв\n\n' +
    'Поэтому вклад каждого коэффициента БОЛЬШЕ его номинальной ставки: ' +
    'каждый следующий коэффициент применяется к УЖЕ наценённому числу.\n\n' +
    'Пример: резерв 5% от 100 ₽ = +5 ₽. ' +
    'Но резерв 5% от 130 ₽ (после буферов и инфляции) = +6,5 ₽ — ' +
    'это +6,5% к базовой 100 ₽, а не +5%.\n\n' +
    'Чем больше множитель коэффициента — тем больше его доля ' +
    'в общей наценке. Доли распределены так, чтобы их сумма ' +
    'была равна общей наценке сверху карточки.\n\n' +
    'НДС в эту карточку не входит — это отдельный налог, не риск. ' +
    'Он применяется к итогу независимо от того, включены риски или нет.';

function renderRiskCard(result, calc, period, applyRisks = true) {
    const data = computeRiskContribution(result, result.disabledStands || []);
    if (!data) {
        return el('article', { class: 'dash-card dash-card-risk' },
            el('div', { class: 'dash-card-header' },
                el('div', { class: 'dash-card-eyebrow' },
                    el('span', { text: 'Вклад риск-коэффициентов' })
                )
            ),
            el('div', { class: 'dash-card-body dash-risk-empty',
                text: 'Все коэффициенты равны 1 — наценка от рисков отсутствует.' })
        );
    }

    const totalSurplusPct = data.surplus * 100;
    const mul = periodMul(period);
    const slash = periodSlash(period);
    // Базовая стоимость (без рисков). В режиме applyRisks=true result.totalMonthly
    // содержит costFinal-сумму с рисками, и базу нужно вычислить через overall.
    // В режиме applyRisks=false result.totalMonthly = costBase total — это и есть база.
    const totalMonthly = result.totalMonthly || 0;
    const baseMonthly = applyRisks
        ? (data.overall > 0 ? totalMonthly / data.overall : 0)
        : totalMonthly;
    const surplusMonthly = baseMonthly * data.surplus;
    const surplusPeriod = surplusMonthly * mul;

    const visible = data.items
        .filter(it => Math.abs(it.multiplier - 1) > 1e-6)
        // Сортировка по убыванию вклада в общую наценку (самый «дорогой» риск — первым).
        .sort((a, b) => b.shareOfSurplus - a.shareOfSurplus);

    return el('article', { class: 'dash-card dash-card-risk' },
        el('div', { class: 'dash-card-header' },
            el('div', { class: 'dash-card-eyebrow' },
                el('span', { text: 'Вклад риск-коэффициентов' }),
                el('span', { class: 'info-icon',
                    title: RISK_OVERVIEW_TOOLTIP,
                    attrs: { role: 'note', tabindex: '0', 'aria-label': 'Как считается вклад' }
                }, icon('info', { size: 12 }))
            ),
            el('div', { class: 'dash-card-eyebrow-sub' },
                el('span', { text: applyRisks ? 'Общая наценка ' : 'Потенциальная наценка ' }),
                el('span', { class: 'dash-risk-surplus',
                    /* 12.U26-fix: единый формат процента ru-RU (запятая) — согласовано с
                       «Распределение по категориям», где percent() даёт «41,7%». Раньше
                       .toFixed(1) выдавал «56.0%» (точка) → визуальный диссонанс. */
                    text: `${totalSurplusPct >= 0 ? '+' : ''}${formatNumber(totalSurplusPct, { min: 1, max: 1 })}%`
                }),
                el('span', { class: 'dash-risk-surplus-amount',
                    /* 12.U25-fix-14: убрана точка-разделитель «·» — пользователь воспринимал её как
                       мусор перед числом. column-gap родителя (.dash-card-eyebrow-sub) даёт
                       визуальную границу между процент-пиллом и суммой. */
                    text: `${fmtRubForPeriod(surplusPeriod, period)} ${slash}`
                }),
                !applyRisks
                    ? el('span', { class: 'dash-risk-surplus-note',
                        title: 'Сейчас риск-коэффициенты ВЫКЛЮЧЕНЫ в Опроснике — итог считается без них. Это сумма, на которую вырос бы итог, если бы вы их включили.',
                        text: ' (если применить)' })
                    : null
            )
        ),
        el('div', { class: 'dash-card-body dash-risk-body' },
            ...visible.map(it => {
                const contribPct = it.shareOfSurplus * data.surplus * 100;
                const contribAmount = surplusPeriod * it.shareOfSurplus;
                return el('div', { class: 'dash-risk-row',
                    title: buildRiskRowTooltip(it.id, calc, contribPct, contribAmount, slash, it.multiplier),
                    attrs: { tabindex: '0' }
                },
                    el('span', { class: 'dash-risk-row-label', text: it.label }),
                    el('span', { class: 'dash-risk-row-bar' },
                        el('span', { class: 'dash-risk-row-bar-fill',
                            style: { width: `${Math.max(0, Math.min(100, Math.abs(it.shareOfSurplus) * 100))}%` }
                        })
                    ),
                    el('span', { class: 'dash-risk-row-amount',
                        /* 12.U25-fix-16: единица времени (/ год / мес / день) обязательна — без неё
                           «+25 817 тыс. ₽» оторвано от шапки «Общая наценка ... / год» и пользователь
                           вынужден помнить, в каком периоде смотрит дашборд. */
                        text: `${contribAmount >= 0 ? '+' : ''}${fmtRubForPeriod(contribAmount, period)} ${slash}`
                    }),
                    el('span', { class: 'dash-risk-row-value',
                        /* 12.U26-fix: ru-RU формат (запятая), согласован с категории. */
                        text: `${contribPct >= 0 ? '+' : ''}${formatNumber(contribPct, { min: 1, max: 1 })}%`
                    })
                );
            })
        )
    );
}
