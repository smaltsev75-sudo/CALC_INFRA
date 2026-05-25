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
import { formatRub } from '../services/format.js';
import { SEED_ITEMS } from '../domain/seed.js';

const SEED_AI_METRIC_BY_ITEM_ID = new Map(
    SEED_ITEMS.filter(item => item.dashboardAiMetric).map(item => [item.id, item.dashboardAiMetric])
);

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
    const mode = options.mode === 'cost' ? 'cost' : 'qty';
    const qtyMetrics = aggregateAiMetrics(result, calc.dictionaries?.items || [], disabledStands, applyRisks, calc);
    const costMetrics = mode === 'cost'
        ? aggregateAiMetricCosts(result, calc.dictionaries?.items || [], disabledStands)
        : null;
    const total = mode === 'cost' ? (costMetrics.total || {}) : (qtyMetrics.total || {});
    const perStand = mode === 'cost' ? (costMetrics.perStand || {}) : (qtyMetrics.perStand || {});
    const hideNoBudget = !!options.hideNoBudget;

    // Скрываем блок, если ВСЕ метрики пусты (AI отключён в проекте).
    const hasAny = DASHBOARD_AI_METRIC_LABELS.some(label => {
        const e = total[label];
        return mode === 'cost'
            ? e && (e.cost > 0 || e.present)
            : e && e.qty > 0;
    });
    if (!hasAny) return null;

    const visibleLabels = DASHBOARD_AI_METRIC_LABELS.filter(label => {
        if (!hideNoBudget) return true;
        return mode === 'cost'
            ? hasVisibleAiMetricBudget(label, total, perStand, disabledStands)
            : hasVisibleAiMetricValue(label, total, perStand, disabledStands);
    });
    if (visibleLabels.length === 0) return null;

    const fmt = (qty, unit) => {
        const v = formatResourceQty(qty, unit);
        return v === null ? '—' : `${v} ${unit}`;
    };

    const headerRow = el('tr', { class: 'details-thead-row details-thead-row-headers' },
        el('th', { class: 'details-ai-cell-metric', text: 'Метрика / ед.' }),
        ...STAND_IDS.map(sid => el('th', {
            class: ['details-ai-cell-stand', disabledStands.includes(sid) && 'details-ai-cell-disabled'],
            title: disabledStands.includes(sid)
                ? `${STAND_LABELS[sid]} исключён из ИТОГО (toolbar). Цифра в этой колонке остаётся для справки, но в ИТОГО не входит.`
                : STAND_LABELS[sid],
            text: STAND_LABELS[sid]
        })),
        el('th', { class: 'details-ai-cell-total', text: 'ИТОГО' }),
        el('th', { class: 'details-ai-cell-spacer', attrs: { 'aria-hidden': 'true' } })
    );

    const rows = visibleLabels.map(label => {
        const tot = total[label];
        const title = DASHBOARD_AI_METRIC_TITLES[label] || label;
        const desc = DASHBOARD_AI_METRIC_DESCRIPTIONS[label] || '';
        const suffix = DASHBOARD_AI_METRIC_UNIT_SUFFIX[label] || '';
        const unitText = metricUnitText(mode, tot, suffix);

        const openHint = ev => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            if (typeof ctx.openMessageModal === 'function') {
                ctx.openMessageModal({ title, message: desc });
            }
        };

        const cells = STAND_IDS.map(sid => {
            const cell = perStand[sid]?.[label];
            const text = mode === 'cost'
                ? (cell?.present ? formatRub(cell.cost || 0) : '—')
                : (cell ? fmt(cell.qty, cell.unit) : '—');
            return el('td', {
                class: ['details-ai-cell-stand', disabledStands.includes(sid) && 'details-ai-cell-disabled'],
                title: cell?.present || cell?.qty > 0
                    ? `${STAND_LABELS[sid]}: ${text}${mode === 'qty' ? suffix : ''}`
                    : `${STAND_LABELS[sid]}: нет данных`,
                text: mode === 'cost'
                    ? (cell?.present ? formatRub(cell.cost || 0) : '—')
                    : (cell && cell.qty > 0 ? `${formatResourceQty(cell.qty, cell.unit) ?? '—'}` : '—')
            });
        });

        const totalText = mode === 'cost'
            ? (tot?.present ? formatRub(tot.cost || 0) : '—')
            : (tot && tot.qty > 0
                ? `${formatResourceQty(tot.qty, tot.unit) ?? '—'} ${tot.unit}${suffix}`
                : '—');

        return el('tr', { class: 'details-ai-row' },
            el('td', { class: 'details-ai-cell-metric' },
                el('span', { class: 'details-ai-cell-metric-main' },
                    el('span', { class: 'details-ai-cell-metric-name', text: title }),
                    infoIcon(openHint, 'Подробное описание метрики')
                ),
                el('span', { class: 'details-ai-cell-metric-unit', text: unitText })
            ),
            ...cells,
            el('td', { class: 'details-ai-cell-total', text: totalText }),
            el('td', { class: 'details-ai-cell-spacer', attrs: { 'aria-hidden': 'true' } })
        );
    });

    const modeNote = mode === 'cost'
        ? (applyRisks
            ? 'Бюджет AI-метрик, ₽/мес, с риск-коэффициентами и НДС по строкам ЭК.'
            : 'Бюджет AI-метрик, ₽/мес, без риск-коэффициентов. НДС учитывается, если включён в расчёте.')
        : (applyRisks
        ? 'С capacity-буферами (буферы / сезонность / сдвиг / контингент). Без VAT и инфляции — финансовые факторы, не capacity.'
        : 'Без capacity-буферов — голый объём. Включите «Учитывать риск-коэффициенты» в Опроснике для оценки с буферами.');

    const summary = el('div', { class: 'details-ai-summary' },
        el('div', { class: 'details-ai-summary-header' },
            el('span', { class: 'details-ai-summary-title', text: 'Сводка AI-метрик' }),
            el('span', { class: 'details-ai-summary-note', text: modeNote })
        ),
        el('div', { class: 'details-ai-summary-table-wrap' },
            el('table', { class: 'details-ai-summary-table' },
                el('colgroup', null,
                    el('col', { class: 'details-ai-col-metric' }),
                    ...STAND_IDS.map((_, index) => el('col', { class: `details-ai-col-stand details-ai-col-stand-${index}` })),
                    el('col', { class: 'details-ai-col-total' }),
                    el('col', { class: 'details-ai-col-spacer' })
                ),
                el('thead', null, headerRow),
                el('tbody', null, ...rows)
            )
        )
    );
    scheduleAiSummaryColumnAlignment(summary);
    return summary;
}

