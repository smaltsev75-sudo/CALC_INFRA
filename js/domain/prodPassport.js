import { STAND_IDS, STAND_LABELS, MONTHS_PER_YEAR } from '../utils/constants.js';
import { calculate } from './calculator.js';
import { buildQuantityTrace, getEffectiveItems } from './quantityTrace.js';
import { SEED_ITEMS } from './seed.js';

const DEFAULT_LIMIT = 10;
const RUB_PER_THOUSAND = 1000;
const EPS = 1e-6;

const SEED_ITEM_BY_ID = new Map(SEED_ITEMS.map(item => [item.id, item]));

const SOURCE_LABELS = Object.freeze({
    answer: 'из опросника',
    manual: 'введено вручную',
    wizard: 'из Quick Start',
    scale: 'из Quick Start',
    profile: 'из Quick Start',
    product_type: 'из Quick Start',
    geography: 'из Quick Start',
    activity: 'из Quick Start',
    compliance: 'из Quick Start',
    sla_preset: 'из Quick Start',
    ai_default: 'из Quick Start',
    default: 'значение по умолчанию',
    defaultValue: 'значение по умолчанию',
    defaultIfUnknown: 'значение по умолчанию',
    repair: 'автоисправлено при загрузке',
    autoRepair: 'автоисправлено при загрузке',
    coerceNumber: 'автоисправлено при загрузке',
    coerceSelect: 'автоисправлено при загрузке',
    missing: 'нет значения'
});

const QUESTION_LABEL_OVERRIDES = Object.freeze({
    peak_rps: 'Пиковый RPS',
    avg_rps: 'Средний RPS',
    ram_per_vcpu_ratio: 'RAM на 1 vCPU',
    cache_size_gb: 'Кэш',
    registered_users_total: 'Зарегистрированные пользователи',
    dau_share_of_registered_percent: 'Доля активных пользователей',
    ai_users_share: 'Доля пользователей AI',
    ai_requests_per_user_day: 'AI-запросов на пользователя в день',
    ai_avg_input_tokens: 'Входящие токены на запрос',
    ai_avg_output_tokens: 'Исходящие токены на запрос'
});

const SETTING_LABEL_OVERRIDES = Object.freeze({
    'standSizeRatio.PROD': 'Размер стенда ПРОМ',
    'standSizeRatio.LOAD': 'Размер стенда Нагрузка',
    'standSizeRatio.PSI': 'Размер стенда ПСИ',
    'standSizeRatio.IFT': 'Размер стенда ИФТ',
    'standSizeRatio.DEV': 'Размер стенда DEV',
    'aiStandFactor.PROD': 'Доля AI-нагрузки ПРОМ',
    'aiStandFactor.LOAD': 'Доля AI-нагрузки Нагрузка',
    'aiStandFactor.PSI': 'Доля AI-нагрузки ПСИ',
    'aiStandFactor.IFT': 'Доля AI-нагрузки ИФТ',
    'aiStandFactor.DEV': 'Доля AI-нагрузки DEV',
    bufferTask: 'Буфер задачи',
    bufferProject: 'Буфер проекта',
    kInflation: 'Инфляция',
    kSeasonal: 'Сезонный коэффициент',
    kScheduleShift: 'Сдвиг расписания',
    kContingency: 'Резерв на риски',
    vatRate: 'НДС',
    vatEnabled: 'Учитывать НДС',
    daysPerMonth: 'Дней в месяце',
    phaseDurationMonths: 'Длительность фазы'
});

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
    const mul = 10 ** digits;
    return Math.round((finite(value) + Number.EPSILON) * mul) / mul;
}

function formatRu(value, digits = 0) {
    return ruFormatter(digits).format(finite(value));
}

const RU_FORMATTERS = new Map();

function ruFormatter(digits = 0) {
    const key = String(digits);
    if (!RU_FORMATTERS.has(key)) {
        RU_FORMATTERS.set(key, new Intl.NumberFormat('ru-RU', {
            minimumFractionDigits: 0,
            maximumFractionDigits: digits
        }));
    }
    return RU_FORMATTERS.get(key);
}

function formatMoneyMonth(rub) {
    return `${formatRu(rub / RUB_PER_THOUSAND, 0)} тыс.руб./мес.`;
}

function formatMoneyYear(rub) {
    return `${formatRu(rub / RUB_PER_THOUSAND, 0)} тыс.руб./год`;
}

function formatMoneyRub(rub) {
    return `${formatRu(rub, 0)} руб.`;
}

