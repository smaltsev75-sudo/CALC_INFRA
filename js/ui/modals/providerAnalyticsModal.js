/**
 * Прайс-бенчмарк (read-only сравнение цен провайдеров).
 *
 * Источник данных:
 *   - ctx.aggregateProviderPrices(providerIds, effectiveByProvider) → таблица
 *     (вызывает domain/providerAnalytics + сам собирает effective prices).
 *
 * UX:
 *   - 5 столбцов representative-key-item per category.
 *   - Каждая строка: название провайдера, цены по категориям, итог.
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
import {
    CATEGORY_UNITS,
    CATEGORY_LABELS_FOR_UI,
    CATEGORY_DESCRIPTIONS_FOR_UI
} from '../../domain/providerAnalytics.js';
import { getProviderPriceBundleMeta } from '../../domain/providerOverlay.js';
import { getProviderPriceActuality } from '../../domain/providerPriceTrust.js';
import { formatNumber, formatPercentPoints } from '../../services/format.js';

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
       - sortBy:      'total' | 'CPU' | 'RAM' | 'STORAGE' | 'NETWORK' | 'LICENSE'
       - sortDir:     'asc' | 'desc'             (default 'asc')
       - visibleCategories: string[] | null      (default — все 5 категорий) — Stage 14.1 */
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

    const data = ctx.aggregateProviderPrices
        ? ctx.aggregateProviderPrices(allActiveIds, effectiveByProvider)
        : {
            providers: [],
            categories: ['CPU', 'RAM', 'STORAGE', 'NETWORK', 'LICENSE'],
            trustMatrix: { capabilities: [], providers: [] }
        };

    const providerMetaById = {};
    for (const id of allActiveIds) {
        providerMetaById[id] = ctx.getCurrentProviderOverride?.(id)
            || data.providers.find(p => p.id === id)?.priceMeta
            || getProviderPriceBundleMeta(id);
    }

    /* Stage 14.1: фильтр видимых категорий. Дефолт — все. Persist через
       ctx.setProviderAnalyticsVisibleCategories (controller → localStorage). */
    const visibleCategories = Array.isArray(m.visibleCategories)
        ? m.visibleCategories.filter(c => data.categories.includes(c))
        : [...data.categories];
    const visibleSet = new Set(visibleCategories);

    /* Если выбранный sortBy относится к скрытой категории — fallback на 'total'. */
    const effectiveSortBy = (sortBy === 'total' || visibleSet.has(sortBy)) ? sortBy : 'total';

    /* Сортировка по выбранной колонке. Итог пересчитывается с учётом visibleCategories. */
    const computeRowTotal = (p) => {
        let sum = 0;
        for (const cat of visibleCategories) {
            const eff = p.byCategory[cat]?.effective;
            if (Number.isFinite(eff)) sum += eff;
        }
        return sum;
    };
    const sortedProviders = [...data.providers].sort((a, b) => {
        const va = effectiveSortBy === 'total' ? computeRowTotal(a) : (a.byCategory[effectiveSortBy]?.effective ?? 0);
        const vb = effectiveSortBy === 'total' ? computeRowTotal(b) : (b.byCategory[effectiveSortBy]?.effective ?? 0);
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

    const renderProviderActuality = (providerId) => {
        const actuality = getProviderPriceActuality(providerMetaById[providerId]);
        return el('span', {
            class: 'analytics-provider-meta',
            text: actuality.label
        });
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
       «что именно за число в этой колонке» (например, «Цена 1 vCPU shared
       в месяц»). «Итого» тут — это сумма представительных цен для скоринга
       провайдеров, не математически корректный total (единицы разные). */
    const thead = el('thead', null,
        el('tr', null,
            el('th', { class: 'analytics-th-provider', text: 'Провайдер' }),
            ...visibleCategories.map(cat => el('th', {
                class: ['analytics-th-cat', effectiveSortBy === cat && 'is-sorted'],
                attrs: { type: 'button',
                    title: `${CATEGORY_DESCRIPTIONS_FOR_UI[cat] || cat}. Нажмите, чтобы отсортировать по этой колонке.` },
                onClick: () => handleSort(cat)
            },
                el('span', null,
                    el('span', { class: 'analytics-th-cat-name', text: CATEGORY_LABELS_FOR_UI[cat] || cat }),
                    el('span', { class: 'analytics-th-cat-unit',
                        text: CATEGORY_UNITS[cat] || '' })
                ),
                sortIcon(cat)
            )),
            el('th', {
                class: ['analytics-th-total', effectiveSortBy === 'total' && 'is-sorted'],
                onClick: () => handleSort('total'),
                attrs: { title: 'Сумма представительных цен видимых категорий — индикатор для ранжирования. Единицы измерения категорий различаются (₽/vCPU, ₽/ГБ, ₽/ТБ, ₽/узел/год); сумма не является корректной денежной величиной, только относительной оценкой.' }
            },
                el('span', null,
                    el('span', { class: 'analytics-th-cat-name', text: 'Сумма' }),
                    el('span', { class: 'analytics-th-cat-unit', text: 'для ранжирования' })
                ),
                sortIcon('total')
            )
        )
    );

    const renderCell = (cell) => {
        const trustBadge = renderTrustBadge(cell?.trust);
        if (!cell || cell.effective === null) {
            const emptyText = cell?.trust?.status === 'by-request' ? 'по запросу' : '—';
            return el('td', {
                class: ['analytics-td-cat', 'analytics-td-cat-empty'],
                attrs: { title: cell?.trust ? `${cell.trust.fullLabel}. ${cell.trust.description}` : undefined }
            },
                el('span', { class: 'analytics-td-cat-stack' },
                    el('span', { class: 'analytics-td-cat-num', text: emptyText }),
                    trustBadge
                )
            );
        }
        const pillText = fmtPct(cell.deltaPct);
        return el('td', { class: 'analytics-td-cat' },
            el('span', { class: 'analytics-td-cat-stack' },
                el('span', { class: 'analytics-td-cat-main' },
                    el('span', { class: 'analytics-td-cat-num', text: fmtRub(cell.effective) }),
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
                trustBadge
            )
        );
    };

    const tbody = el('tbody', null,
        ...sortedProviders.map(p => {
            const rowTotal = computeRowTotal(p);
            return el('tr', { class: 'analytics-row' },
                el('td', { class: 'analytics-td-provider' },
                    el('span', { class: 'analytics-provider-name', text: p.label }),
                    renderProviderActuality(p.id),
                    ...renderProviderWarnings(p.warnings)
                ),
                ...visibleCategories.map(cat => renderCell(p.byCategory[cat])),
                el('td', { class: 'analytics-td-total',
                    text: fmtRub(rowTotal) })
            );
        })
    );

    const table = el('table', { class: 'analytics-table' }, thead, tbody);

    /* Stage 14.1: панель фильтра по категориям. Каждая кнопка — toggle on/off
       с aria-pressed; визуально — pill (.analytics-cat-toggle). При клике
       persist через ctx + patchModal. */
    const filterBar = el('div', { class: 'analytics-cat-filter',
        attrs: { role: 'group', 'aria-label': 'Фильтр категорий' } },
        el('span', { class: 'analytics-cat-filter-label', text: 'Категории:' }),
        ...data.categories.map(cat => {
            const active = visibleSet.has(cat);
            return el('button', {
                class: ['analytics-cat-toggle', active && 'is-active'],
                attrs: {
                    type: 'button',
                    'aria-pressed': active ? 'true' : 'false',
                    title: active
                        ? `Скрыть колонку ${CATEGORY_LABELS_FOR_UI[cat] || cat}`
                        : `Показать колонку ${CATEGORY_LABELS_FOR_UI[cat] || cat}`
                },
                onClick: () => toggleCategory(cat)
            }, CATEGORY_LABELS_FOR_UI[cat] || cat);
        })
    );

    const noProviders = data.providers.length === 0
        ? el('div', { class: 'analytics-empty',
            text: 'Активных провайдеров нет.' })
        : null;
    const noCategories = visibleCategories.length === 0
        ? el('div', { class: 'analytics-empty',
            text: 'Все категории скрыты — отметьте хотя бы одну для отображения цен.' })
        : null;

    return modalShell({
        title: 'Прайс-бенчмарк',
        size: 'analytics',
        onClose: close,
        children: el('div', { class: 'analytics-body' },
            el('p', { class: 'analytics-hint',
                text: 'Представительные цены: процессоры = 1 виртуальное ядро shared, память = 1 ГБ, SSD-диски = 1 ТБ, балансировщик = HTTP/HTTPS L7, лицензия = ОС на 1 узел. Под каждой ценой показан уровень доверия: проверено, публичный прайс, задано вручную или нет публичной цены. Колонка «Сумма» — индикатор для ранжирования, не денежная величина.' }),
            renderTrustMatrix(data.trustMatrix),
            filterBar,
            noProviders || noCategories || null,
            !noCategories ? table : null
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', { class: 'btn btn-ghost', onClick: close }, 'Закрыть')
        )
    });
}
