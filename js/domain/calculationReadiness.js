/**
 * Stage 17.6 — Readiness for Review (готовность расчёта к обсуждению).
 *
 * Pure-domain функция: получает calc + опциональные precomputed signals,
 * возвращает вердикт + списки блокеров и warning'ов.
 *
 * Не дублирует Health Check:
 *   - Health  отвечает «насколько качественные данные внутри расчёта?»
 *     (полнота заполнения, корректность типов, проверки доменных инвариантов).
 *   - Readiness отвечает «можно ли с этим расчётом идти к людям?»
 *     (агрегирует health + допущения + бюджет + прайс в один вердикт).
 *
 * Шкала вердиктов:
 *   - 'empty'                 — расчёт пуст, обсуждать нечего.
 *   - 'needs_clarification'   — есть блокеры (минимум один).
 *   - 'ready'                 — нет блокеров (warning'и допустимы).
 *
 * Блокеры (зафиксированы Stage 17.6 spec):
 *   - calc_empty       — нет ни одного непустого ответа.
 *   - health_errors    — health.counts.error > 0.
 *   - health_score_low — health.score < HEALTH_SCORE_MIN (60).
 *   - budget_missing   — НЕ задан ни target_capex_rub, ни target_opex_monthly_rub.
 *
 * Warning'и (не блокеры — расчёт всё равно «готов», но с пометкой):
 *   - risky_assumptions — risky-count ≥ RISKY_ASSUMPTIONS_WARN (3).
 *   - provider_stale    — calc.providerVersion.stale === true.
 *
 * Layer: pure domain (без DOM, store, services).
 */

import { evaluateCalculationHealth } from './calculationHealth.js';
import { buildAssumptionsRegister, getRiskyAssumptions } from './assumptionsRegister.js';

/* ============================================================
 * Public constants
 * ============================================================ */

export const READINESS_VERDICTS = Object.freeze({
    READY: 'ready',
    NEEDS_CLARIFICATION: 'needs_clarification',
    EMPTY: 'empty'
});

export const READINESS_THRESHOLDS = Object.freeze({
    HEALTH_SCORE_MIN: 60,
    RISKY_ASSUMPTIONS_WARN: 3
});

/* ============================================================
 * Internal helpers
 * ============================================================ */

function isEmptyAnswer(v) {
    if (v === null || v === undefined) return true;
    if (v === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
}

function countMeaningfulAnswers(calc) {
    const answers = calc?.answers || {};
    let count = 0;
    for (const k of Object.keys(answers)) {
        if (!isEmptyAnswer(answers[k])) count++;
    }
    return count;
}

function isMissingBudget(calc) {
    const tc = calc?.answers?.target_capex_rub;
    const to = calc?.answers?.target_opex_monthly_rub;
    const noCapex = tc == null || tc === '' || !(Number(tc) > 0);
    const noOpex  = to == null || to === '' || !(Number(to) > 0);
    return noCapex && noOpex;
}

function resolveRiskyCount(calc, context) {
    if (Number.isInteger(context.riskyCount)) return context.riskyCount;
    const reg = context.assumptionsRegister;
    if (Array.isArray(reg?.risky)) return reg.risky.length;
    if (Array.isArray(reg)) {
        try { return getRiskyAssumptions(reg).length; } catch { return 0; }
    }
    try {
        const built = buildAssumptionsRegister(calc);
        return Array.isArray(built) ? getRiskyAssumptions(built).length : 0;
    } catch {
        return 0;
    }
}

function resolveHealth(calc, context) {
    if (context.healthResult) return context.healthResult;
    try { return evaluateCalculationHealth(calc); }
    catch { return { findings: [], score: 100, counts: { error: 0, warning: 0, recommendation: 0, info: 0 } }; }
}

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * Оценить готовность расчёта к обсуждению.
 *
 * @param {object|null} calc
 * @param {object} [context]
 * @param {object} [context.healthResult]   — precomputed evaluateCalculationHealth(calc)
 * @param {object} [context.assumptionsRegister] — { risky: [...] } или массив register'а
 * @param {number} [context.riskyCount]     — precomputed risky-count
 * @returns {{
 *   verdict: 'ready'|'needs_clarification'|'empty',
 *   blockers: Array<{ id, title, detail }>,
 *   warnings: Array<{ id, title, detail }>
 * }}
 */
export function evaluateCalculationReadiness(calc, context = {}) {
    if (!calc || typeof calc !== 'object') {
        return { verdict: READINESS_VERDICTS.EMPTY, blockers: [], warnings: [] };
    }

    const answerCount = countMeaningfulAnswers(calc);

    // ---- Verdict 'empty' — расчёт без ответов вообще, нет смысла перечислять блокеры ----
    if (answerCount === 0) {
        return {
            verdict: READINESS_VERDICTS.EMPTY,
            blockers: [{
                id: 'calc_empty',
                title: 'Расчёт пуст',
                detail: 'Опросник не заполнен — нет ни одного ответа.'
            }],
            warnings: []
        };
    }

    const blockers = [];
    const warnings = [];

    const health = resolveHealth(calc, context);
    const errorCount = Number(health?.counts?.error) || 0;
    const score = Number.isFinite(health?.score) ? health.score : 100;

    // ---- BLOCKER: Health errors ----
    if (errorCount > 0) {
        blockers.push({
            id: 'health_errors',
            title: `Критические ошибки: ${errorCount}`,
            detail: 'Health Check нашёл ошибки, расчёт некорректен — сначала исправить.'
        });
    }

    // ---- BLOCKER: Low health score (только если ошибок нет — иначе дубль) ----
    if (errorCount === 0 && score < READINESS_THRESHOLDS.HEALTH_SCORE_MIN) {
        blockers.push({
            id: 'health_score_low',
            title: `Качество расчёта: ${score}/100`,
            detail: `Оценка ниже ${READINESS_THRESHOLDS.HEALTH_SCORE_MIN} — слишком много пробелов.`
        });
    }

    // ---- BLOCKER: Budget not set ----
    if (isMissingBudget(calc)) {
        blockers.push({
            id: 'budget_missing',
            title: 'Бюджет не задан',
            detail: 'Не указаны target CAPEX и target OPEX — нельзя обсуждать «вписываемся ли в лимит».'
        });
    }

    // ---- WARNING: Risky assumptions ≥ 3 ----
    const riskyCount = resolveRiskyCount(calc, context);
    if (riskyCount >= READINESS_THRESHOLDS.RISKY_ASSUMPTIONS_WARN) {
        warnings.push({
            id: 'risky_assumptions',
            title: `Рискованных допущений: ${riskyCount}`,
            detail: 'Часть ответов — значения по умолчанию. Обсуждайте как предварительный.'
        });
    }

    // ---- WARNING: Provider stale ----
    if (calc?.providerVersion && calc.providerVersion.stale === true) {
        warnings.push({
            id: 'provider_stale',
            title: 'Прайс провайдера устарел',
            detail: 'Применённый прайс помечен как stale — суммы требуют сверки.'
        });
    }

    const verdict = blockers.length > 0
        ? READINESS_VERDICTS.NEEDS_CLARIFICATION
        : READINESS_VERDICTS.READY;

    return { verdict, blockers, warnings };
}
