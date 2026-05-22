/**
 * Stage 14.5 (PATCH 2.7.3) — Cross-Provider Scenario Comparison модалка.
 *
 * Для активного расчёта показывает таблицу: rows = items внутри active calc,
 * columns = выбранные провайдеры. Каждая ячейка содержит totalMonthly за этот
 * item ЕСЛИ БЫ расчёт работал на этом провайдере. Дельты считаются от текущего
 * провайдера (calc.settings.provider).
 *
 * Не путать с `providerAnalyticsModal` — там провайдеры × категории (глобально,
 * без привязки к calc); здесь — items × провайдеры (calc-specific).
 *
 * Источник данных:
 *   - ctx.listActiveProvidersForComparison() → Array<{ id, label }>
 *   - ctx.getCalcCrossProviderComparison(providerIds) →
 *       { currentProviderId, providers: Array<{ id, label, totalMonthly,
 *         deltaAbs, deltaPct, perItem: Array<{...}> }> }
 *   - ctx.setScenarioComparisonSelectedProviders(providerIds) → persist.
 *
 * UX:
 *   - Чекбоксы вверху: какие провайдеры показывать (по дефолту — все active).
 *   - Текущий провайдер выделен бейджем «Текущий»; deltaAbs всегда 0.
 *   - Footer-row «ИТОГО» — totalMonthly расчёта на каждом провайдере.
 *   - Дельты per-item рендерятся через delta-pill (тот же стиль что в analytics).
 */

import { el } from '../dom.js';
import { icon } from '../icons.js';
import { modalShell } from './baseModal.js';
import { formatNumber, formatPercentPoints } from '../../services/format.js';

const fmtRub = (n) => {
    const num = Number(n);
    if (!Number.isFinite(num)) return '—';
    return formatNumber(Math.round(num), { min: 0, max: 0 });
};

const fmtPct = (pct) => {
    if (!Number.isFinite(pct) || pct === 0) return null;
    const abs = Math.abs(pct);
    return formatPercentPoints(pct, { min: abs >= 10 ? 0 : 1, max: abs >= 10 ? 0 : 1 });
};

/* Threshold delta-pill — float-noise filter (≤0.5 копейки = «нет дельты»). */
const EPSILON_KOPECK = 0.005;

function _renderDeltaPill(deltaAbs, deltaPct) {
    if (!Number.isFinite(deltaAbs) || Math.abs(deltaAbs) < EPSILON_KOPECK) return null;
    const pillText = fmtPct(deltaPct);
    if (!pillText) return null;
    return el('span', {
        class: ['delta-pill', deltaAbs > 0 ? 'delta-pill--up' : 'delta-pill--down'],
        attrs: {
            title: `Δ ${deltaAbs > 0 ? '+' : '−'}${fmtRub(Math.abs(deltaAbs))} ₽/мес (${pillText}) относительно текущего провайдера.`
        },
        text: pillText
    });
}

