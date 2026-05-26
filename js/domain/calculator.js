/**
 * Системные формулы калькулятора. Все коэффициенты и агрегации — здесь.
 *
 * Формула для одной ячейки (item × stand):
 *   billingIntervalMul:
 *     daily   → daysPerMonth         (стоимость задана за день → ×30 в месяц)
 *     monthly → 1
 *     annual  → 1/12
 *     oneTime → 1/phaseDurationMonths
 *
 *   --- Риск-коэффициенты (включаются мастером settings.applyRiskFactors) ---
 *   bufferFactor   = (1 + bufferTask) × (1 + bufferProject)
 *   inflationMul   = (1 + kInflation)^planningHorizonYears
 *   seasonalMul    = item.resourceClass ∈ SEASONAL → (1 + kSeasonal) : 1
 *   scheduleMul    = billingInterval=oneTime → (1 + kScheduleShift) : 1
 *   contingencyMul = 1 + kContingency
 *   riskTotal      = bufferFactor × inflationMul × seasonalMul × scheduleMul × contingencyMul
 *
 *   --- НДС (независимая ось — не риск-коэффициент) ---
 *   vatMul         = vatEnabled → (1 + vatRate) : 1
 *
 *   costBase  = qty × pricePerUnit × billingIntervalMul
 *   costFinal = costBase × (applyRiskFactors ? riskTotal : 1) × vatMul
 *
 * 12.U20: VAT отделён от риск-коэффициентов. НДС — это налог, а не «риск», и
 * пользователь может включать/выключать его независимо от мастера рисков.
 *
 * Формулы количества — данные (item.qtyFormulas), редактируемые через UI.
 */

import { getAst, isAstError, clearAstCache } from './formula/cache.js';
import { evaluate } from './formula/evaluator.js';
import {
    STAND_IDS,
    CATEGORY_IDS,
    RESOURCE_CLASS_IDS,
    BILLING_INTERVAL_IDS,
    SEASONAL_RESOURCE_CLASSES,
    MONTHS_PER_YEAR,
    DEFAULT_PHASE_DURATION_MONTHS,
    DEFAULT_DAYS_PER_MONTH,
    DEFAULT_PLANNING_HORIZON_YEARS,
    DEFAULT_BUFFER_TASK,
    DEFAULT_BUFFER_PROJECT,
    DEFAULT_K_INFLATION,
    DEFAULT_K_SEASONAL,
    DEFAULT_K_SCHEDULE_SHIFT,
    DEFAULT_K_CONTINGENCY,
    DEFAULT_VAT_ENABLED,
    DEFAULT_STAND_SIZE_RATIO,
    DEFAULT_AI_STAND_FACTOR,
    CALC_CACHE_SIZE,
    AGENT_STEPS_MULTIPLIER,
    DEFAULT_AGENT_PARALLEL
} from '../utils/constants.js';
import { SEED_ITEMS } from './seed.js';
import { applyProviderOverlay, DEFAULT_PROVIDER } from './providerOverlay.js';
import { getCurrentVatRate } from './vatRateTable.js';
import {
    getEffectiveLlmTokenDemand,
    hasPositiveTokenDemandInputs
} from './aiDemand.js';

/* 12.U12: SEED-fallback для dashboardResource у item-ов из старых расчётов
   (dictionary.items был сохранён до Этапа 12.U5, когда поле появилось).
   Без fallback per-resource override не сработал бы для legacy-расчётов. */
const SEED_DASHBOARD_RESOURCE_BY_ID = new Map(
    SEED_ITEMS.filter(it => it.dashboardResource).map(it => [it.id, it.dashboardResource])
);

/* SEED-fallback для AI-признака item-ов из старых расчётов (legacy без поля
   dashboardAiMetric). Любой ЭК с category === 'AI' в seed → его id попадает
   сюда. Используется в buildContext чтобы AI-фактор на стенд применялся даже
   к расчётам, сохранённым до того как dashboardAiMetric появился в seed. */
const SEED_AI_ITEM_IDS = new Set(
    SEED_ITEMS.filter(it => it.category === 'AI' || it.dashboardAiMetric).map(it => it.id)
);
const AI_MODEL_TIER_FACTOR = Object.freeze({
    light: 0.4,
    mid: 1,
    heavy: 3,
    frontier: 10
});
const EXTERNAL_LLM_TOKEN_ITEM_IDS = new Set([
    'llm-tokens-input-1m',
    'llm-tokens-output-1m',
    'ai-safety-moderation-tokens-1m'
]);
import { LruCache } from '../utils/lru.js';
import { getCostType, makeZeroCostTypeMap } from './costType.js';