function formatRatio(value) {
    return formatRu(value, 4);
}

function formatPercent(value) {
    return `${formatRu(value, 0)}%`;
}

function formatValue(value) {
    if (value === null || value === undefined || value === '') return 'не задано';
    if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
    if (Array.isArray(value)) return value.length ? value.join(', ') : 'не задано';
    if (typeof value === 'number') return formatRu(value, Number.isInteger(value) ? 0 : 2);
    return String(value);
}

function formatQty(value, unit) {
    const n = finite(value);
    const digits = Math.abs(n) < 10 && !Number.isInteger(n) ? 2 : 0;
    return `${formatRu(n, digits)}${unit ? ` ${unit}` : ''}`;
}

function sourceLabel(source) {
    if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
    if (!source) return 'нет значения';
    return `неизвестный источник: ${source}`;
}

function questionLabel(input) {
    return QUESTION_LABEL_OVERRIDES[input.id] || input.title || input.id;
}

function settingLabel(input) {
    return SETTING_LABEL_OVERRIDES[input.path] || `Параметр расчёта ${input.path}`;
}

function itemFormula(item, stand) {
    return item?.qtyFormulas?.[stand] || '';
}

function itemText(item, key, fallback = '') {
    return item?.[key] || SEED_ITEM_BY_ID.get(item?.id)?.[key] || fallback;
}

function itemDashboardResource(item) {
    return item?.dashboardResource || SEED_ITEM_BY_ID.get(item?.id)?.dashboardResource || null;
}

function buildInputLists(trace) {
    const questions = trace.questionInputs.map(input => ({
        id: input.id,
        label: questionLabel(input),
        value: input.value,
        valueText: formatValue(input.value),
        source: input.source,
        sourceLabel: sourceLabel(input.source),
        technicalRef: input.ref
    }));

    const settings = trace.settingInputs.map(input => ({
        id: input.path,
        label: settingLabel(input),
        value: input.value,
        valueText: formatValue(input.value),
        source: input.overriddenByContext ? 'context' : 'settings',
        sourceLabel: input.overriddenByContext ? 'уточнено для ЭК' : 'параметр расчёта',
        technicalRef: input.ref
    }));

    return { questions, settings };
}

function markerFromInputs(inputs, errors) {
    const markers = [];
    const questionSources = new Set((inputs?.questions || []).map(input => input.sourceLabel));
    if (questionSources.has('значение по умолчанию')) {
        markers.push({ type: 'default', label: 'по умолчанию', title: 'В расчёте ЭК есть значения по умолчанию' });
    }
    if (questionSources.has('автоисправлено при загрузке')) {
        markers.push({ type: 'repair', label: 'автоисправлено', title: 'Часть значений была исправлена при загрузке JSON' });
    }
    if ((errors || []).length > 0) {
        markers.push({ type: 'warning', label: 'предупреждение', title: 'Есть замечание к расчёту ЭК' });
    }
    return markers;
}

function buildQuantityFormula(trace, item) {
    const technical = trace.formula || itemFormula(item, trace.stand);
    const text = trace.formulaHelp
        || itemText(item, 'description')
        || `Количество ЭК рассчитывается по формуле для стенда ${STAND_LABELS[trace.stand] || trace.stand}.`;
    return {
        text,
        technical,
        substitution: `${technical || 'формула'} = ${formatQty(trace.qty, trace.unit)}`
    };
}

function buildCostFormula(trace) {
    const qty = finite(trace.qty);
    const price = finite(trace.billing?.pricePerUnit);
    const interval = finite(trace.billing?.billingIntervalMul, 1);
    const riskMul = trace.risk?.applyRiskFactors ? finite(trace.risk?.breakdown?.total, 1) : 1;
    const vatMul = finite(trace.risk?.breakdown?.vatMul, 1);
    const monthly = finite(trace.costFinal);
    if (trace.costBreakdownAvailable === false) {
        return {
            label: 'Стоимость',
            expression: `Разложение стоимости недоступно; итог ≈ ${formatMoneyMonth(monthly)}`,
            components: [
                { label: 'Итог', value: monthly, text: formatMoneyMonth(monthly), hint: 'Бюджет ЭК за месяц из результата расчёта' }
            ],
            resultText: formatMoneyMonth(monthly)
        };
    }
    return {
        label: 'Стоимость = количество × цена × тариф × риски × НДС',
        expression: `${formatQty(qty, trace.unit)} × ${formatMoneyRub(price)} × ${formatRatio(interval)} × ${formatRatio(riskMul)} × ${formatRatio(vatMul)} ≈ ${formatMoneyMonth(monthly)}`,
        components: [
            { label: 'Количество', value: qty, text: formatQty(qty, trace.unit), hint: 'Количество ЭК по формуле стенда ПРОМ' },
            { label: 'Цена', value: price, text: formatMoneyRub(price), hint: 'Цена за одну единицу ЭК из применённого прайса' },
            { label: 'Тариф', value: interval, text: formatRatio(interval), hint: 'Множитель интервала тарификации в месяц' },
            { label: 'Риски', value: riskMul, text: formatRatio(riskMul), hint: 'Множитель риск-коэффициентов; 1 означает без наценки' },
            { label: 'НДС', value: vatMul, text: formatRatio(vatMul), hint: 'Множитель НДС, если налог включён в расчёт' },
            { label: 'Итог', value: monthly, text: formatMoneyMonth(monthly), hint: 'Бюджет ЭК за месяц' }
        ],
        resultText: formatMoneyMonth(monthly)
    };
}

