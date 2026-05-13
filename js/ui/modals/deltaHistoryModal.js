/**
 * Stage 10.3 + 14.4 (PATCH 2.7.2): модалка «История прайсов» в формате
 * multi-provider accordion'а. Каждый активный провайдер с историей (current
 * override и/или ≥1 snapshot) — отдельный раскрываемый блок. Внутри блока —
 * привычная per-provider история: current + до 3 snapshot'ов с delta-summary
 * и rollback кнопками.
 *
 * Источник данных:
 *   - ctx.getAllProvidersWithHistory()                → Array<{ id, label,
 *                                                       hasCurrentOverride,
 *                                                       historyCount }>
 *   - ctx.getCurrentProviderOverride(providerId)      → applied JSON или null
 *   - ctx.getProviderOverrideHistory(providerId)      → Array<{appliedJSON, appliedAt}>
 *   - ctx.restoreProviderOverrideAt(triggerEvent, providerId, idx) → action
 *   - ctx.setDeltaHistoryProviderExpanded(providerId, isExpanded) → toggle + persist
 *
 * State:
 *   - state.modals.deltaHistory.providerId  — preselected (auto-expand при
 *                                              первом open'е если expandedIds=null)
 *   - state.modals.deltaHistory.expandedIds — string[] | null. null = «не
 *                                              сохранено» → UI дефолт = [providerId].
 *
 * UX:
 *   - Header строка provider'а: button с chevron + label + counter «N версий»
 *     (current + history.length).
 *   - На expand: рендерятся row'ы — current сверху, history newest first.
 *     Кнопки rollback ТОЛЬКО для исторических точек, не для current.
 *   - Empty-state: provider'ы без истории не показываются вообще.
 *     Если ВСЕХ провайдеров пусто — единый текст «Истории прайсов нет».
 */

import { el } from '../dom.js';
import { icon } from '../icons.js';
import { modalShell } from './baseModal.js';
import { formatTimeAgo } from '../../services/format.js';
import { computePricesDelta } from '../../domain/calcVersioning.js';

/* Stage 14.2 (PATCH 2.7.1): денежный форматтер для tooltip'а delta-pill —
   унифицирован с другими модалками. */
const fmtRub = (n) => {
    const num = Number(n);
    if (!Number.isFinite(num)) return '—';
    return Math.round(num).toLocaleString('ru-RU').replace(/,/g, ' ');
};

const fmtPct = (pct) => {
    const abs = Math.abs(pct);
    const rounded = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
    return (pct > 0 ? '+' : '−') + rounded + '%';
};

/* Per-provider тело accordion-блока: current row + history rows + delta-summary.
   Та же логика рендера, что была до Stage 14.4 — выделена в отдельную функцию. */
function _renderProviderBody(providerId, ctx) {
    const currentOverride = ctx.getCurrentProviderOverride
        ? ctx.getCurrentProviderOverride(providerId)
        : null;
    const history = ctx.getProviderOverrideHistory
        ? ctx.getProviderOverrideHistory(providerId)
        : [];

    const points = [];
    if (currentOverride) {
        points.push({
            label: 'Текущий',
            json: currentOverride,
            appliedAt: null,
            historyIdx: null
        });
    }
    for (let i = 0; i < history.length; i++) {
        const h = history[i];
        points.push({
            label: `История ${i + 1}`,
            json: h?.appliedJSON || null,
            appliedAt: h?.appliedAt || null,
            historyIdx: i
        });
    }

    if (points.length === 0) {
        /* Не должно случиться: getAllProvidersWithHistory отфильтровал бы
           этого провайдера. Но защитный fallback на случай race-condition. */
        return el('div', { class: 'delta-history-row-summary',
            text: 'Нет истории для этого провайдера.' });
    }

    const rows = points.map((pt, i) => {
        if (!pt.json) return null;
        const next = points[i + 1];
        /* delta = что изменилось от next.prices к pt.prices (более старая → более новая). */
        const delta = next?.json
            ? computePricesDelta(next.json.prices, pt.json.prices)
            : null;

        const headerLine = el('div', { class: 'delta-history-row-header' },
            el('span', { class: 'delta-history-row-version',
                text: `${pt.label} · ${pt.json.version || '—'}` }),
            pt.appliedAt
                ? el('span', { class: 'delta-history-row-time',
                    title: pt.appliedAt,
                    text: formatTimeAgo(pt.appliedAt) || pt.appliedAt })
                : el('span', { class: 'delta-history-row-time-current',
                    text: '(применён сейчас)' })
        );

        const summaryLine = delta
            ? el('div', { class: 'delta-history-row-summary' },
                el('span', { class: 'delta-history-row-summary-stat',
                    text: `Изменено: ${delta.itemsChanged}` }),
                delta.itemsAdded > 0
                    ? el('span', { class: 'delta-history-row-summary-stat',
                        text: ` · добавлено: ${delta.itemsAdded}` })
                    : null,
                delta.itemsRemoved > 0
                    ? el('span', { class: 'delta-history-row-summary-stat',
                        text: ` · удалено: ${delta.itemsRemoved}` })
                    : null
            )
            : el('div', { class: 'delta-history-row-summary',
                text: 'Базовая точка истории (нет более старой для сравнения).' });

        /* Stage 14.2 (PATCH 2.7.1): унифицированный tooltip — «Старая X ₽ → Новая Y ₽ (Δ%)». */
        const topChanges = delta
            ? el('div', { class: 'delta-history-row-top' },
                ...delta.topUp.map(d => el('span', {
                    class: ['delta-pill', 'delta-pill--up'],
                    title: `${d.id}: Старая ${fmtRub(d.oldPrice)} ₽ → Новая ${fmtRub(d.newPrice)} ₽ (${fmtPct(d.deltaPct)})`,
                    text: `↑ ${d.id} ${fmtPct(d.deltaPct)}`
                })),
                ...delta.topDown.map(d => el('span', {
                    class: ['delta-pill', 'delta-pill--down'],
                    title: `${d.id}: Старая ${fmtRub(d.oldPrice)} ₽ → Новая ${fmtRub(d.newPrice)} ₽ (${fmtPct(d.deltaPct)})`,
                    text: `↓ ${d.id} ${fmtPct(d.deltaPct)}`
                }))
            )
            : null;

        const rollbackBtn = pt.historyIdx !== null
            ? el('button', {
                class: ['btn', 'btn-secondary', 'delta-history-row-rollback'],
                attrs: {
                    type: 'button',
                    title: `Откатить overlay на ${pt.json.version}. Текущий и более новые точки истории будут удалены.`
                },
                onClick: e => {
                    if (typeof ctx.restoreProviderOverrideAt === 'function') {
                        ctx.restoreProviderOverrideAt(e, providerId, pt.historyIdx);
                    }
                }
            },
                icon('rotate-ccw', { size: 14 }),
                el('span', { text: `Откатить на ${pt.json.version}` })
            )
            : null;

        return el('div', { class: ['delta-history-row',
                                   pt.historyIdx === null && 'delta-history-row--current'] },
            headerLine,
            summaryLine,
            topChanges,
            rollbackBtn
        );
    }).filter(Boolean);

    return el('div', { class: 'delta-history-accordion-body' }, ...rows);
}

