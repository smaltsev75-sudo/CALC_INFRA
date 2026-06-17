import {
    STAND_IDS,
    DASHBOARD_AI_METRIC_LABELS,
    DEFAULT_AI_STAND_FACTOR,
    AGENT_STEPS_MULTIPLIER,
    DEFAULT_AGENT_PARALLEL
} from '../utils/constants.js';
import { formatNumber } from '../services/format.js';
import { SEED_ITEMS } from '../domain/seed.js';
import { buildQuestionDefaults, buildContext } from '../domain/calculator.js';

// 12.U5: индекс dashboardResource из актуального SEED_ITEMS — fallback для
// расчётов, dictionary которых был сохранён до добавления поля. UI-only.
const SEED_ITEM_BY_ID = new Map(SEED_ITEMS.map(it => [it.id, it]));
const AI_MODEL_TIER_FACTOR = Object.freeze({
    light: 0.4,
    mid: 1,
    heavy: 3,
    frontier: 10
});
const TOKEN_DEMAND_ITEM_IDS = Object.freeze([
    'llm-tokens-input-1m',
    'llm-tokens-output-1m',
    'ai-safety-moderation-tokens-1m'
]);
const EMBEDDING_DEMAND_ITEM_IDS = Object.freeze(['rag-embeddings-1m']);

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
export function aggregateResources(result, dictionaryItems, disabledStands, applyRisks, answers = null) {
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

    /* v2.20.73: контекстный hint для строки GPU. ЭК vCPU GPU-нод считается
     * ТОЛЬКО при ai_hosting_mode = on_prem_gpu (см. seed cpu-vcpu-gpu). Для
     * external_api / private_cloud GPU=0 — это by design, не «надо заполнить
     * Опросник». Generic tooltip «заполните вопросы про БД/файлы» вводит в
     * заблуждение. Передаём в renderResourcesBlock явное объяснение. */
    if (answers && typeof answers === 'object') {
        const aiLlmUsed = answers.ai_llm_used === true;
        const hostingMode = String(answers.ai_hosting_mode || '').trim();
        if (aiLlmUsed && hostingMode && hostingMode !== 'on_prem_gpu') {
            const gpuHint =
                'GPU считается отдельной позицией только при ответе ' +
                '«Собственная GPU-инфраструктура (on-premise)» в вопросе ' +
                '«Режим размещения ИИ-модели». При размещении на внешнем API ' +
                'или в приватном облаке стоимость GPU уже зашита в цену ' +
                'токена у провайдера — оценка ИИ-нагрузки в этом случае ' +
                'видна в строке «Токены» и в Детализации «Входящие/Исходящие ' +
                'токены LLM».';
            if (out.total.GPU) out.total.GPU.zeroReasonHint = gpuHint;
            for (const sid of STAND_IDS) {
                if (out.perStand[sid]?.GPU) {
                    out.perStand[sid].GPU.zeroReasonHint = gpuHint;
                }
            }
        }
    }

    return out;
}

function isFractionalCapacityUnit(unit) {
    return String(unit || '').includes('ТБ');
}

/** Форматирует qty по единице измерения.
 *
 * CPU/RAM/шт. остаются целыми: половина vCPU или узла в Dashboard выглядит
 * как ложная точность. Для ёмкости в ТБ дробная часть важна: 0.17 ТБ SSD или
 * 0.10 ТБ HDD — это реальный ненулевой ресурс, и округление до 0 превращало
 * его в прочерк на стендах DEV/ИФТ. */
export function formatResourceQty(qty, unit) {
    if (!Number.isFinite(qty) || qty <= 0) return null;
    if (isFractionalCapacityUnit(unit)) {
        const max = qty < 10 ? 2 : (qty < 100 ? 1 : 0);
        return formatNumber(qty, { min: 0, max });
    }
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
        if (isFractionalCapacityUnit(totalCell.unit)) continue;
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

function finiteNumber(value, fallback = 0) {
    const normalized = typeof value === 'string'
        ? value.trim()
            .replace(/\s+/g, '')
            .replace('%', '')
            .replace(',', '.')
        : value;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : fallback;
}

function boolAnswer(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized !== '' && normalized !== 'false' && normalized !== '0' &&
            normalized !== 'нет' && normalized !== 'no';
    }
    return Boolean(value);
}

