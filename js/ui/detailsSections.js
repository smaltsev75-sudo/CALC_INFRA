/**
 * Heavy render sections for the Details tab.
 *
 * details.js owns screen orchestration; this module owns the qty/cost tables.
 * AI summary and shared totals are split into smaller focused modules and
 * re-exported below for backwards-compatible callers.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import {
    STAND_IDS, STAND_LABELS,
    CATEGORY_IDS, CATEGORY_LABELS, CATEGORY_COLORS,
    BILLING_INTERVAL_LABELS, COST_TYPE_LABELS, MONTHS_PER_YEAR
} from '../utils/constants.js';
import { formatNumber, formatPercentPoints, formatRub, num, percent } from '../services/format.js';
import { getCostType } from '../domain/costType.js';
import { renderVatBadge, renderVatBreakdownLine } from './vatBadge.js';
import { deriveAiMetricItemQty } from './dashboardAggregates.js';

export { renderAiMetricsSummary } from './detailsAiSummary.js';
export { computeTotalsForItems, itemMonthlyOnActiveStands } from './detailsTotals.js';

function isCategoryCollapsed(catId, state) {
    const collapsed = state.ui?.detailsCollapsedCats;
    if (collapsed === null || collapsed === undefined) return true;
    return collapsed.includes(catId);
}

/* ============================================================
 * 1. ТАБЛИЦА ОБЪЁМОВ (qty)
 * ============================================================ */

/* Суффикс периода для столбца «Ед.изм.» в таблице Объёма (qty). qty в
   разных ЭК имеет разную семантику времени:
   - Flow (трафик ТБ, токены LLM, эмбеддинги, уведомления тыс./мес)
     → накапливается за месяц.
   - Capacity (vCPU, ГБ RAM, ТБ SSD/HDD/S3, ГБ RAG-индекса, узлы)
     → мгновенный размер на стенде, без интервала времени.
   - One-time (пентест единичный, обучение, внедрение)
     → одноразово за весь срок проекта.
   - Annual (пентесты регулярные, аудит ИБ ежегодный)
     → в год.

   Без этого пользователь смотрит на «80,51 ТБ» и не понимает, это объём
   за месяц трафика или мгновенный размер хранилища (ответ: для трафика
   это месяц, для SSD — мгновенный). */
function unitPeriodSuffix(item) {
    if (!item) return '';
    if (item.billingInterval === 'oneTime')   return ' / за срок';
    if (item.billingInterval === 'annually')  return ' / год';
    // monthly — отделяем flow от capacity по семантике метрики/класса.
    const isFlowAi  = item.dashboardAiMetric === 'TOKENS' || item.dashboardAiMetric === 'EMBEDDINGS';
    const isFlowNet = item.resourceClass === 'TRAFFIC';
    const isFlowMsg = item.resourceClass === 'SERVICE';
    if (isFlowAi || isFlowNet || isFlowMsg) return ' / мес';
    return '';
}

export function formatQtyDisplayUnit(unit) {
    const raw = String(unit || '').trim();
    if (!raw) return '';

    const thousand = raw.match(/^1000\s+(.+)$/i);
    if (thousand) return `тыс. ${thousand[1].trim()}`;

    const million = raw.match(/^1\s+млн\.?\s+(.+)$/i);
    if (million) return `млн ${million[1].trim()}`;

    return raw;
}

export function formatQtyDisplayParts(qty, unit) {
    return {
        valueText: num(qty),
        unitText: formatQtyDisplayUnit(unit)
    };
}

