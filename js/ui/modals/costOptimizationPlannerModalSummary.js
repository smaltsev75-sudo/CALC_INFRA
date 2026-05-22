import { el } from './../dom.js';
import {
    PERIOD_IDS,
    PERIOD_LABELS,
    DEFAULT_PERIOD
} from '../../utils/constants.js';
import {
    formatRubPeriod,
    periodMul
} from './costOptimizationPlannerModalFormat.js';

/* ============================================================
 * Summary preview
 * ============================================================ */

export function renderSummary(m, ctx) {
    const draft = m.draft;
    const preview = draft.preview || null;
    const changesCount = Object.keys(draft.changes || {}).length;
    const viewPeriod = PERIOD_IDS.includes(m.viewPeriod) ? m.viewPeriod : DEFAULT_PERIOD;
    if (!preview) {
        return el('section', { class: 'cop-modal-section cop-modal-summary' },
            el('p', { class: 'cop-modal-section-hint', text: 'Расчёт preview…' })
        );
    }
    if (preview.error) {
        return el('section', { class: 'cop-modal-section cop-modal-summary cop-modal-summary-error' },
            el('h4', { class: 'cop-modal-section-title', text: 'Итог' }),
            el('p', { class: 'cop-modal-summary-error-line',
                text: 'Не удалось пересчитать черновик. Проверьте значения.' })
        );
    }

    const mul = periodMul(viewPeriod);
    const range = preview.targetRange;
    const inRange = preview.inTargetRange;
    /* savingPercent — инвариантен относительно period (отношение). */
    const percentStr = preview.savingPercent.toFixed(1) + '%';
    const savingStr = formatRubPeriod(preview.savingMonthly * mul, viewPeriod);
    const beforeStr = formatRubPeriod(preview.beforeTotalMonthly * mul, viewPeriod);
    const afterStr  = formatRubPeriod(preview.afterTotalMonthly * mul, viewPeriod);

    let statusText;
    let statusCls;
    if (changesCount === 0) {
        statusText = 'Изменений пока нет.';
        statusCls = 'cop-summary-status-empty';
    } else if (inRange) {
        statusText = `Попадает в диапазон ${range.minPercent}–${range.maxPercent}%.`;
        statusCls = 'cop-summary-status-in-range';
    } else if (preview.savingPercent < range.minPercent) {
        statusText = `Пока ${percentStr} — ниже цели ${range.minPercent}–${range.maxPercent}%. Добавьте рычаги.`;
        statusCls = 'cop-summary-status-below';
    } else {
        statusText = `${percentStr} выше верхней границы ${range.maxPercent}%. Возможно, выбранные изменения ближе к следующему уровню.`;
        statusCls = 'cop-summary-status-above';
    }

    return el('section', { class: 'cop-modal-section cop-modal-summary',
        attrs: { 'aria-label': 'Итог черновика' } },
        el('div', { class: 'cop-summary-header' },
            el('h4', { class: 'cop-modal-section-title', text: 'Итог' }),
            renderPeriodSwitcher(viewPeriod, ctx)
        ),
        el('div', { class: 'cop-summary-cards' },
            renderSummaryCard('Текущая стоимость', beforeStr, 'cop-summary-card-before'),
            renderSummaryCard('После изменений',   afterStr,  'cop-summary-card-after'),
            renderSummaryCard('Экономия',
                changesCount === 0 ? '—' : `−${savingStr}`,
                'cop-summary-card-saving',
                changesCount === 0 ? null : `${percentStr} от текущей`)
        ),
        el('p', { class: ['cop-summary-status', statusCls], text: statusText }),
        el('p', { class: 'cop-summary-meta',
            text: `Изменено параметров: ${changesCount}` })
    );
}

/* Сегментный переключатель периода (день / месяц / год) — управляет ТОЛЬКО
   отображением сумм в карточках Итога. Не трогает draft и не синхронизируется
   с period дашборда: модалка — отдельный scope, пользователь может смотреть
   экономию в год, оставаясь на месячном дашборде. */
function renderPeriodSwitcher(currentPeriod, ctx) {
    return el('div', { class: 'cop-summary-period', attrs: { role: 'group',
        'aria-label': 'Период отображения сумм' } },
        ...PERIOD_IDS.map(p => el('button', {
            class: ['cop-summary-period-btn', p === currentPeriod && 'is-active'],
            attrs: {
                type: 'button',
                'aria-pressed': p === currentPeriod ? 'true' : 'false',
                title: `Показывать суммы ${PERIOD_LABELS[p]}`
            },
            onClick: () => { if (p !== currentPeriod) ctx.setOptimizationViewPeriod?.(p); }
        }, PERIOD_LABELS[p]))
    );
}

function renderSummaryCard(label, value, cls, sub = null) {
    return el('div', { class: ['cop-summary-card', cls] },
        el('div', { class: 'cop-summary-card-label', text: label }),
        el('div', { class: 'cop-summary-card-value', text: value }),
        sub ? el('div', { class: 'cop-summary-card-sub', text: sub }) : null
    );
}
