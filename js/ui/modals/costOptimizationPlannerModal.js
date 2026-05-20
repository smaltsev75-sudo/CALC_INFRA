/**
 * Stage 18.1 Phase 2 (v2.13.0) — модалка «План оптимизации стоимости»
 * как draft-редактор.
 *
 * Структура:
 *   1. Disclaimer (Phase 2): «черновик ни на что не влияет, активный расчёт
 *      не меняется».
 *   2. Level tabs (Консервативный / Амбициозный / Экстремальный) — выбор уровня.
 *   3. Constraints grid (6 toggle'ов) — что разрешаем менять.
 *   4. Summary preview: текущая / после / экономия / статус диапазона.
 *   5. Editable levers — список доступных рычагов с inline-редакторами:
 *      percent / number_int / number_float / enum.
 *   6. Footer: «Сбросить изменения» (активно) | «Применить изменения»
 *      (disabled, появится в Phase 3).
 *
 * Phase 2 ограничения (важно):
 *   • НЕТ Apply / Rollback.
 *   • Все мутации идут через ctx.* которые вызывают controller — controller
 *     дёргает pure-domain функции. Активный расчёт НЕ меняется.
 *   • Закрытие модалки сохраняет draft в runtime state (8б).
 *
 * Layer: ui/. Импортирует domain (groupOptimizationLevers) — это разрешено
 * layer-linter'ом аналогично dashboard.js / healthChip.js. Stage 18.1.1
 * заменил плоский список рычагов на grouped accordion по области компромисса.
 */

import { el } from './../dom.js';
import { icon } from './../icons.js';
import { modalShell } from './baseModal.js';
import {
    PLAN_IDS,
    PLAN_TIERS,
    DEFAULT_LEVEL,
    LEVEL_DEFAULT_CONSTRAINTS,
    groupOptimizationLevers,
    draftHasHighRisk,
    listHighRiskChanges
} from '../../domain/costOptimizationPlanner.js';
import { formatRubThousands, parseNumberInput } from '../../services/format.js';
import { DECIMAL_INPUT_TYPE, decimalInputAttrs, formatDecimalInputValue } from '../decimalInput.js';
import {
    PERIOD_IDS,
    PERIOD_LABELS,
    DEFAULT_PERIOD,
    MONTHS_PER_YEAR
} from '../../utils/constants.js';

/* ============================================================
 * Vocabulary
 * ============================================================ */

const RISK_BADGE = Object.freeze({
    low:    { label: 'Низкий риск',  cls: 'cop-risk-low'    },
    medium: { label: 'Средний риск', cls: 'cop-risk-medium' },
    high:   { label: 'Высокий риск', cls: 'cop-risk-high'   }
});

/* Constraint-toggle'ы. Подпись соответствует Stage 18.1 спеку «Modal layout
   → Constraints» — без «(per Stage X.Y)»-жаргона. */
const CONSTRAINT_TOGGLES = Object.freeze([
    { key: 'allowReliabilityTradeoff', label: 'Можно снижать SLA',         hint: 'Открывает рычаг снижения целевого SLA. Высокий риск.' },
    { key: 'allowNonProdReduction',    label: 'Можно уменьшать стенды',    hint: 'Уменьшение стендов DEV / ИФТ / ПСИ / НТ.' },
    { key: 'allowRiskBufferReduction', label: 'Можно снижать риск-буферы', hint: 'Снижение bufferTask / bufferProject / contingency / schedule shift.' },
    { key: 'allowAiReduction',         label: 'Можно уменьшать AI / RAG',  hint: 'Сокращение output-токенов, корпуса и эмбеддингов RAG.' },
    { key: 'allowRetentionReduction',  label: 'Можно уменьшать retention', hint: 'Сокращение срока хранения бэкапов в пределах compliance-floor.' },
    { key: 'protectCompliance',        label: 'Защитить compliance',       hint: 'Запрет уходить ниже compliance-минимума (например, retention 90 дней).' }
]);