function buildAnswerResolver(calc) {
    const answers = calc?.answers || {};
    const defaults = buildQuestionDefaults(calc?.dictionaries?.questions || []);
    return (id, fallback = 0) => {
        const value = answers[id];
        if (value !== undefined && value !== null && value !== '') return value;
        if (defaults[id] !== undefined && defaults[id] !== null && defaults[id] !== '') {
            return defaults[id];
        }
        return fallback;
    };
}

function hasAnswerValue(calc, id) {
    const answers = calc?.answers || {};
    if (!Object.prototype.hasOwnProperty.call(answers, id)) return false;
    const value = answers[id];
    return value !== null && value !== undefined && value !== '';
}

function sameScalarValue(a, b) {
    if (typeof a === 'number' || typeof b === 'number') {
        const an = Number(a);
        const bn = Number(b);
        return Number.isFinite(an) && Number.isFinite(bn) && an === bn;
    }
    return a === b;
}

function isExplicitAnswer(calc, id) {
    if (!hasAnswerValue(calc, id)) return false;
    const meta = calc?.answersMeta?.[id];
    if (meta && typeof meta === 'object') return true;
    const defaults = buildQuestionDefaults(calc?.dictionaries?.questions || []);
    if (!Object.prototype.hasOwnProperty.call(defaults, id)) return true;
    return !sameScalarValue(calc.answers[id], defaults[id]);
}

function hasExplicitLlmTokenDemand(calc, get) {
    const registered = finiteNumber(get('registered_users_total', 0));
    const dauShare = finiteNumber(get('dau_share_of_registered_percent', 0));
    const aiShare = finiteNumber(get('ai_users_share', 0));
    const requestsPerDay = finiteNumber(get('ai_requests_per_user_day', 0));
    const inputTokens = finiteNumber(get('ai_avg_input_tokens', 0));
    const outputTokens = finiteNumber(get('ai_avg_output_tokens', 0));
    if (![registered, dauShare, aiShare, requestsPerDay].every(v => v > 0)) return false;
    if (![inputTokens, outputTokens].some(v => v > 0)) return false;
    return [
        'ai_users_share',
        'ai_requests_per_user_day',
        'ai_avg_input_tokens',
        'ai_avg_output_tokens',
        'ai_caching_share'
    ].some(id => isExplicitAnswer(calc, id));
}

function hasPositiveLlmTokenDemandInputs(get) {
    const registered = finiteNumber(get('registered_users_total', 0));
    const dauShare = finiteNumber(get('dau_share_of_registered_percent', 0));
    const aiShare = finiteNumber(get('ai_users_share', 0));
    const requestsPerDay = finiteNumber(get('ai_requests_per_user_day', 0));
    const inputTokens = finiteNumber(get('ai_avg_input_tokens', 0));
    const outputTokens = finiteNumber(get('ai_avg_output_tokens', 0));
    return [registered, dauShare, aiShare, requestsPerDay].every(v => v > 0)
        && [inputTokens, outputTokens].some(v => v > 0);
}

function hasImplicitLlmFeature(calc, get) {
    return [
        'rag_needed',
        'ai_agent_mode',
        'ai_safety_layer',
        'ai_finetune_needed'
    ].some(id => boolAnswer(get(id, false)) && isExplicitAnswer(calc, id));
}

function shouldUseLlmTokenDemand(calc, get) {
    return boolAnswer(get('ai_llm_used', false))
        || hasExplicitLlmTokenDemand(calc, get)
        || (hasImplicitLlmFeature(calc, get) && hasPositiveLlmTokenDemandInputs(get));
}

function aiStandRatio(calc, stand) {
    if (stand === 'PROD') return 1;
    const ratios = calc?.settings?.aiStandFactor;
    const value = ratios && typeof ratios === 'object'
        ? ratios[stand]
        : DEFAULT_AI_STAND_FACTOR[stand];
    return Number.isFinite(Number(value))
        ? Number(value)
        : (DEFAULT_AI_STAND_FACTOR[stand] ?? 1);
}

function agentStepFactor(get) {
    if (!boolAnswer(get('ai_agent_mode', false))) return 1;
    const complexity = get('agent_complexity', 'simple');
    const stepsBase = AGENT_STEPS_MULTIPLIER[complexity] ?? AGENT_STEPS_MULTIPLIER.simple;
    const parallel = get('ai_agent_type', 'tool_use') === 'multi_agent'
        ? Math.max(1, finiteNumber(get('agent_parallel_specialists', DEFAULT_AGENT_PARALLEL), DEFAULT_AGENT_PARALLEL))
        : 1;
    return stepsBase * parallel;
}

