/**
 * Stage 15.3 — Модалка «Анализ чувствительности».
 *
 * Отвечает на вопрос: «Какие параметры сильнее всего влияют на OPEX/CAPEX/итог?»
 *
 * Структура:
 *   1. Переключатель cost-type (OPEX / CAPEX / Итого).
 *   2. Фильтр по категориям (chips: Инфраструктура, Данные, AI, Риски, ...).
 *   3. Ранжированный список драйверов (ranked drivers): карточки с abs-дельтой.
 *   4. Секция N/A (поля, для которых анализ невозможен).
 *   5. Footer: кнопка «Закрыть».
 *
 * Кэш анализа keyed по calcRevision — фильтрация/сортировка не запускает
 * повторный перебор всех полей, только re-rank из кешированного results[].
 *
 * Layer compliance: не импортирует из controllers/ или state/.
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';
import {
    runSensitivityAnalysis,
    rankSensitivityDrivers
} from '../../domain/sensitivityAnalysis.js';
import {
    SENSITIVITY_CATEGORIES,
    SENSITIVITY_CATEGORY_ORDER,
    DEFAULT_SENSITIVITY_FILTERS
} from '../../utils/constants.js';

/* ============================================================
 * Кэш анализа (module-scope, keyed by calcRevision)
 * ============================================================ */

let _cachedRevision = null;
let _cachedAnalysis = null; // { results, notAvailable }

function getOrRunAnalysis(calc) {
    const rev = calc?.calcRevision ?? null;
    if (rev !== null && rev === _cachedRevision && _cachedAnalysis) {
        return _cachedAnalysis;
    }
    _cachedRevision = rev;
    _cachedAnalysis = runSensitivityAnalysis(calc);
    return _cachedAnalysis;
}

/* ============================================================
 * Форматирование чисел
 * ============================================================ */

function fmtMoney(v) {
    if (!Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} млн ₽`;
    if (abs >= 1_000)    return `${(v / 1_000).toFixed(1)} тыс. ₽`;
    return `${v.toFixed(0)} ₽`;
}

function fmtPercent(v) {
    if (!Number.isFinite(v)) return '—';
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(1)} %`;
}

/* ============================================================
 * Рендер одной карточки-драйвера
 * ============================================================ */

function renderDriverCard(item, rank, costType) {
    const deltaVal = costType === 'opex'  ? item.delta.opexMonthly
                   : costType === 'capex' ? item.delta.capexMonthly
                   : item.delta.total;
    const pctVal   = costType === 'opex'  ? item.deltaPercent.opexMonthly
                   : costType === 'capex' ? item.deltaPercent.capexMonthly
                   : item.deltaPercent.total;

    const positive = deltaVal >= 0;
    const deltaCls = positive ? 'sensitivity-driver-delta--up' : 'sensitivity-driver-delta--down';

    const catLabel = SENSITIVITY_CATEGORIES[item.category] || item.category;

    return el('div', { class: 'sensitivity-driver-card' },
        el('div', { class: 'sensitivity-driver-rank' }, `#${rank}`),
        el('div', { class: 'sensitivity-driver-info' },
            el('div', { class: 'sensitivity-driver-label' },
                el('span', { class: 'sensitivity-driver-name', text: item.label }),
                el('span', { class: 'sensitivity-driver-category', text: catLabel })
            ),
            el('div', { class: 'sensitivity-driver-change', text: item.changeLabel })
        ),
        el('div', { class: ['sensitivity-driver-delta', deltaCls] },
            el('div', {
                class: 'sensitivity-driver-delta-money',
                text: fmtMoney(deltaVal),
                title: `Изменение стоимости при ${item.changeLabel}`
            }),
            el('div', {
                class: 'sensitivity-driver-delta-pct',
                text: fmtPercent(pctVal)
            })
        ),
        item.note
            ? el('div', { class: 'sensitivity-driver-note', text: item.note })
            : null
    );
}

/* ============================================================
 * Рендер секции N/A
 * ============================================================ */