/* ---------- Интервал тарификации → ежемесячный множитель ---------- */

/**
 * Преобразование интервала тарификации в ежемесячную долю.
 *
 * @param {string} interval — daily | monthly | annual | oneTime
 * @param {number} daysPerMonth — для daily-интервалов
 * @param {number} phaseDurationMonths — для oneTime-интервалов
 * @returns {number}
 */
export function billingIntervalToMonthlyMultiplier(interval, daysPerMonth, phaseDurationMonths) {
    switch (interval) {
        case 'daily': {
            const d = Number(daysPerMonth);
            if (!Number.isFinite(d) || d <= 0) return DEFAULT_DAYS_PER_MONTH;
            return d;
        }
        case 'monthly': return 1;
        case 'annual':  return 1 / MONTHS_PER_YEAR;
        case 'oneTime': {
            const m = Number(phaseDurationMonths);
            if (!Number.isFinite(m) || m <= 0) return 1 / DEFAULT_PHASE_DURATION_MONTHS;
            return 1 / m;
        }
        default: return 1;
    }
}

/* ---------- Helpers ---------- */

/** 12.U31: вернуть Number(value) если финитное, иначе fallback. Защищает от
    `Number(null) = 0` (тихое обнуление коэффициента) и `Number('abc') = NaN`. */
