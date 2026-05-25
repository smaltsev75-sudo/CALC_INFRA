/**
 * AI capacity summary for the Details tab.
 *
 * Details cost/qty tables stay in detailsSections.js; this module owns only the
 * compact AI metrics rollup shown on the Details tab.
 */

import { el, infoIcon } from './dom.js';
import {
    STAND_IDS, STAND_LABELS,
    DASHBOARD_AI_METRIC_LABELS, DASHBOARD_AI_METRIC_TITLES,
    DASHBOARD_AI_METRIC_DESCRIPTIONS, DASHBOARD_AI_METRIC_UNIT_SUFFIX
} from '../utils/constants.js';
import { aggregateAiMetrics, formatResourceQty } from './dashboard.js';

/* Сводный блок AI-метрик внизу таблицы Детализации.

   UI: маленькая таблица 4 строки x 5 столбцов стендов + ИТОГО. Каждая
   строка — одна AI-метрика (Токены / RAG-индекс / Эмбеддинги / CPU агентов),
   каждая ячейка — qty этой метрики на этом стенде с правильной единицей
   измерения. Disabled-стенды показаны приглушёнными.

   Граничные:
     calc=null              → null (нет активного расчёта).
     все qty всех метрик=0  → null (AI отключён в проекте).
     хотя бы одна qty>0     → блок появляется с заголовком + таблица.
     hideNoBudget=true      → строки без видимых значений в активных стендах
                              и ИТОГО скрываются синхронно с кнопкой
                              «Скрыть без бюджета».

   Зачем здесь, а не только на Дэшборде:
     Детализация = разрез ИТ-аналитика. Он видит per-item суммы (токены input,
     output, эмбеддинги отдельно), а здесь — агрегаты этих ЭК по операционной
     метрике (TOKENS = input + output вместе). Помогает быстро ответить на
     вопрос «сколько у нас в сумме токенов на PSI?» без ручного сложения
     двух строк. */
export function renderAiMetricsSummary(calc, result, disabledStands, applyRisks, ctx, options = {}) {
    if (!calc) return null;
    const aiMetrics = aggregateAiMetrics(result, calc.dictionaries?.items || [], disabledStands, applyRisks, calc);
    const total = aiMetrics.total || {};
    const perStand = aiMetrics.perStand || {};
    const hideNoBudget = !!options.hideNoBudget;

    // Скрываем блок, если ВСЕ метрики пусты (AI отключён в проекте).
    const hasAny = DASHBOARD_AI_METRIC_LABELS.some(label => {
        const e = total[label];
        return e && e.qty > 0;
    });
    if (!hasAny) return null;

    const visibleLabels = DASHBOARD_AI_METRIC_LABELS.filter(label => {
        if (!hideNoBudget) return true;
        return hasVisibleAiMetricValue(label, total, perStand, disabledStands);
    });
    if (visibleLabels.length === 0) return null;

    const fmt = (qty, unit) => {
        const v = formatResourceQty(qty, unit);
        return v === null ? '—' : `${v} ${unit}`;
    };

    const headerRow = el('tr', { class: 'details-thead-row details-thead-row-headers' },
        el('th', { class: 'details-ai-cell-metric', text: 'Метрика' }),
        ...STAND_IDS.map(sid => el('th', {
            class: ['details-ai-cell-stand', disabledStands.includes(sid) && 'details-ai-cell-disabled'],
            title: disabledStands.includes(sid)
                ? `${STAND_LABELS[sid]} исключён из ИТОГО (toolbar). Цифра в этой колонке остаётся для справки, но в ИТОГО не входит.`
                : STAND_LABELS[sid],
            text: STAND_LABELS[sid]
        })),
        el('th', { class: 'details-ai-cell-total', text: 'ИТОГО' })
    );

    const rows = visibleLabels.map(label => {
        const tot = total[label];
        const title = DASHBOARD_AI_METRIC_TITLES[label] || label;
        const desc = DASHBOARD_AI_METRIC_DESCRIPTIONS[label] || '';
        const suffix = DASHBOARD_AI_METRIC_UNIT_SUFFIX[label] || '';

        const openHint = ev => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            if (typeof ctx.openMessageModal === 'function') {
                ctx.openMessageModal({ title, message: desc });
            }
        };

        const cells = STAND_IDS.map(sid => {
            const cell = perStand[sid]?.[label];
            const text = cell ? fmt(cell.qty, cell.unit) : '—';
            return el('td', {
                class: ['details-ai-cell-stand', disabledStands.includes(sid) && 'details-ai-cell-disabled'],
                title: cell ? `${STAND_LABELS[sid]}: ${text}${suffix}` : `${STAND_LABELS[sid]}: нет данных`,
                text: cell && cell.qty > 0 ? `${formatResourceQty(cell.qty, cell.unit) ?? '—'}` : '—'
            });
        });

        const totalText = tot && tot.qty > 0
            ? `${formatResourceQty(tot.qty, tot.unit) ?? '—'} ${tot.unit}${suffix}`
            : '—';

        return el('tr', { class: 'details-ai-row' },
            el('td', { class: 'details-ai-cell-metric' },
                el('span', { class: 'details-ai-cell-metric-name', text: title }),
                infoIcon(openHint, 'Подробное описание метрики')
            ),
            ...cells,
            el('td', { class: 'details-ai-cell-total', text: totalText })
        );
    });

    const modeNote = applyRisks
        ? 'С capacity-буферами (буферы / сезонность / сдвиг / контингент). Без VAT и инфляции — финансовые факторы, не capacity.'
        : 'Без capacity-буферов — голый объём. Включите «Учитывать риск-коэффициенты» в Опроснике для оценки с буферами.';

    return el('div', { class: 'details-ai-summary' },
        el('div', { class: 'details-ai-summary-header' },
            el('span', { class: 'details-ai-summary-title', text: 'Сводка AI-метрик' }),
            el('span', { class: 'details-ai-summary-note', text: modeNote })
        ),
        el('div', { class: 'details-ai-summary-table-wrap' },
            el('table', { class: 'details-ai-summary-table' },
                el('thead', null, headerRow),
                el('tbody', null, ...rows)
            )
        )
    );
}

function hasVisibleAiMetricValue(label, total, perStand, disabledStands = []) {
    const isVisible = (entry) => {
        if (!entry || !(entry.qty > 0)) return false;
        const text = formatResourceQty(entry.qty, entry.unit);
        return text !== null && text !== '0';
    };
    if (isVisible(total?.[label])) return true;
    const disabled = new Set(disabledStands);
    return STAND_IDS.some(sid => !disabled.has(sid) && isVisible(perStand?.[sid]?.[label]));
}