function capacityMultiplier(cell, applyRisks) {
    const br = cell?.riskBreakdown;
    return (applyRisks && br)
        ? br.bufferFactor * br.seasonalMul * br.scheduleMul * br.contingencyMul
        : 1;
}

function ragRefreshMultiplier(value) {
    switch (value) {
        // Stage 1 (qty-модель ПРОМ): realtime = непрерывная дельта (×2), не полный
        // ночной пересчёт. daily остаётся полным пересчётом (×30). Зеркалит seed
        // rag-embeddings-1m, иначе Dashboard разойдётся с Деталями/Паспортом.
        case 'realtime':
            return 2;
        case 'daily':
            return 30;
        case 'weekly':
            return 4.3;
        case 'monthly':
            return 1;
        case 'quarterly':
            return 1 / 3;
        case 'on_demand':
            return 0.5;
        case 'never':
        default:
            return 0;
    }
}

/* Stage 1 (qty-модель ПРОМ): эффективное число AI-запросов в месяц с degenerate-
 * recovery — через ТОТ ЖЕ buildContext, что и calculate() (S.aiRequestsPerMonth),
 * чтобы Dashboard-fallback не расходился с основным расчётом при вырожденной
 * user-base (registered=0 + подтверждённый baseline). Без agent-факторов. */
function recoveredAiRequestsPerMonth(calc) {
    if (!calc || typeof calc !== 'object') return 0;
    const questionDefaults = buildQuestionDefaults(calc?.dictionaries?.questions || []);
    const activeScenario = Array.isArray(calc?.scenarios)
        ? calc.scenarios.find(s => s?.id === calc.activeScenarioId)
        : null;
    const demandHints = {
        healthAcknowledgements: calc?.healthAcknowledgements || null,
        activeScenarioAnswers: activeScenario?.answers || null
    };
    try {
        const ctx = buildContext(
            calc?.answers || {}, calc?.settings || {}, questionDefaults,
            'PROD', null, calc?.answersMeta || {}, demandHints
        );
        return Number(ctx?.S?.aiRequestsPerMonth) || 0;
    } catch {
        return 0;
    }
}

export function deriveLlmTokenItemQty(calc, itemId, stand) {
    const get = buildAnswerResolver(calc);
    if (!shouldUseLlmTokenDemand(calc, get)) return 0;

    const cacheShare = Math.min(100, Math.max(0, finiteNumber(get('ai_caching_share', 0)))) / 100;
    const modelFactor = AI_MODEL_TIER_FACTOR[get('ai_model_tier', 'mid')] ?? AI_MODEL_TIER_FACTOR.mid;
    // requestsPerMonth = recovered (DAU × доля_AI × запросов/день × 30) × agentStepFactor.
    const requestsPerMonth = recoveredAiRequestsPerMonth(calc) * agentStepFactor(get);
    const ratio = aiStandRatio(calc, stand);

    if (itemId === 'llm-tokens-input-1m') {
        const inputTokens = finiteNumber(get('ai_avg_input_tokens', 0));
        return Math.ceil(Math.max(0,
            requestsPerMonth * inputTokens * (1 - cacheShare) / 1_000_000 * modelFactor * ratio
        ));
    }
    if (itemId === 'llm-tokens-output-1m') {
        const outputTokens = finiteNumber(get('ai_avg_output_tokens', 0));
        return Math.ceil(Math.max(0,
            requestsPerMonth * outputTokens / 1_000_000 * modelFactor * ratio
        ));
    }
    if (itemId === 'ai-safety-moderation-tokens-1m') {
        if (!boolAnswer(get('ai_safety_layer', false))) return 0;
        const inputTokens = finiteNumber(get('ai_avg_input_tokens', 0));
        const outputTokens = finiteNumber(get('ai_avg_output_tokens', 0));
        const inputMillions = requestsPerMonth * inputTokens * (1 - cacheShare) / 1_000_000 * modelFactor * ratio;
        const outputMillions = requestsPerMonth * outputTokens / 1_000_000 * modelFactor * ratio;
        return Math.ceil(Math.max(0, (inputMillions + outputMillions) * 0.10));
    }
    return 0;
}