function metricUnitText(mode, totalEntry, suffix = '') {
    if (mode === 'cost') return '₽/мес';
    const unit = totalEntry?.unit || '';
    const flowSuffix = suffix || '';
    return `${unit}${flowSuffix}`.trim() || 'qty';
}

function scheduleAiSummaryColumnAlignment(summary) {
    if (typeof window === 'undefined' || !summary) return;
    const run = () => alignAiSummaryColumns(summary);
    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(run);
    } else {
        window.setTimeout(run, 0);
    }
}

function alignAiSummaryColumns(summary) {
    const pane = summary.closest('.tab-pane') || document;
    const sourceTable = pane.querySelector('.details-table-cost, .details-table-qty');
    const targetTable = summary.querySelector('.details-ai-summary-table');
    if (!sourceTable || !targetTable) return;

    const standHeaders = [...sourceTable.querySelectorAll('thead tr.details-thead-row-headers th.col-stand')];
    if (standHeaders.length !== STAND_IDS.length) return;

    const targetRect = targetTable.getBoundingClientRect();
    const sourceRect = sourceTable.getBoundingClientRect();
    const firstStandRect = standHeaders[0].getBoundingClientRect();
    const totalHeader = sourceTable.querySelector('thead tr.details-thead-row-headers th.col-total');
    const totalRect = totalHeader?.getBoundingClientRect();

    const standWidths = standHeaders.map(th => Math.max(0, th.getBoundingClientRect().width));
    const metricWidth = Math.max(160, firstStandRect.left - targetRect.left);
    const totalWidth = Math.max(88, totalRect?.width || 88);
    const spacerWidth = Math.max(0,
        sourceRect.right - targetRect.left - metricWidth -
        standWidths.reduce((sum, width) => sum + width, 0) - totalWidth
    );

    summary.style.setProperty('--details-ai-metric-col', `${metricWidth}px`);
    standWidths.forEach((width, index) => {
        summary.style.setProperty(`--details-ai-stand-col-${index}`, `${width}px`);
    });
    summary.style.setProperty('--details-ai-total-col', `${totalWidth}px`);
    summary.style.setProperty('--details-ai-spacer-col', `${spacerWidth}px`);
}

function aggregateAiMetricCosts(result, dictionaryItems, disabledStands = []) {
    const disabled = new Set(disabledStands);
    const out = {
        total: {},
        perStand: Object.fromEntries(STAND_IDS.map(sid => [sid, {}]))
    };
    for (const label of DASHBOARD_AI_METRIC_LABELS) {
        out.total[label] = { cost: 0, present: false };
        for (const sid of STAND_IDS) out.perStand[sid][label] = { cost: 0, present: false };
    }

    for (const item of dictionaryItems || []) {
        const label = item.dashboardAiMetric || SEED_AI_METRIC_BY_ITEM_ID.get(item.id);
        if (!label || !out.total[label]) continue;
        const itemResult = result?.items?.[item.id];
        if (!itemResult) continue;

        let itemActiveCost = 0;
        let itemActivePresent = false;
        for (const sid of STAND_IDS) {
            const cell = itemResult.stands?.[sid];
            if (!cell) continue;
            const qty = Number(cell.qty) || 0;
            const cost = Number(cell.costFinal) || 0;
            const present = qty > 0 || cost > 0;
            if (!present) continue;

            out.perStand[sid][label].cost += moneyDisplayValue(cost);
            out.perStand[sid][label].present = true;
            if (!disabled.has(sid)) {
                itemActiveCost += cost;
                itemActivePresent = true;
            }
        }
        if (itemActivePresent) {
            out.total[label].cost += moneyDisplayValue(itemActiveCost);
            out.total[label].present = true;
        }
    }
    return out;
}

function moneyDisplayValue(value) {
    return Math.round(Number(value) || 0);
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

function hasVisibleAiMetricBudget(label, total, perStand, disabledStands = []) {
    const isVisible = (entry) => entry && Number(entry.cost) > 0;
    if (isVisible(total?.[label])) return true;
    const disabled = new Set(disabledStands);
    return STAND_IDS.some(sid => !disabled.has(sid) && isVisible(perStand?.[sid]?.[label]));
}
