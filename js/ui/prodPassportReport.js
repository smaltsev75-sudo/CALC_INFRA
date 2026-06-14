import { buildProdPassport } from '../domain/prodPassport.js';
import { csvSafeQuote, downloadCsv } from '../services/csvExport.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { error as showError } from './snackbar.js';

const PAGE_SIZE = 10;
const SEARCH_PATCH_DELAY_MS = 120;

let searchPatchTimer = null;
let restoreSearchFocusOnce = false;

function moneyThousands(value) {
    const n = Number(value) || 0;
    return Math.round(n / 1000);
}

const csvCell = value => csvSafeQuote(value, ';');

function factorToneClass(index) {
    return `prod-passport-factor-tone-${index % 6}`;
}

function scheduleSearchPatch(ctx, search) {
    if (searchPatchTimer) clearTimeout(searchPatchTimer);
    searchPatchTimer = setTimeout(() => {
        restoreSearchFocusOnce = true;
        ctx.patchModal('prodPassport', {
            search,
            offset: 0,
            selectedItemId: null
        });
    }, SEARCH_PATCH_DELAY_MS);
}

function restoreSearchFocus(input) {
    if (!restoreSearchFocusOnce || !input) return;
    restoreSearchFocusOnce = false;
    const schedule = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : callback => setTimeout(callback, 0);
    schedule(() => {
        if (!input.isConnected) return;
        input.focus();
        const end = String(input.value || '').length;
        try {
            input.setSelectionRange(end, end);
        } catch {
            /* search input may reject selection in older engines */
        }
    });
}

function renderSummaryCard(label, value, hint, testId) {
    return el('div', {
        class: 'prod-passport-summary-card',
        title: hint,
        attrs: { 'data-testid': testId }
    },
        el('div', { class: 'prod-passport-summary-label', text: label }),
        el('div', { class: 'prod-passport-summary-value', text: value })
    );
}

function renderSummary(model) {
    const dataStatus = [
        ['По умолчанию', model.summary.defaultItemsCount],
        ['Автоисправлено', model.summary.repairedItemsCount],
        ['Предупреждения', model.summary.warningItemsCount]
    ].filter(([, value]) => Number(value) > 0);

    return el('section', {
        class: 'prod-passport-summary',
        attrs: { 'data-testid': 'prod-passport-summary' }
    },
        el('div', { class: 'prod-passport-section-title' }, 'Сводка ПРОМ'),
        el('div', { class: 'prod-passport-summary-grid' },
            renderSummaryCard(
                'ЭК',
                String(model.summary.itemsCount),
                'Количество элементов конфигурации, которые дают количество или бюджет на стенде ПРОМ.',
                'prod-passport-summary-items'
            ),
            renderSummaryCard(
                'Бюджет',
                model.summary.totalMonthlyText,
                'Сумма бюджета ПРОМ за месяц в тех же расчётных данных, что использует Детализация.',
                'prod-passport-summary-month'
            ),
            renderSummaryCard(
                'Год',
                model.summary.totalAnnualText,
                'Месячный бюджет ПРОМ, умноженный на 12 месяцев.',
                'prod-passport-summary-year'
            )
        ),
        dataStatus.length
            ? el('div', { class: 'prod-passport-data-status' },
                el('span', { text: 'Проверка данных:' }),
                dataStatus.map(([label, value]) => el('span', {
                    class: 'prod-passport-data-status-chip',
                    text: `${label}: ${value}`
                }))
            )
            : null,
        renderTopFactors(model)
    );
}

