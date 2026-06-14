/**
 * TopBar — горизонтальная полоса над main-контентом.
 *
 * Показывает: название текущего расчёта + tab-switcher сценариев + индикатор
 * статуса сохранения. Действия (Импорт/Экспорт JSON, PDF, Сброс, Тема) и
 * навигация — в левом sidebar (см. sidebar.js, перенос 2026-06-14).
 * В topbar остаётся только диагностическая кнопка (видна лишь при ?diag=1).
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { renderScenarioTabs } from './scenarioTabs.js';

export function renderHeader(state, ctx) {
    const calc = state.activeCalc;
    const diagnostic = renderDiagnosticButton(state, ctx);

    return el('header', { class: 'app-topbar' },
        /* 2026-05-18 (повтор): topbar-title ВЕСЬ блок выводится только при
         * активном расчёте. Раньше при !calc показывали «Калькулятор
         * инфраструктуры» — это полный дубль с logo в sidebar (там уже есть
         * «Калькулятор инфраструктуры v2.x.x»). Дубль раздражал пользователя
         * («сколько раз тебе повторять»). */
        calc && el('div', { class: 'app-topbar-title' },
            el('span', { class: 'app-topbar-title-muted', text: 'Текущий расчёт · ' }),
            calc.name
        ),

        // Sprint 3.0 Stage 2: tab-switcher для сценариев — между title и persist-indicator.
        // Не рендерится если нет активного calc (renderScenarioTabs сам возвращает null).
        renderScenarioTabs(state, ctx),

        renderPersistIndicator(state),

        // 2026-06-14: пользовательские действия перенесены в sidebar. В topbar
        // остаётся только diag-кнопка (и только в режиме ?diag=1).
        diagnostic && el('div', { class: 'app-topbar-actions' }, diagnostic)
    );
}

function isDiagnosticModeEnabled() {
    try {
        return new URLSearchParams(window.location.search).get('diag') === '1';
    } catch (_err) {
        return false;
    }
}

function renderDiagnosticButton(state, ctx) {
    if (!isDiagnosticModeEnabled()) return null;
    return iconButton(ctx, {
        iconName: 'copy',
        label: 'Диагностика',
        title:
            'Скопировать локальный диагностический JSON. Приложение не отправляет его автоматически; внутри могут быть параметры расчёта.',
        ariaLabel: 'Скопировать диагностический JSON расчёта',
        testId: 'header-copy-diagnostics',
        disabled: !state.activeCalc,
        onClick: () => ctx.copyDiagnosticBundle?.()
    });
}

function iconButton(_ctx, { iconName, label, title, disabled, danger, onClick, ariaLabel, testId }) {
    return el('button', {
        class: ['btn', 'btn-ghost', 'btn-icon-text', danger && 'btn-danger-ghost'],
        title,
        disabled,
        attrs: {
            type: 'button',
            'aria-label': ariaLabel || label,
            'data-testid': testId
        },
        onClick
    },
        icon(iconName, { size: 16 }),
        el('span', { text: label })
    );
}

function renderPersistIndicator(state) {
    if (!state.activeCalc) return null;
    const status = state.persistStatus || 'idle';
    const meta = {
        idle:    {
            iconName: 'check', text: 'Все изменения сохранены',
            tip: 'Расчёт автоматически сохраняется в браузере. Все ваши изменения уже на месте.',
            cls: 'persist-idle'
        },
        pending: {
            iconName: 'loader-2', text: 'Сохранение…',
            tip: 'Сейчас сохраняем последние изменения в браузере.',
            cls: 'persist-pending'
        },
        saved:   {
            iconName: 'check', text: 'Сохранено',
            tip: 'Изменения только что сохранены.',
            cls: 'persist-saved'
        },
        error:   {
            iconName: 'alert-triangle', text: 'Ошибка сохранения',
            tip: state.persistMessage || 'Не удалось сохранить расчёт. Возможно, переполнено хранилище браузера.',
            cls: 'persist-error'
        }
    }[status];
    return el('div', {
        class: ['persist-indicator', meta.cls],
        title: meta.tip,
        attrs: { role: 'status', 'aria-live': 'polite' }
    },
        icon(meta.iconName, { size: 14 }),
        el('span', { class: 'persist-text', text: meta.text })
    );
}
