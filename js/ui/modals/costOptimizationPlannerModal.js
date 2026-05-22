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
 *   6. Footer: «Сбросить изменения» | «Применить изменения»
 *      (активно при наличии правок, с inline-confirmation для high-risk).
 *
 * Инварианты (важно):
 *   • Все мутации идут через ctx.* которые вызывают controller — controller
 *     дёргает pure-domain функции.
 *   • Активный расчёт НЕ меняется до явного «Применить изменения».
 *   • Закрытие модалки сохраняет draft в runtime state; F5 сбрасывает его.
 *
 * Layer: ui/. Компоненты модалки импортируют domain для grouped levers —
 * это разрешено layer-linter'ом аналогично dashboard.js / healthChip.js.
 */

import { el } from './../dom.js';
import { icon } from './../icons.js';
import { modalShell } from './baseModal.js';
import { listHighRiskChanges } from '../../domain/costOptimizationPlanner.js';
import { renderConstraintsBlock, renderLevelTabs } from './costOptimizationPlannerModalControls.js';
import { formatValueGeneric } from './costOptimizationPlannerModalFormat.js';
import { renderLeversBlock } from './costOptimizationPlannerModalLevers.js';
import { renderSummary } from './costOptimizationPlannerModalSummary.js';
import { renderCalculationProviderPriceActuality } from '../providerPriceActuality.js';

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
        renderCalculationProviderPriceActuality(calc, {
            className: 'modal-price-actuality',
            title: 'Прайс расчёта'
        }),
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
