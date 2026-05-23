/**
 * Краткая проверка расчёта самых дорогих ЭК.
 *
 * Строится поверх production trace: Q/S inputs -> qty -> price -> billing
 * interval -> risks -> VAT -> costFinal. Нужна для Детализации и PDF.
 */

import { buildQuantityTrace } from '../domain/quantityTrace.js';
import { calculate } from '../domain/calculator.js';
import {
    BILLING_INTERVAL_LABELS,
    MONTHS_PER_YEAR,
    STAND_IDS,
    STAND_LABELS
} from '../utils/constants.js';
import { formatNumber, formatRub, num } from '../services/format.js';
import { el } from './dom.js';
import {
    formatExplanationValue,
    settingLabel,
    sourceLabel
} from './quantityExplanation.js';

const MONEY_EPS = 0.01;

function displayUnit(unit) {
    const raw = String(unit || '').trim();
    const thousand = raw.match(/^1000\s+(.+)$/i);
    if (thousand) return `тыс. ${thousand[1].trim()}`;
    const million = raw.match(/^1\s+млн\.?\s+(.+)$/i);
    if (million) return `млн ${million[1].trim()}`;
    return raw;
}

function unitBasisText(unit) {
    const raw = String(unit || '').trim();
    const thousand = raw.match(/^1000\s+(.+)$/i);
    if (thousand) return `qty в тысячах: ${thousand[1].trim()}`;
    const million = raw.match(/^1\s+млн\.?\s+(.+)$/i);
    if (million) return `qty в миллионах: ${million[1].trim()}`;
    return raw ? `qty в единицах: ${raw}` : 'единица qty не задана';
}

function billingText(trace) {
    const interval = trace.billing?.billingInterval;
    const mul = Number(trace.billing?.billingIntervalMul) || 0;
    if (interval === 'daily') {
        return `дневной тариф, в месяц ×${formatNumber(mul, { min: 0, max: 4 })}`;
    }
    if (interval === 'annual') {
        return `годовой тариф, в месяц ×${formatNumber(mul, { min: 0, max: 4 })}`;
    }
    if (interval === 'oneTime') {
        return `разовый платёж, в месяц ×${formatNumber(mul, { min: 0, max: 4 })}`;
    }
    return `месячный тариф, в месяц ×${formatNumber(mul, { min: 0, max: 4 })}`;
}

function formatQty(qty, unit) {
    const unitText = displayUnit(unit);
    return `${num(qty)}${unitText ? ` ${unitText}` : ''}`;
}

function closeMoney(a, b) {
    return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= MONEY_EPS;
}

function traceRiskMul(trace) {
    const risk = trace.risk?.breakdown;
    if (!risk) return 1;
    return trace.risk.applyRiskFactors ? risk.total : 1;
}

function traceVatMul(trace) {
    return trace.risk?.breakdown?.vatMul || 1;
}

function traceExpectedBase(trace) {
    return (Number(trace.qty) || 0) *
        (Number(trace.billing?.pricePerUnit) || 0) *
        (Number(trace.billing?.billingIntervalMul) || 0);
}

function traceExpectedFinal(trace) {
    return traceExpectedBase(trace) * traceRiskMul(trace) * traceVatMul(trace);
}

function buildUnitCheck(traces) {
    const issues = [];
    for (const trace of traces) {
        if (!String(trace.unit || '').trim()) {
            issues.push(`${STAND_LABELS[trace.stand] || trace.stand}: нет единицы qty`);
        }
        if (!BILLING_INTERVAL_LABELS[trace.billing?.billingInterval]) {
            issues.push(`${STAND_LABELS[trace.stand] || trace.stand}: неизвестный тарифный период`);
        }
        if (!closeMoney(trace.costBase, traceExpectedBase(trace))) {
            issues.push(`${STAND_LABELS[trace.stand] || trace.stand}: qty × цена × период не сходится`);
        }
        if (!closeMoney(trace.costFinal, traceExpectedFinal(trace))) {
            issues.push(`${STAND_LABELS[trace.stand] || trace.stand}: итог с рисками/НДС не сходится`);
        }
    }
    return {
        ok: issues.length === 0,
        issues
    };
}