export function renderDeltaHistoryModal(state, ctx) {
    const m = state.modals.deltaHistory;
    if (!m?.open) return null;

    const close = () => ctx.closeModal('deltaHistory');

    const providers = typeof ctx.getAllProvidersWithHistory === 'function'
        ? ctx.getAllProvidersWithHistory()
        : [];

    /* Stage 14.4: дефолт expandedIds. Если пользователь явно сохранил пустой
       массив — accordion полностью свёрнут (массив есть, но пустой). Если
       expandedIds === null → авто-раскрываем preselected providerId (тот, что
       пришёл из per-provider кнопки «История»). */
    const providerId = m.providerId;
    const expandedIds = Array.isArray(m.expandedIds)
        ? m.expandedIds
        : (providerId ? [providerId] : []);
    const expandedSet = new Set(expandedIds);

    /* Empty-state — никто не имеет истории. */
    if (providers.length === 0) {
        return modalShell({
            title: 'История прайсов',
            onClose: close,
            children: el('div', { class: 'delta-history-body' },
                el('div', { class: 'delta-history-empty',
                    text: 'Истории прайсов нет: ни один активный провайдер пока не получал обновлений.' })
            ),
            footer: el('div', { class: 'modal-footer-actions' },
                el('button', { class: 'btn btn-primary', onClick: close }, 'Закрыть')
            )
        });
    }

    const accordionRows = providers.map(p => {
        const isExpanded = expandedSet.has(p.id);
        const versionsCount = (p.hasCurrentOverride ? 1 : 0) + p.historyCount;
        const counterText = `${versionsCount} ${versionsCount === 1 ? 'версия' : (versionsCount < 5 ? 'версии' : 'версий')}`;

        const toggle = el('button', {
            class: ['delta-history-accordion-toggle',
                    isExpanded && 'delta-history-accordion-toggle--expanded'],
            attrs: {
                type: 'button',
                'aria-expanded': isExpanded ? 'true' : 'false',
                title: isExpanded ? 'Свернуть' : 'Раскрыть'
            },
            onClick: () => {
                if (typeof ctx.setDeltaHistoryProviderExpanded === 'function') {
                    ctx.setDeltaHistoryProviderExpanded(p.id, !isExpanded);
                }
            }
        },
            icon(isExpanded ? 'chevron-down' : 'chevron-right', { size: 16 }),
            el('span', { class: 'delta-history-accordion-label', text: p.label }),
            el('span', { class: 'delta-history-accordion-counter', text: counterText })
        );

        return el('div', { class: ['delta-history-accordion-row',
                                   isExpanded && 'delta-history-accordion-row--expanded'] },
            toggle,
            isExpanded ? _renderProviderBody(p.id, ctx) : null
        );
    });

    return modalShell({
        title: 'История прайсов',
        size: 'lg',
        onClose: close,
        children: el('div', { class: 'delta-history-body' },
            el('p', { class: 'delta-history-hint',
                text: 'Каждая точка — отдельная версия прайса. «Изменено / добавлено / удалено» — что изменилось относительно более старой точки. Откат восстанавливает выбранную версию и отбрасывает все более новые.' }),
            ...accordionRows
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', { class: 'btn btn-primary', onClick: close }, 'Закрыть')
        )
    });
}
