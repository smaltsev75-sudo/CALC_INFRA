import { buildProdPassport } from '../domain/prodPassport.js';
import { csvSafeQuote, downloadCsv } from '../services/csvExport.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { error as showError } from './snackbar.js';

const PAGE_SIZE = 10;

function moneyThousands(value) {
    const n = Number(value) || 0;
    return Math.round(n / 1000);
}

const csvCell = value => csvSafeQuote(value, ';');

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
            ),
            renderSummaryCard(
                'По умолчанию',
                String(model.summary.defaultItemsCount),
                'Сколько ЭК в расчёте использовали хотя бы одно значение по умолчанию.',
                'prod-passport-summary-defaults'
            ),
            renderSummaryCard(
                'Автоисправлено',
                String(model.summary.repairedItemsCount),
                'Сколько ЭК используют значения, исправленные при загрузке JSON.',
                'prod-passport-summary-repaired'
            ),
            renderSummaryCard(
                'Предупреждения',
                String(model.summary.warningItemsCount),
                'Сколько ЭК имеют замечания к формуле или исходным значениям.',
                'prod-passport-summary-warnings'
            )
        ),
        renderTopFactors(model)
    );
}

function renderTopFactors(model) {
    const factors = model.summary.topFactors || [];
    return el('div', {
        class: 'prod-passport-factors',
        attrs: { 'data-testid': 'prod-passport-top-factors' }
    },
        el('div', { class: 'prod-passport-subtitle', text: 'Что сильнее всего повлияло на бюджет ПРОМ' }),
        el('div', {
            class: 'prod-passport-factor-note',
            text: 'Показатели пересекаются между факторами: один ЭК может зависеть от нескольких ответов, поэтому проценты не суммируются к 100%.'
        }),
        factors.length === 0
            ? el('div', { class: 'prod-passport-empty', text: 'Нет факторов с заметным охватом.' })
            : el('div', { class: 'prod-passport-factor-table' },
                el('div', { class: 'prod-passport-factor-head' },
                    el('span', { text: 'Фактор' }),
                    el('span', { text: 'Связанные ЭК, тыс.руб./мес.' }),
                    el('span', { text: 'Охват бюджета' })
                ),
                factors.map(factor => el('div', {
                    class: 'prod-passport-factor-row',
                    dataset: {
                        fieldId: factor.fieldId,
                        monthlyImpact: String(factor.monthlyImpact),
                        coverage: String(factor.coveragePercent)
                    }
                },
                    el('span', { class: 'prod-passport-factor-name', text: factor.label }),
                    el('span', { class: 'prod-passport-factor-money', text: String(moneyThousands(factor.monthlyImpact)) }),
                    el('span', { class: 'prod-passport-factor-share', text: factor.coverageText })
                ))
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
    return el('section', {
        class: 'prod-passport-list',
        attrs: { 'data-testid': 'prod-passport-item-list' }
    },
        el('div', { class: 'prod-passport-section-title' }, 'ЭК ПРОМ'),
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
            ? el('div', { class: 'prod-passport-empty', text: 'Для ПРОМ нет ЭК с количеством или бюджетом.' })
            : model.page.items.map(row => renderItemRow(row, row.itemId === selectedItemId, ctx)),
        renderPager(model, ctx)
    );
}

function renderPager(model, ctx) {
    const from = model.page.total === 0 ? 0 : model.page.offset + 1;
    const to = Math.min(model.page.offset + model.page.items.length, model.page.total);
    const setOffset = nextOffset => {
        const selectedItemId = model.items[nextOffset]?.itemId || model.page.items[0]?.itemId || null;
        ctx.patchModal('prodPassport', { offset: nextOffset, selectedItemId });
    };
    return el('div', { class: 'prod-passport-pager' },
        el('span', { text: `${from}-${to} из ${model.page.total}` }),
        el('div', { class: 'prod-passport-pager-actions' },
            el('button', {
                class: 'btn btn-ghost btn-icon-text',
                attrs: { type: 'button', 'data-testid': 'prod-passport-prev-page' },
                disabled: !model.page.hasPrev,
                onClick: () => setOffset(Math.max(0, model.page.offset - model.page.limit))
            }, icon('chevron-left', { size: 14 }), el('span', { text: 'Назад' })),
            el('button', {
                class: 'btn btn-ghost btn-icon-text',
                attrs: { type: 'button', 'data-testid': 'prod-passport-next-page' },
                disabled: !model.page.hasNext,
                onClick: () => setOffset(model.page.offset + model.page.limit)
            }, el('span', { text: 'Следующие 10' }), icon('chevron-right', { size: 14 }))
        )
    );
}

function renderResultBlock(row) {
    return el('div', { class: 'prod-passport-detail-result' },
        el('div', { class: 'prod-passport-kv' },
            el('span', { text: 'Количество' }),
            el('strong', { text: row.quantityText })
        ),
        el('div', { class: 'prod-passport-kv' },
            el('span', { text: 'Бюджет' }),
            el('strong', { text: row.monthlyText })
        ),
        el('div', { class: 'prod-passport-kv' },
            el('span', { text: 'Год' }),
            el('strong', { text: row.annualText })
        ),
        el('div', { class: 'prod-passport-kv' },
            el('span', { text: 'Доля бюджета' }),
            el('strong', { text: row.budgetShareText })
        )
    );
}

function renderQuantityFormula(row) {
    return el('section', { class: 'prod-passport-detail-section' },
        el('h4', { text: 'Как получено количество' }),
        row.errors.length
            ? el('div', {
                class: 'prod-passport-error',
                attrs: { 'data-testid': 'prod-passport-formula-error' },
                text: row.errorText
            })
            : null,
        el('p', { class: 'prod-passport-formula-text', text: row.quantityFormula.text }),
        el('div', { class: 'prod-passport-substitution' },
            el('span', { text: 'Подстановка' }),
            el('code', { text: row.quantityFormula.substitution })
        ),
        el('details', { class: 'prod-passport-technical' },
            el('summary', { text: 'Техническая формула' }),
            el('code', { text: row.quantityFormula.technical || 'не задано' })
        )
    );
}

function renderInputsTable(row) {
    const inputs = [
        ...(row.inputs.questions || []),
        ...(row.inputs.settings || [])
    ];
    return el('section', { class: 'prod-passport-detail-section' },
        el('h4', { text: 'Что повлияло' }),
        inputs.length === 0
            ? el('div', { class: 'prod-passport-empty', text: 'В формуле нет ссылок на ответы или параметры расчёта.' })
            : el('div', { class: 'prod-passport-input-table' },
                el('div', { class: 'prod-passport-input-head' },
                    el('span', { text: 'Параметр' }),
                    el('span', { text: 'Значение' }),
                    el('span', { text: 'Источник значения' }),
                    el('span', { text: 'Техническая ссылка' })
                ),
                inputs.map(input => el('div', { class: 'prod-passport-input-row' },
                    el('span', { text: input.label }),
                    el('span', { text: input.valueText }),
                    el('span', { text: input.sourceLabel }),
                    el('details', { class: 'prod-passport-tech-ref' },
                        el('summary', { text: 'Показать' }),
                        el('code', { text: input.technicalRef })
                    )
                ))
            )
    );
}

function renderCostFormula(row) {
    return el('section', { class: 'prod-passport-detail-section' },
        el('h4', { text: 'Формула стоимости' }),
        el('p', { class: 'prod-passport-formula-label', text: row.costFormula.label }),
        el('code', { class: 'prod-passport-cost-expression', text: row.costFormula.expression }),
        el('div', { class: 'prod-passport-cost-components' },
            row.costFormula.components.map(component => el('div', {
                class: 'prod-passport-cost-component',
                title: component.hint
            },
                el('span', { text: component.label }),
                el('strong', { text: component.text })
            ))
        )
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
        renderResultBlock(row),
        renderQuantityFormula(row),
        renderInputsTable(row),
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
        topFactorsLimit: 6
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