function numWithDefault(value, fallback) {
    if (value === undefined || value === null) return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/* ---------- Риск-фактор ---------- */

/**
 * Вычислить декомпозицию риск-множителей для одной ячейки (item × stand).
 *
 * 12.U20: `total` теперь содержит ТОЛЬКО риск-коэффициенты (без НДС). НДС —
 * независимая ось, применяется отдельно в `calculate()` вне зависимости от
 * `settings.applyRiskFactors`. `vatMul` остаётся в breakdown как информация
 * (для tooltip в Hero / детализации), но в `total` больше не множится.
 */
export function riskFactor(item, stand, settings) {
    /* 12.U31 (Code Review Followup, B-P1-3): bufferTask/bufferProject теперь
       через `?? DEFAULT_*` + `Number.isFinite` guard — как другие коэффициенты.
       Раньше `Number(undefined) || 0 = 0` тихо превращал legacy-расчёт без
       буферов в «бюджет без надбавки», игнорируя дефолт 30% / 15% из seed. */
    const bufferTask    = numWithDefault(settings.bufferTask,    DEFAULT_BUFFER_TASK);
    const bufferProject = numWithDefault(settings.bufferProject, DEFAULT_BUFFER_PROJECT);
    const kInflation    = numWithDefault(settings.kInflation,    DEFAULT_K_INFLATION);
    const kSeasonal     = numWithDefault(settings.kSeasonal,     DEFAULT_K_SEASONAL);
    const kSchedule     = numWithDefault(settings.kScheduleShift,DEFAULT_K_SCHEDULE_SHIFT);
    const kContingency  = numWithDefault(settings.kContingency,  DEFAULT_K_CONTINGENCY);
    const horizonYears  = numWithDefault(settings.planningHorizonYears, DEFAULT_PLANNING_HORIZON_YEARS);
    const vatEnabled    = settings.vatEnabled !== undefined ? !!settings.vatEnabled : DEFAULT_VAT_ENABLED;
    const vatRate       = numWithDefault(settings.vatRate,       getCurrentVatRate());

    const bufferFactor = (1 + bufferTask) * (1 + bufferProject);
    const inflationMul = Math.pow(1 + kInflation, horizonYears);

    const seasonalApplies = SEASONAL_RESOURCE_CLASSES.includes(item.resourceClass);
    const seasonalMul = seasonalApplies ? (1 + kSeasonal) : 1;

    /* 13.U10-fix: kScheduleShift применяется ТОЛЬКО к oneTime-платежам.
       Раньше также к stand='LOAD' — но это нарушало физический инвариант
       «стенд НТ по мощностям ≤ ПРОМ»: LOAD получал × (1+kSchedule)
       сверху над прод-базой, и 100 vCPU PROD превращались в 115 vCPU LOAD,
       что бессмысленно (нагрузочное тестирование симулирует прод, не
       превышает его). Семантика kScheduleShift: буфер на возможный сдвиг
       релиза для РАЗОВЫХ платежей (продлённое тестирование, повторный
       пентест и т.п.). К recurring-нагрузке на LOAD не относится. */
    const scheduleApplies = item.billingInterval === 'oneTime';
    const scheduleMul = scheduleApplies ? (1 + kSchedule) : 1;

    const contingencyMul = 1 + kContingency;
    const vatMul = vatEnabled ? (1 + vatRate) : 1;

    const total = bufferFactor * inflationMul * seasonalMul * scheduleMul * contingencyMul;

    return { bufferFactor, inflationMul, seasonalMul, scheduleMul, contingencyMul, vatMul, total };
}

/* ---------- Контекст вычислений ---------- */

/**
 * Собрать map fallback-значений по questions. Зависит только от questions,
 * поэтому вычисляется один раз на calculate() и переиспользуется для
 * всех 180 (item × stand) контекстов — иначе на каждой ячейке шёл бы
 * лишний обход 80+ вопросов, ~14k property-writes на recalc.
 */
export function buildQuestionDefaults(questions) {
    const out = {};
    for (const q of questions) {
        if (q.defaultIfUnknown !== undefined && q.defaultIfUnknown !== null) {
            out[q.id] = q.defaultIfUnknown;
        } else if (q.defaultValue !== undefined && q.defaultValue !== null) {
            out[q.id] = q.defaultValue;
        }
    }
    return out;
}

/**
 * Подготовить контекст для evaluator: ответы Q, настройки S, defaults вопросов.
 * questionDefaults передаётся снаружи (см. buildQuestionDefaults) — buildContext
 * вызывается 180 раз на recalc и не должен пересобирать defaults сам.
 *
 * Внешний аудит «Жёсткая проверка» (2026-05-20, P2#5): экспортируем эту
 * функцию, чтобы Formula Modal мог собирать ТОТ ЖЕ context, что реальный
 * расчёт. Раньше formulaModal использовал raw `S: calc.settings` без
 * per-resource ratios / AI stand factor / agentStepFactor — диагностика
 * формул для AI-ЭК и hardware показывала неправильные значения.
 */
export function buildContext(answers, settings, questionDefaults, stand, item = null, answersMeta = null) {
    let ratio = settings.standSizeRatio && typeof settings.standSizeRatio === 'object'
        ? settings.standSizeRatio
        : DEFAULT_STAND_SIZE_RATIO;

    /* 12.U12: per-resource override. Если у item задано dashboardResource (CPU/RAM/...)
       и в settings есть resourceRatio для этого ресурса — подменяем ratio так, чтобы
       все ключи `S.standSizeRatio.<STAND>` возвращали значение для ИМЕННО этого
       ресурса. Формулы в seed.js не меняются: `S.standSizeRatio.DEV` для CPU-item
       прозрачно даёт CPU-ratio для DEV, для RAM-item — RAM-ratio для DEV. Item-ы
       без dashboardResource (Услуги/Лицензии/Безопасность) продолжают использовать
       общий standSizeRatio как раньше. Решение «B» из обсуждения 2026-05-03. */
    const itemResource = item && (item.dashboardResource ?? SEED_DASHBOARD_RESOURCE_BY_ID.get(item.id));
    if (item && itemResource && settings.resourceRatio && typeof settings.resourceRatio === 'object') {
        const resource = itemResource;
        const overridden = {};
        for (const sid of Object.keys(ratio)) {
            const v = settings.resourceRatio[sid]?.[resource];
            overridden[sid] = (typeof v === 'number') ? v : ratio[sid];
        }
        ratio = overridden;
    }

    /* AI-фактор на стенд (поверх всего остального, для AI-ЭК) — для каждого
       стенда отдельно говорим, какая доля AI-расходов на нём идёт.

       Принцип: AI-расходы НЕ масштабируются как железо. Если на DEV железо
       0.16 от PROD, это не значит что и LLM-токенов на DEV 16% — на DEV LLM
       обычно мокают, токенов вообще 0. Поэтому AI-ЭК (item.category === 'AI'
       или item.dashboardAiMetric) используют отдельный множитель settings
       .aiStandFactor[STAND] вместо общего standSizeRatio.

       Граничные значения:
         aiStandFactor.DEV = 0   → токены/RAG/агенты на DEV = 0 (полный выкл.).
         aiStandFactor.DEV = 1   → токены на DEV = как на PROD (full scale).
         aiStandFactor.DEV = 0.5 → токены на DEV = половина PROD.
       PROD заперт = 1.00 (эталон, не правится).

       Defaults (когда settings.aiStandFactor отсутствует — legacy до v9):
         DEV=0, IFT=0.2, PSI=0.5, PROD=1.0, LOAD=1.0.

       Когда применяется: только если item имеет признак AI (category или
       dashboardAiMetric). Hardware-ЭК (CPU/RAM/SSD/...) проходят мимо и
       используют обычный standSizeRatio (с per-resource override выше). */
    const isAiItem = item && (
        item.category === 'AI' ||
        item.dashboardAiMetric ||
        SEED_AI_ITEM_IDS.has(item.id)
    );
    if (item && isAiItem) {
        const aiF = settings.aiStandFactor && typeof settings.aiStandFactor === 'object'
            ? settings.aiStandFactor
            : DEFAULT_AI_STAND_FACTOR;
        const overridden = {};
        for (const sid of Object.keys(ratio)) {
            const v = aiF[sid];
            overridden[sid] = (typeof v === 'number') ? v : (DEFAULT_AI_STAND_FACTOR[sid] ?? 1);
        }
        // PROD заперт = 1.00 (защита от подмены через JSON-импорт).
        if ('PROD' in overridden) overridden.PROD = 1.00;
        ratio = overridden;
    }
    /* Этап 13: производные множители для AI-агентов. Собираются ОДИН раз
       на пару (item × stand) и кладутся в S, чтобы DSL-формулы могли читать
       `S.agentStepFactor` / `S.agentToolFactor` без знания о внутренней
       структуре опросника. Поведение при выключенном master ai_agent_mode —
       factor = 1 (формулы LLM-токенов с домножением на factor дают тот же
       результат, что и в v7), и factor для tool-use = 0 (sandbox не нужен). */
    const a = answers || {};
    const answerContext = { Q: a, questionDefaults };
    const agentEnabled = answerBool(answerContext, 'ai_agent_mode', false);
    const stepsBase = agentEnabled
        ? (AGENT_STEPS_MULTIPLIER[a.agent_complexity] ?? AGENT_STEPS_MULTIPLIER.simple)
        : 1;
    /* Параллельные специалисты применяются только в multi_agent (orchestrator
       раскладывает задачу на N специалистов). Для tool_use остаётся 1. */
    const parallel = agentEnabled && a.ai_agent_type === 'multi_agent'
        ? (Number.isFinite(Number(a.agent_parallel_specialists)) && Number(a.agent_parallel_specialists) >= 1
            ? Number(a.agent_parallel_specialists)
            : DEFAULT_AGENT_PARALLEL)
        : 1;
    const agentStepFactor = stepsBase * parallel;
    const toolShare = agentEnabled
        ? (Number.isFinite(Number(a.agent_tool_use_share)) ? Number(a.agent_tool_use_share) / 100 : 0)
        : 0;
    const agentToolFactor = agentStepFactor * toolShare;
    const aiModelTierFactor = AI_MODEL_TIER_FACTOR[a.ai_model_tier] ?? AI_MODEL_TIER_FACTOR.mid;

    return {
        Q: answers || {},
        S: {
            bufferTask:           settings.bufferTask,
            bufferProject:        settings.bufferProject,
            kInflation:           settings.kInflation,
            kSeasonal:            settings.kSeasonal,
            kScheduleShift:       settings.kScheduleShift,
            kContingency:         settings.kContingency,
            vatEnabled:           settings.vatEnabled,
            vatRate:              settings.vatRate,
            planningHorizonYears: settings.planningHorizonYears,
            daysPerMonth:         settings.daysPerMonth,
            period:               settings.period,
            phaseDurationMonths:  settings.phaseDurationMonths,
            standSizeRatio:       ratio,
            agentStepFactor,
            agentToolFactor,
            aiModelTierFactor
        },
        STAND: stand,
        questionDefaults,
        answersMeta: answersMeta || {}
    };
}

/* ---------- Расчёт qty/cost для одного ЭК ---------- */

/**
 * Безопасно вычислить qty ЭК для конкретного стенда.
 * Если формула пуста или ошибка — возвращаем 0 + поле error.
 *
 * Возвращает «сырое» qty без проверки на финитность — overflow-detection
 * (Infinity / NaN) выполняется на уровне calculate() единообразно для
 * qty / costBase / costFinal с сообщением «Числовое переполнение».
 */
function computeItemQty(item, stand, context) {
    if (!item.applicableStands.includes(stand)) return { qty: 0, error: null };
    const source = item.qtyFormulas?.[stand] ?? '';
    const ast = getAst(source);
    if (ast === null) return { qty: 0, error: null };
    if (isAstError(ast)) return { qty: 0, error: ast.__error.message };
    try {
        const v = evaluate(ast, context);
        const num = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
        // Не-финитные значения (Infinity / NaN) пропускаем дальше — их перехватит
        // overflow-check в calculate() и выставит cell.error = 'Числовое переполнение'.
        if (!Number.isFinite(num)) return { qty: num, error: null };
        return { qty: Math.max(0, num), error: null };
    } catch (e) {
        return { qty: 0, error: e.message };
    }
}

function resolveAnswerValue(context, id, fallback = 0) {
    const answers = context?.Q || {};
    const defaults = context?.questionDefaults || {};
    if (Object.prototype.hasOwnProperty.call(answers, id)) {
        const value = answers[id];
        if (value !== null && value !== undefined && value !== '') return value;
    }
    if (Object.prototype.hasOwnProperty.call(defaults, id)) {
        const value = defaults[id];
        if (value !== null && value !== undefined && value !== '') return value;
    }
    return fallback;
}

function answerBool(context, id, fallback = false) {
    const value = resolveAnswerValue(context, id, fallback);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized !== '' && normalized !== 'false' && normalized !== '0' && normalized !== 'нет';
    }
    return Boolean(value);
}