export function quantityCapacityMultiplier(cell, applyRisks) {
    if (!applyRisks || !cell?.riskBreakdown) return 1;
    const br = cell.riskBreakdown;
    const factor = ['bufferFactor', 'seasonalMul', 'scheduleMul', 'contingencyMul']
        .reduce((acc, key) => {
            const value = Number(br[key]);
            return acc * (Number.isFinite(value) ? value : 1);
        }, 1);
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

export function effectiveQtyForDisplay(cell, applyRisks = true) {
    const qty = Number(cell?.qty) || 0;
    return qty * quantityCapacityMultiplier(cell, applyRisks);
}

export function renderQtySection(byCat, result, ctx, disabledStands = [], applyRisks = true, state = null, presentCats = [], calc = null) {
    const disabled = new Set(disabledStands);
    const categoryOrder = presentCats.length > 0 ? presentCats : CATEGORY_IDS;
    return el('div', { class: 'details-section' },
        el('h3', { class: 'details-section-title' },
            el('span', { text: 'Объём (qty)' }),
            applyRisks
                ? el('span', { class: 'details-section-tag dash-card-eyebrow-tag',
                    title: 'Qty показан с capacity-буферами: задачи / проект / сезон / сдвиг / контингент. VAT и инфляция к объёмам не применяются.',
                    text: 'С РИСКАМИ' })
                : el('span', { class: 'details-section-tag dash-card-eyebrow-tag dash-card-eyebrow-tag-warn',
                    title: 'Qty показан без capacity-буферов — голый расчёт.',
                    text: 'БЕЗ РИСКОВ' })
        ),
        el('div', { class: 'details-table-wrap' },
            el('table', { class: 'details-table details-table-qty' },
                el('thead', null,
                    el('tr', { class: 'details-thead-row details-thead-row-headers' },
                        el('th', { class: 'col-name', text: 'Элемент' }),
                        el('th', { class: 'col-vendor', text: 'Поставщик' }),
                        el('th', { class: 'col-unit', text: 'Ед.изм.' }),
                        /* 12.U30-fix-2: 2-line header — название над подписью, центр.
                           Версия qty: подпись просто «qty» (единицы разные по строкам). */
                        ...STAND_IDS.map(sid => el('th', {
                            class: ['col-stand', disabled.has(sid) && 'stand-disabled'],
                            // title= ставим только когда есть НЕ-видимая инфа
                            // (стенд исключён). В обычном состоянии название стенда
                            // и единица «qty» уже видны в самой ячейке — tooltip = шум.
                            title: disabled.has(sid) ? 'Стенд исключён из ИТОГО' : undefined
                        },
                            el('div', { class: 'col-stand-name', text: STAND_LABELS[sid] }),
                            el('div', { class: 'col-stand-unit', text: 'qty' })
                        )),
                        el('th', { class: 'col-total', text: 'ИТОГО qty',
                            title: 'Сумма qty по активным стендам. Период зависит от типа ЭК — см. суффикс в колонке «Ед.изм.»: «/ мес» (поток за месяц), «/ год», «/ за срок» (one-time за весь проект) или без суффикса (мгновенная capacity).'
                        }),
                        el('th', { class: 'col-info' })
                    )
                ),
                el('tbody', null,
                    ...categoryOrder.flatMap(cat => {
                        const list = byCat[cat] || [];
                        if (list.length === 0) return [];
                        const collapsed = state ? isCategoryCollapsed(cat, state) : true;
                        const rows = [renderQtyCategoryRow(cat, list, disabled, collapsed, ctx, presentCats)];
                        if (!collapsed) {
                            for (const it of list) rows.push(renderQtyItemRow(it, result, ctx, disabled, applyRisks, calc));
                        }
                        return rows;
                    })
                )
            )
        )
    );
}

function renderQtyCategoryRow(cat, list, disabled = new Set(), collapsed = true, ctx = null, presentCats = []) {
    const chevron = icon(collapsed ? 'chevron-right' : 'chevron-down', { size: 14 });
    return el('tr', {
        class: ['category-row', 'category-row-clickable', !collapsed && 'category-row-expanded'],
        attrs: {
            'aria-expanded': collapsed ? 'false' : 'true',
            'data-category': cat,
            tabindex: '0',
            role: 'button',
            title: collapsed ? `Раскрыть категорию «${CATEGORY_LABELS[cat]}»` : `Свернуть категорию «${CATEGORY_LABELS[cat]}»`
        },
        onClick: () => ctx?.toggleDetailsCategory?.(cat, presentCats),
        onKeyDown: (e) => {
            if (e.code === 'Enter' || e.code === 'Space') {
                e.preventDefault();
                ctx?.toggleDetailsCategory?.(cat, presentCats);
            }
        }
    },
        el('td', { attrs: { colspan: 3 } },
            el('span', { class: 'category-chevron' }, chevron),
            el('span', { class: 'category-dot', style: { background: CATEGORY_COLORS[cat] } }),
            el('span', { class: 'category-name', text: CATEGORY_LABELS[cat] }),
            el('span', { class: 'category-count', text: ` · ${list.length}` })
        ),
        ...STAND_IDS.map(sid => el('td', { class: ['col-stand', disabled.has(sid) && 'stand-disabled'] })),
        el('td', { class: 'col-total' }),
        el('td', { class: 'col-info' })
    );
}

function renderQtyItemRow(item, result, ctx, disabled = new Set(), applyRisks = true, calc = null) {
    const r = result.items[item.id];
    let qtySum = 0;
    const displayUnit = formatQtyDisplayUnit(item.unit);
    return el('tr', { class: 'item-row', attrs: { 'data-item-id': item.id } },
        /* 12.U30-fix: title с полным названием + description, чтобы при ellipsis
           короткой колонки .col-name пользователь видел при hover полное имя
           и пояснение. Раньше title не было — пользователь жаловался. */
        el('td', {
            class: 'col-name',
            title: item.description ? `${item.name}\n\n${item.description}` : item.name
        },
            el('div', { class: 'col-name-main', text: item.name || '—' }),
            renderItemInfoIcon(item, ctx)
        ),
        el('td', { class: 'col-vendor', text: item.vendor || '—' }),
        /* 13.U10: суффикс периода рядом с единицей — «ТБ / мес» для трафика,
           «ТБ» для SSD (capacity), «шт. / за срок» для пентестов и т.п.
           См. unitPeriodSuffix() выше. */
        el('td', {
            class: 'col-unit',
            text: `${displayUnit}${unitPeriodSuffix(item)}`
        }),
        ...STAND_IDS.map(sid => {
            const cell = r?.stands[sid];
            const isDisabled = disabled.has(sid);
            const fallbackQty = cell && (Number(cell.qty) || 0) <= 0
                ? deriveAiMetricItemQty(calc, item.id, sid)
                : 0;
            if (!cell || ((Number(cell.qty) || 0) <= 0 && fallbackQty <= 0 && !cell.error)) {
                return el('td', { class: ['col-stand', 'col-stand-empty', isDisabled && 'stand-disabled'], text: '—' });
            }
            const displayQty = fallbackQty > 0
                ? fallbackQty * quantityCapacityMultiplier(cell, applyRisks)
                : effectiveQtyForDisplay(cell, applyRisks);
            // qtySum считаем только по активным стендам — как и итог в таблице.
            if (!isDisabled) qtySum += displayQty;
            // Этап 13.U2 PDF-fit: число и единица — отдельные spans. CSS @media print
            // скрывает .qty-unit (единица уже видна в колонке «Ед.изм.»), что освобождает
            // ~30-40% ширины числовых колонок и устраняет обрезку справа на A4 landscape.
            return el('td', {
                class: ['col-stand', cell.error && 'col-stand-error', isDisabled && 'stand-disabled'],
                // title= только при НЕ-видимой инфе: ошибка вычисления или
                // что стенд исключён из ИТОГО. В норме «1,72 ТБ» уже видно
                // в самой ячейке — tooltip с тем же числом был бы дубль.
                title: cell.error
                    ? `Ошибка: ${cell.error}`
                    : (isDisabled ? 'Стенд исключён из ИТОГО' : undefined)
            },
                el('span', { class: 'qty-num', text: formatQtyDisplayParts(displayQty, item.unit).valueText }),
                ' ',
                el('span', { class: 'qty-unit', text: displayUnit })
            );
        }),
        el('td', { class: 'col-total' },
            qtySum > 0
                ? [el('span', { class: 'qty-num', text: formatQtyDisplayParts(qtySum, item.unit).valueText }), ' ', el('span', { class: 'qty-unit', text: displayUnit })]
                : el('span', { text: '—' })
        ),
        el('td', { class: 'col-info' })
    );
}

/* ============================================================
 * 2. ТАБЛИЦА СТОИМОСТИ (₽)
 * ============================================================ */

export function renderCostSection(byCat, result, ctx, totals, isFiltered, disabledStands = [], applyRisks = true, calc = null, state = null, presentCats = []) {
    const disabled = new Set(disabledStands);
    const categoryOrder = presentCats.length > 0 ? presentCats : CATEGORY_IDS;
    return el('div', { class: 'details-section' },
        el('h3', { class: 'details-section-title' },
            el('span', { text: 'Стоимость, ₽' }),
            applyRisks
                ? el('span', { class: 'details-section-tag dash-card-eyebrow-tag',
                    title: 'Суммы рассчитаны С УЧЁТОМ риск-коэффициентов (буферы, инфляция, сезонность, сдвиг расписания, резерв). НДС — отдельная ось, см. соседний бейдж. Переключатель рисков — в Опроснике.',
                    text: 'С РИСКАМИ' })
                : el('span', { class: 'details-section-tag dash-card-eyebrow-tag dash-card-eyebrow-tag-warn',
                    title: 'Суммы рассчитаны БЕЗ риск-коэффициентов — это базовая стоимость по прайс-листам поставщиков. Колонка «Вклад риск-коэф.» показывает потенциальную наценку, которая БЫЛА БЫ если бы коэффициенты применялись. Переключатель — в Опроснике.',
                    text: 'БЕЗ РИСКОВ' }),
            /* 12.U23: VAT-бейдж рядом с риск-бейджем — пользователь сразу видит,
               включают ли все суммы в таблице НДС или нет. */
            calc ? renderVatBadge(calc) : null,
            /* Разбивка НДС за месяц для текущей выборки (с учётом фильтра по стендам). */
            calc ? renderVatBreakdownLine(calc, totals.totalMonthly || 0, '/ мес') : null
        ),
        el('div', { class: 'details-table-wrap' },
            el('table', { class: 'details-table details-table-cost' },
                /* 12.U27: thead = 4 row'a (заголовки + 3 ИТОГО). Sticky-top на каждой
                   row через top: 0 / var(--row-h) / calc(var(--row-h)*2) / *3.
                   tfoot удалён — итоги теперь сверху, всегда на виду при скролле. */
                el('thead', { class: 'details-thead-with-totals' },
                    el('tr', { class: 'details-thead-row details-thead-row-headers' },
                        el('th', { class: 'col-name', text: 'Элемент' }),
                        el('th', { class: 'col-vendor', text: 'Поставщик' }),
                        el('th', { class: 'col-tariff', text: 'Тариф' }),
                        el('th', { class: 'col-unit', text: 'Ед.изм.' }),
                        el('th', { class: 'col-price', text: 'Цена/ед.' }),
                        el('th', { class: 'col-cost-type', text: 'Тип расхода',
                            title: 'CAPEX — капитальные (разовые); OPEX — операционные (регулярные). По умолчанию: oneTime → CAPEX, остальные → OPEX.' }),
                        /* 12.U30-fix-2: 2-line header — название стенда над «₽/мес», центр. */
                        ...STAND_IDS.map(sid => el('th', {
                            class: ['col-stand', disabled.has(sid) && 'stand-disabled'],
                            title: disabled.has(sid) ? 'Стенд исключён из ИТОГО' : undefined
                        },
                            el('div', { class: 'col-stand-name', text: STAND_LABELS[sid] }),
                            el('div', { class: 'col-stand-unit', text: '₽/мес' })
                        )),
                        el('th', { class: 'col-total', text: 'ИТОГО / мес' }),
                        el('th', { class: 'col-total', text: 'ИТОГО / год' }),
                        el('th', { class: 'col-share', text: 'Доля, %', title: 'Доля строки в общей стоимости расчёта (₽/мес)' }),
                        el('th', { class: 'col-risk', text: 'Риск, %', title: 'На сколько процентов цена этой строки выросла из-за риск-коэффициентов (буферы, инфляция, сезонность, НДС и т.д.).' }),
                        el('th', { class: 'col-risk-amount', text: 'Риск, ₽/мес', title: 'Сколько РУБЛЕЙ В МЕСЯЦ добавили риск-коэффициенты к базовой стоимости этой строки. Считается по активным стендам. В режиме «Без рисков» показывается потенциальная сумма (если бы коэффициенты применялись).' }),
                        el('th', { class: 'col-info' })
                    ),
                    ...renderCostTotalsRows(totals, isFiltered, disabled)
                ),
                el('tbody', null,
                    ...categoryOrder.flatMap(cat => {
                        const list = byCat[cat] || [];
                        if (list.length === 0) return [];
                        const collapsed = state ? isCategoryCollapsed(cat, state) : true;
                        const rows = [renderCostCategoryRow(cat, list, result, disabled, collapsed, ctx, presentCats, totals.totalMonthly)];
                        if (!collapsed) {
                            for (const it of list) rows.push(renderCostItemRow(it, result, ctx, disabled, totals.totalMonthly));
                        }
                        return rows;
                    })
                )
            )
        )
    );
}

function renderCostCategoryRow(cat, list, result, disabled = new Set(), collapsed = true, ctx = null, presentCats = [], denomMonthly = null) {
    // Категория ИТОГО учитывает только активные стенды — иначе строка-сумма в
    // категории не сходилась бы с цифрой в footer'е.
    let totalMonthly = 0;
    let baseMonthly = 0;
    let potentialFinalMonthly = 0;
    for (const it of list) {
        const r = result.items[it.id];
        if (!r) continue;
        for (const sid of STAND_IDS) {
            if (disabled.has(sid)) continue;
            const cell = r.stands[sid];
            if (!cell || cell.costBase <= 0) continue;
            totalMonthly += cell.costFinal || 0;
            baseMonthly += cell.costBase;
            // Потенциальный final = base × реальные коэффициенты (всегда, даже когда
            // applyRisks=false — для информационного отображения наценки).
            potentialFinalMonthly += cell.costBase * (cell.riskBreakdown?.total || 1);
        }
    }
    const riskAmount = potentialFinalMonthly - baseMonthly;
    const chevron = icon(collapsed ? 'chevron-right' : 'chevron-down', { size: 14 });
    return el('tr', {
        class: ['category-row', 'category-row-clickable', !collapsed && 'category-row-expanded'],
        attrs: {
            'aria-expanded': collapsed ? 'false' : 'true',
            'data-category': cat,
            tabindex: '0',
            role: 'button',
            title: collapsed ? `Раскрыть категорию «${CATEGORY_LABELS[cat]}»` : `Свернуть категорию «${CATEGORY_LABELS[cat]}»`
        },
        onClick: () => ctx?.toggleDetailsCategory?.(cat, presentCats),
        onKeyDown: (e) => {
            if (e.code === 'Enter' || e.code === 'Space') {
                e.preventDefault();
                ctx?.toggleDetailsCategory?.(cat, presentCats);
            }
        }
    },
        el('td', { attrs: { colspan: 6 } },
            el('span', { class: 'category-chevron' }, chevron),
            el('span', { class: 'category-dot', style: { background: CATEGORY_COLORS[cat] } }),
            el('span', { class: 'category-name', text: CATEGORY_LABELS[cat] }),
            el('span', { class: 'category-count', text: ` · ${list.length}` })
        ),
        ...STAND_IDS.map(sid => {
            const sum = list.reduce((a, it) => a + (result.items[it.id]?.stands[sid].costFinal || 0), 0);
            return el('td', {
                class: ['col-stand', disabled.has(sid) && 'stand-disabled'],
                text: sum > 0 ? formatRub(sum) : '—'
            });
        }),
        el('td', {
            class: 'col-total',
            title: `ИТОГО / мес по категории «${CATEGORY_LABELS[cat]}» на активных стендах.`,
            text: formatRub(totalMonthly)
        }),
        el('td', {
            class: 'col-total',
            title: `ИТОГО / год по категории «${CATEGORY_LABELS[cat]}» на активных стендах.`,
            text: formatRub(totalMonthly * MONTHS_PER_YEAR)
        }),
        renderCategoryShareCell(totalMonthly, denomMonthly),
        el('td', { class: 'col-risk' }),
        el('td', { class: 'col-risk-amount',
            title: `Суммарный вклад риск-коэффициентов в ₽/мес для этой категории.\n\n` +
                   `За год: ≈ ${formatRub(riskAmount * MONTHS_PER_YEAR)}.`,
            text: riskAmount > 0 ? `+${formatRub(riskAmount)}` : '—' }),
        el('td', { class: 'col-info' })
    );
}

function renderCostItemRow(item, result, ctx, disabled = new Set(), denomMonthly = null) {
    const r = result.items[item.id];
    // ИТОГО строки = сумма по активным стендам (как и общий ИТОГО внизу).
    let itemMonthly = 0;
    let baseSum = 0;
    let finalSum = 0;
    // Денежная наценка по активным стендам = сумма (costBase × (riskBreakdown.total - 1)).
    // Используем потенциальный множитель: даже в режиме applyRisks=false показываем,
    // сколько ₽ ДОБАВИЛИ БЫ риск-коэффициенты к базовой стоимости этой строки.
    let riskAmountActive = 0;
    for (const sid of STAND_IDS) {
        const cell = r?.stands[sid];
        if (!cell || cell.costBase <= 0) continue;
        baseSum  += cell.costBase;
        finalSum += cell.costFinal;
        if (!disabled.has(sid)) {
            itemMonthly += cell.costFinal || 0;
            const totalRisk = cell.riskBreakdown?.total || 1;
            riskAmountActive += cell.costBase * (totalRisk - 1);
        }
    }
    const itemAnnual = itemMonthly * MONTHS_PER_YEAR;
    const rowRiskTotal = baseSum > 0 ? finalSum / baseSum : null;
    const ct = getCostType(item);
    // Знаменатель для «Доля в стенде, %» — общий ИТОГО по активным стендам/фильтру.
    const denom = denomMonthly !== null ? denomMonthly : result.totalMonthly;

    return el('tr', { class: 'item-row', attrs: { 'data-cost-type': ct, 'data-item-id': item.id } },
        /* 12.U30-fix: title с полным названием + description, чтобы при ellipsis
           короткой колонки .col-name пользователь видел при hover полное имя
           и пояснение. Раньше title не было — пользователь жаловался. */
        el('td', {
            class: 'col-name',
            title: item.description ? `${item.name}\n\n${item.description}` : item.name
        },
            el('div', { class: 'col-name-main', text: item.name || '—' }),
            renderItemInfoIcon(item, ctx)
        ),
        el('td', { class: 'col-vendor', text: item.vendor || '—' }),
        el('td', { class: 'col-tariff', text: BILLING_INTERVAL_LABELS[item.billingInterval] || item.billingInterval || '—' }),
        el('td', { class: 'col-unit', text: formatQtyDisplayUnit(item.unit) }),
        el('td', { class: 'col-price', text: formatRub(item.pricePerUnit) }),
        el('td', { class: 'col-cost-type' },
            el('span', { class: ['cost-type-pill', `cost-type-pill-${ct}`],
                title: COST_TYPE_LABELS[ct] + (item.costType ? ' (явно задано)' : ' (автоматически по интервалу)')
            }, ct.toUpperCase())
        ),
        ...STAND_IDS.map(sid => {
            const cell = r?.stands[sid];
            const isDisabled = disabled.has(sid);
            if (!cell || cell.costFinal <= 0) {
                return el('td', { class: ['col-stand', 'col-stand-empty', isDisabled && 'stand-disabled'], text: '—' });
            }
            const standMonthly = result.stands[sid]?.totalMonthly || 0;
            const standShare = standMonthly > 0 ? cell.costFinal / standMonthly : 0;
            const cellRisk = cell.riskBreakdown?.total;
            const qtyDisplay = formatQtyDisplayParts(cell.qty, item.unit);
            const tooltipParts = [`qty = ${qtyDisplay.valueText} ${qtyDisplay.unitText}`];
            if (standMonthly > 0) tooltipParts.push(`Доля в стенде: ${percent(standShare)}`);
            if (Number.isFinite(cellRisk)) {
                tooltipParts.push(`Риск-фактор ×${formatNumber(cellRisk, { min: 4, max: 4 })}`);
            }
            if (isDisabled) tooltipParts.push('Стенд исключён из ИТОГО');
            return el('td', {
                class: ['col-stand', cell.error && 'col-stand-error', isDisabled && 'stand-disabled'],
                title: cell.error ? `Ошибка: ${cell.error}` : tooltipParts.join(' · ')
            }, formatRub(cell.costFinal));
        }),
        el('td', { class: 'col-total', text: formatRub(itemMonthly) }),
        el('td', { class: 'col-total', text: formatRub(itemAnnual) }),
        renderShareCell(itemMonthly, denom),
        renderRiskCell(rowRiskTotal),
        renderRiskAmountCell(riskAmountActive),
        el('td', { class: 'col-info' })
    );
}

function renderRiskAmountCell(riskAmount) {
    if (!Number.isFinite(riskAmount) || Math.abs(riskAmount) < 0.5) {
        return el('td', { class: 'col-risk-amount col-risk-amount-empty', text: '—' });
    }
    const sign = riskAmount > 0 ? '+' : '';
    return el('td', {
        class: ['col-risk-amount', riskAmount > 0 ? 'col-risk-up' : 'col-risk-down'],
        title: `Вклад риск-коэффициентов в рублях за МЕСЯЦ для этой строки (по активным стендам).\n\n` +
               `За год: ≈ ${formatRub(riskAmount * MONTHS_PER_YEAR)}.`
    }, `${sign}${formatRub(riskAmount)}`);
}

/**
 * Кнопка «Почему столько?» открывает окно с понятной трассировкой количества
 * и технической формулой. Одна кнопка вместо двух дублей: описание ЭК остаётся
 * в title ячейки имени, а расчёт — в модалке.
 */
function renderItemInfoIcon(item, ctx) {
    const titleParts = [];
    titleParts.push('Почему столько? Показать входные ответы, коэффициенты и формулу.');
    return el('button', {
        class: 'quantity-explain-inline',
        title: titleParts.join('\n\n'),
        attrs: {
            type: 'button',
            'aria-label': 'Почему столько?',
            'data-testid': 'quantity-explain-button'
        },
        onClick: () => ctx.openFormula(item.id)
    }, icon('help-circle', { size: 12 }), el('span', { text: 'Почему столько?' }));
}

function renderShareCell(itemMonthly, denomMonthly) {
    if (!itemMonthly || !denomMonthly) {
        return el('td', { class: 'col-share col-share-empty', text: '—' });
    }
    const share = itemMonthly / denomMonthly;
    return el('td', {
        class: 'col-share',
        title: `Доля строки в общей стоимости расчёта (₽/мес).`
    }, percent(share));
}

function renderCategoryShareCell(categoryMonthly, denomMonthly) {
    if (!categoryMonthly || !denomMonthly) {
        return el('td', { class: 'col-share col-share-empty', text: '—' });
    }
    return el('td', {
        class: 'col-share category-share',
        title: 'Доля категории в общей стоимости текущей выборки (₽/мес).'
    }, percent(categoryMonthly / denomMonthly));
}

function renderRiskCell(riskTotal) {
    if (!Number.isFinite(riskTotal)) {
        return el('td', { class: 'col-risk col-risk-empty', text: '—' });
    }
    const surplus = (riskTotal - 1) * 100;
    return el('td', {
        class: ['col-risk', surplus > 0 ? 'col-risk-up' : surplus < 0 ? 'col-risk-down' : null],
        title: `Средневзвешенный риск-фактор по строке: ×${formatNumber(riskTotal, { min: 4, max: 4 })}.`
    }, formatPercentPoints(surplus, { min: 1, max: 1 }));
}

/**
 * Footer таблицы стоимости: 3 строки —
 *   1. ИТОГО (общий) — суммы по стендам и месяц/год.
 *   2. ИТОГО CAPEX — капитальные расходы (₽/мес и ₽/год).
 *   3. ИТОГО OPEX  — операционные расходы (₽/мес и ₽/год).
 */
function renderCostTotalsRows(totals, isFiltered, disabled = new Set()) {
    const monthly = totals.totalMonthly || 0;
    const annual  = monthly * MONTHS_PER_YEAR;
    const capex   = totals.byCostType?.capex || 0;
    const opex    = totals.byCostType?.opex  || 0;
    const hasDisabled = disabled.size > 0;
    const grandLabel = isFiltered
        ? 'ИТОГО (по фильтру' + (hasDisabled ? ', активные стенды)' : ')')
        : (hasDisabled ? 'ИТОГО (активные стенды)' : 'ИТОГО');

    const riskAmount = totals.riskAmountTotal || 0;
    const riskAmountText = Math.abs(riskAmount) >= 0.5
        ? `${riskAmount > 0 ? '+' : ''}${formatRub(riskAmount)}`
        : '—';

    const grandRow = el('tr', { class: 'totals-row totals-row-grand details-thead-row details-thead-row-totals details-thead-row-totals-grand' },
        el('td', { attrs: { colspan: 6 }, text: grandLabel }),
        ...STAND_IDS.map(sid => el('td', {
            class: ['col-stand', disabled.has(sid) && 'stand-disabled'],
            text: formatRub(totals.stands[sid].totalMonthly)
        })),
        el('td', { class: 'col-total', text: formatRub(monthly) }),
        el('td', { class: 'col-total', text: formatRub(annual) }),
        el('td', { class: 'col-share', text: '100%' }),
        el('td', { class: 'col-risk' }),
        el('td', { class: ['col-risk-amount', riskAmount > 0 ? 'col-risk-up' : null],
            title: `ИТОГО вклад риск-коэффициентов в ₽/мес по всем строкам и активным стендам.\n\n` +
                   `За год: ≈ ${formatRub(riskAmount * MONTHS_PER_YEAR)}.`,
            text: riskAmountText }),
        el('td')
    );

    const capexRow = el('tr', { class: 'totals-row totals-row-capex details-thead-row details-thead-row-totals details-thead-row-totals-capex', attrs: { 'data-cost-type': 'capex' } },
        el('td', { attrs: { colspan: 6 }, text: 'ИТОГО CAPEX (капитальные)' }),
        ...STAND_IDS.map(sid => el('td', { class: ['col-stand', disabled.has(sid) && 'stand-disabled'] })),
        el('td', { class: 'col-total', text: formatRub(capex) }),
        el('td', { class: 'col-total', text: formatRub(capex * MONTHS_PER_YEAR) }),
        el('td', { class: 'col-share', text: monthly > 0 ? percent(capex / monthly) : '—' }),
        el('td', { class: 'col-risk' }),
        el('td', { class: 'col-risk-amount' }),
        el('td')
    );

    const opexRow = el('tr', { class: 'totals-row totals-row-opex details-thead-row details-thead-row-totals details-thead-row-totals-opex', attrs: { 'data-cost-type': 'opex' } },
        el('td', { attrs: { colspan: 6 }, text: 'ИТОГО OPEX (операционные)' }),
        ...STAND_IDS.map(sid => el('td', { class: ['col-stand', disabled.has(sid) && 'stand-disabled'] })),
        el('td', { class: 'col-total', text: formatRub(opex) }),
        el('td', { class: 'col-total', text: formatRub(opex * MONTHS_PER_YEAR) }),
        el('td', { class: 'col-share', text: monthly > 0 ? percent(opex / monthly) : '—' }),
        el('td', { class: 'col-risk' }),
        el('td', { class: 'col-risk-amount' }),
        el('td')
    );

    return [grandRow, capexRow, opexRow];
}
