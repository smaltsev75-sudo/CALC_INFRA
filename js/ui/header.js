/**
 * TopBar — горизонтальная полоса над main-контентом.
 *
 * Показывает: название текущего расчёта (или общую подпись) + индикатор
 * статуса сохранения + actions (Импорт JSON / Экспорт JSON / PDF / Сброс).
 * Логотип и навигация — в левом sidebar (см. sidebar.js).
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { renderScenarioTabs } from './scenarioTabs.js';

export function renderHeader(state, ctx) {
    const calc = state.activeCalc;

    return el('header', { class: 'app-topbar' },
        /* 2026-05-18 (повтор): topbar-title ВЕСЬ блок выводится только при
         * активном расчёте. Раньше при !calc показывали «Калькулятор
         * инфраструктуры» — это полный дубль с logo в sidebar (там уже есть
         * «Калькулятор инфраструктуры v2.x.x»). Дубль раздражал пользователя
         * («сколько раз тебе повторять»). Теперь шапка слева чистая, только
         * actions справа. */
        calc && el('div', { class: 'app-topbar-title' },
            el('span', { class: 'app-topbar-title-muted', text: 'Текущий расчёт · ' }),
            calc.name
        ),

        // Sprint 3.0 Stage 2: tab-switcher для сценариев — между title и persist-indicator.
        // Не рендерится если нет активного calc (renderScenarioTabs сам возвращает null).
        renderScenarioTabs(state, ctx),

        renderPersistIndicator(state),

        el('div', { class: 'app-topbar-actions' },
            /* 12.U33: переключатель темы. Иконка показывает «куда переключим»,
               а не текущее состояние: в тёмной теме — Sun (предложение перейти
               в светлую), в светлой — Moon. aria-label полный, для screen-reader. */
            renderThemeToggle(state, ctx),
            renderDiagnosticButton(state, ctx),
            iconButton(ctx, {
                iconName: 'folder-open',
                label: 'Импорт JSON',
                title: 'Импорт расчёта из JSON-файла. Файл добавится к списку ваших расчётов (Ctrl+Alt+O)',
                ariaLabel: 'Импорт расчёта из JSON',
                testId: 'header-import-json',
                onClick: (e) => ctx.importCalc(e)
            }),
            iconButton(ctx, {
                iconName: 'save',
                label: 'Экспорт JSON',
                title: 'Экспорт текущего расчёта в JSON-файл — сохранить копию или передать коллеге (Ctrl+Alt+S)',
                ariaLabel: 'Экспорт текущего расчёта в JSON',
                testId: 'header-export-json',
                disabled: !calc,
                onClick: (e) => ctx.exportCalc(e)
            }),
            iconButton(ctx, {
                iconName: 'printer',
                label: 'PDF',
                title: 'Распечатать или сохранить активную вкладку в PDF. На вкладке «Опросник» — таблица «Вопрос → Ответ», сгруппированная по типу. Ctrl+Alt+P',
                testId: 'header-print-pdf',
                disabled: !calc,
                onClick: (e) => ctx.printPdf(e)
            }),
            iconButton(ctx, {
                iconName: 'rotate-ccw',
                label: 'Сброс',
                title: 'Удалить все расчёты и восстановить исходный набор шаблонов. Действие необратимо.',
                testId: 'header-reset',
                danger: true,
                onClick: () => ctx.openReset()
            })
        )
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

function renderThemeToggle(state, ctx) {
    const isLight = state.ui?.theme === 'light';
    const nextLabel = isLight ? 'Тёмная тема' : 'Светлая тема';
    return el('button', {
        class: ['btn', 'btn-ghost', 'btn-icon-text', 'theme-toggle'],
        title: `Переключить на ${nextLabel.toLowerCase()} (текущая: ${isLight ? 'светлая' : 'тёмная'})`,
        attrs: {
            type: 'button',
            'data-testid': 'theme-toggle',
            'aria-label': `Переключить на ${nextLabel.toLowerCase()}`,
            'aria-pressed': isLight ? 'true' : 'false'
        },
        onClick: () => ctx.toggleTheme()
    },
        icon(isLight ? 'moon' : 'sun', { size: 16 }),
        el('span', { text: nextLabel })
    );
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