function renderTopFactors(model) {
    const factors = model.summary.topFactors || [];
    const coverageTotal = factors.reduce((sum, factor) => sum + (Number(factor.coveragePercent) || 0), 0);
    const remainder = Math.max(0, 100 - coverageTotal);
    return el('section', {
        class: 'prod-passport-factors',
        attrs: { 'data-testid': 'prod-passport-top-factors' }
    },
        el('div', { class: 'prod-passport-factors-title' },
            el('div', { class: 'prod-passport-subtitle', text: 'Факторы влияния' }),
            el('span', {
                class: 'prod-passport-factors-summary-meta',
                text: factors.length ? `${factors.length} показателей` : 'нет заметных факторов'
            })
        ),
        factors.length === 0
            ? el('div', { class: 'prod-passport-empty', text: 'Нет факторов с заметным охватом.' })
            : el('article', { class: 'prod-passport-factor-panel' },
                el('div', {
                    class: 'prod-passport-factor-gradient',
                    attrs: { 'aria-hidden': 'true' }
                },
                    factors.map((factor, index) => el('span', {
                        class: ['prod-passport-factor-segment', factorToneClass(index)],
                        title: `${factor.label}: ${factor.coverageText}`,
                        style: {
                            flexBasis: `${Math.max(0, Number(factor.coveragePercent) || 0)}%`
                        }
                    })),
                    remainder > 0
                        ? el('span', {
                            class: 'prod-passport-factor-remainder',
                            style: { flexBasis: `${remainder}%` }
                        })
                        : null
                ),
                el('p', {
                    class: 'prod-passport-factor-note',
                    text: 'Проценты показывают долю от общего бюджета ПРОМ. Один ЭК может зависеть от нескольких факторов, поэтому проценты не суммируются к 100%.'
                }),
                el('div', { class: 'prod-passport-factor-list' },
                    factors.map((factor, index) => el('div', {
                        class: 'prod-passport-factor-item',
                        dataset: {
                            fieldId: factor.fieldId,
                            monthlyImpact: String(factor.monthlyImpact),
                            coverage: String(factor.coveragePercent)
                        }
                    },
                        el('span', {
                            class: ['prod-passport-factor-swatch', factorToneClass(index)],
                            attrs: { 'aria-hidden': 'true' }
                        }),
                        el('span', { class: 'prod-passport-factor-name', text: factor.label }),
                        el('strong', { class: 'prod-passport-factor-money', text: factor.monthlyText }),
                        el('span', { class: 'prod-passport-factor-percent', text: factor.coverageText })
                    ))
                )
            )
    );
}

function markerClass(marker) {
    if (marker.type === 'repair') return 'prod-passport-marker-repair';
    if (marker.type === 'warning') return 'prod-passport-marker-warning';
    return 'prod-passport-marker-default';
}

function markerText(marker) {
    if (marker.type === 'repair') return 'авто';
    if (marker.type === 'warning') return '!';
    return 'умолч.';
}

function renderMarkers(row) {
    if (!row.markers.length) return null;
    return el('span', { class: 'prod-passport-markers' },
        row.markers.map(marker => el('span', {
            class: ['prod-passport-marker', markerClass(marker)],
            title: marker.title,
            attrs: { 'aria-label': marker.title },
            text: markerText(marker)
        }))
    );
}

function renderItemRow(row, selected, ctx) {
    return el('button', {
        class: ['prod-passport-row', selected && 'prod-passport-row-selected'],
        attrs: {
            type: 'button',
            'data-testid': `prod-passport-row-${row.itemId}`,
            'aria-pressed': selected ? 'true' : 'false'
        },
        dataset: {
            itemId: row.itemId,
            quantity: String(row.quantity),
            monthlyCost: String(row.monthlyCost),
            budgetShare: String(row.budgetSharePercent)
        },
        onClick: () => ctx.patchModal('prodPassport', { selectedItemId: row.itemId })
    },
        el('span', { class: 'prod-passport-row-name' },
            el('strong', { text: row.name }),
            renderMarkers(row)
        ),
        el('span', { class: 'prod-passport-row-qty', text: row.quantityText }),
        el('span', { class: 'prod-passport-row-money', text: row.monthlyText }),
        el('span', { class: 'prod-passport-row-share', text: row.budgetShareText })
    );
}

function renderItemList(model, selectedItemId, ctx) {
    const search = model.search || '';
    const searchInput = el('input', {
        class: 'prod-passport-search',
        type: 'search',
        value: search,
        placeholder: 'Поиск по названию ЭК',
        attrs: {
            'data-testid': 'prod-passport-search',
            'aria-label': 'Поиск по названию ЭК'
        },
        onInput: event => scheduleSearchPatch(ctx, event.target.value)
    });
    restoreSearchFocus(searchInput);
    return el('section', {
        class: 'prod-passport-list',
        attrs: { 'data-testid': 'prod-passport-item-list' }
    },
        el('div', { class: 'prod-passport-section-title' }, 'ЭК ПРОМ'),
        el('div', { class: 'prod-passport-list-toolbar' },
            searchInput
        ),
        el('div', {
            class: 'prod-passport-list-head',
            attrs: { 'data-testid': 'prod-passport-list-head' }
        },
            el('span', { text: 'ЭК' }),
            el('span', { text: 'Количество' }),
            el('span', { text: 'Бюджет/мес.' }),
            el('span', { text: '% бюджета' })
        ),
        model.page.items.length === 0
            ? el('div', {
                class: 'prod-passport-empty',
                text: search ? 'По этому названию ЭК не найдены.' : 'Для ПРОМ нет ЭК с количеством или бюджетом.'
            })
            : model.page.items.map(row => renderItemRow(row, row.itemId === selectedItemId, ctx)),
        renderPager(model, ctx)
    );
}