/* ============================================================
 * Public entry — рендер модалки
 * ============================================================ */

export function renderCostOptimizationPlannerModal(state, ctx) {
    const m = state.modals.costOptimizationPlanner;
    if (!m || !m.open) return null;
    const onClose = () => ctx.closeCostOptimizationPlannerModal();
    const calc = state.activeCalc;

    return modalShell({
        title: 'План оптимизации стоимости',
        size: 'lg',
        onClose,
        children: el('div', { class: 'cop-modal-body' },
            calc
                ? renderBody(calc, m, ctx)
                : renderEmpty()
        ),
        footer: renderFooter(m, ctx)
    });
}

function renderEmpty() {
    return el('div', { class: 'cop-modal-empty' },
        el('p', { text: 'Откройте расчёт, чтобы построить план оптимизации.' })
    );
}

function renderBody(calc, m, ctx) {
    const draft = m.draft;
    if (!draft) {
        return el('div', { class: 'cop-modal-empty' },
            el('p', { text: 'Черновик ещё не создан. Закройте и откройте модалку повторно.' })
        );
    }
    return el('div', null,
        renderDisclaimer(),
        renderRollbackBar(m, ctx),
        renderLevelTabs(draft, ctx),
        renderConstraintsBlock(draft, ctx),
        renderSummary(m, ctx),
        renderLeversBlock(calc, m, ctx),
        renderInlineConfirmPanel(m, ctx)
    );
}

/* ============================================================
 * Disclaimer
 * ============================================================ */

function renderDisclaimer() {
    return el('p', { class: 'cop-modal-disclaimer',
        text: 'Изменения сохраняются в черновике и применяются к расчёту только после нажатия «Применить изменения».' });
}

/* ============================================================
 * Rollback bar — показывается после успешного apply
 * ============================================================ */

function renderRollbackBar(m, ctx) {
    if (!m.lastApplySnapshot) return null;
    return el('div', { class: 'cop-rollback-bar',
        attrs: { role: 'status', 'aria-live': 'polite' } },
        el('div', { class: 'cop-rollback-text' },
            el('span', { class: 'cop-rollback-icon', attrs: { 'aria-hidden': 'true' } },
                icon('rotate-ccw', { size: 14 })
            ),
            el('span', { text: 'Последнее применение можно откатить, пока модалка открыта.' })
        ),
        el('button', {
            class: 'btn btn-ghost btn-sm cop-rollback-btn',
            attrs: { type: 'button',
                title: 'Вернуть расчёт к состоянию до последнего применения.' },
            onClick: () => ctx.rollbackOptimizationApply()
        }, 'Откатить последнее применение')
    );
}

/* ============================================================
 * Inline high-risk confirmation panel
 *
 * Когда applyOptimizationDraftAction обнаружил high-risk changes — controller
 * выставляет m.confirming=true, UI рендерит этот блок ниже levers. Кнопки:
 *   «Подтвердить изменения» → ctx.confirmOptimizationApply()
 *   «Отмена»                → ctx.cancelOptimizationApplyConfirm()
 * ============================================================ */

