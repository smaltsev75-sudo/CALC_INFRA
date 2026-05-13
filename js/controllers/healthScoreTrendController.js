/**
 * Stage 16.5 (PATCH 2.9.4) — Health Score Trend controller.
 *
 * Тонкая прослойка между интеграционными точками (Health Check / Guided
 * Completion / Optimization Playbooks) и persistence-слоем. Собирает snapshot
 * из health-result, прогоняет через dedup, пишет в localStorage.
 *
 * История живёт ОТДЕЛЬНО от calc — schema migration не нужна, переживает F5.
 *
 * Layer compliance: импортирует store + domain + persistence (services), но НЕ ui.
 */

import { store } from '../state/store.js';
import { evaluateCalculationHealth } from '../domain/calculationHealth.js';
import {
    buildHealthScoreSnapshot
} from '../domain/healthScoreTrend.js';
import {
    appendHealthScoreTrendSnapshot,
    loadHealthScoreTrend,
    clearHealthScoreTrend as _clearTrend
} from '../state/persistence.js';

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * Записать snapshot health-score для активного / переданного calc.
 * Использует evaluateCalculationHealth, если healthResult не передан.
 *
 * @param {string|null} calcId      - id расчёта; null/undefined → берём активный
 * @param {object|null} healthResult - готовый result (опционально, для re-use кэша)
 * @param {string}      source       - 'health_check' | 'guided_completion' |
 *                                      'optimization_playbook' | 'manual_recheck'
 * @returns {{ ok: boolean, written?: boolean, reason?: string }}
 */
export function recordHealthScoreSnapshot(calcId, healthResult, source) {
    const calc = store.getState().activeCalc;
    const id = calcId || calc?.id;
    if (!id) return { ok: false, reason: 'no-calc-id' };

    let result = healthResult;
    if (!result) {
        if (!calc) return { ok: false, reason: 'no-active-calc' };
        try {
            result = evaluateCalculationHealth(calc);
        } catch (_e) {
            return { ok: false, reason: 'evaluate-failed' };
        }
    }
    const snapshot = buildHealthScoreSnapshot(result, source);
    if (!snapshot) return { ok: false, reason: 'invalid-result' };

    const written = appendHealthScoreTrendSnapshot(id, snapshot);
    return { ok: true, written };
}

/**
 * История trend'а для активного calc. Возвращает массив snapshot'ов
 * (oldest → newest). Если активного calc нет или истории нет — [].
 */
export function getHealthScoreTrendForActiveCalc() {
    const calc = store.getState().activeCalc;
    if (!calc?.id) return [];
    const trend = loadHealthScoreTrend();
    return Array.isArray(trend[calc.id]) ? trend[calc.id] : [];
}

/**
 * История по конкретному id (используется UI, когда модалка ещё не вызывала
 * recordHealthScoreSnapshot, но calc id уже известен).
 */
export function getHealthScoreTrendForCalc(calcId) {
    if (!calcId) return [];
    const trend = loadHealthScoreTrend();
    return Array.isArray(trend[calcId]) ? trend[calcId] : [];
}

/**
 * Очистить историю активного calc.
 * @returns {boolean} true если что-то было удалено.
 */
export function clearHealthScoreTrendForActiveCalc() {
    const calc = store.getState().activeCalc;
    if (!calc?.id) return false;
    return _clearTrend(calc.id);
}