function visiblePageNumbers(currentPage, pageCount) {
    if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1);
    const pages = new Set([1, pageCount, currentPage]);
    if (currentPage <= 3) {
        pages.add(2);
        pages.add(3);
    } else {
        pages.add(currentPage - 1);
    }
    if (currentPage >= pageCount - 2) {
        pages.add(pageCount - 1);
        pages.add(pageCount - 2);
    } else {
        pages.add(currentPage + 1);
    }
    return [...pages].filter(page => page >= 1 && page <= pageCount).sort((a, b) => a - b);
}

function renderPager(model, ctx) {
    const from = model.page.total === 0 ? 0 : model.page.offset + 1;
    const to = Math.min(model.page.offset + model.page.items.length, model.page.total);
    const pageCount = Math.max(1, Math.ceil(model.page.total / model.page.limit));
    const currentPage = Math.min(pageCount, Math.floor(model.page.offset / model.page.limit) + 1);
    const pageNumbers = visiblePageNumbers(currentPage, pageCount);
    const setOffset = nextOffsetRaw => {
        const maxOffset = Math.max(0, (pageCount - 1) * model.page.limit);
        const nextOffset = Math.min(maxOffset, Math.max(0, nextOffsetRaw));
        const selectedItemId = model.items[nextOffset]?.itemId || model.page.items[0]?.itemId || null;
        ctx.patchModal('prodPassport', { offset: nextOffset, selectedItemId });
    };
    const setPage = pageNumber => setOffset((pageNumber - 1) * model.page.limit);
    return el('div', { class: 'prod-passport-pager' },
        el('span', { class: 'prod-passport-page-range', text: `${from}-${to} из ${model.page.total}` }),
        el('div', { class: 'prod-passport-pager-actions' },
            el('button', {
                class: 'btn btn-ghost btn-icon-text',
                attrs: { type: 'button', 'data-testid': 'prod-passport-prev-page' },
                disabled: !model.page.hasPrev,
                onClick: () => setOffset(Math.max(0, model.page.offset - model.page.limit))
            }, icon('chevron-left', { size: 14 }), el('span', { text: 'Назад' })),
            el('div', { class: 'prod-passport-page-buttons', attrs: { 'aria-label': 'Страницы отчёта' } },
                pageNumbers.flatMap((pageNumber, index) => [
                    index > 0 && pageNumber - pageNumbers[index - 1] > 1
                        ? el('span', { class: 'prod-passport-page-ellipsis', text: '...' })
                        : null,
                    el('button', {
                        class: ['prod-passport-page-button', pageNumber === currentPage && 'prod-passport-page-button-active'],
                        attrs: {
                            type: 'button',
                            'data-testid': 'prod-passport-page-button',
                            'aria-current': pageNumber === currentPage ? 'page' : null,
                            'aria-label': `Страница ${pageNumber}`
                        },
                        onClick: () => setPage(pageNumber)
                    }, String(pageNumber))
                ])
            ),
            el('button', {
                class: 'btn btn-ghost btn-icon-text',
                attrs: { type: 'button', 'data-testid': 'prod-passport-next-page' },
                disabled: !model.page.hasNext,
                onClick: () => setOffset(model.page.offset + model.page.limit)
            }, el('span', { text: 'Далее' }), icon('chevron-right', { size: 14 }))
        )
    );
}

function renderQuantityValues(row) {
    const inputs = [
        ...(row.inputs.questions || []),
        ...(row.inputs.settings || [])
    ];
    if (!inputs.length) return null;
    return el('div', { class: 'prod-passport-quantity-values' },
        el('span', { class: 'prod-passport-quantity-values-title', text: 'Подставленные значения' }),
        el('div', { class: 'prod-passport-quantity-values-grid' },
            inputs.map(input => el('div', { class: 'prod-passport-quantity-value' },
                el('span', { class: 'prod-passport-quantity-value-label', text: input.label }),
                el('strong', { class: 'prod-passport-quantity-value-number', text: input.valueText }),
                el('span', { class: 'prod-passport-quantity-value-source', text: input.sourceLabel })
            ))
        )
    );
}

function renderQuantityFormula(row) {
    return el('section', {
        class: ['prod-passport-detail-section', 'prod-passport-quantity-section'],
        attrs: { 'data-testid': 'prod-passport-quantity-details' }
    },
        el('h4', { text: 'Как получено количество' }),
        row.errors.length
            ? el('div', {
                class: 'prod-passport-error',
                attrs: { 'data-testid': 'prod-passport-formula-error' },
                text: row.errorText
            })
            : null,
        el('p', { class: 'prod-passport-formula-text', text: row.quantityFormula.text }),
        el('div', { class: 'prod-passport-substitution', attrs: { 'data-testid': 'prod-passport-quantity-calculation' } },
            el('span', { text: 'Расчёт количества' }),
            el('code', { text: row.quantityFormula.substitution })
        ),
        renderQuantityValues(row)
    );
}