function renderInlineConfirmPanel(m, ctx) {
    if (!m.confirming || !m.draft) return null;
    const items = listHighRiskChanges(m.draft);
    return el('section', {
        class: 'cop-modal-section cop-confirm-panel',
        attrs: { role: 'alertdialog', 'aria-labelledby': 'cop-confirm-title', 'aria-live': 'assertive' }
    },
        el('h4', { class: 'cop-confirm-title', id: 'cop-confirm-title',
            text: 'Подтверждение применения изменений с высоким риском' }),
        el('p', { class: 'cop-confirm-intro',
            text: 'Вы применяете изменения, которые могут заметно повлиять на надёжность или резервы:' }),
        items.length > 0
            ? el('ul', { class: 'cop-confirm-list' },
                ...items.map(it => el('li', { class: 'cop-confirm-list-item' },
                    el('strong', { text: it.title }),
                    el('span', { class: 'cop-confirm-list-delta',
                        text: ` ${formatValueGeneric(it.from)} → ${formatValueGeneric(it.to)}` }),
                    it.consequence
                        ? el('p', { class: 'cop-confirm-list-consequence',
                            text: `Последствие: ${it.consequence}` })
                        : null
                ))
            )
            : null,
        el('div', { class: 'cop-confirm-actions' },
            el('button', {
                class: 'btn btn-primary cop-confirm-apply',
                attrs: { type: 'button',
                    title: 'Применить изменения к расчёту' },
                onClick: () => ctx.confirmOptimizationApply()
            }, 'Подтвердить изменения'),
            el('button', {
                class: 'btn btn-ghost cop-confirm-cancel',
                attrs: { type: 'button',
                    title: 'Не применять. Вернуться к редактированию.' },
                onClick: () => ctx.cancelOptimizationApplyConfirm()
            }, 'Отмена')
        )
    );
}

function formatValueGeneric(v) {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 100) return Math.round(v).toLocaleString('ru-RU');
    if (Math.abs(v) >= 1)   return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/* ============================================================
 * Level tabs
 * ============================================================ */

function renderLevelTabs(draft, ctx) {
    const currentLevel = draft.level || DEFAULT_LEVEL;
    return el('section', { class: 'cop-modal-section cop-modal-levels',
        attrs: { 'aria-label': 'Уровень оптимизации' } },
        el('h4', { class: 'cop-modal-section-title', text: 'Уровень оптимизации' }),
        el('div', { class: 'cop-level-tabs', attrs: { role: 'tablist' } },
            ...PLAN_TIERS.map(tier => renderLevelTab(tier, currentLevel, ctx))
        )
    );
}

function renderLevelTab(tier, currentLevel, ctx) {
    const isActive = tier.id === currentLevel;
    const rangeStr = `${tier.range.minPercent}–${tier.range.maxPercent}%`;
    return el('button', {
        class: ['cop-level-tab', isActive && 'is-active', `cop-level-${tier.id}`],
        attrs: {
            type: 'button',
            role: 'tab',
            'aria-selected': isActive ? 'true' : 'false',
            title: `${tier.title} — экономия ${rangeStr}. ${tier.description}`
        },
        onClick: () => { if (!isActive) ctx.setOptimizationLevel(tier.id); }
    },
        el('span', { class: 'cop-level-tab-title', text: tier.title }),
        el('span', { class: 'cop-level-tab-range', text: rangeStr })
    );
}

/* ============================================================
 * Constraints
 * ============================================================ */

function renderConstraintsBlock(draft, ctx) {
    const constraints = draft.constraints || {};
    const touched = draft.touchedConstraints || {};
    return el('section', { class: 'cop-modal-section cop-modal-constraints',
        attrs: { 'aria-label': 'Ограничения' } },
        el('h4', { class: 'cop-modal-section-title', text: 'Ограничения' }),
        el('p', { class: 'cop-modal-section-hint',
            text: 'Уровень задаёт начальный набор. Ваши изменения сохраняются при переключении уровня.' }),
        el('div', { class: 'cop-modal-constraints-grid' },
            ...CONSTRAINT_TOGGLES.map(c =>
                renderConstraintToggle(c, !!constraints[c.key], !!touched[c.key], ctx)
            )
        )
    );
}

function renderConstraintToggle(c, value, isTouched, ctx) {
    return el('label', {
        class: ['cop-modal-constraint', value && 'cop-modal-constraint-on'],
        attrs: { title: c.hint }
    },
        el('input', {
            type: 'checkbox',
            checked: value,
            attrs: { 'data-focus-key': `cop-constraint-${c.key}` },
            onChange: e => ctx.toggleOptimizationConstraint(c.key, !!e.target.checked)
        }),
        el('span', { class: 'cop-modal-constraint-label', text: c.label }),
        isTouched
            ? el('span', { class: 'cop-modal-constraint-touched',
                attrs: { title: 'Вы явно выбрали этот вариант — переключение уровня его не перетрёт' },
                text: '·' })
            : null
    );
}

