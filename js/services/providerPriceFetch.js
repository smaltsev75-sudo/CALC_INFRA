/**
 * Validation + normalization + history rollback для override'ов прайсов
 * провайдеров.
 *
 * Stage 17.2 Phase 5: bundled-fetch path удалён (functions
 * `providerLatestUrl`, `fetchProviderPriceJson`, `applyProviderPriceUpdate`,
 * `rollbackProviderPriceUpdate` — снесены вместе с UI-кнопкой «Обновить
 * с сервера»). Файл оставлен под историческим именем `providerPriceFetch.js`,
 * но теперь содержит pure-валидацию JSON-схемы прайса, нормализацию VAT
 * (Stage VAT-2 Phase 1) и helpers управления history-стеком override'ов.
 *
 * Stage VAT-2 Phase 1: `validateProviderPriceJson` принимает schemaVersion=1
 * (legacy, backwards-compat) ИЛИ schemaVersion=2 (новая схема с vatPolicy +
 * pricePerUnitNet/Gross + vatRate per entry). Новый pure helper
 * `normalizeProviderPriceEntry(entry, providerVatPolicy, options)` приводит
 * любой entry к net (single source of truth для downstream calculator).
 *
 * Текущий пользовательский путь обновления прайса:
 *   file-picker → readJsonFile → validateProviderPriceJson →
 *   saveProviderOverride + pushProviderOverrideHistory.
 * Реализован в `js/controllers/providerController.js#updateProviderPricesFromFile`.
 *
 * Контракт ответа всех функций — `{ ok: true, ... }` или
 * `{ ok: false, reason, message }`. Никаких throw'ов наружу.
 */

import {
    EPSILON_VAT_CONSISTENCY,
    PROVIDER_PRICE_SCHEMA_VERSION
} from '../utils/constants.js';
import {
    loadProviderOverrides,
    saveProviderOverride,
    clearProviderOverride,
    pushProviderOverrideHistory,
    popProviderOverrideHistory,
    peekProviderOverrideHistory,
    loadProviderOverrideHistory
} from '../state/persistence.js';

const ALLOWED_TOP_LEVEL_V1 = Object.freeze([
    'schemaVersion', 'providerId', 'version', 'timestamp', 'source', 'prices'
]);

const ALLOWED_TOP_LEVEL_V2 = Object.freeze([
    'schemaVersion', 'providerId', 'version', 'timestamp', 'source', 'prices', 'vatPolicy'
]);

const REQUIRED_TOP_LEVEL = Object.freeze([
    'schemaVersion', 'providerId', 'version', 'timestamp', 'source', 'prices'
]);

const ALLOWED_CONFIDENCE = Object.freeze([
    'verified', 'source-level', 'assumed', 'user-declared'
]);

const ALLOWED_USER_VAT_POLICY = Object.freeze(['net', 'gross-20', 'gross-22']);

/**
 * Pure: проверяет структуру JSON и нормализует prices к net.
 *
 * @param {object} parsed — распарсенный JSON.
 * @param {string} expectedProviderId — `providerId`, ожидаемый caller'ом.
 * @param {object} [options]
 * @param {'net'|'gross-20'|'gross-22'} [options.userVatPolicy]
 *   Для v1 import: явный выбор пользователя о VAT-политике файла.
 *   Применяется к каждому price entry → net + originalPricePerUnit.
 *   Игнорируется для v2 (у v2 свой `vatPolicy` внутри JSON).
 * @param {boolean} [options.requireVatPolicy=false]
 *   Если true И schemaVersion=1 И нет userVatPolicy → reject
 *   `vat-policy-required`. Phase 5 UI выставит true для user-import path.
 *   Default false → backwards-compat для bundled JSON loading.
 *
 * @returns {{ ok: true, data } | { ok: false, reason, message }}
 *   v1 reasons: shape | schema-version | provider-mismatch | missing-field
 *               | invalid-timestamp | empty-prices | shape-prices
 *               | invalid-price | unknown-fields | vat-policy-required
 *               | invalid-user-vat-policy
 *   v2 reasons: всё из v1 + missing-vat-policy | invalid-confidence
 *               | invalid-vat-rate | gross-without-vat-rate | vat-inconsistency
 */