function deriveRagEmbeddingItemQty(calc, stand) {
    const get = buildAnswerResolver(calc);
    if (!boolAnswer(get('rag_needed', false))) return 0;
    // NB: НЕ гейтим по on_prem_gpu. Это операционный fallback ВИДИМОСТИ нагрузки:
    // для on-prem эмбеддинги не тарифицируются внешним API (seed-формула даёт cost=0),
    // но объём токенов эмбеддинга должен оставаться виден для планирования мощности
    // (см. CLAUDE.md: «on-prem operational derivation»).

    // (A) переиндексация корпуса × доля корпуса за цикл (delta%).
    const corpusGb = finiteNumber(get('rag_corpus_size_gb', 0));
    const refresh = ragRefreshMultiplier(get('rag_refresh_frequency', 'never'));
    const deltaPercent = Math.min(100, Math.max(0, finiteNumber(get('rag_refresh_delta_percent', 100))));
    const indexingTokens = corpusGb * 200000000 * refresh * deltaPercent / 100;

    // (B) эмбеддинги запросов: каждый отдельный поиск векторизует запрос (~200 токенов — оценка).
    // recoveredAiRequestsPerMonth — тот же recovered контракт, что в calculate (S.aiRequestsPerMonth):
    // вырожденная user-base восстанавливается из подтверждённого baseline.
    const retrievalCalls = finiteNumber(get('rag_retrieval_calls_per_query', 0));
    const queryTokens = recoveredAiRequestsPerMonth(calc) * retrievalCalls * 200;

    const ratio = aiStandRatio(calc, stand);
    return Math.ceil(Math.max(0, (indexingTokens + queryTokens) / 1_000_000 * ratio));
}

export function deriveAiMetricItemQty(calc, itemId, stand) {
    const tokenQty = deriveLlmTokenItemQty(calc, itemId, stand);
    if (tokenQty > 0) return tokenQty;
    if (itemId === 'rag-embeddings-1m') return deriveRagEmbeddingItemQty(calc, stand);
    return 0;
}

function deriveAiMetricItemsQty(calc, result, itemIds, stand, applyRisks) {
    return itemIds.reduce((sum, itemId) => {
        const qty = deriveAiMetricItemQty(calc, itemId, stand);
        if (qty <= 0) return sum;
        const cell = result?.items?.[itemId]?.stands?.[stand];
        return sum + qty * capacityMultiplier(cell, applyRisks);
    }, 0);
}

function applyAiMetricDemandFallback(out, calc, activeStands, result, applyRisks, spec) {
    if (!calc || !out?.perStand || !out?.total?.[spec.label]) return out;
    const activeTokenTotal = activeStands.reduce((sum, sid) =>
        sum + (Number(out.perStand?.[sid]?.[spec.label]?.qty) || 0), 0);
    if (activeTokenTotal > 0) return out;

    let derivedTotal = 0;
    for (const sid of STAND_IDS) {
        const entry = out.perStand[sid]?.[spec.label];
        if (!entry) continue;
        const derived = deriveAiMetricItemsQty(calc, result, spec.itemIds, sid, applyRisks);
        if (derived > 0) {
            entry.qty = derived;
            entry.unit = entry.unit || spec.unit;
            entry.applicable = true;
        }
        if (activeStands.includes(sid)) derivedTotal += Number(entry.qty) || 0;
    }
    if (derivedTotal > 0) {
        out.total[spec.label].qty = derivedTotal;
        out.total[spec.label].unit = out.total[spec.label].unit || spec.unit;
        out.total[spec.label].applicable = true;
    }
    return out;
}

/* ============================================================
 * Этап 13.U6: AI / RAG / агенты — отдельная секция дашборда
 * ============================================================ */
export function aggregateAiMetrics(result, dictionaryItems, disabledStands, applyRisks, calc = null) {
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

    applyAiMetricDemandFallback(out, calc, activeStands, result, applyRisks, {
        label: 'TOKENS',
        unit: 'млн токенов',
        itemIds: TOKEN_DEMAND_ITEM_IDS
    });
    applyAiMetricDemandFallback(out, calc, activeStands, result, applyRisks, {
        label: 'EMBEDDINGS',
        unit: 'млн токенов',
        itemIds: EMBEDDING_DEMAND_ITEM_IDS
    });
    return distributeRoundingPreservingSum(out, activeStands);
}