/* ============================================================
 * Summary preview
 * ============================================================ */

function periodMul(period) {
    return period === 'daily' ? 1 / 30 : period === 'annual' ? MONTHS_PER_YEAR : 1;
}

function periodSlash(period) {
    return period === 'daily' ? '/ день' : period === 'annual' ? '/ год' : '/ мес';
}

function formatRubPeriod(value, period) {
    if (!Number.isFinite(value)) return '—';
    /* Все суммы в модалке — в тыс. ₽. На дневном периоде значения малы
       (десятки/сотни тыс.), округление каждой карточки вниз ломает сумму
       (50 + 112 ≠ 163), поэтому daily выводим с 1 знаком после запятой —
       тот же приём, что в Dashboard (12.U25-fix-10). */
    const fd = period === 'daily' ? 1 : 0;
    return `${formatRubThousands(value, { fractionDigits: fd })} ${periodSlash(period)}`;
}

function renderSummary(m, ctx) {
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

/* ============================================================
 * Editable levers
 * ============================================================ */

/* Stage 18.1.1 — grouped levers (accordion). Каждая группа имеет header с
   summary (count / saving / max risk), при клике сворачивается/разворачивается.
   Заблокированные группы рендерятся collapsed с причиной и inline-кнопкой
   «Разрешить ...», которая дёргает toggleOptimizationConstraint(true) — она
   НЕ применяет правки, а только снимает ограничение. */
function renderLeversBlock(calc, m, ctx) {
    const draft = m.draft;
    const groups = groupOptimizationLevers(calc, draft);
    const openSet = new Set(Array.isArray(m.openGroups) ? m.openGroups : []);

    /* Если ни одной доступной группы и ни одной с changes/blocked'ом — пусто. */
    const hasAnyVisible = groups.some(g =>
        g.availableLeverCount > 0 || g.changedCount > 0 || g.blocked);
    if (!hasAnyVisible) {
        return el('section', { class: 'cop-modal-section cop-modal-levers' },
            el('h4', { class: 'cop-modal-section-title', text: 'Рычаги оптимизации' }),
            el('p', { class: 'cop-modal-section-hint',
                text: 'Нет доступных рычагов при текущих ограничениях. Включите дополнительные категории сверху или поднимите уровень оптимизации.' })
        );
    }

    /* Сортировка: группы «Нет применимых параметров» (constraint включён,
       но appliesIf отсеял все spec'и — например AI без ai_llm_used) опускаются
       в самый низ. Blocked-группы остаются в естественном порядке (они применимы,
       просто запрещены — у пользователя есть путь снять constraint). */
    const isEmpty = (g) => !g.blocked && g.availableLeverCount === 0 && g.changedCount === 0;
    const orderedGroups = [
        ...groups.filter(g => !isEmpty(g)),
        ...groups.filter(isEmpty)
    ];

    return el('section', { class: 'cop-modal-section cop-modal-levers',
        attrs: { 'aria-label': 'Рычаги оптимизации' } },
        el('h4', { class: 'cop-modal-section-title', text: 'Рычаги оптимизации' }),
        el('p', { class: 'cop-modal-section-hint',
            text: 'Рычаги сгруппированы по тому, чем придётся пожертвовать: стенды, SLA, хранение, AI / RAG, рисковые резервы или горизонт планирования.' }),
        el('div', { class: 'cop-lever-groups' },
            ...orderedGroups.map(g => renderLeverGroup(g, openSet.has(g.id), ctx))
        )
    );
}

function renderLeverGroup(group, isOpen, ctx) {
    const isBlocked = group.blocked;
    const isEmpty = !isBlocked && group.availableLeverCount === 0 && group.changedCount === 0;
    /* Заблокированная группа НЕ ведёт себя как accordion — body виден всегда,
       чтобы пользователь сразу читал причину и видел inline-кнопку «Разрешить».
       Аккордеон применяется только к unblocked-группам (см. ниже). */
    const expanded = isBlocked ? true : isOpen;
    const cls = ['cop-lever-group',
        isBlocked && 'cop-lever-group-blocked',
        isEmpty && 'cop-lever-group-empty',
        expanded && 'is-expanded'];
    const headerId = `cop-lever-group-${group.id}-header`;
    const bodyId   = `cop-lever-group-${group.id}-body`;

    /* Header: для blocked — статичный div (нет toggling smysl'а); для остальных
       — button с aria-expanded и onClick. */
    const header = isBlocked
        ? el('div', { class: 'cop-lever-group-header cop-lever-group-header-static',
            attrs: { id: headerId, title: group.description } },
            el('span', { class: 'cop-lever-group-chevron', attrs: { 'aria-hidden': 'true' } },
                icon('lock', { size: 14 })),
            el('span', { class: 'cop-lever-group-title', text: group.title }),
            renderLeverGroupMeta(group, isBlocked, isEmpty)
        )
        : el('button', {
            class: 'cop-lever-group-header',
            attrs: {
                type: 'button',
                id: headerId,
                'aria-expanded': expanded ? 'true' : 'false',
                'aria-controls': bodyId,
                title: group.description
            },
            onClick: () => ctx.toggleOptimizationLeverGroup?.(group.id)
        },
            el('span', { class: 'cop-lever-group-chevron', attrs: { 'aria-hidden': 'true' } },
                icon(expanded ? 'chevron-down' : 'chevron-right', { size: 14 })),
            el('span', { class: 'cop-lever-group-title', text: group.title }),
            renderLeverGroupMeta(group, isBlocked, isEmpty)
        );

    return el('div', { class: cls },
        header,
        el('div', {
            class: ['cop-lever-group-body', !expanded && 'is-collapsed'],
            attrs: { id: bodyId, role: 'region', 'aria-labelledby': headerId,
                hidden: expanded ? null : 'hidden' }
        },
            el('p', { class: 'cop-lever-group-description', text: group.description }),
            isBlocked
                ? renderLeverGroupBlocked(group, ctx)
                : isEmpty
                    ? el('p', { class: 'cop-lever-group-empty-hint',
                        text: 'Нет применимых параметров для текущего расчёта.' })
                    : el('ol', { class: 'cop-lever-list' },
                        ...group.levers.map(l => renderLeverItem(l, ctx)))
        )
    );
}

function renderLeverGroupMeta(group, isBlocked, isEmpty) {
    if (isBlocked) {
        return el('span', { class: 'cop-lever-group-meta cop-lever-group-meta-blocked',
            text: 'Заблокировано ограничениями' });
    }
    if (isEmpty) {
        return el('span', { class: 'cop-lever-group-meta cop-lever-group-meta-empty',
            text: 'Нет применимых параметров' });
    }
    /* Активная группа: count + saving + risk-badge. */
    const parts = [];
    const countText = group.changedCount > 0
        ? `${group.changedCount} из ${group.availableLeverCount} изменено`
        : `${group.availableLeverCount} ${pluralParams(group.availableLeverCount)}`;
    parts.push(el('span', { class: 'cop-lever-group-meta-count', text: countText }));
    if (group.totalSavingRub > 0) {
        parts.push(el('span', { class: 'cop-lever-group-meta-saving',
            text: `−${formatRubThousands(group.totalSavingRub)} / мес` }));
    }
    if (group.maxRiskLevel) {
        const risk = RISK_BADGE[group.maxRiskLevel] || RISK_BADGE.low;
        parts.push(el('span', {
            class: ['cop-risk-badge', 'cop-risk-badge-sm', risk.cls, 'cop-lever-group-meta-risk'],
            text: risk.label
        }));
    }
    return el('span', { class: 'cop-lever-group-meta' }, ...parts);
}

function renderLeverGroupBlocked(group, ctx) {
    return el('div', { class: 'cop-lever-group-blocked-body' },
        el('p', { class: 'cop-lever-group-blocked-reason', text: group.blockedReason }),
        group.constraintKey && group.constraintEnableLabel
            ? el('button', {
                class: 'btn btn-ghost btn-sm cop-lever-group-unblock',
                attrs: { type: 'button',
                    title: 'Снять ограничение. Изменения в расчёт не применяются.' },
                onClick: () => ctx.toggleOptimizationConstraint?.(group.constraintKey, true)
            }, group.constraintEnableLabel)
            : null
    );
}

function pluralParams(n) {
    /* «1 параметр», «2 параметра», «5 параметров» — RU-плюрализация. */
    const mod10  = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'параметр';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'параметра';
    return 'параметров';
}

function renderLeverItem(lever, ctx) {
    const risk = RISK_BADGE[lever.riskLevel] || RISK_BADGE.low;
    /* PATCH 2.14.17: description — одна строка под title объясняет ЧТО за
       параметр (берётся из metadata модели через resolveLeverDescription).
       Длинные description-тексты из seed.js могут содержать переносы строки
       и второй абзац (рекомендации). Для UI планера показываем только
       первую содержательную строку — её достаточно, полный текст пользователь
       видит в Опроснике через кнопку «Перейти к полю». */
    const descShort = (lever.description || '')
        .split(/\n+/)[0]
        .trim()
        .slice(0, 240); // sanity cap — избежать гигантских карточек
    return el('li', { class: ['cop-lever', `cop-lever-${lever.riskLevel}`,
            lever.hasDraftChange && 'cop-lever-modified'] },
        el('div', { class: 'cop-lever-head' },
            el('span', { class: 'cop-lever-title', text: lever.title }),
            el('span', { class: ['cop-risk-badge', 'cop-risk-badge-sm', risk.cls],
                text: risk.label })
        ),
        descShort
            ? el('p', { class: 'cop-lever-description', text: descShort })
            : null,
        renderLeverEditor(lever, ctx),
        lever.consequence
            ? el('p', { class: 'cop-lever-consequence', text: `Последствие: ${lever.consequence}` })
            : null,
        renderLeverActions(lever, ctx)
    );
}

function renderLeverEditor(lever, ctx) {
    const editor = lever.editor;
    switch (editor.editorType) {
        case 'enum':       return renderEnumEditor(lever, ctx);
        case 'number_int': return renderNumberEditor(lever, ctx, /*integer*/ true);
        case 'number_float':
        case 'percent':    return renderNumberEditor(lever, ctx, /*integer*/ false);
        default:           return null;
    }
}

function renderEnumEditor(lever, ctx) {
    const fieldId = lever.fieldId;
    const current = Number(lever.editingValue);
    const opts = lever.editor.options || [];
    const suggested = lever.suggestedValue;
    return el('div', { class: 'cop-lever-editor cop-lever-editor-enum' },
        el('label', { class: 'cop-lever-editor-label' },
            el('span', { class: 'cop-lever-editor-from',
                text: `Сейчас: ${formatValueShort(lever.baseValue, lever)}` }),
            el('select', {
                class: 'input cop-lever-select',
                attrs: { 'data-focus-key': `cop-lever-${lever.id}` },
                onChange: e => ctx.updateOptimizationDraftValue(fieldId, Number(e.target.value))
            },
                ...opts.map(v => el('option', {
                    value: String(v),
                    selected: Math.abs(v - current) < 1e-9,
                    text: formatValueShort(v, lever)
                }))
            ),
            suggested != null && Math.abs(suggested - current) > 1e-9
                ? el('span', { class: 'cop-lever-suggested',
                    text: `Рекомендуется: ${formatValueShort(suggested, lever)}` })
                : null
        )
    );
}

function renderNumberEditor(lever, ctx, integer) {
    const fieldId = lever.fieldId;
    const editor = lever.editor;
    const current = Number(lever.editingValue);
    const suggested = lever.suggestedValue;
    /* Range input + текстовое значение. Не делаем slider в Phase 2 для
       простоты тестов; обычный number input с min/max/step справится. */
    return el('div', { class: 'cop-lever-editor cop-lever-editor-number' },
        el('div', { class: 'cop-lever-editor-row' },
            el('span', { class: 'cop-lever-editor-from',
                text: `Сейчас: ${formatValueShort(lever.baseValue, lever)}` }),
            el('input', {
                class: 'input cop-lever-input',
                type: DECIMAL_INPUT_TYPE,
                value: formatDecimalInputValue(integer ? Math.round(current) : current),
                attrs: decimalInputAttrs({
                    'data-focus-key': `cop-lever-${lever.id}`,
                }),
                onChange: e => {
                    const raw = parseNumberInput(e.target.value);
                    if (Number.isFinite(raw)) ctx.updateOptimizationDraftValue(fieldId, raw);
                }
            })
        ),
        suggested != null && Math.abs(suggested - current) > (editor.step ?? 0.01) / 100
            ? el('p', { class: 'cop-lever-suggested',
                text: `Рекомендуется для уровня: ${formatValueShort(suggested, lever)}` })
            : null,
        el('p', { class: 'cop-lever-range-hint',
            text: `Диапазон: ${formatValueShort(editor.min, lever)} – ${formatValueShort(editor.max, lever)}` })
    );
}

function renderLeverActions(lever, ctx) {
    const fieldId = lever.fieldId;
    return el('div', { class: 'cop-lever-actions' },
        lever.hasDraftChange
            ? el('button', {
                class: 'btn btn-ghost btn-sm cop-lever-reset',
                attrs: { type: 'button',
                    title: 'Вернуть значение к исходному (текущее в расчёте)' },
                onClick: () => ctx.removeOptimizationDraftChange(fieldId)
            }, 'Сбросить параметр')
            : null,
        typeof ctx?.focusQuestion === 'function' && fieldId.startsWith('answer:')
            ? el('button', {
                class: 'btn btn-ghost btn-sm cop-lever-nav',
                attrs: { type: 'button',
                    title: 'Открыть поле в опроснике' },
                onClick: () => {
                    ctx.closeCostOptimizationPlannerModal();
                    ctx.focusQuestion(fieldId.slice('answer:'.length));
                }
            }, 'Перейти к полю', icon('chevron-right', { size: 12 }))
            : null
    );
}

/* ============================================================
 * Footer
 * ============================================================ */

function renderFooter(m, ctx) {
    const draft = m?.draft;
    const changesCount = draft?.changes ? Object.keys(draft.changes).length : 0;
    const hasChanges   = changesCount > 0;
    const hasError     = !!draft?.preview?.error;
    const confirming   = !!m?.confirming;
    /* Apply активен только если есть changes, нет preview-ошибок, и сейчас НЕ
       идёт inline-confirmation (тогда apply скрыт — его заменили confirm/cancel
       внутри panel'а). */
    const applyEnabled = hasChanges && !hasError && !confirming;

    return el('div', { class: 'cop-modal-footer' },
        el('button', {
            class: 'btn btn-ghost',
            attrs: {
                type: 'button',
                disabled: hasChanges ? undefined : 'disabled',
                title: hasChanges
                    ? 'Очистить все правки в черновике'
                    : 'Нет правок для сброса'
            },
            onClick: hasChanges ? () => ctx.resetOptimizationDraft() : null
        }, 'Сбросить изменения'),
        /* Phase 3: «Применить изменения» активен. Если draft содержит high-risk
           changes — клик откроет inline-confirmation panel вместо немедленного
           apply (controller сам это решает). */
        el('button', {
            class: 'btn btn-primary cop-modal-apply',
            attrs: {
                type: 'button',
                disabled: applyEnabled ? undefined : 'disabled',
                title: !hasChanges
                    ? 'Нет правок для применения'
                    : hasError
                        ? 'Сначала исправьте ошибки в черновике'
                        : confirming
                            ? 'Подтвердите изменения в панели выше'
                            : 'Применить ваши правки к расчёту'
            },
            onClick: applyEnabled ? () => ctx.applyOptimizationDraftAction() : null
        }, 'Применить изменения'),
        el('button', {
            class: 'btn btn-ghost',
            attrs: { type: 'button', title: 'Закрыть модалку (Esc). Черновик сохранится до F5.' },
            onClick: () => ctx.closeCostOptimizationPlannerModal()
        }, 'Закрыть')
    );
}

/* ============================================================
 * Helpers
 * ============================================================ */

/* PATCH 2.14.17: русское склонение «год» для planningHorizonYears.
   1 год / 2 года / 5 лет. Простой алгоритм по правилам ру-плюрализации. */
function pluralYears(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'год';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'года';
    return 'лет';
}

/* PATCH 2.14.17: значения форматируются с учётом lever.unit (выставляется
   в domain buildEditableLevers через deriveLeverUnit). Раньше единицы
   определялись эвристиками внутри formatValueShort, что давало голые
   «0,15» вместо «15 %» для kContingency/bufferTask и расходилось со
   стилем «% от ПРОМ» для standSizeRatio.

   Контракт по типам:
     - percent editor (settings_ratio / settings_field) → значение 0..1 → ×100, без знаков после запятой
     - enum SLA               → «99,9 %» (один знак после запятой, обрезается)
     - enum backup_retention  → «90 дн.»
     - number_int horizon     → «3 года» (склонение)
     - number_int ai_tokens   → «1 200 токенов»
     - number_float rag_corpus / embeddings → значение + ' ГБ' / ' млн векторов'
 */
function formatValueShort(v, lever) {
    if (!Number.isFinite(v)) return '—';
    const editor = lever?.editor;
    const unit = lever?.unit || '';

    // Special case: planningHorizon — целое число лет со склонением (поверх unit).
    if (editor?.editorType === 'number_int' && lever?.fieldId === 'setting:planningHorizonYears') {
        const n = Math.round(v);
        return `${n} ${pluralYears(n)}`;
    }

    // Percent editor: storage value 0..1 (ratio/доля) → проценты.
    // unit '% от ПРОМ' / '%' уже несёт ' %' в постфиксе.
    if (editor?.editorType === 'percent') {
        const formatted = (v * 100).toFixed(0);
        // unit '% от ПРОМ' начинается с '%' — не дублируем «%»: подставляем «N% от ПРОМ» или «N %»
        if (unit === '% от ПРОМ')  return `${formatted} % от ПРОМ`;
        return `${formatted} %`;
    }

    // Enum: SLA — десятичный процент; backup_retention — целые дни.
    if (editor?.editorType === 'enum') {
        if (unit === 'дн.') return `${Math.round(v)} дн.`;
        if (unit === '%')   return `${v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} %`;
        // Fallback: эвристики прежней реализации.
        if (Math.abs(v) >= 1000) return `${Math.round(v)} дн.`;
        if (Number.isInteger(v) && Math.abs(v) >= 7 && Math.abs(v) <= 9000) return `${v} дн.`;
        return `${v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} %`;
    }

    // Integer non-horizon (AI tokens и др.).
    if (editor?.editorType === 'number_int') {
        const n = Math.round(v);
        const num = n.toLocaleString('ru-RU');
        return unit ? `${num} ${unit}` : num;
    }

    // number_float (RAG corpus, embeddings).
    let core;
    if (Math.abs(v) >= 100)      core = Math.round(v).toLocaleString('ru-RU');
    else if (Math.abs(v) >= 10)  core = v.toFixed(1).replace(/\.0$/, '');
    else                          core = v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return unit ? `${core} ${unit}` : core;
}