export function validateProviderPriceJson(parsed, expectedProviderId, options = {}) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, reason: 'shape', message: 'Ожидался объект на верхнем уровне.' };
    }

    const sv = parsed.schemaVersion;
    if (sv === 1) {
        return _validateV1(parsed, expectedProviderId, options);
    }
    if (sv === PROVIDER_PRICE_SCHEMA_VERSION) {
        return _validateV2(parsed, expectedProviderId, options);
    }
    return {
        ok: false,
        reason: 'schema-version',
        message: `Ожидалась schemaVersion=1 или ${PROVIDER_PRICE_SCHEMA_VERSION}, получено ${sv}.`
    };
}

/**
 * Pure helper: нормализует один price entry к net.
 *
 * Контракт «net в downstream» — pricePerUnit ВСЕГДА равен net. Calculator
 * применяет НДС ровно один раз через `vatMul = 1 + calc.vatRate` поверх
 * этого net.
 *
 * Идемпотентен: повторный вызов на уже нормализованном entry (с
 * `vatNormalized: true`) возвращает shallow-clone без перевычислений.
 *
 * @param {object} entry — raw price entry (`{ pricePerUnit, ... }` v1, или
 *                         `{ pricePerUnitNet, pricePerUnitGross, vatRate, ... }` v2).
 * @param {object} providerVatPolicy — `{ pricesIncludeVat, vatRateIncluded?, confidence }`.
 *                                     Для v1 + userVatPolicy — синтезируется caller'ом.
 * @param {object} [options]
 * @param {'net'|'gross-20'|'gross-22'} [options.userVatPolicy]
 *   Для v1 entry. Триггерит конверсию pricePerUnit (legacy) → net.
 * @param {string} [options.id]
 *   Опционально для diagnostic-сообщений.
 *
 * @returns {{ ok: true, entry } | { ok: false, reason, message }}
 *   reasons: invalid-entry | invalid-vat-rate | invalid-price
 *          | gross-without-vat-rate | vat-inconsistency | vat-policy-required
 *          | invalid-user-vat-policy | missing-price
 */
