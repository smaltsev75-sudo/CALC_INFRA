/**
 * Прайс-бенчмарк (read-only сравнение цен провайдеров).
 *
 * Источник данных:
 *   - ctx.aggregateProviderPrices(providerIds, effectiveByProvider) → таблица
 *     (вызывает domain/providerAnalytics + сам собирает effective prices).
 *
 * UX:
 *   - Для активного расчёта: до 6 ЭК по месячному вкладу на горизонте,
 *     только если по ЭК есть эталонная цена Cloud.ru.
 *   - Каждая строка: название провайдера, месячный вклад по ЭК, вклад top-6.
 *     Цена за единицу показана вторичной строкой.
 *   - Бейдж delta-pill (Stage 9.1) если effective != frozen.
 *   - Клик на th-категорию → сортировка по этой колонке (asc/desc toggle).
 *   - Фильтр видимых категорий через pill-toggle (Stage 14.1).
 *
 * Read-only: модалка не обновляет прайсы. Единственный путь обновления —
 * «Импорт прайса JSON» в Опроснике.
 */

import { el } from '../dom.js';
import { icon } from '../icons.js';
import { modalShell } from './baseModal.js';
import { calculate } from '../../domain/calculator.js';
import {
    CATEGORY_UNITS,
    CATEGORY_LABELS_FOR_UI,
    CATEGORY_DESCRIPTIONS_FOR_UI,
    PROVIDER_BENCHMARK_TOP_LIMIT,
    PROVIDER_BENCHMARK_REFERENCE_PROVIDER,
    buildProviderBenchmarkItems
} from '../../domain/providerAnalytics.js';
import { getProviderPriceBundleMeta } from '../../domain/providerOverlay.js';
import { getProviderPriceActuality } from '../../domain/providerPriceTrust.js';
import { formatNumber, formatPercentPoints, percent } from '../../services/format.js';

const fmtRub = (n) => formatNumber(Number(n), { min: 0, max: 2 });

const fmtPct = (pct) => {
    if (!Number.isFinite(pct) || pct === 0) return null;
    const abs = Math.abs(pct);
    return formatPercentPoints(pct, { min: abs >= 10 ? 0 : 1, max: abs >= 10 ? 0 : 1 });
};

