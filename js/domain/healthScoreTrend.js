/**
 * Stage 16.5 (PATCH 2.9.4) — Health Score Trend.
 *
 * Чистый domain-модуль, отвечает за:
 *   - построение snapshot из health-result;
 *   - dedup защиту от шума (одинаковые score+counts+source за 60s);
 *   - append с обрезкой до 20 точек;
 *   - summary (first / current / best / delta);
 *   - format (timeline-строка «64 → 78 → 91»).
 *
 * Layer compliance: pure domain (без DOM, store, services). Persistence —
 * в js/state/persistence.js (он импортирует этот модуль).
 */

/* ============================================================
 * Constants
 * ============================================================ */

export const HEALTH_SCORE_TREND_LIMIT = 20;

export const HEALTH_SCORE_TREND_DEDUP_WINDOW_MS = 60_000;  // 60 секунд

export const HEALTH_SCORE_TREND_SOURCE_LABELS = Object.freeze({
    health_check:           'Проверка расчёта',
    guided_completion:      'Мастер уточнения',
    optimization_playbook:  'Рекомендованное действие',
    manual_recheck:         'Ручная проверка'
});

const VALID_SOURCES = Object.freeze(Object.keys(HEALTH_SCORE_TREND_SOURCE_LABELS));

const FORMAT_DEFAULT_LIMIT = 5;

/* ============================================================
 * Helpers
 * ============================================================ */

function isFiniteNum(x) {
    return typeof x === 'number' && Number.isFinite(x);
}

function safeCount(v) {
    if (!isFiniteNum(v)) return 0;
    return Math.max(0, Math.trunc(v));
}

function normalizeSource(source) {
    return VALID_SOURCES.includes(source) ? source : 'manual_recheck';
}

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * Построить snapshot health score из result evaluateCalculationHealth.
 *
 * @param {object} healthResult - { score, counts: { error, warning, recommendation, info } }
 * @param {string} source       - 'health_check' | 'guided_completion' | 'optimization_playbook' | 'manual_recheck'
 * @param {Date}   [now]        - дата записи (для тестов; default — new Date())
 * @returns {object|null}        - { timestamp, score, errorCount, warningCount, recommendationCount, source }
 *                                  или null если score отсутствует/некорректен
 */
export function buildHealthScoreSnapshot(healthResult, source, now) {
    if (!healthResult || typeof healthResult !== 'object') return null;
    const score = healthResult.score;
    if (!isFiniteNum(score)) return null;
    const counts = healthResult.counts || {};
    const at = now instanceof Date ? now : new Date();
    return {
        timestamp:           at.toISOString(),
        score:               Math.round(score),
        errorCount:          safeCount(counts.error),
        warningCount:        safeCount(counts.warning),
        recommendationCount: safeCount(counts.recommendation),
        source:              normalizeSource(source)
    };
}

/**
 * Решает, добавлять ли snapshot в историю. Защита от шума:
 *   - если последняя точка имеет тот же score+errorCount+warningCount+
 *     recommendationCount+source И моложе 60 секунд — НЕ добавляем.
 */
export function shouldAppendHealthScoreSnapshot(history, snapshot) {
    if (!snapshot) return false;
    if (!Array.isArray(history) || history.length === 0) return true;
    const last = history[history.length - 1];
    if (!last) return true;
    const sameAll =
        last.score === snapshot.score &&
        last.errorCount === snapshot.errorCount &&
        last.warningCount === snapshot.warningCount &&
        last.recommendationCount === snapshot.recommendationCount &&
        last.source === snapshot.source;
    if (!sameAll) return true;
    const lastTime = Date.parse(last.timestamp);
    const newTime  = Date.parse(snapshot.timestamp);
    if (!Number.isFinite(lastTime) || !Number.isFinite(newTime)) return true;
    return (newTime - lastTime) >= HEALTH_SCORE_TREND_DEDUP_WINDOW_MS;
}

/**
 * Добавить snapshot к истории. Возвращает новую копию массива (не мутирует
 * вход). Применяет dedup и trim до limit.
 *
 * @param {Array} history
 * @param {object|null} snapshot
 * @param {object} [options]
 * @param {boolean} [options.force=false]  - пропустить dedup (для unit-тестов
 *                                            или принудительного снимка)
 * @param {number}  [options.limit]        - переопределить HEALTH_SCORE_TREND_LIMIT
 */
export function appendHealthScoreSnapshot(history, snapshot, options = {}) {
    const safe = Array.isArray(history) ? history.slice() : [];
    if (!snapshot) return safe;
    const force = options.force === true;
    if (!force && !shouldAppendHealthScoreSnapshot(safe, snapshot)) {
        return safe;
    }
    safe.push(snapshot);
    const limit = isFiniteNum(options.limit) && options.limit > 0
        ? Math.trunc(options.limit)
        : HEALTH_SCORE_TREND_LIMIT;
    if (safe.length > limit) {
        return safe.slice(safe.length - limit);
    }
    return safe;
}

/**
 * Сводка по истории: first / current / best / delta / count.
 *   - first   — первая точка (старейшая)
 *   - current — последняя точка
 *   - best    — точка с максимальным score (при равенстве — последняя из них)
 *   - delta   — current.score − first.score (может быть отрицательным)
 *
 * @returns {object|null}
 */
export function getHealthScoreTrendSummary(history) {
    if (!Array.isArray(history) || history.length === 0) return null;
    const first = history[0];
    const current = history[history.length - 1];
    let best = first;
    for (const s of history) {
        if (s && isFiniteNum(s.score) && s.score >= best.score) {
            best = s;
        }
    }
    return {
        first,
        current,
        best,
        count: history.length,
        delta: (current?.score ?? 0) - (first?.score ?? 0)
    };
}

/**
 * Форматирует историю в timeline-строку: «64 → 78 → 91».
 *
 * @param {Array} history
 * @param {object} [options]
 * @param {number} [options.limit=5]  - сколько последних точек показать; 0 = все.
 * @param {string} [options.separator=' → ']
 */
export function formatHealthScoreTrend(history, options = {}) {
    if (!Array.isArray(history) || history.length === 0) return '';
    const limit = options.limit === 0 ? 0
        : (isFiniteNum(options.limit) && options.limit > 0
            ? Math.trunc(options.limit)
            : FORMAT_DEFAULT_LIMIT);
    const separator = typeof options.separator === 'string'
        ? options.separator
        : ' → ';
    const slice = limit === 0 ? history : history.slice(-limit);
    const scores = slice
        .filter(s => s && isFiniteNum(s.score))
        .map(s => Math.round(s.score));
    if (scores.length === 0) return '';
    // Схлопываем последовательно одинаковые значения: «100 → 100 → 100» = «100».
    // «50 → 75 → 75 → 91» = «50 → 75 → 91». Иначе timeline бесполезен и
    // визуально шумит, когда score не меняется (типичный кейс: пользователь
    // открыл Health Check несколько раз, ничего не правил → все snapshot'ы
    // одинаковы по score, но dedup-окно 60s было превышено).
    const collapsed = [scores[0]];
    for (let i = 1; i < scores.length; i++) {
        if (scores[i] !== collapsed[collapsed.length - 1]) {
            collapsed.push(scores[i]);
        }
    }
    return collapsed.map(String).join(separator);
}
