/**
 * Stage 15.1 — Calculation Health Check.
 *
 * Pure-domain логика (без DOM, store, services — только calc + DI metadata).
 * Возвращает массив findings по 22 правилам + score + counts.
 *
 * Score = clamp(100 − sum(HEALTH_PENALTY[sev]), 0, 100). Шкала штрафов
 * подобрана так, чтобы ОДНА ошибка чувствительно опускала рейтинг (−20),
 * а 5+ рекомендаций оставались в зелёной зоне (≥80).
 *
 * Правила сгруппированы по 6 категориям:
 *   - consistency  — внутренние противоречия в нагрузке/аудитории
 *   - completeness — полнота данных (default-ratio, answer-rate, бюджет)
 *   - risk         — настройки риск-факторов (зарезервировано на будущее)
 *   - pricing      — свежесть и применимость прайс-bundle'а
 *   - security     — соответствие требованиям ИБ для типа продукта
 *   - architecture — архитектурные противоречия (зарезервировано)
 */

import {
    HEALTH_PENALTY,
    HEALTH_SEVERITIES
} from '../utils/constants.js';
import { CALCULATION_HEALTH_CHECKS } from './calculationHealthChecks.js';

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * @param {Object} calc       — calc-объект из store.
 * @param {Object} [options]
 * @param {Object} [options.bundleMeta] — { providerId, version, timestamp, isStale? }
 *                                        для pricing-checks. UI передаёт через ctx.
 * @returns {{ findings: HealthFinding[], score: number, counts: { error: number,
 *            warning: number, recommendation: number, info: number } }}
 */
export function evaluateCalculationHealth(calc, options = {}) {
    const safeCounts = { error: 0, warning: 0, recommendation: 0, info: 0 };
    if (!calc || typeof calc !== 'object') {
        return { findings: [], score: 100, counts: safeCounts };
    }
    const findings = [];
    for (const check of CALCULATION_HEALTH_CHECKS) {
        try {
            const f = check(calc, options);
            if (f) findings.push(f);
        } catch (_err) {
            // защитный: один сломанный check не должен убивать всю оценку
            // (например, новое поле с несовместимым типом ответа)
        }
    }
    const counts = { ...safeCounts };
    for (const f of findings) {
        if (counts[f.severity] !== undefined) counts[f.severity]++;
    }
    return { findings, score: getHealthScore(findings), counts };
}

/**
 * Вычисляет финальный score по списку findings.
 * Шкала: clamp(100 − sum(HEALTH_PENALTY[sev]), 0, 100), целое число.
 */
export function getHealthScore(findings) {
    if (!Array.isArray(findings)) return 100;
    let penalty = 0;
    for (const f of findings) {
        const p = HEALTH_PENALTY[f?.severity];
        if (typeof p === 'number') penalty += p;
    }
    const score = 100 - penalty;
    if (score < 0) return 0;
    if (score > 100) return 100;
    return Math.round(score);
}

/**
 * Группирует findings по severity. Возвращает объект со ВСЕМИ 4 ключами
 * (даже пустыми) — чтобы UI мог рендерить пустые секции без NPE-проверок.
 */
export function groupHealthFindings(findings) {
    const groups = { error: [], warning: [], recommendation: [], info: [] };
    if (!Array.isArray(findings)) return groups;
    for (const f of findings) {
        if (f && HEALTH_SEVERITIES.includes(f.severity)) {
            groups[f.severity].push(f);
        }
    }
    return groups;
}

/**
 * Per-scenario evaluate. По решению пользователя (lock-in #2): UI вызывает
 * только для активного scenario. Для legacy-расчётов без scenario-структуры
 * scenarioId игнорируется и возвращается тот же результат, что и для всего calc.
 */
export function evaluateScenarioHealth(calc, scenarioId, options = {}) {
    if (!calc) {
        return { findings: [], score: 100,
            counts: { error: 0, warning: 0, recommendation: 0, info: 0 } };
    }
    const result = evaluateCalculationHealth(calc, options);
    if (scenarioId) {
        // Помечаем все findings заданным scenarioId для UI (drill-down).
        result.findings = result.findings.map(f => ({ ...f, scenarioId }));
    }
    return result;
}