function buildRow({ item, cell, trace, totalMonthly }) {
    const rawQuantity = Number(cell?.qty);
    const rawMonthlyCost = Number(cell?.costFinal);
    const quantity = Number.isFinite(rawQuantity) ? rawQuantity : 0;
    const monthlyCost = Number.isFinite(rawMonthlyCost) ? rawMonthlyCost : 0;
    const annualCost = monthlyCost * MONTHS_PER_YEAR;
    const budgetSharePercent = totalMonthly > EPS ? monthlyCost / totalMonthly * 100 : 0;
    const inputs = buildInputLists(trace);
    const errors = [
        ...(cell?.error ? [{ type: 'formula-error', message: cell.error }] : []),
        ...(!Number.isFinite(rawQuantity)
            ? [{ type: 'non-finite-quantity', message: 'Количество ЭК не является числом; в отчёте показан 0.' }]
            : []),
        ...(!Number.isFinite(rawMonthlyCost)
            ? [{ type: 'non-finite-cost', message: 'Бюджет ЭК не является числом; в отчёте показан 0 руб.' }]
            : [])
    ];
    const markers = markerFromInputs(inputs, errors);

    return {
        itemId: item.id,
        name: item.name,
        unit: item.unit,
        category: item.category,
        resourceClass: item.resourceClass,
        dashboardResource: itemDashboardResource(item),
        quantity,
        quantityText: formatQty(quantity, item.unit),
        monthlyCost,
        monthlyText: formatMoneyMonth(monthlyCost),
        annualCost,
        annualText: formatMoneyYear(annualCost),
        budgetSharePercent,
        budgetShareText: formatPercent(budgetSharePercent),
        markers,
        errors,
        errorText: errors.map(error => error.message).join('; '),
        quantityFormula: buildQuantityFormula(trace, item),
        costFormula: buildCostFormula(trace),
        inputs
    };
}

function addFactor(map, key, label, monthlyCost, totalMonthly) {
    if (!key || monthlyCost <= EPS) return;
    const prev = map.get(key) || {
        fieldId: key,
        label,
        monthlyImpact: 0,
        coveragePercent: 0,
        itemIds: new Set()
    };
    prev.monthlyImpact += monthlyCost;
    prev.coveragePercent = totalMonthly > EPS ? prev.monthlyImpact / totalMonthly * 100 : 0;
    map.set(key, prev);
}

function buildTopFactors(rows, totalMonthly, limit) {
    const factors = new Map();
    for (const row of rows) {
        for (const input of row.inputs.questions || []) {
            addFactor(factors, input.id, input.label, row.monthlyCost, totalMonthly);
            factors.get(input.id)?.itemIds.add(row.itemId);
        }
        for (const input of row.inputs.settings || []) {
            addFactor(factors, input.id, input.label, row.monthlyCost, totalMonthly);
            factors.get(input.id)?.itemIds.add(row.itemId);
        }
    }
    return [...factors.values()]
        .sort((a, b) => b.monthlyImpact - a.monthlyImpact || a.label.localeCompare(b.label, 'ru'))
        .slice(0, limit)
        .map(factor => ({
            ...factor,
            itemIds: [...factor.itemIds],
            monthlyImpact: round(factor.monthlyImpact, 2),
            coveragePercent: round(factor.coveragePercent, 2),
            monthlyText: formatMoneyMonth(factor.monthlyImpact),
            coverageText: formatPercent(factor.coveragePercent)
        }));
}

