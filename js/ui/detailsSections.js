/**
 * Heavy render sections for the Details tab.
 *
 * details.js owns screen orchestration; this module owns the qty/cost tables,
 * AI metrics summary, and the totals helpers they share.
 */

import { el, infoIcon } from './dom.js';
import { icon } from './icons.js';
import {
    STAND_IDS, STAND_LABELS,
    CATEGORY_IDS, CATEGORY_LABELS, CATEGORY_COLORS,
    BILLING_INTERVAL_LABELS, COST_TYPE_LABELS, MONTHS_PER_YEAR,
    DASHBOARD_AI_METRIC_LABELS, DASHBOARD_AI_METRIC_TITLES,
    DASHBOARD_AI_METRIC_DESCRIPTIONS, DASHBOARD_AI_METRIC_UNIT_SUFFIX
} from '../utils/constants.js';
import { formatRub, num, percent } from '../services/format.js';
import { getCostType } from '../domain/costType.js';
import { renderVatBadge, renderVatBreakdownLine } from './vatBadge.js';
import { aggregateAiMetrics, formatResourceQty } from './dashboard.js';
function isCategoryCollapsed(catId, state) {
    const collapsed = state.ui?.detailsCollapsedCats;
    if (collapsed === null || collapsed === undefined) return true;
    return collapsed.includes(catId);
}

/**
 * Считает ИТОГО ₽/мес для ЭК по активным стендам.
 * Используется для определения «не влияет ли на бюджет».
 * В режиме «без рисков» суммы уже на costBase — функция работает прозрачно.
 */
export function itemMonthlyOnActiveStands(itemId, result, disabledStands) {
    const r = result.items[itemId];
    if (!r) return 0;
    let m = 0;
    for (const sid of STAND_IDS) {
        if (disabledStands.includes(sid)) continue;
        m += r.stands[sid]?.costFinal || 0;
    }
    return m;
}

/* Сводный блок AI-метрик внизу таблицы Детализации.

   UI: маленькая таблица 4 строки × 5 столбцов стендов + ИТОГО. Каждая
   строка — одна AI-метрика (Токены / RAG-индекс / Эмбеддинги / CPU агентов),
   каждая ячейка — qty этой метрики на этом стенде с правильной единицей
   измерения. Disabled-стенды показаны приглушёнными.

   Граничные:
     calc=null              → null (нет активного расчёта).
     все qty всех метрик=0  → null (AI отключён в проекте).
     хотя бы одна qty>0     → блок появляется с заголовком + таблица.

   Зачем здесь, а не только на Дэшборде:
     Детализация = разрез ИТ-аналитика. Он видит per-item суммы (токены input,
     output, эмбеддинги отдельно), а здесь — агрегаты этих ЭК по операционной
     метрике (TOKENS = input + output вместе). Помогает быстро ответить на
     вопрос «сколько у нас в сумме токенов на PSI?» без ручного сложения
     двух строк. */
