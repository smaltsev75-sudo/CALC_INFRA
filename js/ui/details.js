/**
 * Вкладка «Детализация» — две таблицы (Объём / Стоимость) с группировкой по
 * категориям. Все суммы в RUB. Для каждой строки показываем долю в стенде,
 * вклад риск-коэффициентов и тип расхода (CAPEX/OPEX).
 *
 * Структура:
 *   1. «Объём (qty)» — категория, элемент, поставщик, ед.изм. + 5 стендов + ИТОГО qty.
 *   2. «Стоимость (₽)» — все остальные колонки + Тип расхода + ₽/мес + ₽/год + доли.
 *
 * Описание ЭК (item.description) больше не выводится отдельной строкой —
 * показывается через title= иконки ⓘ при наведении.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { CATEGORY_IDS, MONTHS_PER_YEAR, STAND_IDS } from '../utils/constants.js';
import { calculate } from '../domain/calculator.js';
import { applyStandFilter } from '../domain/standsFilter.js';
import { getProviderSecurityPriceWarningForCalc } from '../domain/providerPriceTrust.js';
import { renderCalculationProviderPriceActuality } from './providerPriceActuality.js';
import { renderStandToggles } from './standToggles.js';
import { renderScenarioBadge } from './scenarioBadge.js';
import {
    computeTotalsForItems,
    itemMonthlyOnActiveStands,
    renderAiMetricsSummary,
    renderCostSection,
    renderQtySection
} from './detailsSections.js';
import { renderDetailsQuantityPrintSummary } from './quantityExplanation.js';
import { deriveAiMetricItemQty } from './dashboardAggregates.js';

/** Sub-tab id-ы для Детализации. */
const SUB_TABS = Object.freeze(['cost', 'qty']);
const SUB_TAB_LABELS = Object.freeze({ cost: 'Бюджет (₽)', qty: 'Объём (qty)' });
const DEFAULT_SUB_TAB = 'cost';

function getSubTab(state) {
    const t = state.ui?.detailsSubTab;
    return SUB_TABS.includes(t) ? t : DEFAULT_SUB_TAB;
}

export function renderDetails(state, ctx) {
    const calc = state.activeCalc;
    if (!calc) return el('div', { class: 'tab-pane' }, el('p', { text: 'Создайте расчёт во вкладке «Расчёты».' }));

    const result = calculate(calc, state.calcRevision);
    const disabledStands = calc.view?.disabledStands || [];
    const search = (state.ui.searchByTab?.details || '').toLowerCase();
    const subTab = getSubTab(state);
    const hideZero = !!state.ui?.detailsHideZero;
    // Режим определяется параметром расчёта в Опроснике, а не UI-toggle'ом.
    const applyRisks = calc.settings?.applyRiskFactors !== false;
    const providerPriceWarning = getProviderSecurityPriceWarningForCalc(calc);

    // Сортировка: ВНУТРИ категории — по убыванию ИТОГО ₽/мес
    // (на активных стендах). Сами группы ниже сортируются по ИТОГО / год.
    // См. memory/feedback_sort_descending — числа в столбце идут по убыванию.
    const items = [...calc.dictionaries.items];
    items.sort((a, b) => {
        if (a.category !== b.category) return CATEGORY_IDS.indexOf(a.category) - CATEGORY_IDS.indexOf(b.category);
        const am = itemMonthlyOnActiveStands(a.id, result, disabledStands);
        const bm = itemMonthlyOnActiveStands(b.id, result, disabledStands);
        if (bm !== am) return bm - am;
        // tie-break: имя по алфавиту, чтобы порядок был стабильным когда суммы равны
        return a.name.localeCompare(b.name, 'ru');
    });

    let filtered = search
        ? items.filter(it =>
            (it.name || '').toLowerCase().includes(search) ||
            (it.vendor || '').toLowerCase().includes(search) ||
            (it.description || '').toLowerCase().includes(search)
        )
        : items;

    // Скрыть ЭК, не влияющие на бюджет (cost = 0 на активных стендах).
    let hiddenCount = 0;
    if (hideZero) {
        const before = filtered.length;
        filtered = filtered.filter(it =>
            itemMonthlyOnActiveStands(it.id, result, disabledStands) > 0 ||
            (subTab === 'qty' && itemHasDerivedAiMetricQty(it, disabledStands, calc))
        );
        hiddenCount = before - filtered.length;
    }

    const byCat = {};
    for (const cat of CATEGORY_IDS) byCat[cat] = [];
    for (const it of filtered) (byCat[it.category] || (byCat[it.category] = [])).push(it);

    const totalsForFilter = computeTotalsForItems(filtered, result, disabledStands);
    const isFiltered = !!search || hideZero;

    // Список category-id, у которых ЕСТЬ items в текущей выборке.
    // Порядок — по убыванию суммы группы в столбце «ИТОГО / год».
    // Нужен и рендеру, и контроллеру при первом раскрытии accordion'а.
    const presentCats = buildDetailsCategoryOrder(byCat, result, disabledStands);

    return el('section', { class: 'tab-pane' },
        el('div', { class: 'tab-toolbar' },
            el('div', { class: 'tab-title-group' },
                el('h2', { class: 'tab-title', text: `Детализация · ${calc.name}` }),
                renderScenarioBadge(calc)
            ),
            el('div', { class: 'tab-toolbar-actions' },
                renderSubTabSwitcher(subTab, ctx),
                renderHideZeroToggle(hideZero, hiddenCount, ctx),
                renderStandToggles(disabledStands, ctx),
                el('input', {
                    class: 'input search-input',
                    type: 'text',
                    placeholder: 'Поиск по названию, поставщику, описанию (Ctrl+Alt+F)',
                    value: state.ui.searchByTab?.details || '',
                    title: 'Фильтрация строк таблицы. Поиск по названию, поставщику и описанию элементов',
                    attrs: { 'data-role': 'search-input', 'data-focus-key': 'search:details' },
                    onInput: e => ctx.setSearch('details', e.target.value)
                }),
                el('button', {
                    class: 'btn btn-ghost btn-icon-text',
                    title: 'Открыть анализ факторов, влияющих на расчёт и бюджет',
                    attrs: { type: 'button', 'data-testid': 'details-root-cause-open' },
                    onClick: () => ctx.openRootCauseReportModal?.()
                }, icon('git-branch', { size: 16 }), el('span', { text: 'Анализ факторов' })),
                el('button', {
                    class: 'btn btn-ghost btn-icon-text',
                    title: 'Скачать детализацию в Excel-совместимом формате CSV — для отчёта или передачи коллегам',
                    onClick: (e) => ctx.exportCsv(e)
                }, icon('bar-chart-3', { size: 16 }), el('span', { text: 'CSV' }))
                /* 12.U27: кнопка «Заказ ЭК» удалена — была семантическим дублем CSV
                   для пользователя. Если понадобится procurement-формат — восстановить
                   из истории. */
            )
        ),

        renderCalculationProviderPriceActuality(calc, {
            className: 'details-provider-price-actuality',
            title: 'Прайс расчёта',
            testId: 'details-provider-price-actuality'
        }),
        providerPriceWarning ? renderProviderPriceWarning(providerPriceWarning, ctx) : null,

        subTab === 'qty'
            ? renderQtySection(byCat, result, ctx, disabledStands, applyRisks, state, presentCats, calc)
            : renderCostSection(byCat, result, ctx, totalsForFilter, isFiltered, disabledStands, applyRisks, calc, state, presentCats),

        renderDetailsQuantityPrintSummary(calc, result, disabledStands),

        /* Сводная панель AI-метрик — qty-таблица (токены/ГБ/vCPU). Она видна
           на обеих подвкладках Детализации: на «Бюджет» пользователь сразу
           видит, что заполненный раздел «Объём токенов» реально попал в расчёт,
           а на «Объём» получает тот же агрегат рядом с построчными qty. */
        renderAiMetricsSummary(calc, result, disabledStands, applyRisks, ctx, { hideNoBudget: hideZero })
    );
}