function inputText(input) {
    const title = input.title || input.id;
    return `${title}: ${formatExplanationValue(input.value)} (${sourceLabel(input.source)})`;
}

function settingText(input) {
    const suffix = input.overriddenByContext ? ', с учётом профиля ресурса' : '';
    return `${settingLabel(input.path)}: ${formatExplanationValue(input.value)}${suffix}`;
}

function joinLimited(list, limit, emptyText) {
    if (!list || list.length === 0) return emptyText;
    const head = list.slice(0, limit);
    const rest = list.length - head.length;
    const text = head.join('; ');
    return rest > 0 ? `${text}; ещё ${rest}` : text;
}

function sourceSummary(traces) {
    const bySource = new Map();
    const seenInputs = new Set();
    for (const trace of traces) {
        for (const input of trace.questionInputs || []) {
            const key = `${input.id}:${input.source}`;
            if (seenInputs.has(key)) continue;
            seenInputs.add(key);
            bySource.set(input.source, (bySource.get(input.source) || 0) + 1);
        }
    }
    return [...bySource.entries()]
        .sort((a, b) => b[1] - a[1] || sourceLabel(a[0]).localeCompare(sourceLabel(b[0]), 'ru'))
        .map(([source, count]) => `${sourceLabel(source)}: ${count}`);
}

function activeMonthlyForItem(itemResult, disabled) {
    let total = 0;
    for (const stand of STAND_IDS) {
        if (disabled.has(stand)) continue;
        total += itemResult?.stands?.[stand]?.costFinal || 0;
    }
    return total;
}

function buildTraces(calculation, itemId, result, disabled) {
    const traces = [];
    for (const stand of STAND_IDS) {
        if (disabled.has(stand)) continue;
        try {
            const trace = buildQuantityTrace(calculation, itemId, stand, result);
            if (trace.applicable && ((Number(trace.qty) || 0) > 0 || (Number(trace.costFinal) || 0) > 0)) {
                traces.push(trace);
            }
        } catch (_error) {
            // Один битый ЭК не должен ломать весь отчёт Детализации.
        }
    }
    return traces.sort((a, b) => (Number(b.costFinal) || 0) - (Number(a.costFinal) || 0));
}

function buildRow(calculation, result, disabled, itemId, monthly) {
    const traces = buildTraces(calculation, itemId, result, disabled);
    const primary = traces[0] || null;
    if (!primary) return null;

    const unitCheck = buildUnitCheck(traces);
    const answers = primary.questionInputs.map(inputText);
    const settings = primary.settingInputs.map(settingText);
    const riskMul = traceRiskMul(primary);
    const vatMul = traceVatMul(primary);
    const intervalMul = Number(primary.billing?.billingIntervalMul) || 0;

    return {
        itemId,
        itemName: primary.itemName || itemId,
        monthly,
        annual: monthly * MONTHS_PER_YEAR,
        primaryStand: primary.stand,
        primaryStandLabel: STAND_LABELS[primary.stand] || primary.stand,
        primaryCost: Number(primary.costFinal) || 0,
        qty: Number(primary.qty) || 0,
        unit: primary.unit,
        pricePerUnit: Number(primary.billing?.pricePerUnit) || 0,
        intervalMul,
        riskMul,
        vatMul,
        sourceSummary: sourceSummary(traces),
        answersText: joinLimited(answers, 3, 'в формуле нет ответов пользователя'),
        settingsText: joinLimited(settings, 3, 'в формуле нет коэффициентов настроек'),
        unitText: `${unitBasisText(primary.unit)}; ${billingText(primary)}`,
        unitCheck
    };
}

export function buildCostCheckReportModel(calculation, result = null, disabledStands = [], options = {}) {
    const disabled = new Set(disabledStands || []);
    const limit = Number.isInteger(options.limit) ? options.limit : 10;
    const resolvedResult = result || calculate(calculation);
    const itemsResult = resolvedResult?.items || {};

    const candidates = Object.entries(itemsResult)
        .map(([itemId, itemResult]) => ({
            itemId,
            monthly: activeMonthlyForItem(itemResult, disabled)
        }))
        .filter(row => row.monthly > 0)
        .sort((a, b) => b.monthly - a.monthly)
        .slice(0, Math.max(1, limit));

    const rows = candidates
        .map(row => buildRow(calculation, resolvedResult, disabled, row.itemId, row.monthly))
        .filter(Boolean);

    return {
        limit: Math.max(1, limit),
        shown: rows.length,
        rows
    };
}

