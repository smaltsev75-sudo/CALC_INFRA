import { SENSITIVITY_CATEGORIES } from '../utils/constants.js';
import { formatNumber, formatRub, num } from '../services/format.js';
import { buildRootCauseAnalysisModel } from '../domain/rootCauseAnalysis.js';
import { el } from './dom.js';

function valueText(value) {
    if (typeof value === 'boolean') return value ? 'да' : 'нет';
    if (typeof value === 'number') return num(value);
    if (value === null || value === undefined || value === '') return 'не задано';
    return String(value);
}

function renderAffectedItems(row) {
    if (!row.topAffectedItems.length) {
        return el('span', {
            class: 'root-cause-muted',
            text: 'нет детализированных изменений по ЭК'
        });
    }
    return el('div', { class: 'root-cause-affected-list' },
        ...row.topAffectedItems.map(item =>
            el('div', { class: 'root-cause-affected-item' },
                el('span', { text: item.itemName }),
                el('strong', {
                    text: `${item.savingMonthly >= 0 ? '-' : '+'}${formatRub(Math.abs(item.savingMonthly))}/мес`
                })
            )
        )
    );
}

function renderLinks(row) {
    if (row.directFormulaCount > 0) {
        const names = row.directItemNames.length > 0
            ? `: ${row.directItemNames.join(', ')}`
            : '';
        return `${row.directFormulaCount} формул количества${names}`;
    }
    return 'связь видна после полного пересчёта бюджета';
}

function renderRow(row, index) {
    const categoryLabel = SENSITIVITY_CATEGORIES[row.category] || row.category;
    const action = row.kind === 'numeric'
        ? `${row.actionLabel} и пересчитать бюджет`
        : `${row.actionLabel}: ${valueText(row.currentValue)} → ${valueText(row.proposedValue)}`;

    return el('article', {
        class: 'root-cause-row',
        attrs: { 'data-testid': 'root-cause-row' }
    },
        el('div', { class: 'root-cause-main' },
            el('div', { class: 'root-cause-head' },
                el('span', { class: 'root-cause-rank', text: String(index + 1) }),
                el('div', { class: 'root-cause-title-block' },
                    el('strong', { class: 'root-cause-name', text: row.label }),
                    el('span', { class: 'root-cause-muted', text: categoryLabel })
                )
            )
        ),
        el('div', { class: 'root-cause-saving' },
            el('span', { class: 'root-cause-label', text: 'Влияние на бюджет' }),
            el('strong', { text: `-${formatRub(row.savingMonthly)}/мес` }),
            el('span', { text: `${formatRub(row.savingAnnual)}/год · ${formatNumber(row.savingPercent, { min: 1, max: 1 })}%` })
        ),
        el('div', { class: 'root-cause-action' },
            el('span', { class: 'root-cause-label', text: 'Что меняем для оценки' }),
            el('span', { text: action })
        ),
        el('div', { class: 'root-cause-footprint' },
            el('span', { class: 'root-cause-label', text: 'Влияет на' }),
            el('span', { text: `${row.affectedItemsCount} ЭК в расчёте` })
        ),
        el('details', { class: 'root-cause-details' },
            el('summary', { text: 'Показать связи с ЭК' }),
            el('div', { class: 'root-cause-detail-grid' },
                el('div', { class: 'root-cause-detail-block' },
                    el('span', { class: 'root-cause-detail-label', text: 'Сейчас → для оценки' }),
                    el('span', {
                        class: 'root-cause-detail-text',
                        text: `${valueText(row.currentValue)} → ${valueText(row.proposedValue)}`
                    })
                ),
                el('div', { class: 'root-cause-detail-block' },
                    el('span', { class: 'root-cause-detail-label', text: 'Где используется' }),
                    el('span', { class: 'root-cause-detail-text', text: renderLinks(row) })
                ),
                el('div', { class: 'root-cause-detail-block root-cause-detail-block-wide' },
                    el('span', { class: 'root-cause-detail-label', text: 'ЭК с самым большим изменением бюджета' }),
                    renderAffectedItems(row)
                )
            )
        )
    );
}

export function renderRootCauseReportContent(calculation, result, disabledStands = [], options = {}) {
    const model = buildRootCauseAnalysisModel(calculation, {
        ...options,
        result,
        disabledStands
    });
    if (model.rows.length === 0) return null;

    return el('section', {
        class: 'root-cause-report',
        attrs: { 'data-testid': 'root-cause-report' }
    },
        el('div', { class: 'root-cause-summary' },
            el('span', { text: `Top-${model.shown} корневых причин, влияющих на расчёт и бюджет.` }),
            el('span', {
                text: `Расчёт эффекта: фактор с числом временно уменьшен на ${model.numericReductionPct}%; фактор да/нет временно переключён.`
            })
        ),
        el('div', { class: 'root-cause-list' },
            ...model.rows.map(renderRow)
        )
    );
}