export function renderAiMetricsSummary(calc, result, disabledStands, applyRisks, ctx) {
    if (!calc) return null;
    const aiMetrics = aggregateAiMetrics(result, calc.dictionaries?.items || [], disabledStands, applyRisks);
    const total = aiMetrics.total || {};
    const perStand = aiMetrics.perStand || {};

    // Скрываем блок, если ВСЕ метрики пусты (AI отключён в проекте).
    const hasAny = DASHBOARD_AI_METRIC_LABELS.some(label => {
        const e = total[label];
        return e && e.qty > 0;
    });
    if (!hasAny) return null;

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

    const rows = DASHBOARD_AI_METRIC_LABELS.map(label => {
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
    const isFlowMsg = item.resourceClass === 'SERVICE' && /\/\s*мес|\bмес\b/.test(item.unit || '');
    if (isFlowAi || isFlowNet || isFlowMsg) return ' / мес';
    return '';
}

export function renderQtySection(byCat, result, ctx, disabledStands = [], state = null, presentCats = []) {
    const disabled = new Set(disabledStands);
    const categoryOrder = presentCats.length > 0 ? presentCats : CATEGORY_IDS;
    return el('div', { class: 'details-section' },
        el('h3', { class: 'details-section-title', text: 'Объём (qty)' }),
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
                            for (const it of list) rows.push(renderQtyItemRow(it, result, ctx, disabled));
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

function renderQtyItemRow(item, result, ctx, disabled = new Set()) {
    const r = result.items[item.id];
    let qtySum = 0;
    return el('tr', { class: 'item-row' },
        /* 12.U30-fix: title с полным названием + description, чтобы при ellipsis
           короткой колонки .col-name пользователь видел при hover полное имя
           и пояснение. Раньше title не было — пользователь жаловался. */
        el('td', {
            class: 'col-name',
            title: item.description ? `${item.name}\n\n${item.description}` : item.name
        },
            el('div', { class: 'col-name-main', text: item.name || '—' })
        ),
        el('td', { class: 'col-vendor', text: item.vendor || '—' }),
        /* 13.U10: суффикс периода рядом с единицей — «ТБ / мес» для трафика,
           «ТБ» для SSD (capacity), «шт. / за срок» для пентестов и т.п.
           См. unitPeriodSuffix() выше. */
        el('td', {
            class: 'col-unit',
            text: `${item.unit}${unitPeriodSuffix(item)}`
        }),
        ...STAND_IDS.map(sid => {
            const cell = r?.stands[sid];
            const isDisabled = disabled.has(sid);
            if (!cell || (!cell.qty && !cell.error)) {
                return el('td', { class: ['col-stand', 'col-stand-empty', isDisabled && 'stand-disabled'], text: '—' });
            }
            // qtySum считаем только по активным стендам — как и итог в таблице.
            if (!isDisabled) qtySum += cell.qty || 0;
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
                el('span', { class: 'qty-num', text: num(cell.qty) }),
                ' ',
                el('span', { class: 'qty-unit', text: item.unit })
            );
        }),
        el('td', { class: 'col-total' },
            qtySum > 0
                ? [el('span', { class: 'qty-num', text: num(qtySum) }), ' ', el('span', { class: 'qty-unit', text: item.unit })]
                : el('span', { text: '—' })
        ),
        el('td', { class: 'col-info' },
            renderItemInfoIcon(item, ctx)
        )
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
                        const rows = [renderCostCategoryRow(cat, list, result, disabled, collapsed, ctx, presentCats)];
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

function renderCostCategoryRow(cat, list, result, disabled = new Set(), collapsed = true, ctx = null, presentCats = []) {
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
        el('td', { class: 'col-total', text: formatRub(totalMonthly) }),
        el('td', { class: 'col-total', text: formatRub(totalMonthly * MONTHS_PER_YEAR) }),
        el('td', { class: 'col-share' }),
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

    return el('tr', { class: 'item-row', attrs: { 'data-cost-type': ct } },
        /* 12.U30-fix: title с полным названием + description, чтобы при ellipsis
           короткой колонки .col-name пользователь видел при hover полное имя
           и пояснение. Раньше title не было — пользователь жаловался. */
        el('td', {
            class: 'col-name',
            title: item.description ? `${item.name}\n\n${item.description}` : item.name
        },
            el('div', { class: 'col-name-main', text: item.name || '—' })
        ),
        el('td', { class: 'col-vendor', text: item.vendor || '—' }),
        el('td', { class: 'col-tariff', text: BILLING_INTERVAL_LABELS[item.billingInterval] || item.billingInterval || '—' }),
        el('td', { class: 'col-unit', text: item.unit }),
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
            const tooltipParts = [`qty = ${num(cell.qty)} ${item.unit}`];
            if (standMonthly > 0) tooltipParts.push(`Доля в стенде: ${percent(standShare)}`);
            if (Number.isFinite(cellRisk)) tooltipParts.push(`Риск-фактор ×${cellRisk.toFixed(4)}`);
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
        el('td', { class: 'col-info' },
            renderItemInfoIcon(item, ctx)
        )
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
 * Иконка ⓘ с описанием в title (если есть) и обработчиком клика — открыть формулу.
 * Заменяет отдельный col-name-sub блок (компактнее).
 */
function renderItemInfoIcon(item, ctx) {
    const titleParts = [];
    if (item.description) titleParts.push(item.description);
    titleParts.push('Клик: показать формулу');
    return el('button', {
        class: 'info-icon',
        title: titleParts.join('\n\n'),
        attrs: { type: 'button', 'aria-label': 'Показать формулу' },
        onClick: () => ctx.openFormula(item.id)
    }, icon('info', { size: 12 }));
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

function renderRiskCell(riskTotal) {
    if (!Number.isFinite(riskTotal)) {
        return el('td', { class: 'col-risk col-risk-empty', text: '—' });
    }
    const surplus = (riskTotal - 1) * 100;
    const sign = surplus > 0 ? '+' : '';
    return el('td', {
        class: ['col-risk', surplus > 0 ? 'col-risk-up' : surplus < 0 ? 'col-risk-down' : null],
        title: `Средневзвешенный риск-фактор по строке: ×${riskTotal.toFixed(4)}.`
    }, `${sign}${surplus.toFixed(1)}%`);
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

/**
 * Сумма по отфильтрованному набору ЭК и активным стендам (для строки ИТОГО).
 * Возвращает структуру со всеми агрегатами, нужными footer'у.
 *
 * Колонки выключенных стендов сохраняют свои частичные суммы — UI приглушает
 * их визуально, но строка-сумма по стенду остаётся видимой; сами агрегаты
 * totalMonthly / byCostType — только по активным.
 */
export function computeTotalsForItems(items, result, disabledStands = []) {
    const disabled = new Set(disabledStands);
    const stands = {};
    const byCostType = { capex: 0, opex: 0 };
    let totalMonthly = 0;
    // Сумма «вклада риск-коэф. в ₽» по активным стендам — для footer'а.
    // Считаем по cell.costBase × (riskBreakdown.total - 1) — это наценка в рублях,
    // независимо от applyRisks (в режиме без рисков показывается потенциальная).
    let riskAmountTotal = 0;
    for (const sid of STAND_IDS) stands[sid] = { totalMonthly: 0 };
    for (const it of items) {
        const r = result.items[it.id];
        if (!r) continue;
        const ct = getCostType(it);
        let itemActive = 0;
        for (const sid of STAND_IDS) {
            const cell = r.stands[sid];
            const cf = cell?.costFinal || 0;
            stands[sid].totalMonthly += cf;
            if (!disabled.has(sid)) {
                itemActive += cf;
                if (cell?.costBase > 0) {
                    const totalRisk = cell.riskBreakdown?.total || 1;
                    riskAmountTotal += cell.costBase * (totalRisk - 1);
                }
            }
        }
        totalMonthly += itemActive;
        byCostType[ct] += itemActive;
    }
    return { stands, totalMonthly, byCostType, riskAmountTotal };
}