function renderSourceList(row) {
    return el('div', { class: 'cost-check-source-list' },
        ...(row.sourceSummary.length > 0
            ? row.sourceSummary.map(text => el('span', { class: 'cost-check-source-pill', text }))
            : [el('span', { class: 'cost-check-muted', text: 'нет Q-ответов' })])
    );
}

function renderCheckBadge(row) {
    return el('span', {
        class: ['cost-check-badge', row.unitCheck.ok ? 'cost-check-badge-ok' : 'cost-check-badge-warn'],
        title: row.unitCheck.ok ? 'Формулы стоимости сходятся' : row.unitCheck.issues.join('\n')
    }, row.unitCheck.ok ? 'ОК' : 'Проверь');
}

function renderRow(row, index) {
    const chain = `${formatQty(row.qty, row.unit)} × ${formatRub(row.pricePerUnit)} × ` +
        `период ×${formatNumber(row.intervalMul, { min: 0, max: 4 })} × ` +
        `риски ×${formatNumber(row.riskMul, { min: 4, max: 4 })} × ` +
        `НДС ×${formatNumber(row.vatMul, { min: 4, max: 4 })} = ${formatRub(row.primaryCost)}/мес`;

    return el('tr', { class: 'cost-check-row' },
        el('td', { class: 'cost-check-cell cost-check-item' },
            el('div', { class: 'cost-check-item-layout' },
                el('div', { class: 'cost-check-rank', text: String(index + 1) }),
                el('div', { class: 'cost-check-item-text' },
                    el('strong', { text: row.itemName }),
                    el('span', { text: `самый дорогой стенд: ${row.primaryStandLabel}` })
                )
            )
        ),
        el('td', { class: 'cost-check-cell cost-check-money' },
            el('strong', { text: `${formatRub(row.monthly)}/мес` }),
            el('span', { text: `${formatRub(row.annual)}/год` })
        ),
        el('td', { class: 'cost-check-cell cost-check-chain' },
            el('div', { class: 'cost-check-chain-line', text: chain }),
            el('div', { class: 'cost-check-muted', text: `Ответы: ${row.answersText}` }),
            el('div', { class: 'cost-check-muted', text: `Коэффициенты: ${row.settingsText}` })
        ),
        el('td', { class: 'cost-check-cell cost-check-sources' },
            renderSourceList(row)
        ),
        el('td', { class: 'cost-check-cell cost-check-units' },
            el('div', { class: 'cost-check-unit-head' }, renderCheckBadge(row)),
            el('div', { class: 'cost-check-muted', text: row.unitText })
        )
    );
}

export function renderCostCheckReport(calculation, result, disabledStands = [], options = {}) {
    const model = buildCostCheckReportModel(calculation, result, disabledStands, options);
    if (model.rows.length === 0) return null;

    return el('section', {
        class: 'details-cost-check-report',
        attrs: { 'data-testid': 'cost-check-report' }
    },
        el('div', { class: 'details-section-title cost-check-title' },
            el('span', { text: 'Проверка расчёта ЭК' }),
            el('span', { class: 'details-section-tag dash-card-eyebrow-tag', text: `TOP-${model.shown}` })
        ),
        el('p', {
            class: 'cost-check-note',
            text: 'Показаны самые дорогие ЭК текущего расчёта. Итог в строке - сумма активных стендов; цепочка расчёта показана по самому дорогому стенду.'
        }),
        el('div', { class: 'cost-check-table-wrap' },
            el('table', { class: 'cost-check-table' },
                el('thead', null,
                    el('tr', null,
                        el('th', { text: 'ЭК' }),
                        el('th', { text: 'Вклад' }),
                        el('th', { text: 'Расчёт' }),
                        el('th', { text: 'Источники' }),
                        el('th', { text: 'Единицы' })
                    )
                ),
                el('tbody', null,
                    ...model.rows.map(renderRow)
                )
            )
        )
    );
}