export function renderProviderScenarioComparisonModal(state, ctx) {
    const m = state.modals.scenarioComparison;
    if (!m?.open) return null;

    const close = () => ctx.closeModal('scenarioComparison');

    const allActive = typeof ctx.listActiveProvidersForComparison === 'function'
        ? ctx.listActiveProvidersForComparison() : [];
    const allActiveIds = allActive.map(p => p.id);

    const selectedProviderIds = Array.isArray(m.selectedProviderIds)
        ? m.selectedProviderIds.filter(id => allActiveIds.includes(id))
        : allActiveIds;

    const data = typeof ctx.getCalcCrossProviderComparison === 'function'
        ? ctx.getCalcCrossProviderComparison(selectedProviderIds)
        : { currentProviderId: null, providers: [] };

    const currentProviderId = data.currentProviderId;
    const visibleProviders = data.providers || [];

    const toggleProvider = (id) => {
        const next = selectedProviderIds.includes(id)
            ? selectedProviderIds.filter(x => x !== id)
            : [...selectedProviderIds, id];
        ctx.patchModal('scenarioComparison', { selectedProviderIds: next });
        if (typeof ctx.setScenarioComparisonSelectedProviders === 'function') {
            ctx.setScenarioComparisonSelectedProviders(next);
        }
    };

    /* Filter-bar: чекбоксы для каждого active провайдера. */
    const filterBar = el('div', { class: 'scenario-cmp-filter',
        attrs: { role: 'group', 'aria-label': 'Фильтр провайдеров' } },
        el('span', { class: 'scenario-cmp-filter-label', text: 'Провайдеры:' }),
        ...allActive.map(p => {
            const checked = selectedProviderIds.includes(p.id);
            const isCurrent = p.id === currentProviderId;
            return el('label', {
                class: ['scenario-cmp-filter-item',
                        checked && 'is-checked',
                        isCurrent && 'is-current']
            },
                el('input', {
                    type: 'checkbox',
                    checked,
                    attrs: { 'aria-label': `Показать ${p.label}` },
                    onChange: () => toggleProvider(p.id)
                }),
                el('span', { class: 'scenario-cmp-filter-label-text', text: p.label }),
                isCurrent
                    ? el('span', { class: 'scenario-cmp-filter-current-badge',
                        attrs: { title: 'Текущий провайдер этого расчёта.' },
                        text: 'Текущий' })
                    : null
            );
        })
    );

    /* PATCH 2.7.3 hotfix: подсказка переписана на бизнес-язык — без техжаргона
       (totalMonthly / baseline / effective overlay / frozen / applied override). */
    const hintText = 'Сколько составили бы месячные расходы по этому расчёту, если бы он работал на другом провайдере. Цифры по текущему провайдеру — точка отсчёта; рядом с другими провайдерами показано, насколько они дороже или дешевле в %. Учитываются последние применённые тарифы (с обновлениями).';

    /* Empty-state: нет выбранных провайдеров. */
    if (visibleProviders.length === 0) {
        return modalShell({
            title: 'Сравнить расчёт по провайдерам',
            size: 'lg',
            onClose: close,
            children: el('div', { class: 'scenario-cmp-body' },
                el('p', { class: 'scenario-cmp-hint', text: hintText }),
                filterBar,
                el('div', { class: 'scenario-cmp-empty',
                    text: 'Не выбрано ни одного провайдера. Отметьте выше хотя бы одного.' })
            ),
            footer: el('div', { class: 'modal-footer-actions' },
                el('button', { class: 'btn btn-primary', onClick: close }, 'Закрыть')
            )
        });
    }

    /* Items list — берём из baseline (current provider) для row-headers. Если
       currentProviderId не в visibleProviders — берём первого.
       PATCH 2.7.3 hotfix: сортируем по убыванию суммы baseline'а — крупные
       статьи расходов сверху (`feedback_sort_descending`). */
    const baselineProv = visibleProviders.find(p => p.id === currentProviderId)
        || visibleProviders[0];
    const items = [...(baselineProv?.perItem || [])]
        .sort((a, b) => (Number(b.totalMonthly) || 0) - (Number(a.totalMonthly) || 0));

    /* Map: providerId → Map<itemId, perItem> для O(1) lookup'а. */
    const itemMapByProvider = new Map();
    for (const p of visibleProviders) {
        const m2 = new Map();
        for (const it of p.perItem) m2.set(it.itemId, it);
        itemMapByProvider.set(p.id, m2);
    }

    /* THEAD: 2 ряда — column headers + ИТОГО (оба sticky при vertical scroll).
       PATCH 2.7.3 hotfix:
       — единая ед.изм. «₽/мес» для ВСЕХ провайдеров (раньше для текущего
         была «базовая» — пользователь не понимал, в каких единицах число);
       — ИТОГО переехало из <tfoot> в <thead> (PATCH details-table 12.U27)
         как первая «информационная» строка. Sticky thead вместе с ним
         удерживается при scroll'е tbody. */
    const thead = el('thead', null,
        el('tr', { class: 'scenario-cmp-thead-row-headers' },
            el('th', { class: 'scenario-cmp-th-item', text: 'Статья расходов' }),
            ...visibleProviders.map(p => el('th', {
                class: ['scenario-cmp-th-provider',
                        p.id === currentProviderId && 'is-current']
            },
                el('span', null,
                    el('span', { class: 'scenario-cmp-th-provider-name', text: p.label }),
                    el('span', { class: 'scenario-cmp-th-provider-unit', text: '₽/мес' })
                )
            ))
        ),
        el('tr', { class: 'scenario-cmp-thead-row-totals' },
            el('td', { class: 'scenario-cmp-td-item-total', text: 'ИТОГО / мес' }),
            ...visibleProviders.map(p => {
                const isBaseline = p.id === currentProviderId;
                return el('td', { class: ['scenario-cmp-td-cell-total',
                                          isBaseline && 'is-baseline'] },
                    el('span', { class: 'scenario-cmp-num-total',
                        text: fmtRub(p.totalMonthly) }),
                    isBaseline ? null : _renderDeltaPill(p.deltaAbs, p.deltaPct)
                );
            })
        )
    );

    /* TBODY: для каждого item — name + cells по провайдерам */
    const tbody = el('tbody', null,
        ...items.map(it => el('tr', { class: 'scenario-cmp-row' },
            el('td', { class: 'scenario-cmp-td-item',
                attrs: { title: it.name } },
                el('span', { class: 'scenario-cmp-td-item-name', text: it.name })
            ),
            ...visibleProviders.map(p => {
                const cell = itemMapByProvider.get(p.id)?.get(it.itemId);
                if (!cell) {
                    return el('td', { class: 'scenario-cmp-td-cell', text: '—' });
                }
                const isBaseline = p.id === currentProviderId;
                return el('td', { class: ['scenario-cmp-td-cell',
                                          isBaseline && 'is-baseline'] },
                    el('span', { class: 'scenario-cmp-num',
                        text: fmtRub(cell.totalMonthly) }),
                    isBaseline ? null : _renderDeltaPill(cell.deltaAbs, cell.deltaPct)
                );
            })
        ))
    );

    /* ИТОГО переехало в thead 2-й строкой (для sticky-поведения, см. выше). */
    const table = el('table', { class: 'scenario-cmp-table' }, thead, tbody);

    const wrap = el('div', { class: 'scenario-cmp-table-wrap' }, table);

    return modalShell({
        title: 'Сравнить расчёт по провайдерам',
        size: 'lg',
        onClose: close,
        children: el('div', { class: 'scenario-cmp-body' },
            el('p', { class: 'scenario-cmp-hint', text: hintText }),
            filterBar,
            wrap
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', { class: 'btn btn-primary', onClick: close }, 'Закрыть')
        )
    });
}