export function normalizeProviderPriceEntry(entry, providerVatPolicy, options = {}) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { ok: false, reason: 'invalid-entry', message: 'entry должен быть объектом.' };
    }

    /* Идемпотентность: если entry уже нормализован — возвращаем shallow clone. */
    if (entry.vatNormalized === true) {
        return { ok: true, entry: { ...entry } };
    }

    const id = options.id || '<entry>';
    const hasNet = 'pricePerUnitNet' in entry;
    const hasGross = 'pricePerUnitGross' in entry;
    const hasVatRate = 'vatRate' in entry;
    const hasLegacyPpu = 'pricePerUnit' in entry;

    /* Validate vatRate (если присутствует) — табличный whitelist в B.4. */
    if (hasVatRate) {
        const v = entry.vatRate;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
            return {
                ok: false,
                reason: 'invalid-vat-rate',
                message: `${id}: vatRate должен быть числом в [0, 1], получено ${String(v)}.`
            };
        }
    }

    /* Validate net (если присутствует). */
    if (hasNet) {
        const v = entry.pricePerUnitNet;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
            return {
                ok: false,
                reason: 'invalid-price',
                message: `${id}.pricePerUnitNet должен быть неотрицательным конечным числом.`
            };
        }
    }

    /* Validate gross (если присутствует). */
    if (hasGross) {
        const v = entry.pricePerUnitGross;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
            return {
                ok: false,
                reason: 'invalid-price',
                message: `${id}.pricePerUnitGross должен быть неотрицательным конечным числом.`
            };
        }
    }

    let net;
    let gross;
    let vatRateIncluded;
    let confidence;

    if (hasNet && hasGross) {
        /* Both present — required vatRate + consistency check. */
        if (!hasVatRate) {
            return {
                ok: false,
                reason: 'gross-without-vat-rate',
                message: `${id}: pricePerUnitGross с pricePerUnitNet требует vatRate.`
            };
        }
        const expectedGross = entry.pricePerUnitNet * (1 + entry.vatRate);
        if (Math.abs(entry.pricePerUnitGross - expectedGross) > EPSILON_VAT_CONSISTENCY) {
            return {
                ok: false,
                reason: 'vat-inconsistency',
                message:
                    `${id}: net=${entry.pricePerUnitNet}, gross=${entry.pricePerUnitGross}, ` +
                    `vatRate=${entry.vatRate}. Ожидался gross≈${expectedGross.toFixed(4)}, ` +
                    `допуск ${EPSILON_VAT_CONSISTENCY} ₽.`
            };
        }
        net = entry.pricePerUnitNet;
        gross = entry.pricePerUnitGross;
        vatRateIncluded = entry.vatRate;
    } else if (hasGross) {
        if (!hasVatRate) {
            return {
                ok: false,
                reason: 'gross-without-vat-rate',
                message: `${id}: pricePerUnitGross требует vatRate.`
            };
        }
        gross = entry.pricePerUnitGross;
        vatRateIncluded = entry.vatRate;
        net = _roundKopek(gross / (1 + vatRateIncluded));
    } else if (hasNet) {
        net = entry.pricePerUnitNet;
        if (hasVatRate) vatRateIncluded = entry.vatRate;
    } else if (hasLegacyPpu) {
        /* v1 fallback path — требует явный userVatPolicy. */
        const policy = options.userVatPolicy;
        if (!policy) {
            return {
                ok: false,
                reason: 'vat-policy-required',
                message: `${id}: legacy pricePerUnit требует явный options.userVatPolicy.`
            };
        }
        if (!ALLOWED_USER_VAT_POLICY.includes(policy)) {
            return {
                ok: false,
                reason: 'invalid-user-vat-policy',
                message: `${id}: unknown userVatPolicy='${policy}'. Допустимо: ${ALLOWED_USER_VAT_POLICY.join('|')}.`
            };
        }
        const raw = entry.pricePerUnit;
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
            return {
                ok: false,
                reason: 'invalid-price',
                message: `${id}.pricePerUnit должен быть неотрицательным конечным числом.`
            };
        }
        if (policy === 'net') {
            net = raw;
        } else {
            /* 'gross-20' → 20 → 0.20; 'gross-22' → 22 → 0.22.
             * Ставка извлекается из имени policy — нет VAT-литералов в коде
             * (линтер vat-rate-no-literals.test.js): пользовательский выбор
             * сам по себе является объявлением ставки. */
            gross = raw;
            const pct = Number(policy.slice(-2));
            vatRateIncluded = pct / 100;
            net = _roundKopek(gross / (1 + vatRateIncluded));
        }
    } else {
        return {
            ok: false,
            reason: 'missing-price',
            message: `${id}: entry без pricePerUnitNet, pricePerUnitGross или pricePerUnit.`
        };
    }

    /* Confidence: user-declared если из options.userVatPolicy, иначе берём из
     * provider-level vatPolicy.confidence. */
    if (options.userVatPolicy) {
        confidence = 'user-declared';
    } else if (providerVatPolicy && typeof providerVatPolicy.confidence === 'string'
        && ALLOWED_CONFIDENCE.includes(providerVatPolicy.confidence)) {
        confidence = providerVatPolicy.confidence;
    }

    /* Build normalized entry: clone + overwrite normalized fields. */
    const out = { ...entry };
    /* Удаляем raw input-поля, оставляя только канонический набор. */
    delete out.vatRate;
    out.pricePerUnit = net;
    out.pricePerUnitNet = net;
    if (gross !== undefined) out.pricePerUnitGross = gross;
    if (vatRateIncluded !== undefined) out.vatRateIncluded = vatRateIncluded;
    if (confidence) out.vatPolicyConfidence = confidence;
    out.vatNormalized = true;
    if (hasLegacyPpu && !hasNet && !hasGross) {
        out.originalPricePerUnit = entry.pricePerUnit;
    }

    return { ok: true, entry: out };
}

/* ============================================================
 * Internal: v1 / v2 validators
 * ============================================================ */