function itemHasDerivedAiMetricQty(item, disabledStands = [], calc = null) {
    const disabled = new Set(disabledStands);
    return STAND_IDS.some(sid => !disabled.has(sid) && deriveAiMetricItemQty(calc, item.id, sid) > 0);
}

function renderProviderPriceWarning(warning, ctx) {
    return el('div', {
        class: 'details-provider-price-warning',
        attrs: { role: 'status', title: warning.title }
    },
        icon('alert-triangle', { size: 16 }),
        el('div', { class: 'details-provider-price-warning-text' },
            el('strong', { text: warning.label }),
            el('span', { text: ` — ${warning.message}` })
        ),
        el('button', {
            class: 'btn btn-ghost details-provider-price-warning-action',
            attrs: { type: 'button' },
            title: 'Открыть детальную проверку расчёта',
            onClick: () => ctx.openCalculationHealthModal?.()
        }, 'Открыть проверку')
    );
}

export function detailsCategoryAnnualOnActiveStands(list, result, disabledStands = []) {
    const monthly = (list || []).reduce(
        (acc, it) => acc + itemMonthlyOnActiveStands(it.id, result, disabledStands),
        0
    );
    return monthly * MONTHS_PER_YEAR;
}

export function buildDetailsCategoryOrder(byCat, result, disabledStands = []) {
    const canonicalIndex = new Map(CATEGORY_IDS.map((cat, index) => [cat, index]));
    return CATEGORY_IDS
        .filter(cat => (byCat?.[cat] || []).length > 0)
        .sort((a, b) => {
            const aAnnual = detailsCategoryAnnualOnActiveStands(byCat[a], result, disabledStands);
            const bAnnual = detailsCategoryAnnualOnActiveStands(byCat[b], result, disabledStands);
            if (bAnnual !== aAnnual) return bAnnual - aAnnual;
            return canonicalIndex.get(a) - canonicalIndex.get(b);
        });
}

function renderSubTabSwitcher(active, ctx) {
    return el('div', { class: 'period-switcher', attrs: { role: 'group', 'aria-label': 'Раздел детализации' } },
        ...SUB_TABS.map(t =>
            el('button', {
                class: ['period-btn', t === active && 'period-btn-active'],
                title: SUB_TAB_LABELS[t],
                attrs: { type: 'button', 'aria-pressed': t === active ? 'true' : 'false' },
                onClick: () => { if (t !== active) ctx.setUi?.({ detailsSubTab: t }); }
            }, SUB_TAB_LABELS[t])
        )
    );
}

function renderHideZeroToggle(active, hiddenCount, ctx) {
    const label = active && hiddenCount > 0
        ? `Без нулевых · скрыто ${hiddenCount}`
        : 'Скрыть без бюджета';
    return el('button', {
        class: ['btn', 'btn-ghost', 'btn-icon-text', 'details-hide-zero', active && 'details-hide-zero-active'],
        title: 'Скрыть строки без вклада в бюджет на активных стендах: ЭК с ИТОГО за месяц 0 и пустые строки сводки AI-метрик.',
        attrs: { type: 'button', 'aria-pressed': active ? 'true' : 'false' },
        onClick: () => ctx.setUi?.({ detailsHideZero: !active })
    },
        icon(active ? 'check' : 'x', { size: 14 }),
        el('span', { text: label })
    );
}