function answerNumber(context, id, fallback = 0) {
    const raw = resolveAnswerValue(context, id, fallback);
    const normalized = typeof raw === 'string'
        ? raw.trim().replace(/\s+/g, '').replace('%', '').replace(',', '.')
        : raw;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : fallback;
}

function hasContextAnswer(context, id) {
    const answers = context?.Q || {};
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

function isExplicitContextAnswer(context, id) {
    if (!hasContextAnswer(context, id)) return false;
    const meta = context?.answersMeta?.[id];
    if (meta && typeof meta === 'object') return true;
    const defaults = context?.questionDefaults || {};
    if (!Object.prototype.hasOwnProperty.call(defaults, id)) return true;
    return !sameScalarValue(context.Q[id], defaults[id]);
}

function hasExplicitTokenDemand(context) {
    const registered = answerNumber(context, 'registered_users_total', 0);
    const dauShare = answerNumber(context, 'dau_share_of_registered_percent', 0);
    const aiShare = answerNumber(context, 'ai_users_share', 0);
    const requestsPerUserDay = answerNumber(context, 'ai_requests_per_user_day', 0);
    const inputTokens = answerNumber(context, 'ai_avg_input_tokens', 0);
    const outputTokens = answerNumber(context, 'ai_avg_output_tokens', 0);
    if (![registered, dauShare, aiShare, requestsPerUserDay].every(v => Number.isFinite(v) && v > 0)) {
        return false;
    }
    if (![inputTokens, outputTokens].some(v => Number.isFinite(v) && v > 0)) return false;
    return [
        'ai_users_share',
        'ai_requests_per_user_day',
        'ai_avg_input_tokens',
        'ai_avg_output_tokens',
        'ai_caching_share'
    ].some(id => isExplicitContextAnswer(context, id));
}

function hasImplicitLlmFeature(context) {
    return [
        'rag_needed',
        'ai_agent_mode',
        'ai_safety_layer',
        'ai_finetune_needed'
    ].some(id => answerBool(context, id, false) && isExplicitContextAnswer(context, id));
}

function shouldCalculateLlmTokenDemand(context) {
    return answerBool(context, 'ai_llm_used', false)
        || hasExplicitTokenDemand(context)
        || (hasImplicitLlmFeature(context) && hasPositiveTokenDemandInputs(context));
}

/**
 * Domain-level fallback for external LLM token items.
 *
 * Legacy/imported JSON can contain stale qtyFormulas for token rows (or explicit
 * zero formulas after older migrations). UI-only recovery is not enough: the
 * Details cost table and all totals must be based on the same calculated cells.
 * This fallback mirrors the seed formula and runs only when the formula produced
 * zero while answers describe a positive external/private-cloud LLM workload.
 */
function deriveExternalLlmTokenQtyFallback(item, stand, context) {
    if (!EXTERNAL_LLM_TOKEN_ITEM_IDS.has(item?.id)) return 0;
    if (!item.applicableStands?.includes(stand)) return 0;
    if (!shouldCalculateLlmTokenDemand(context)) return 0;
    if (String(resolveAnswerValue(context, 'ai_hosting_mode', '')).trim() === 'on_prem_gpu') return 0;
    if (item.id === 'ai-safety-moderation-tokens-1m'
        && !answerBool(context, 'ai_safety_layer', false)) return 0;

    /* v2.20.72: degenerate user-base rescue. Если пользователь явно включил AI
     * (ai_llm_used=true) и задал положительные demand-параметры (aiShare,
     * requestsPerUserDay, входные/выходные токены), но registered<=0 OR dau<=0,
     * это вырожденное несогласованное состояние: AI активирован, но user-base
     * не задана → формула × 0 = 0, fallback × 0 = 0 → токены silent-0.
     *
     * Документированное поведение из seed.js (registered_users_total.description):
     * «Если ответ не указан («Нет информации») — расчёт пойдёт от 500 000.»
     * Применяем тот же defensive-defaulting для degenerate-0 при наличии явного
     * AI opt-in. См. CLAUDE.md §Current Project Lessons: «If ai_llm_used is true
     * and token workload inputs are positive, the model must produce either
     * visible token workload or an explicit on-prem operational derivation.» */
    const demand = getEffectiveLlmTokenDemand(context, {
        repairDegenerate: answerBool(context, 'ai_llm_used', false)
    });
    const dauShare = demand.dauShare / 100;
    const aiShare = demand.aiShare / 100;
    const requestsPerUserDay = demand.requestsPerUserDay;
    const inputTokens = demand.inputTokens;
    const outputTokens = demand.outputTokens;
    const cacheShare = demand.cacheShare / 100;
    const agentStepFactor = numWithDefault(context?.S?.agentStepFactor, 1);
    const modelFactor = numWithDefault(context?.S?.aiModelTierFactor, 1);
    const standRatio = numWithDefault(context?.S?.standSizeRatio?.[stand], stand === 'PROD' ? 1 : 0);

    const requestsPerMonth = demand.registered * dauShare * aiShare * requestsPerUserDay * DEFAULT_DAYS_PER_MONTH * agentStepFactor;
    const inputMillions = requestsPerMonth * inputTokens * (1 - cacheShare) / 1_000_000 * modelFactor * standRatio;
    const outputMillions = requestsPerMonth * outputTokens / 1_000_000 * modelFactor * standRatio;

    if (item.id === 'llm-tokens-input-1m') return Math.ceil(Math.max(0, inputMillions));
    if (item.id === 'llm-tokens-output-1m') return Math.ceil(Math.max(0, outputMillions));
    return Math.ceil(Math.max(0, (inputMillions + outputMillions) * 0.10));
}

/* ---------- LRU-кэш итогов ---------- */

const _resultCache = new LruCache(CALC_CACHE_SIZE);

/* ---------- Вспомогательная инициализация агрегаторов ---------- */

function makeZeroCategoryMap()      { return Object.fromEntries(CATEGORY_IDS.map(c => [c, 0])); }
function makeZeroResourceClassMap() { return Object.fromEntries(RESOURCE_CLASS_IDS.map(c => [c, 0])); }
function makeZeroIntervalMap()      { return Object.fromEntries(BILLING_INTERVAL_IDS.map(c => [c, 0])); }

/**
 * Главная функция расчёта.
 *
 * Кэш-ключ строится из идентификатора расчёта и его revision-счётчика
 * (см. store.js), что дешевле, чем хешировать весь словарь на каждом
 * вызове. Если revision не передан — кэш выключен (расчёт всегда живой).
 *
 * Структура результата (расширенная, обратно совместимая):
 *   {
 *     stands: { DEV: { items: [{itemId, qty, costBase, costFinal, error, riskBreakdown}],
 *                      totalDaily, totalMonthly, totalAnnual,
 *                      byCategory, byResourceClass, byBillingInterval, byCostType }, ... },
 *     totalDaily, totalMonthly, totalAnnual,
 *     byCategory, byResourceClass, byBillingInterval, byCostType,
 *     items: { itemId: { stands: { DEV:{qty, costBase, costFinal, error, riskBreakdown}, ... },
 *                        totalDaily, totalMonthly, totalAnnual, costType } }
 *   }
 *
 *   byCostType — { capex: ₽, opex: ₽ }. CAPEX/OPEX определяется через
 *   getCostType(item) — явное item.costType или auto-derive по billingInterval
 *   ('oneTime'→capex, иначе opex).
 *
 * @param {Object} calculation
 * @param {string|number} [revision] — версия расчёта для ключа кэша
 */
export function calculate(calculation, revision = null) {
    const cacheKey = revision !== null && calculation?.id
        ? `${calculation.id}#${revision}`
        : null;
    if (cacheKey) {
        const cached = _resultCache.get(cacheKey);
        if (cached) return cached;
    }

    const { settings, answers, dictionaries } = calculation;
    const questions = dictionaries.questions || [];

    /* 14.U6: Provider overlay. Перед расчётом подменяем pricePerUnit (и vendor/
       priceSource) для item-ов, перечисленных в PROVIDER_OVERLAYS[provider].prices.
       Provider читаем из settings (default sbercloud). Silent fallback: для item-ов
       без записи в overlay используются seed-цены. provider=undefined / неактивный
       provider тоже даёт fallback на seed (см. applyProviderOverlay).
       Влияет на ВСЕ consumer'ы (Дашборд / Детализация / Сравнение / PDF / CSV)
       автоматически — единый источник истины.

       Stage 8.3: если у calc'а есть `providerVersion` маркер — это означает,
       что snapshot эффективных цен (frozen ∪ user override) уже сохранён в
       calc.dictionaries.items пользователем через applyNewProviderPrices.
       Применять frozen-overlay поверх такого snapshot'а нельзя — это перетрёт
       override обратно на frozen-цены. Используем items как есть.
       Legacy-расчёты без providerVersion работают как раньше. */
    const providerId = settings?.provider || DEFAULT_PROVIDER;
    const rawItems = dictionaries.items || [];
    const items = calculation?.providerVersion
        ? rawItems
        : applyProviderOverlay(rawItems, providerId);

    const phaseDuration = Number(settings?.phaseDurationMonths) || DEFAULT_PHASE_DURATION_MONTHS;
    const daysPerMonth  = Number(settings?.daysPerMonth) || DEFAULT_DAYS_PER_MONTH;

    /* questionDefaults зависит только от questions — собираем ОДИН раз и
       переиспользуем для всех (item × stand) контекстов ниже. */
    const questionDefaults = buildQuestionDefaults(questions);

    const result = {
        stands: {},
        totalDaily: 0,
        totalMonthly: 0,
        totalAnnual: 0,
        byCategory:         makeZeroCategoryMap(),
        byResourceClass:    makeZeroResourceClassMap(),
        byBillingInterval:  makeZeroIntervalMap(),
        byCostType:         makeZeroCostTypeMap(),
        items: {}
    };

    for (const stand of STAND_IDS) {
        result.stands[stand] = {
            items: [],
            totalDaily: 0,
            totalMonthly: 0,
            totalAnnual: 0,
            byCategory:        makeZeroCategoryMap(),
            byResourceClass:   makeZeroResourceClassMap(),
            byBillingInterval: makeZeroIntervalMap(),
            byCostType:        makeZeroCostTypeMap()
        };
    }

    for (const item of items) {
        result.items[item.id] = {
            stands: {},
            totalDaily: 0,
            totalMonthly: 0,
            totalAnnual: 0,
            costType: getCostType(item)
        };
        for (const stand of STAND_IDS) {
            result.items[item.id].stands[stand] = {
                qty: 0, costBase: 0, costFinal: 0, error: null, riskBreakdown: null
            };
        }
    }

    // Применять ли риск-коэффициенты к итогу. По умолчанию TRUE (с рисками).
    // При FALSE — наценка не накапливается в итог (costFinal = costBase × vatMul,
    // т.е. без буферов/инфляции/сезонности/расписания/резерва), НО cell.riskBreakdown
    // всё равно содержит реальные коэффициенты, чтобы UI мог показать
    // «потенциальную» наценку в карточке «Вклад риск-коэффициентов».
    //
    // 12.U20: НДС применяется ВСЕГДА когда vatEnabled=true, независимо от applyRisks.
    // НДС — это налог, а не риск; пользователь либо учитывает его в бюджете, либо
    // нет — это отдельный решение от того, накручиваем ли мы риски сверху.
    const applyRisks = settings.applyRiskFactors !== false;

    for (const item of items) {
        const intervalMul = billingIntervalToMonthlyMultiplier(
            item.billingInterval, daysPerMonth, phaseDuration
        );
        const price = Number(item.pricePerUnit) || 0;
        const ct = getCostType(item);

        for (const stand of STAND_IDS) {
            const ctx = buildContext(answers, settings, questionDefaults, stand, item, calculation.answersMeta);
            const { qty: formulaQty, error: formulaError } = computeItemQty(item, stand, ctx);
            /* Fallback тригерится при formulaError=null И:
             *   (а) формула вернула 0/негатив (легитимный случай: явный 0 или
             *       устаревшая стаб-формула после миграции);
             *   (б) формула вернула non-finite (NaN/Infinity) — например, если
             *       будущая ревизия formula-engine будет возвращать NaN на
             *       missing S.<var> вместо нынешнего 0. Defensive: ни при
             *       какой эволюции engine'а токены не должны «провалиться» в
             *       overflow-guard и показать «—». См. CLAUDE.md §Current
             *       Project Lessons «If `ai_llm_used` is true and token
             *       workload inputs are positive, the model must produce
             *       either visible token workload or an explicit on-prem
             *       operational derivation». */
            const formulaIsZeroOrNonFinite = !Number.isFinite(formulaQty) || formulaQty <= 0;
            const fallbackQty = !formulaError && formulaIsZeroOrNonFinite
                ? deriveExternalLlmTokenQtyFallback(item, stand, ctx)
                : 0;
            const rawQty = fallbackQty > 0 ? fallbackQty : formulaQty;
            const rawCostBase = rawQty * price * intervalMul;
            const breakdown = riskFactor(item, stand, settings);
            // 12.U20: VAT — независимая ось, применяется ВСЕГДА когда vatEnabled.
            // Риски — отдельный мастер: при applyRisks=false costFinal = costBase × vatMul.
            const riskMul = applyRisks ? breakdown.total : 1;
            const rawCostFinal = rawCostBase * riskMul * breakdown.vatMul;

            // Overflow-guard: если qty / costBase / costFinal стали не-финитными
            // (Infinity / NaN из-за переполнения double), фиксируем ошибку и не
            // даём «грязным» числам утечь в агрегаты — иначе result.totalMonthly
            // станет NaN и испортит весь дашборд / CSV-экспорт.
            // riskBreakdown оставляем с реальными коэффициентами (CLAUDE.md:
            // «cell.riskBreakdown ВСЕГДА содержит реальные коэффициенты»).
            const overflow = !Number.isFinite(rawQty)
                || !Number.isFinite(rawCostBase)
                || !Number.isFinite(rawCostFinal);
            const error = overflow ? 'Числовое переполнение' : formulaError;
            const qty       = overflow ? 0 : rawQty;
            const costBase  = overflow ? 0 : rawCostBase;
            const costFinal = overflow ? 0 : rawCostFinal;

            const cell = {
                itemId: item.id, qty,
                costBase, costFinal,
                error, riskBreakdown: breakdown
            };
            const standBucket = result.stands[stand];
            standBucket.items.push(cell);
            standBucket.totalMonthly += costFinal;
            standBucket.totalAnnual  += costFinal * MONTHS_PER_YEAR;

            const cat = CATEGORY_IDS.includes(item.category) ? item.category : 'SERVICES';
            const rc  = RESOURCE_CLASS_IDS.includes(item.resourceClass) ? item.resourceClass : 'SERVICE';
            const bi  = BILLING_INTERVAL_IDS.includes(item.billingInterval) ? item.billingInterval : 'monthly';

            standBucket.byCategory[cat]            += costFinal;
            standBucket.byResourceClass[rc]        += costFinal;
            standBucket.byBillingInterval[bi]      += costFinal;
            standBucket.byCostType[ct]             += costFinal;

            result.byCategory[cat]                 += costFinal;
            result.byResourceClass[rc]             += costFinal;
            result.byBillingInterval[bi]           += costFinal;
            result.byCostType[ct]                  += costFinal;

            result.items[item.id].stands[stand] = {
                qty, costBase, costFinal, error, riskBreakdown: breakdown
            };
            result.items[item.id].totalMonthly += costFinal;
            result.items[item.id].totalAnnual  += costFinal * MONTHS_PER_YEAR;

            result.totalMonthly += costFinal;
            result.totalAnnual  += costFinal * MONTHS_PER_YEAR;
        }
    }

    // Дневные итоги — производные от месячных через daysPerMonth.
    const safeDays = daysPerMonth > 0 ? daysPerMonth : DEFAULT_DAYS_PER_MONTH;
    result.totalDaily = result.totalMonthly / safeDays;
    for (const stand of STAND_IDS) {
        result.stands[stand].totalDaily = result.stands[stand].totalMonthly / safeDays;
    }
    for (const item of items) {
        const agg = result.items[item.id];
        agg.totalDaily = agg.totalMonthly / safeDays;
    }

    if (cacheKey) _resultCache.set(cacheKey, result);
    return result;
}

/**
 * Очистка кэша. Вызывается при загрузке нового JSON или существенных миграциях.
 */
export function clearCalculationCache() {
    _resultCache.clear();
    clearAstCache();
}