function renderNaSection(notAvailable) {
    if (!notAvailable.length) return null;
    return el('details', { class: 'sensitivity-na-section' },
        el('summary', { class: 'sensitivity-na-summary' },
            `Не применимо (${notAvailable.length})`
        ),
        el('ul', { class: 'sensitivity-na-list' },
            ...notAvailable.map(item =>
                el('li', { class: 'sensitivity-na-item' },
                    el('span', { class: 'sensitivity-na-label', text: item.label }),
                    el('span', { class: 'sensitivity-na-reason', text: item.reason || '' })
                )
            )
        )
    );
}

/* ============================================================
 * Рендер основного тела
 * ============================================================ */

function renderBody(calc, filters, ctx) {
    const { results, notAvailable } = getOrRunAnalysis(calc);
    const { costType, categories } = filters;

    const ranked = rankSensitivityDrivers(results, costType, categories);

    const costLabels = { opex: 'OPEX', capex: 'CAPEX', total: 'Итого' };

    // Cost-type radio
    const costToggle = el('div', { class: 'sensitivity-cost-toggle', attrs: { role: 'group', 'aria-label': 'Тип стоимости' } },
        ...['opex', 'capex', 'total'].map(ct =>
            el('button', {
                class: ['sensitivity-cost-btn', ct === costType ? 'sensitivity-cost-btn--active' : ''],
                attrs: { type: 'button', 'aria-pressed': String(ct === costType) },
                onClick: () => ctx.setSensitivityFilters({ ...filters, costType: ct })
            }, costLabels[ct])
        )
    );

    // Category chips
    const catChips = el('div', { class: 'sensitivity-category-chips', attrs: { role: 'group', 'aria-label': 'Категории параметров' } },
        ...SENSITIVITY_CATEGORY_ORDER.map(cat => {
            const active = categories.includes(cat);
            return el('button', {
                class: ['sensitivity-category-chip', active ? 'sensitivity-category-chip--active' : ''],
                attrs: { type: 'button', 'aria-pressed': String(active) },
                title: active ? 'Нажмите, чтобы исключить категорию' : 'Нажмите, чтобы включить категорию',
                onClick: () => {
                    const next = active
                        ? categories.filter(c => c !== cat)
                        : [...categories, cat];
                    ctx.setSensitivityFilters({ ...filters, categories: next });
                }
            }, SENSITIVITY_CATEGORIES[cat] || cat);
        })
    );

    // Drivers list
    const driverList = ranked.length > 0
        ? el('div', { class: 'sensitivity-driver-list' },
            ...ranked.map((item, i) => renderDriverCard(item, i + 1, costType))
          )
        : el('div', { class: 'sensitivity-empty-state' },
            'Нет данных для отображения. Попробуйте изменить фильтры или заполните опросник.'
          );

    return el('div', { class: 'sensitivity-modal-body' },
        el('div', { class: 'sensitivity-filter-row' }, costToggle, catChips),
        el('div', { class: 'sensitivity-results-section' },
            ranked.length > 0
                ? el('div', { class: 'sensitivity-results-header' },
                    el('span', { class: 'sensitivity-results-count',
                        text: `Показано: ${ranked.length} параметров`
                    }),
                    el('span', { class: 'sensitivity-results-hint',
                        text: 'Изменение при +10% для числовых / переключении для булевых параметров'
                    })
                  )
                : null,
            driverList
        ),
        renderNaSection(notAvailable)
    );
}

/* ============================================================
 * Главный entry
 * ============================================================ */

export function renderSensitivityAnalysisModal(state, ctx) {
    const m = state.modals?.sensitivity;
    if (!m || !m.open) return null;

    const onClose = () => ctx.closeModal('sensitivity');
    const calc = state.activeCalc;
    const filters = state.ui?.sensitivityFilters || DEFAULT_SENSITIVITY_FILTERS;

    return modalShell({
        title: 'Анализ чувствительности',
        size: 'lg',
        onClose,
        children: el('div', { class: 'sensitivity-modal' },
            calc
                ? renderBody(calc, filters, ctx)
                : el('div', { class: 'sensitivity-empty-state' }, 'Нет активного расчёта.')
        ),
        footer: el('button', {
            class: 'btn btn-primary',
            attrs: { type: 'button' },
            title: 'Закрыть (Esc)',
            onClick: onClose
        }, 'Закрыть')
    });
}
