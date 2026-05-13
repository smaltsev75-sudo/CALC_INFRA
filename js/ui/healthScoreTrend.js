/**
 * Stage 16.5 (PATCH 2.9.4) — Health Score Trend UI component.
 *
 * Рендерит mini-timeline и подробную секцию с динамикой health score.
 *
 * - renderHealthScoreTrendMini  — короткая строка «64 → 78 → 91» для дашборда.
 * - renderHealthScoreTrend      — полная секция (mini + last snapshot details +
 *                                  опциональная кнопка очистки).
 * - renderHealthScoreTrendEmpty — empty-state placeholder.
 *
 * Layer: pure UI (читает domain helpers, не знает о store).
 */

import { el } from './dom.js';
import {
    formatHealthScoreTrend,
    getHealthScoreTrendSummary,
    HEALTH_SCORE_TREND_SOURCE_LABELS
} from '../domain/healthScoreTrend.js';

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * Mini timeline для дашборда. При истории <2 точек — пояснение.
 *
 * @param {Array} history
 * @param {object} [options]
 * @param {number} [options.limit=5]
 * @returns {Element}
 */
export function renderHealthScoreTrendMini(history, options = {}) {
    if (!Array.isArray(history) || history.length === 0) {
        return renderHealthScoreTrendEmpty();
    }
    if (history.length === 1) {
        return el('div', {
            class: ['health-score-trend-mini', 'health-score-trend-mini-single']
        },
            el('span', {
                class: 'health-score-trend-label',
                text: 'Динамика качества:'
            }),
            el('span', {
                class: 'health-score-trend-value',
                text: String(Math.round(history[0]?.score ?? 0))
            }),
            el('span', {
                class: 'health-score-trend-hint',
                text: 'появится после нескольких проверок'
            })
        );
    }
    const text = formatHealthScoreTrend(history, { limit: options.limit ?? 5 });
    return el('div', { class: 'health-score-trend-mini' },
        el('span', {
            class: 'health-score-trend-label',
            text: 'Динамика качества:'
        }),
        el('span', { class: 'health-score-trend-value', text })
    );
}

/**
 * Полная секция для модалки Health Check. Содержит:
 *   - заголовок;
 *   - timeline (последние 5 точек);
 *   - summary (first → current, count, best);
 *   - детали последней проверки (counts + source);
 *   - опциональную кнопку «Очистить историю качества».
 *
 * @param {Array} history
 * @param {object} [options]
 * @param {Function} [options.onClear] - если передан — рендерим кнопку очистки.
 */
export function renderHealthScoreTrend(history, options = {}) {
    if (!Array.isArray(history) || history.length === 0) {
        return el('section', { class: 'health-score-trend' },
            el('h4', {
                class: 'health-score-trend-title',
                text: 'Динамика качества'
            }),
            renderHealthScoreTrendEmpty()
        );
    }
    const summary = getHealthScoreTrendSummary(history);
    const last = summary?.current;
    const timeline = formatHealthScoreTrend(history, { limit: 5 });
    return el('section', { class: 'health-score-trend' },
        el('h4', {
            class: 'health-score-trend-title',
            text: 'Динамика качества'
        }),
        el('div', { class: 'health-score-trend-timeline' },
            el('span', { class: 'health-score-trend-value', text: timeline })
        ),
        renderSummaryRow(summary),
        renderLastSnapshotDetails(last),
        typeof options.onClear === 'function'
            ? el('div', { class: 'health-score-trend-actions' },
                el('button', {
                    class: 'btn btn-ghost health-score-trend-clear',
                    attrs: { type: 'button',
                        title: 'Удалить историю качества для этого расчёта' },
                    onClick: options.onClear
                }, 'Очистить историю качества')
              )
            : null
    );
}

/**
 * Empty-state — пустая история.
 */
export function renderHealthScoreTrendEmpty() {
    return el('div', { class: 'health-score-trend-empty' },
        el('span', {
            class: 'health-score-trend-hint',
            text: 'История качества пока не накоплена.'
        })
    );
}

/* ============================================================
 * Internal
 * ============================================================ */

function renderSummaryRow(summary) {
    if (!summary || summary.count < 2) return null;
    const delta = summary.delta;
    const sign = delta > 0 ? '+' : '';
    const cls = delta > 0
        ? 'health-score-trend-delta-positive'
        : (delta < 0 ? 'health-score-trend-delta-negative' : 'health-score-trend-delta-zero');
    return el('div', { class: 'health-score-trend-summary' },
        el('span', {
            class: 'health-score-trend-summary-item',
            text: `Проверок: ${summary.count}`
        }),
        el('span', {
            class: ['health-score-trend-summary-item', 'health-score-trend-summary-delta', cls],
            text: `Δ ${sign}${delta}`
        }),
        el('span', {
            class: 'health-score-trend-summary-item',
            text: `Лучшее: ${summary.best?.score ?? '—'}`
        })
    );
}

function renderLastSnapshotDetails(snap) {
    if (!snap) return null;
    const sourceLabel = HEALTH_SCORE_TREND_SOURCE_LABELS[snap.source] || snap.source || '—';
    const date = formatTimestamp(snap.timestamp);
    return el('div', { class: 'health-score-trend-last' },
        el('h5', {
            class: 'health-score-trend-last-title',
            text: 'Последняя проверка'
        }),
        el('ul', { class: 'health-score-trend-last-list' },
            el('li', { text: `Оценка: ${snap.score}/100` }),
            el('li', { text: `Ошибок: ${snap.errorCount ?? 0}` }),
            el('li', { text: `Предупреждений: ${snap.warningCount ?? 0}` }),
            el('li', { text: `Рекомендаций: ${snap.recommendationCount ?? 0}` }),
            el('li', { text: `Источник: ${sourceLabel}` }),
            date
                ? el('li', { text: `Время: ${date}` })
                : null
        )
    );
}

function formatTimestamp(iso) {
    if (typeof iso !== 'string') return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const HH = String(d.getHours()).padStart(2, '0');
    const MM = String(d.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}.${yyyy} ${HH}:${MM}`;
}
