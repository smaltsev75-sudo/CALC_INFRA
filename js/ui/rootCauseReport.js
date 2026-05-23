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
        return `${row.directFormulaCount} формул${names}`;
    }
    return 'влияние видно через пересчёт бюджета';
}

function renderRow(row, index) {
    const categoryLabel = SENSITIVITY_CATEGORIES[row.category] || row.category;
    const action = row.kind === 'numeric'
        ? row.actionLabel
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
            el('strong', { text: `-${formatRub(row.savingMonthly)}/мес` }),
            el('span', { text: `${formatRub(row.savingAnnual)}/год · ${formatNumber(row.savingPercent, { min: 1, max: 1 })}%` })
        ),
        el('div', { class: 'root-cause-action' },
            el('span', { class: 'root-cause-label', text: 'Проверка' }),
            el('span', { text: action })
        ),
        el('div', { class: 'root-cause-footprint' },
            el('span', { class: 'root-cause-label', text: 'Затрагивает' }),
            el('span', { text: `${row.affectedItemsCount} ЭК` })
        ),
        el('details', { class: 'root-cause-details' },
            el('summary', { text: 'Связи и изменения' }),
            el('div', { class: 'root-cause-detail-grid' },
                el('div', { class: 'root-cause-detail-block' },
                    el('span', { class: 'root-cause-detail-label', text: 'Значение' }),
                    el('span', {
                        class: 'root-cause-detail-text',
                        text: `${valueText(row.currentValue)} → ${valueText(row.proposedValue)}`
                    })
                ),
                el('div', { class: 'root-cause-detail-block' },
                    el('span', { class: 'root-cause-detail-label', text: 'Прямая связь' }),
                    el('span', { class: 'root-cause-detail-text', text: renderLinks(row) })
                ),
                el('div', { class: 'root-cause-detail-block root-cause-detail-block-wide' },
                    el('span', { class: 'root-cause-detail-label', text: 'Больше всего меняются' }),
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
            el('span', { text: `Показаны ${model.shown} главных причин оптимизации бюджета.` }),
            el('span', { text: `Числовые параметры проверены снижением на ${model.numericReductionPct}%.` })
        ),
        el('div', { class: 'root-cause-list' },
            ...model.rows.map(renderRow)
        )
    );
}
