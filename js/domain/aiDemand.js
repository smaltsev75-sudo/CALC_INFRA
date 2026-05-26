/**
 * Shared AI LLM demand contract.
 *
 * The same predicate is used by calculator fallback, Health Check and tests:
 * if LLM is enabled and token workload inputs are positive, token workload must
 * either be visible or there must be an explicit diagnostic finding.
 */

export const AI_TOKEN_USER_BASE_FIELDS = Object.freeze([
    'registered_users_total',
    'dau_share_of_registered_percent'
]);

export const AI_TOKEN_WORKLOAD_FIELDS = Object.freeze([
    'ai_users_share',
    'ai_requests_per_user_day',
    'ai_avg_input_tokens',
    'ai_avg_output_tokens',
    'ai_caching_share'
]);

export const AI_TOKEN_VOLUME_FIELDS = Object.freeze([
    'ai_avg_input_tokens',
    'ai_avg_output_tokens',
    'ai_caching_share'
]);

export const AI_LLM_TOKEN_CONTRACT_FIELDS = Object.freeze([
    'ai_llm_used',
    'ai_hosting_mode',
    ...AI_TOKEN_USER_BASE_FIELDS,
    ...AI_TOKEN_WORKLOAD_FIELDS
]);

function answerBag(source) {
    if (source?.Q && typeof source.Q === 'object') return source.Q;
    if (source?.answers && typeof source.answers === 'object') return source.answers;
    return source && typeof source === 'object' ? source : {};
}

function defaultBag(source) {
    if (source?.questionDefaults && typeof source.questionDefaults === 'object') {
        return source.questionDefaults;
    }
    if (source?.defaults && typeof source.defaults === 'object') return source.defaults;
    return {};
}

export function resolveDemandAnswer(source, id, fallback = undefined) {
    const answers = answerBag(source);
    if (Object.prototype.hasOwnProperty.call(answers, id)) {
        const value = answers[id];
        if (value !== null && value !== undefined && value !== '') return value;
    }
    const defaults = defaultBag(source);
    if (Object.prototype.hasOwnProperty.call(defaults, id)) {
        const value = defaults[id];
        if (value !== null && value !== undefined && value !== '') return value;
    }
    return fallback;
}

export function demandNumber(source, id, fallback = 0) {
    const raw = resolveDemandAnswer(source, id, fallback);
    const normalized = typeof raw === 'string'
        ? raw.trim().replace(/\s+/g, '').replace('%', '').replace(',', '.')
        : raw;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : fallback;
}

export function demandBool(source, id, fallback = false) {
    const value = resolveDemandAnswer(source, id, fallback);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized !== '' && normalized !== 'false' && normalized !== '0' && normalized !== 'нет';
    }
    return Boolean(value);
}

export function hasActiveLlmOptIn(source) {
    return demandBool(source, 'ai_llm_used', false);
}

export function isExternalLlmHosting(source) {
    return String(resolveDemandAnswer(source, 'ai_hosting_mode', '')).trim() !== 'on_prem_gpu';
}

export function getTokenDemandSignal(source) {
    const aiUsersShare = demandNumber(source, 'ai_users_share', 0);
    const requestsPerUserDay = demandNumber(source, 'ai_requests_per_user_day', 0);
    const inputTokens = demandNumber(source, 'ai_avg_input_tokens', 0);
    const outputTokens = demandNumber(source, 'ai_avg_output_tokens', 0);
    return {
        aiUsersShare,
        requestsPerUserDay,
        inputTokens,
        outputTokens,
        positive: [aiUsersShare, requestsPerUserDay].every(v => Number.isFinite(v) && v > 0)
            && [inputTokens, outputTokens].some(v => Number.isFinite(v) && v > 0)
    };
}

export function hasPositiveTokenDemandSignal(source) {
    return getTokenDemandSignal(source).positive;
}

export function getEffectiveTokenUserBase(source, options = {}) {
    const repairDegenerate = options.repairDegenerate === true;
    const defaults = defaultBag(source);
    const rawRegistered = demandNumber(source, 'registered_users_total', 0);
    const rawDauShare = demandNumber(source, 'dau_share_of_registered_percent', 0);
    let registered = rawRegistered;
    let dauShare = rawDauShare;
    const repairedFields = [];

    if (repairDegenerate && registered <= 0) {
        const def = Number(defaults.registered_users_total);
        if (Number.isFinite(def) && def > 0) {
            registered = def;
            repairedFields.push('registered_users_total');
        }
    }
    if (repairDegenerate && dauShare <= 0) {
        const def = Number(defaults.dau_share_of_registered_percent);
        if (Number.isFinite(def) && def > 0) {
            dauShare = def;
            repairedFields.push('dau_share_of_registered_percent');
        }
    }

    return {
        rawRegistered,
        rawDauShare,
        registered,
        dauShare,
        repairedFields,
        positive: [registered, dauShare].every(v => Number.isFinite(v) && v > 0),
        degenerate: rawRegistered <= 0 || rawDauShare <= 0
    };
}

export function hasPositiveTokenDemandInputs(source, options = {}) {
    if (!hasPositiveTokenDemandSignal(source)) return false;
    const repairDegenerate = options.repairDegenerate === true;
    return getEffectiveTokenUserBase(source, { repairDegenerate }).positive;
}

export function getEffectiveLlmTokenDemand(source, options = {}) {
    const repairDegenerate = options.repairDegenerate === true;
    const signal = getTokenDemandSignal(source);
    const userBase = getEffectiveTokenUserBase(source, {
        repairDegenerate: repairDegenerate && signal.positive
    });
    const cacheShare = Math.min(100, Math.max(0, demandNumber(source, 'ai_caching_share', 0)));
    return {
        ...signal,
        ...userBase,
        aiShare: signal.aiUsersShare,
        cacheShare,
        positive: signal.positive && userBase.positive
    };
}

export function hasLlmTokenVisibilityContract(source, options = {}) {
    if (!hasActiveLlmOptIn(source)) return false;
    if (options.externalOnly === true && !isExternalLlmHosting(source)) return false;
    return hasPositiveTokenDemandInputs(source, {
        repairDegenerate: options.repairDegenerate === true
    });
}