export function renderProviderAnalyticsModal(state, ctx) {
    const m = state.modals.providerAnalytics;
    if (!m?.open) return null;

    const close = () => ctx.closeModal('providerAnalytics');

    /* state.modals.providerAnalytics:
       - sortBy:      'total' | dynamic item id | fallback category id
       - sortDir:     'asc' | 'desc'             (default 'asc')
       - visibleCategories: string[] | null      (default — все calc-specific колонки) */
    const allActiveIds = ['sbercloud', 'yandex', 'vk'];
    const sortBy = m.sortBy || 'total';
    const sortDir = m.sortDir || 'asc';

    /* Загружаем effective цены для всех active providers (controller сам читает
       из localStorage). UI не ходит в services напрямую. */
    const effectiveByProvider = {};
    if (ctx.getEffectivePricesForProvider) {
        for (const id of allActiveIds) {
            effectiveByProvider[id] = ctx.getEffectivePricesForProvider(id);
        }
    }

    const activeCalc = state.activeCalc;
    const activeResult = activeCalc ? calculate(activeCalc, state.calcRevision) : null;
    const benchmarkItems = activeCalc && activeResult
        ? buildProviderBenchmarkItems(activeCalc, activeResult, {
            limit: PROVIDER_BENCHMARK_TOP_LIMIT,
            referenceProviderId: PROVIDER_BENCHMARK_REFERENCE_PROVIDER,
            referencePrices: effectiveByProvider[PROVIDER_BENCHMARK_REFERENCE_PROVIDER]
        })
        : null;

    const data = ctx.aggregateProviderPrices
        ? ctx.aggregateProviderPrices(allActiveIds, effectiveByProvider, benchmarkItems)
        : {
            providers: [],
            categories: ['CPU', 'RAM', 'STORAGE', 'NETWORK', 'LICENSE'],
            categoryMeta: {},
            trustMatrix: { capabilities: [], providers: [] }
        };
    const categoryMeta = data.categoryMeta || {};
    const isCalcSpecificBenchmark = Boolean(activeCalc && activeResult);

    const providerMetaById = {};
    for (const id of allActiveIds) {
        providerMetaById[id] = ctx.getCurrentProviderOverride?.(id)
            || data.providers.find(p => p.id === id)?.priceMeta
            || getProviderPriceBundleMeta(id);
    }

    /* Stage 14.1: фильтр видимых категорий. Дефолт — все. Persist через
       ctx.setProviderAnalyticsVisibleCategories (controller → localStorage). */
    let visibleCategories = Array.isArray(m.visibleCategories)
        ? m.visibleCategories.filter(c => data.categories.includes(c))
        : [...data.categories];
    if (Array.isArray(m.visibleCategories) && m.visibleCategories.length > 0 && visibleCategories.length === 0) {
        visibleCategories = [...data.categories];
    }
    const visibleSet = new Set(visibleCategories);

    /* Если выбранный sortBy относится к скрытой категории — fallback на 'total'. */
    const effectiveSortBy = (sortBy === 'total' || visibleSet.has(sortBy)) ? sortBy : 'total';

    const cellSortValue = (cell) => {
        const impact = Number(cell?.monthlyImpact);
        if (Number.isFinite(impact)) return impact;
        const effective = Number(cell?.effective);
        return Number.isFinite(effective) ? effective : null;
    };

    /* Сортировка по выбранной колонке. В calc-specific режиме итог — месячный
       вклад top-ЭК на текущих количествах, а не сумма разных unit-price. */
    const computeRowTotalInfo = (p) => {
        let sum = 0;
        let missing = 0;
        for (const cat of visibleCategories) {
            const v = cellSortValue(p.byCategory[cat]);
            if (v === null) missing++;
            else sum += v;
        }
        return { sum, missing, complete: missing === 0 };
    };
    const sortedProviders = [...data.providers].sort((a, b) => {
        if (effectiveSortBy === 'total') {
            const ia = computeRowTotalInfo(a);
            const ib = computeRowTotalInfo(b);
            if (ia.missing !== ib.missing) return ia.missing - ib.missing;
            return sortDir === 'asc' ? ia.sum - ib.sum : ib.sum - ia.sum;
        }
        const va = cellSortValue(a.byCategory[effectiveSortBy]);
        const vb = cellSortValue(b.byCategory[effectiveSortBy]);
        if (va === null && vb !== null) return 1;
        if (va !== null && vb === null) return -1;
        if (va === null && vb === null) return 0;
        return sortDir === 'asc' ? va - vb : vb - va;
    });

    const handleSort = (col) => {
        const nextDir = (effectiveSortBy === col && sortDir === 'asc') ? 'desc' : 'asc';
        ctx.patchModal('providerAnalytics', { sortBy: col, sortDir: nextDir });
    };

    const toggleCategory = (cat) => {
        const next = visibleSet.has(cat)
            ? visibleCategories.filter(c => c !== cat)
            : [...visibleCategories, cat];
        ctx.patchModal('providerAnalytics', { visibleCategories: next });
        if (ctx.setProviderAnalyticsVisibleCategories) {
            ctx.setProviderAnalyticsVisibleCategories(next);
        }
    };

    /* Header строка с sort-икoнками. */
    const sortIcon = (col) => effectiveSortBy === col
        ? icon(sortDir === 'asc' ? 'chevron-up' : 'chevron-down', { size: 12 })
        : null;

    const renderTrustBadge = (trust) => trust
        ? el('span', {
            class: ['analytics-trust-badge', `analytics-trust-badge--${trust.status}`],
            attrs: { title: `${trust.fullLabel}. ${trust.description}` },
            text: trust.shortLabel
        })
        : null;

    const renderProviderWarnings = (warnings = []) => warnings.map(w =>
        el('span', {
            class: 'analytics-provider-warning',
            attrs: { title: w.title },
            text: w.label
        })
    );

    const getProviderActualityText = (providerId) => {
        const actuality = getProviderPriceActuality(providerMetaById[providerId]);
        return actuality.date || 'дата не указана';
    };

    const renderProviderActualityTable = (providers = []) => {
        if (!providers.length) return null;
        return el('section', { class: 'analytics-actuality' },
            el('div', { class: 'analytics-section-head analytics-section-head--compact' },
                el('h3', { class: 'analytics-section-title', text: 'Актуальность прайсов' })
            ),
            el('div', { class: 'analytics-actuality-wrap' },
                el('table', { class: 'analytics-actuality-table' },
                    el('thead', null,
                        el('tr', null,
                            el('th', { text: 'Провайдер' }),
                            el('th', { text: 'Дата прайса' })
                        )
                    ),
                    el('tbody', null,
                        ...providers.map(provider =>
                            el('tr', null,
                                el('td', { class: 'analytics-actuality-provider', text: provider.label }),
                                el('td', {
                                    class: 'analytics-actuality-date',
                                    text: getProviderActualityText(provider.id)
                                })
                            )
                        )
                    )
                )
            )
        );
    };

    const getColumnMeta = (cat) => categoryMeta[cat] || {
        label: CATEGORY_LABELS_FOR_UI[cat] || cat,
        unit: CATEGORY_UNITS[cat] || '',
        description: CATEGORY_DESCRIPTIONS_FOR_UI[cat] || cat,
        monthlyCost: null,
        sharePct: null,
        dynamic: false
    };

    const renderColumnTitle = (cat) => {
        const meta = getColumnMeta(cat);
        const lines = [
            meta.description,
            isCalcSpecificBenchmark ? 'Колонка показана, потому что у Cloud.ru есть публичная цена по этому ЭК.' : '',
            Number.isFinite(meta.monthlyCost)
                ? `Вклад в текущем расчёте: ${fmtRub(meta.monthlyCost)} ₽/мес.`
                : '',
            Number.isFinite(meta.sharePct)
                ? `Доля бюджета: ${percent(meta.sharePct / 100)}.`
                : '',
            'Нажмите, чтобы отсортировать по этой колонке.'
        ];
        return lines.filter(Boolean).join('\n');
    };

    const renderTrustMatrix = (matrix) => {
        if (!matrix?.providers?.length || !matrix?.capabilities?.length) return null;
        return el('section', { class: 'analytics-trust-matrix' },
            el('div', { class: 'analytics-section-head' },
                el('h3', { class: 'analytics-section-title', text: 'Cloud.ru vs Yandex vs VK: доверие к ценам' }),
                el('p', {
                    class: 'analytics-section-note',
                    text: 'Матрица показывает не стоимость, а качество источника цены: где прайс проверен, где он публичный, где цена отсутствует или выдаётся по запросу.'
                })
            ),
            el('div', { class: 'analytics-trust-matrix-wrap' },
                el('table', { class: 'analytics-trust-matrix-table' },
                    el('thead', null,
                        el('tr', null,
                            el('th', { text: 'Провайдер' }),
                            ...matrix.capabilities.map(capability =>
                                el('th', {
                                    attrs: { title: capability.title },
                                    text: capability.label
                                })
                            )
                        )
                    ),
                    el('tbody', null,
                        ...matrix.providers.map(provider =>
                            el('tr', null,
                                el('td', { class: 'analytics-trust-provider' },
                                    el('span', { class: 'analytics-provider-name', text: provider.label }),
                                    ...renderProviderWarnings(provider.warnings)
                                ),
                                ...matrix.capabilities.map(capability => {
                                    const trust = provider.byCapability?.[capability.key];
                                    const coverage = trust?.coverage;
                                    const coverageText = coverage
                                        ? `${coverage.covered}/${coverage.total} позиций покрыто`
                                        : '';
                                    return el('td', {
                                        class: ['analytics-trust-cell', `analytics-trust-cell--${trust?.status || 'unknown'}`],
                                        attrs: {
                                            title: [
                                                capability.title,
                                                trust ? `${trust.fullLabel}. ${trust.description}` : '',
                                                coverageText
                                            ].filter(Boolean).join('\n')
                                        }
                                    }, renderTrustBadge(trust));
                                })
                            )
                        )
                    )
                )
            )
        );
    };

    /* PATCH 2.7.3: каждая колонка имеет 2-line header «КАТЕГОРИЯ + ед.изм.»
       (тот же паттерн что .col-stand в details-table). Tooltip содержит
       «что именно за число в этой колонке». В calc-specific режиме нижняя
       строка заголовка показывает вклад ЭК в текущий расчёт. */
    const totalTitle = isCalcSpecificBenchmark
        ? 'Суммарный месячный вклад видимых ЭК с эталонной ценой Cloud.ru, пересчитанный на текущих количествах расчёта. Если у провайдера нет цены по одному из ЭК, итог помечается как неполный.'
        : 'Сумма представительных цен видимых категорий — индикатор для ранжирования. Единицы измерения категорий различаются; сумма не является корректной денежной величиной, только относительной оценкой.';
    const totalUnit = isCalcSpecificBenchmark ? '₽/мес' : 'для ранжирования';
    const thead = el('thead', null,
        el('tr', null,
            el('th', { class: 'analytics-th-provider', text: 'Провайдер' }),
            ...visibleCategories.map(cat => {
                const meta = getColumnMeta(cat);
                const unitText = isCalcSpecificBenchmark ? 'вклад ₽/мес' : (meta.unit || '');
                const headerIcon = sortIcon(cat);
                return el('th', {
                    class: ['analytics-th-cat', effectiveSortBy === cat && 'is-sorted'],
                    attrs: { type: 'button', title: renderColumnTitle(cat) },
                    onClick: () => handleSort(cat)
                },
                    el('span', { class: 'analytics-th-content' },
                        el('span', { class: 'analytics-th-name-row' },
                            el('span', { class: 'analytics-th-cat-name', text: meta.label }),
                            headerIcon
                        ),
                        el('span', { class: 'analytics-th-cat-unit', text: unitText })
                    )
                );
            }),
            el('th', {
                class: ['analytics-th-total', effectiveSortBy === 'total' && 'is-sorted'],
                onClick: () => handleSort('total'),
                attrs: { title: totalTitle }
            },
                el('span', { class: 'analytics-th-content' },
                    el('span', { class: 'analytics-th-name-row' },
                        el('span', { class: 'analytics-th-cat-name',
                            text: isCalcSpecificBenchmark ? 'Вклад ЭК' : 'Сумма' }),
                        sortIcon('total')
                    ),
                    el('span', { class: 'analytics-th-cat-unit', text: totalUnit })
                )
            )
        )
    );

    const renderCell = (cell, cat) => {
        const meta = getColumnMeta(cat);
        const impact = Number(cell?.monthlyImpact);
        const impactLine = Number.isFinite(impact)
            ? `Вклад при этом провайдере: ${fmtRub(impact)} ₽/мес.`
            : '';
        const trustBadge = renderTrustBadge(cell?.trust);
        if (!cell || cell.effective === null) {
            const emptyText = cell?.trust?.status === 'by-request' ? 'по запросу' : '—';
            return el('td', {
                class: ['analytics-td-cat', 'analytics-td-cat-empty'],
                attrs: { title: cell?.trust
                    ? `${meta.description}\n${cell.trust.fullLabel}. ${cell.trust.description}`
                    : meta.description }
            },
                el('span', { class: 'analytics-td-cat-stack' },
                    el('span', { class: 'analytics-td-cat-num', text: emptyText }),
                    trustBadge
                )
            );
        }
        const pillText = fmtPct(cell.deltaPct);
        const showMonthlyImpact = isCalcSpecificBenchmark && Number.isFinite(impact);
        const primaryValue = showMonthlyImpact ? impact : cell.effective;
        const unitPriceLine = showMonthlyImpact
            ? `цена: ${fmtRub(cell.effective)} ${meta.unit}`
            : '';
        return el('td', { class: 'analytics-td-cat',
            attrs: {
                title: [
                    meta.description,
                    showMonthlyImpact ? `Цена за единицу: ${fmtRub(cell.effective)} ${meta.unit}.` : '',
                    impactLine
                ].filter(Boolean).join('\n'),
                ...(showMonthlyImpact ? { 'data-monthly-impact': String(impact) } : {}),
                'data-effective-price': String(cell.effective)
            } },
                el('span', { class: 'analytics-td-cat-stack' },
                    el('span', { class: 'analytics-td-cat-main' },
                        el('span', { class: 'analytics-td-cat-num', text: fmtRub(primaryValue) }),
                    pillText
                        ? el('span', {
                            class: ['delta-pill',
                                    (cell.deltaPct > 0) ? 'delta-pill--up' : 'delta-pill--down'],
                            /* Stage 14.2: hover-tooltip унифицирован «Старая X → Новая Y (Δ%)». */
                            title: `Старая ${fmtRub(cell.frozen)} ₽ → Новая ${fmtRub(cell.effective)} ₽ (${pillText})`,
                            text: pillText
                        })
                        : null
                ),
                showMonthlyImpact
                    ? el('span', { class: 'analytics-td-cat-kind', text: 'вклад, ₽/мес' })
                    : null,
                unitPriceLine
                    ? el('span', { class: 'analytics-td-cat-price', text: unitPriceLine })
                    : null,
                trustBadge
            )
        );
    };

    const tbody = el('tbody', null,
        ...sortedProviders.map(p => {
            const rowTotal = computeRowTotalInfo(p);
            return el('tr', { class: 'analytics-row' },
                el('td', { class: 'analytics-td-provider' },
                    el('span', { class: 'analytics-provider-name', text: p.label }),
                    ...renderProviderWarnings(p.warnings)
                ),
                ...visibleCategories.map(cat => renderCell(p.byCategory[cat], cat)),
                el('td', { class: 'analytics-td-total',
                    attrs: {
                        title: rowTotal.missing > 0
                            ? `Нет цены по ${rowTotal.missing} из ${visibleCategories.length} видимых ЭК. Итог неполный.`
                            : totalTitle,
                        'data-total-cost': String(rowTotal.sum)
                    } },
                    el('span', { class: 'analytics-td-total-stack' },
                        el('span', { class: 'analytics-td-total-num',
                            text: fmtRub(rowTotal.sum) }),
                        rowTotal.missing > 0
                            ? el('span', { class: 'analytics-total-incomplete',
                                text: 'неполно' })
                            : null
                    )
                )
            );
        })
    );

    const table = el('table', { class: 'analytics-table' }, thead, tbody);

    /* Stage 14.1: панель фильтра по категориям. Каждая кнопка — toggle on/off
       с aria-pressed; визуально — pill (.analytics-cat-toggle). При клике
       persist через ctx + patchModal. */
    const filterBar = el('div', { class: 'analytics-cat-filter',
        attrs: { role: 'group', 'aria-label': 'Фильтр ЭК' } },
        el('span', { class: 'analytics-cat-filter-label', text: 'ЭК в сравнении:' }),
        ...data.categories.map(cat => {
            const active = visibleSet.has(cat);
            const meta = getColumnMeta(cat);
            return el('button', {
                class: ['analytics-cat-toggle', active && 'is-active'],
                attrs: {
                    type: 'button',
                    'aria-pressed': active ? 'true' : 'false',
                    title: active
                        ? `Скрыть колонку ${meta.label}`
                        : `Показать колонку ${meta.label}`
                },
                onClick: () => toggleCategory(cat)
            }, meta.label);
        })
    );

    const noProviders = data.providers.length === 0
        ? el('div', { class: 'analytics-empty',
            text: 'Активных провайдеров нет.' })
        : null;
    const hasNoBenchmarkCategories = data.categories.length === 0;
    const noCategories = hasNoBenchmarkCategories
        ? el('div', { class: 'analytics-empty',
            text: isCalcSpecificBenchmark
                ? 'В текущем расчёте нет ЭК с публичной ценой Cloud.ru для сравнения.'
                : 'Нет категорий для сравнения.' })
        : visibleCategories.length === 0
        ? el('div', { class: 'analytics-empty',
            text: 'Все категории скрыты — отметьте хотя бы одну колонку ЭК для отображения цен.' })
        : null;

    const hintText = isCalcSpecificBenchmark
        ? `Показаны до ${PROVIDER_BENCHMARK_TOP_LIMIT} крупнейших ЭК текущего расчёта по месячному вкладу, по которым есть публичная цена Cloud.ru. Крупное число в ячейке — вклад в расчёт за месяц; строка «цена» — тариф за единицу ресурса.`
        : 'Показаны базовые позиции провайдеров. Откройте расчёт, чтобы увидеть 6 крупнейших ЭК именно для него.';

    return modalShell({
        title: 'Прайс-бенчмарк',
        size: 'analytics',
        onClose: close,
        children: el('div', { class: 'analytics-body' },
            el('p', { class: 'analytics-hint', text: hintText }),
            renderProviderActualityTable(data.providers),
            renderTrustMatrix(data.trustMatrix),
            data.categories.length > 0 ? filterBar : null,
            noProviders || noCategories || null,
            !noCategories ? table : null
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', { class: 'btn btn-ghost', onClick: close }, 'Закрыть')
        )
    });
}
