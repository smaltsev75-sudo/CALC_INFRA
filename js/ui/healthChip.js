/**
 * Stage 15.1 — Health Chip (Опросник sticky chip).
 *
 * После Stage 18.2 dashboard-блок «Качество расчёта» удалён (поглощён
 * композитной «Сводкой состояния расчёта», js/ui/calculationStateSummary.js).
 * Здесь остался только `renderHealthStickyChip` — компакт под прогресс-баром
 * Опросника. Он использует тот же `evaluateCalculationHealth(calc)`, что и
 * sidebar-сводка, поэтому UI-значения всегда синхронны.
 */

import { el } from './dom.js';
import { evaluateCalculationHealth } from '../domain/calculationHealth.js';
import { HEALTH_SCORE_THRESHOLDS } from '../utils/constants.js';

/* ---------- Helper: класс score-цвета ---------- */

function scoreColorClass(score) {
    if (score >= HEALTH_SCORE_THRESHOLDS.good) return 'health-score-good';
    if (score >= HEALTH_SCORE_THRESHOLDS.warning) return 'health-score-warning';
    return 'health-score-critical';
}

/** Текст «1 ошибка · 4 предупреждения · 3 рекомендации». Пустые counts опускаются. */
function buildCountsLine(counts) {
    if (!counts) return '';
    const parts = [];
    if (counts.error > 0) parts.push(pluralize(counts.error, 'ошибка', 'ошибки', 'ошибок'));
    if (counts.warning > 0) parts.push(pluralize(counts.warning, 'предупреждение', 'предупреждения', 'предупреждений'));
    if (counts.recommendation > 0) parts.push(pluralize(counts.recommendation, 'рекомендация', 'рекомендации', 'рекомендаций'));
    if (counts.info > 0) parts.push(pluralize(counts.info, 'заметка', 'заметки', 'заметок'));
    return parts.join(' · ');
}

function pluralize(n, one, few, many) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
    return `${n} ${many}`;
}

/* ============================================================
 * Sticky-chip (компакт для Опросника)
 * ============================================================ */

export function renderHealthStickyChip(calc, ctx, options = {}) {
    if (!calc) return null;
    const { score, counts } = evaluateCalculationHealth(calc, options);
    const colorCls = scoreColorClass(score);
    const summary = buildCountsLine(counts);

    return el('div', {
        class: ['health-sticky-chip', colorCls],
        attrs: { role: 'status', 'aria-live': 'polite' },
        title: summary
            ? `Качество расчёта: ${score} / 100. ${summary}.`
            : `Качество расчёта: ${score} / 100.`
    },
        el('span', { class: 'health-sticky-chip-label', text: 'Качество:' }),
        el('span', { class: 'health-sticky-chip-score', text: `${score} / 100` }),
        el('button', {
            class: 'health-sticky-chip-btn',
            attrs: { type: 'button' },
            title: 'Подробности',
            onClick: () => ctx.openCalculationHealthModal()
        }, 'детали')
    );
}

/* Экспорт helper'ов для тестов. */
export const __test = { scoreColorClass, buildCountsLine, pluralize };
