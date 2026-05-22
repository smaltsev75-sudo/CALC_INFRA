/**
 * VAT normalization helpers for provider price entries.
 * Pure service: no persistence, no controller state, no DOM.
 */

import { EPSILON_VAT_CONSISTENCY } from '../utils/constants.js';
export const ALLOWED_CONFIDENCE = Object.freeze([
    'verified', 'source-level', 'assumed', 'user-declared'
]);

export const ALLOWED_USER_VAT_POLICY = Object.freeze(['net', 'gross-20', 'gross-22']);

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

/** Округление до копейки (2 decimal places) — единая точность money в проекте.
 *  Используется при `gross / (1 + vatRate)` для устранения float-шума. */
function _roundKopek(value) {
    return Number(value.toFixed(2));
}