function buildQualityCounts(rows) {
    const withMarker = type => rows.filter(row => row.markers.some(marker => marker.type === type)).length;
    return {
        defaultItemsCount: withMarker('default'),
        repairedItemsCount: withMarker('repair'),
        warningItemsCount: rows.filter(row => row.errors.length > 0 || row.markers.some(marker => marker.type === 'warning')).length
    };
}

/**
 * Собирает модель отчёта «Паспорт ПРОМ».
 *
 * Важно: количество и стоимость берутся из calculate(), а расшифровка формул —
 * из buildQuantityTrace(). В модуле нет самостоятельного расчёта бюджетов.
 */
export function buildProdPassport(calculation, options = {}) {
    const stand = STAND_IDS.includes(options.stand) ? options.stand : 'PROD';
    const limit = Math.max(1, Number(options.limit) || DEFAULT_LIMIT);
    const offset = Math.max(0, Number(options.offset) || 0);
    const includeZero = options.includeZero === true;
    const topFactorsLimit = Math.max(1, Number(options.topFactorsLimit) || 5);
    const result = options.result || calculate(calculation);
    const disabledStands = Array.isArray(calculation?.view?.disabledStands)
        ? calculation.view.disabledStands
        : [];
    const standDisabled = disabledStands.includes(stand);
    const standLabel = STAND_LABELS[stand] || stand;

    if (standDisabled) {
        return {
            stand,
            standLabel,
            standDisabled: true,
            emptyStateMessage: `Стенд ${standLabel} скрыт в Детализации. Включите стенд в панели «Стенды», чтобы увидеть паспорт.`,
            items: [],
            page: {
                items: [],
                offset,
                limit,
                total: 0,
                hasNext: false,
                hasPrev: false
            },
            summary: {
                itemsCount: 0,
                totalMonthly: 0,
                totalMonthlyText: formatMoneyMonth(0),
                totalAnnual: 0,
                totalAnnualText: formatMoneyYear(0),
                defaultItemsCount: 0,
                repairedItemsCount: 0,
                warningItemsCount: 0,
                topFactors: []
            }
        };
    }

    const items = getEffectiveItems(calculation)
        .filter(item => (item.applicableStands || []).includes(stand));
    const totalMonthly = finite(result?.stands?.[stand]?.totalMonthly);

    const rows = items.map(item => {
        const cell = result.items?.[item.id]?.stands?.[stand] || {
            qty: 0,
            costFinal: 0,
            costBase: 0,
            error: null
        };
        let trace;
        try {
            trace = buildQuantityTrace(calculation, item.id, stand, result, { items });
        } catch (error) {
            /* best-effort: паспорт должен открыться даже при сбое трассировки
             * одного ЭК, но дефект нельзя прятать как честный расчёт. */
            console.error('[prodPassport] Не удалось построить трассировку ЭК', {
                itemId: item.id,
                stand,
                error
            });
            trace = {
                itemId: item.id,
                itemName: item.name,
                stand,
                unit: item.unit,
                formula: itemFormula(item, stand),
                formulaHelp: itemText(item, 'formulaHelp'),
                questionInputs: [],
                settingInputs: [],
                qty: finite(cell.qty),
                costFinal: finite(cell.costFinal),
                billing: { pricePerUnit: finite(item.pricePerUnit), billingIntervalMul: 1 },
                risk: { applyRiskFactors: false, breakdown: { total: 1, vatMul: 1 } },
                costBreakdownAvailable: false
            };
        }
        return buildRow({
            item,
            cell,
            trace,
            totalMonthly
        });
    })
        .filter(row => includeZero || row.quantity > EPS || row.monthlyCost > EPS || row.errors.length > 0)
        .sort((a, b) => b.monthlyCost - a.monthlyCost || a.name.localeCompare(b.name, 'ru'));

    const pageItems = rows.slice(offset, offset + limit);
    const qualityCounts = buildQualityCounts(rows);

    return {
        stand,
        standLabel,
        standDisabled: false,
        items: rows,
        page: {
            items: pageItems,
            offset,
            limit,
            total: rows.length,
            hasNext: offset + limit < rows.length,
            hasPrev: offset > 0
        },
        summary: {
            itemsCount: rows.length,
            totalMonthly,
            totalMonthlyText: formatMoneyMonth(totalMonthly),
            totalAnnual: totalMonthly * MONTHS_PER_YEAR,
            totalAnnualText: formatMoneyYear(totalMonthly * MONTHS_PER_YEAR),
            ...qualityCounts,
            topFactors: buildTopFactors(rows, totalMonthly, topFactorsLimit)
        }
    };
}
