/**
 * User-facing explanation for item quantities.
 *
 * Domain tracing lives in domain/quantityTrace.js. This module converts that
 * trace into compact Russian UI text for Details / Formula modal / print.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { buildQuantityTrace } from '../domain/quantityTrace.js';
import { STAND_IDS, STAND_LABELS, BILLING_INTERVAL_LABELS, MONTHS_PER_YEAR } from '../utils/constants.js';
import { formatNumber, formatRub, num } from '../services/format.js';

const SOURCE_LABELS = Object.freeze({
    manual: 'введено вручную',
    answer: 'из опросника',
    wizard: 'из Quick Start',
    scale: 'масштаб Quick Start',
    profile: 'профиль Quick Start',
    product_type: 'тип продукта Quick Start',
    geography: 'география Quick Start',
    activity: 'активность Quick Start',
    compliance: 'правила безопасности',
    sla_preset: 'из SLA',
    ai_default: 'AI-профиль Quick Start',
    derived: 'выведено из ответов',
    default: 'значение по умолчанию',
    missing: 'не найдено'
});

const SETTING_LABELS = Object.freeze({
    daysPerMonth: 'дней в месяце',
    phaseDurationMonths: 'длительность расчёта, мес.',
    planningHorizonYears: 'горизонт планирования, лет',
    agentStepFactor: 'множитель AI-агента',
    agentToolFactor: 'множитель tool-use AI-агента',
    bufferTask: 'буфер задач',
    bufferProject: 'буфер проекта',
    kInflation: 'инфляция',
    kSeasonal: 'сезонность',
    kScheduleShift: 'сдвиг сроков',
    kContingency: 'резерв',
    vatEnabled: 'НДС включён',
    vatRate: 'ставка НДС'
});

function displayUnit(unit) {
    const raw = String(unit || '').trim();
    const thousand = raw.match(/^1000\s+(.+)$/i);
    if (thousand) return `тыс. ${thousand[1].trim()}`;
    const million = raw.match(/^1\s+млн\.?\s+(.+)$/i);
    if (million) return `млн ${million[1].trim()}`;
    return raw;
}

export function sourceLabel(source) {
    return SOURCE_LABELS[source] || String(source || 'неизвестно');
}

export function settingLabel(path) {
    const raw = String(path || '');
    const standMatch = raw.match(/^standSizeRatio\.([A-Z]+)$/);
    if (standMatch) {
        return `коэффициент размера стенда ${STAND_LABELS[standMatch[1]] || standMatch[1]}`;
    }
    return SETTING_LABELS[raw] || `параметр ${raw}`;
}

export function formatExplanationValue(value) {
    if (value === true) return 'Да';
    if (value === false) return 'Нет';
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number') return formatNumber(value, { min: 0, max: 4 });
    if (Array.isArray(value)) return value.map(formatExplanationValue).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function formatQty(qty, unit) {
    const unitText = displayUnit(unit);
    return `${num(qty)}${unitText ? ` ${unitText}` : ''}`;
}

function isMeaningfulTrace(trace) {
    return !!trace && (
        (Number(trace.qty) || 0) > 0 ||
        (Number(trace.costFinal) || 0) > 0 ||
        !!trace.evaluateError ||
        !!trace.cellError
    );
}

function traceSortValue(trace) {
    return Number(trace.costFinal) || Number(trace.qty) || 0;
}

function buildTraceList(calculation, itemId, result, options = {}) {
    const disabled = new Set(options.disabledStands || []);
    const activeOnly = options.activeOnly !== false;
    const limit = Number.isInteger(options.standLimit) ? options.standLimit : 5;
    const all = [];

    for (const stand of STAND_IDS) {
        if (activeOnly && disabled.has(stand)) continue;
        try {
            const trace = buildQuantityTrace(calculation, itemId, stand, result);
            if (trace.applicable) all.push(trace);
        } catch (_error) {
            // Broken item ids are handled by callers; one failed stand should not
            // make the whole Details tab disappear.
        }
    }

    const meaningful = all.filter(isMeaningfulTrace);
    const source = meaningful.length > 0 ? meaningful : all;
    return source
        .slice()
        .sort((a, b) => traceSortValue(b) - traceSortValue(a))
        .slice(0, Math.max(1, limit));
}

export function buildQuantityExplanationModel(calculation, itemOrId, result = null, options = {}) {
    const itemId = typeof itemOrId === 'string' ? itemOrId : itemOrId?.id;
    const fallbackName = typeof itemOrId === 'object' ? itemOrId.name : itemId;
    const traces = itemId ? buildTraceList(calculation, itemId, result, options) : [];
    const first = traces[0] || null;

    return {
        itemId,
        itemName: first?.itemName || fallbackName || 'ЭК',
        traces,
        hasData: traces.length > 0
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

function riskLine(trace) {
    const b = trace.risk?.breakdown;
    if (!b) return null;
    const riskMul = trace.risk.applyRiskFactors ? b.total : 1;
    return `Бюджет: ${formatQty(trace.qty, trace.unit)} × ${formatRub(trace.billing.pricePerUnit)} × ` +
        `${formatNumber(trace.billing.billingIntervalMul, { min: 0, max: 4 })} ` +
        `(${BILLING_INTERVAL_LABELS[trace.billing.billingInterval] || trace.billing.billingInterval}) × ` +
        `риски ${formatNumber(riskMul, { min: 4, max: 4 })} × НДС ${formatNumber(b.vatMul, { min: 4, max: 4 })}.`;
}

function renderTraceCard(trace) {
    const inputs = trace.questionInputs.map(inputText);
    const settings = trace.settingInputs.map(settingText);
    const resultText = trace.evaluateError
        ? `Ошибка формулы: ${trace.evaluateError}`
        : `Итог количества: ${formatQty(trace.qty, trace.unit)}.`;

    return el('article', { class: 'quantity-explanation-card' },
        el('div', { class: 'quantity-explanation-card-head' },
            el('div', { class: 'quantity-explanation-stand', text: STAND_LABELS[trace.stand] || trace.stand }),
            el('div', { class: 'quantity-explanation-total', text: formatQty(trace.qty, trace.unit) })
        ),
        trace.formulaHelp
            ? el('p', { class: 'quantity-explanation-help', text: trace.formulaHelp })
            : el('p', { class: 'quantity-explanation-help', text: 'Количество берётся из формулы ЭК для этого стенда.' }),
        el('dl', { class: 'quantity-explanation-list' },
            el('dt', { text: 'Ответы' }),
            el('dd', { text: joinLimited(inputs, 5, 'в формуле нет ответов пользователя') }),
            el('dt', { text: 'Коэффициенты' }),
            el('dd', { text: joinLimited(settings, 5, 'в формуле нет коэффициентов настроек') }),
            el('dt', { text: 'Расчёт' }),
            el('dd', { text: resultText }),
            riskLine(trace) && el('dt', { text: 'Стоимость' }),
            riskLine(trace) && el('dd', { text: riskLine(trace) })
        )
    );
}

export function renderQuantityExplanationPanel(calculation, itemOrId, result = null, options = {}) {
    const model = buildQuantityExplanationModel(calculation, itemOrId, result, options);
    if (!model.hasData) {
        return el('section', {
            class: 'quantity-explanation-panel',
            attrs: { 'data-testid': 'quantity-explanation-panel' }
        },
            el('div', { class: 'quantity-explanation-title' },
                icon('help-circle', { size: 16 }),
                el('span', { text: 'Почему столько?' })
            ),
            el('p', { class: 'quantity-explanation-empty', text: 'Для этого ЭК нет применимых стендов.' })
        );
    }

    return el('section', {
        class: 'quantity-explanation-panel',
        attrs: { 'data-testid': 'quantity-explanation-panel' }
    },
        el('div', { class: 'quantity-explanation-title' },
            icon('help-circle', { size: 16 }),
            el('span', { text: 'Почему столько?' })
        ),
        el('p', {
            class: 'quantity-explanation-note',
            text: 'Показаны входные ответы, коэффициенты стенда и формула количества. Источник ответа указан в скобках.'
        }),
        el('div', { class: 'quantity-explanation-grid' },
            ...model.traces.map(renderTraceCard)
        )
    );
}

function itemActiveMonthly(itemId, result, disabled = new Set()) {
    let total = 0;
    for (const stand of STAND_IDS) {
        if (disabled.has(stand)) continue;
        total += result?.items?.[itemId]?.stands?.[stand]?.costFinal || 0;
    }
    return total;
}

function printLineForModel(model) {
    const trace = model.traces[0];
    if (!trace) return '';
    const inputs = joinLimited(trace.questionInputs.map(inputText), 3, 'нет ответов пользователя');
    const settings = joinLimited(trace.settingInputs.map(settingText), 3, 'нет коэффициентов настроек');
    const annual = (Number(trace.costFinal) || 0) * MONTHS_PER_YEAR;
    return `${STAND_LABELS[trace.stand] || trace.stand}: ${formatQty(trace.qty, trace.unit)}; ` +
        `${trace.formulaHelp || 'формула ЭК'} Ответы: ${inputs}. Коэффициенты: ${settings}. ` +
        `Стоимость стенда: ${formatRub(trace.costFinal)}/мес, ${formatRub(annual)}/год.`;
}

export function renderDetailsQuantityPrintSummary(calculation, result, disabledStands = [], options = {}) {
    const disabled = new Set(disabledStands);
    const limit = Number.isInteger(options.limit) ? options.limit : 10;
    const items = (calculation?.dictionaries?.items || [])
        .map(item => ({ item, monthly: itemActiveMonthly(item.id, result, disabled) }))
        .filter(row => row.monthly > 0)
        .sort((a, b) => b.monthly - a.monthly)
        .slice(0, Math.max(1, limit));

    if (items.length === 0) return null;

    return el('section', { class: 'details-quantity-print-summary' },
        el('h3', { text: 'Почему столько? Проверка количества ЭК' }),
        el('p', {
            text: `Показаны top-${items.length} ЭК по вкладу в бюджет на активных стендах.`
        }),
        el('ol', null,
            ...items.map(({ item }) => {
                const model = buildQuantityExplanationModel(calculation, item, result, {
                    disabledStands,
                    standLimit: 1
                });
                return el('li', null,
                    el('strong', { text: model.itemName }),
                    el('span', { text: ` — ${printLineForModel(model)}` })
                );
            })
        )
    );
}