function renderCostFormula(row) {
    return el('section', { class: 'prod-passport-detail-section' },
        el('h4', { text: 'Формула стоимости' }),
        el('p', { class: 'prod-passport-formula-label', text: row.costFormula.label }),
        el('code', { class: 'prod-passport-cost-expression', text: row.costFormula.expression }),
        row.costFormula.components.length
            ? el('div', { class: 'prod-passport-cost-components' },
            row.costFormula.components.map(component => el('div', {
                class: 'prod-passport-cost-component',
                title: component.hint
            },
                el('span', { text: component.label }),
                el('strong', { text: component.text })
            ))
        )
            : null
    );
}

function renderDetail(model, selectedItemId) {
    const row = model.items.find(item => item.itemId === selectedItemId) || model.page.items[0] || model.items[0];
    if (!row) {
        return el('section', { class: 'prod-passport-detail' },
            el('div', { class: 'prod-passport-empty', text: 'Выберите ЭК для расшифровки.' })
        );
    }
    return el('section', {
        class: 'prod-passport-detail',
        attrs: { 'data-testid': 'prod-passport-detail' },
        dataset: {
            itemId: row.itemId,
            quantity: String(row.quantity),
            monthlyCost: String(row.monthlyCost),
            annualCost: String(row.annualCost)
        }
    },
        el('div', { class: 'prod-passport-detail-title' },
            el('h3', { text: row.name }),
            renderMarkers(row)
        ),
        renderQuantityFormula(row),
        renderCostFormula(row)
    );
}

function renderStandDisabled(model) {
    return el('section', {
        class: 'prod-passport-stand-disabled',
        attrs: { 'data-testid': 'prod-passport-stand-disabled' }
    },
        icon('alert-triangle', { size: 18 }),
        el('div', null,
            el('strong', { text: 'Паспорт ПРОМ недоступен' }),
            el('p', { text: model.emptyStateMessage })
        )
    );
}

export function buildProdPassportCsv(model) {
    const header = ['ЭК', 'Количество', 'Бюджет/мес., тыс.руб.', '% бюджета'];
    const rows = model.items.map(row => [
        row.name,
        row.quantityText,
        String(moneyThousands(row.monthlyCost)),
        row.budgetShareText
    ]);
    return '\ufeff' + [header, ...rows].map(line => line.map(csvCell).join(';')).join('\r\n');
}

export function buildProdPassportCsvFilename(calcName = 'calculation') {
    const safeName = String(calcName || 'calculation').replace(/[\\/:*?"<>|]+/g, '_');
    return `passport-prod-${safeName}.csv`;
}

export function exportProdPassportCsv(model, calcName = 'calculation') {
    try {
        downloadCsv(buildProdPassportCsvFilename(calcName), buildProdPassportCsv(model));
        return { ok: true };
    } catch (error) {
        console.error('[prodPassportReport] Не удалось скачать CSV Паспорта ПРОМ', error);
        showError('Не удалось скачать CSV Паспорта ПРОМ.');
        return { ok: false, error };
    }
}

export function renderProdPassportReport(calc, result, modalState, ctx) {
    const offset = Math.max(0, Number(modalState?.offset) || 0);
    const model = buildProdPassport(calc, {
        result,
        stand: 'PROD',
        offset,
        limit: PAGE_SIZE,
        topFactorsLimit: 6,
        search: modalState?.search || ''
    });
    const selectedItemId = modalState?.selectedItemId
        || model.page.items[0]?.itemId
        || model.items[0]?.itemId
        || null;

    return el('div', {
        class: 'prod-passport-report',
        attrs: { 'data-testid': 'prod-passport-report' }
    },
        renderSummary(model),
        model.standDisabled
            ? renderStandDisabled(model)
            : [
                el('div', { class: 'prod-passport-workspace' },
                    renderItemList(model, selectedItemId, ctx),
                    renderDetail(model, selectedItemId)
                ),
                el('div', { class: 'prod-passport-actions' },
                    el('button', {
                        class: 'btn btn-secondary btn-icon-text',
                        attrs: { type: 'button', 'data-testid': 'prod-passport-export-csv' },
                        onClick: () => exportProdPassportCsv(model, calc.name)
                    }, icon('file-spreadsheet', { size: 16 }), el('span', { text: 'CSV' }))
                )
            ]
    );
}