function _validateV1(parsed, expectedProviderId, options) {
    /* unknown-fields: защита от случайных полей в JSON (опечатка имени).
       Внутри prices.<id> допустимы forward-compat поля — не трогаем. */
    const keys = Object.keys(parsed);
    for (const k of keys) {
        if (!ALLOWED_TOP_LEVEL_V1.includes(k)) {
            return { ok: false, reason: 'unknown-fields', message: `Неизвестное поле верхнего уровня: ${k}` };
        }
    }

    const baseCheck = _validateCommonTopLevel(parsed, expectedProviderId);
    if (!baseCheck.ok) return baseCheck;

    /* v1 + requireVatPolicy=true БЕЗ userVatPolicy → reject (Phase 5 UI path). */
    if (options.requireVatPolicy && !options.userVatPolicy) {
        return {
            ok: false,
            reason: 'vat-policy-required',
            message: 'Импорт v1 JSON требует явный выбор VAT-политики (cancel | net | gross-20 | gross-22).'
        };
    }

    /* Если userVatPolicy не задан И requireVatPolicy=false — это backwards-compat
     * путь (bundled JSON load). Валидируем структуру, ничего не нормализуем. */
    if (!options.userVatPolicy) {
        return _validateV1RawEntries(parsed, expectedProviderId);
    }

    /* userVatPolicy задан — валидируем + нормализуем каждый entry. */
    if (!ALLOWED_USER_VAT_POLICY.includes(options.userVatPolicy)) {
        return {
            ok: false,
            reason: 'invalid-user-vat-policy',
            message: `Unknown userVatPolicy='${options.userVatPolicy}'. Допустимо: ${ALLOWED_USER_VAT_POLICY.join('|')}.`
        };
    }
    const syntheticPolicy = {
        pricesIncludeVat: options.userVatPolicy !== 'net',
        confidence: 'user-declared'
    };
    return _normalizeAllEntries(parsed, syntheticPolicy, { userVatPolicy: options.userVatPolicy });
}

function _validateV1RawEntries(parsed, expectedProviderId) {
    /* Точное поведение существующего validateProviderPriceJson до VAT-2:
     * валидируем каждый entry без нормализации. Сохраняет backwards-compat
     * для bundled JSON loading. */
    const { prices } = parsed;
    const priceIds = Object.keys(prices);
    for (const id of priceIds) {
        const entry = prices[id];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return { ok: false, reason: 'invalid-price', message: `prices.${id} должен быть объектом.` };
        }
        if (typeof entry.pricePerUnit !== 'number' || !Number.isFinite(entry.pricePerUnit) || entry.pricePerUnit <= 0) {
            return {
                ok: false,
                reason: 'invalid-price',
                message: `prices.${id}.pricePerUnit должен быть положительным конечным числом.`
            };
        }
        if (typeof entry.vendor !== 'string') {
            return { ok: false, reason: 'invalid-price', message: `prices.${id}.vendor должен быть строкой.` };
        }
        if (typeof entry.priceSource !== 'string' || !entry.priceSource) {
            return {
                ok: false,
                reason: 'invalid-price',
                message: `prices.${id}.priceSource должен быть непустой строкой.`
            };
        }
    }
    return { ok: true, data: parsed };
}

function _validateV2(parsed, expectedProviderId, options) {
    /* unknown-fields для v2 — список расширен полем vatPolicy. */
    const keys = Object.keys(parsed);
    for (const k of keys) {
        if (!ALLOWED_TOP_LEVEL_V2.includes(k)) {
            return { ok: false, reason: 'unknown-fields', message: `Неизвестное поле верхнего уровня: ${k}` };
        }
    }

    const baseCheck = _validateCommonTopLevel(parsed, expectedProviderId);
    if (!baseCheck.ok) return baseCheck;

    /* vatPolicy обязателен. */
    if (parsed.vatPolicy === null || parsed.vatPolicy === undefined) {
        return {
            ok: false,
            reason: 'missing-vat-policy',
            message: 'v2 JSON обязан содержать vatPolicy на верхнем уровне.'
        };
    }
    if (typeof parsed.vatPolicy !== 'object' || Array.isArray(parsed.vatPolicy)) {
        return {
            ok: false,
            reason: 'missing-vat-policy',
            message: 'vatPolicy должен быть объектом.'
        };
    }
    if (typeof parsed.vatPolicy.confidence !== 'string'
        || !ALLOWED_CONFIDENCE.includes(parsed.vatPolicy.confidence)) {
        return {
            ok: false,
            reason: 'invalid-confidence',
            message: `vatPolicy.confidence должен быть одним из: ${ALLOWED_CONFIDENCE.join('|')}.`
        };
    }

    return _normalizeAllEntries(parsed, parsed.vatPolicy, {});
}

function _validateCommonTopLevel(parsed, expectedProviderId) {
    for (const field of REQUIRED_TOP_LEVEL) {
        if (!(field in parsed)) {
            return { ok: false, reason: 'missing-field', message: `Отсутствует поле: ${field}.` };
        }
    }

    if (typeof parsed.providerId !== 'string' || !parsed.providerId) {
        return { ok: false, reason: 'missing-field', message: 'providerId должен быть непустой строкой.' };
    }
    if (parsed.providerId !== expectedProviderId) {
        return {
            ok: false,
            reason: 'provider-mismatch',
            message: `Ожидался providerId=${expectedProviderId}, получено ${parsed.providerId}.`
        };
    }

    if (typeof parsed.version !== 'string' || !parsed.version) {
        return { ok: false, reason: 'missing-field', message: 'version должен быть непустой строкой.' };
    }

    if (typeof parsed.timestamp !== 'string') {
        return { ok: false, reason: 'invalid-timestamp', message: 'timestamp должен быть строкой.' };
    }
    const ts = new Date(parsed.timestamp);
    if (Number.isNaN(ts.getTime())) {
        return { ok: false, reason: 'invalid-timestamp', message: `Некорректный timestamp: ${parsed.timestamp}.` };
    }

    if (typeof parsed.source !== 'string') {
        return { ok: false, reason: 'missing-field', message: 'source должен быть строкой (можно пустой).' };
    }

    const { prices } = parsed;
    if (!prices || typeof prices !== 'object' || Array.isArray(prices)) {
        return { ok: false, reason: 'shape-prices', message: 'prices должен быть объектом.' };
    }
    if (Object.keys(prices).length === 0) {
        return { ok: false, reason: 'empty-prices', message: 'prices не должен быть пустым.' };
    }

    return { ok: true };
}

function _normalizeAllEntries(parsed, providerVatPolicy, normalizeOptions) {
    const { prices } = parsed;
    const priceIds = Object.keys(prices);
    const normalizedPrices = {};
    for (const id of priceIds) {
        const entry = prices[id];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return { ok: false, reason: 'invalid-price', message: `prices.${id} должен быть объектом.` };
        }
        const n = normalizeProviderPriceEntry(entry, providerVatPolicy, {
            ...normalizeOptions,
            id: `prices.${id}`
        });
        if (!n.ok) return n;
        /* Поверх нормализации сохраняем v1-обязательные meta-поля
         * (vendor / priceSource), если они есть в input. */
        if (typeof entry.vendor === 'string') n.entry.vendor = entry.vendor;
        if (typeof entry.priceSource === 'string') n.entry.priceSource = entry.priceSource;
        normalizedPrices[id] = n.entry;
    }
    return { ok: true, data: { ...parsed, prices: normalizedPrices } };
}

/** Округление до копейки (2 decimal places) — единая точность money в проекте.
 *  Используется при `gross / (1 + vatRate)` для устранения float-шума. */
function _roundKopek(value) {
    return Number(value.toFixed(2));
}

/* ============================================================
 * History rollback (без изменений с Stage 9.5)
 * ============================================================ */

/**
 * Stage 9.5: откатить current override на ОДНУ позицию в истории — pop top
 * stack, set as current. Если история пуста → clear current → frozen-default.
 *
 * @param {string} providerId
 * @returns {{ ok: true, restored: object|null, hasMoreHistory: boolean } | { ok: false, reason, message }}
 */
export function rollbackProviderPriceOverride(providerId) {
    if (!providerId || typeof providerId !== 'string') {
        return { ok: false, reason: 'invalid-provider', message: 'Не указан providerId.' };
    }

    const previous = popProviderOverrideHistory(providerId);
    if (!previous) {
        /* Истории нет — откат означает «убрать current override совсем». */
        const current = loadProviderOverrides();
        if (!current || !current[providerId]) {
            return { ok: false, reason: 'no-override', message: 'Нет применённого прайса для отката.' };
        }
        const cleared = clearProviderOverride(providerId);
        if (!cleared) return { ok: false, reason: 'persist', message: 'Не удалось очистить overlay.' };
        return { ok: true, restored: null, hasMoreHistory: false };
    }

    /* Восстанавливаем prior override как current. */
    const saved = saveProviderOverride(providerId, previous.appliedJSON);
    if (!saved) {
        /* Откат провалился — попробовать вернуть snapshot обратно в историю. */
        pushProviderOverrideHistory(providerId, previous);
        return { ok: false, reason: 'persist', message: 'Не удалось применить prior overlay.' };
    }

    const remainingHistory = loadProviderOverrideHistory(providerId);
    return { ok: true, restored: previous.appliedJSON, hasMoreHistory: remainingHistory.length > 0 };
}

/**
 * Stage 9.5: получить top-of-stack history snapshot (для UI кнопки «Откатить»).
 * Возвращает { appliedJSON, appliedAt } | null.
 */
export function getPreviousProviderOverride(providerId) {
    return peekProviderOverrideHistory(providerId);
}
