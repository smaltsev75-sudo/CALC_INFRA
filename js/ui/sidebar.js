/**
 * Левая навигационная панель (sidebar) — icon-rail.
 *
 * 2026-06-14 (по требованию пользователя): ВСЕ кнопки — только иконки с хинтами
 * (title-tooltip) + aria-label для screen-reader. Кнопки сгруппированы по типу
 * операций; внутри группы — по убыванию частоты использования:
 *   - «Расчёт» (экраны): Дэшборд / Детализация / Опросник / Расчёты / Сравнение
 *   - «Администрирование» (advancedOnly): Элементы / Вопросы
 *   - «Данные» (перенесены из topbar): Экспорт JSON / Импорт JSON / PDF / Сброс
 *   - footer (система): Расширенные настройки / Справка / Тема
 * Тема размещена ПОД Справкой. Сброс (необратимо) — под «Распечатать» (PDF) в
 * группе «Данные», danger-стилем.
 *
 * Группы разделены тонкими разделителями (.sidebar-divider) + border footer.
 * Панель узкая (icon-only) на всех ширинах; полное имя и горячая клавиша — в
 * tooltip (title) и aria-label.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { appIconEl } from './appIcon.js';
import { APP_VERSION, APP_NAME } from '../utils/constants.js';

/**
 * Структура секций. id — соответствует state.activeTab; iconName — из icons.js.
 * requiresActive=true → пункт серый/недоступный, если нет активного расчёта.
 * advancedOnly=true → секция показывается только при state.ui.advancedModeEnabled.
 * Порядок экранов — по убыванию частоты использования (просмотр результатов →
 * ввод → управление расчётами → сравнение).
 */
const NAV_SECTIONS = Object.freeze([
    {
        title: 'Расчёт',
        items: [
            { id: 'dashboard',     label: 'Дэшборд',     iconName: 'home',           requiresActive: true,  hotkey: 'Ctrl+Alt+3', desc: 'Карточки стендов и ИТОГО' },
            { id: 'details',       label: 'Детализация', iconName: 'table-2',        requiresActive: true,  hotkey: 'Ctrl+Alt+4', desc: 'Таблица ЭК × стенд' },
            { id: 'questionnaire', label: 'Опросник',    iconName: 'clipboard-list', requiresActive: true,  hotkey: 'Ctrl+Alt+2', desc: 'Ответы и параметры' },
            { id: 'calculations',  label: 'Расчёты',     iconName: 'calculator',     requiresActive: false, hotkey: 'Ctrl+Alt+1', desc: 'Список расчётов' },
            { id: 'comparison',    label: 'Сравнение',   iconName: 'git-compare',    requiresActive: false, hotkey: 'Ctrl+Alt+5', desc: 'Сравнение нескольких расчётов' }
        ]
    },
    {
        title: 'Администрирование',
        advancedOnly: true,
        items: [
            { id: 'items',     label: 'Элементы', iconName: 'package',      requiresActive: true, hotkey: 'Ctrl+Alt+6', desc: 'Каталог ЭК (только в расширенных настройках)' },
            { id: 'questions', label: 'Вопросы',  iconName: 'help-circle',  requiresActive: true, hotkey: 'Ctrl+Alt+7', desc: 'Справочник вопросов (только в расширенных настройках)' }
        ]
    }
]);

/* Группа «Данные» (I/O) — перенесена из topbar. Порядок по убыванию частоты:
 * экспорт (сохранить/передать) → импорт (загрузить) → PDF (отчёт) → сброс.
 * Сброс размещён ПОД «Распечатать» (по требованию пользователя) — относится к
 * управлению данными; необратимо → danger-стиль. testId сохранены (header-*). */
const DATA_ACTIONS = Object.freeze([
    { action: 'exportCalc', label: 'Экспорт JSON', iconName: 'save',        testId: 'header-export-json', requiresActive: true,  ariaLabel: 'Экспорт текущего расчёта в JSON', desc: 'Экспорт текущего расчёта в JSON-файл — сохранить копию или передать коллеге (Ctrl+Alt+S)' },
    { action: 'importCalc', label: 'Импорт JSON', iconName: 'folder-open', testId: 'header-import-json', requiresActive: false, ariaLabel: 'Импорт расчёта из JSON',        desc: 'Импорт расчёта из JSON-файла. Файл добавится к списку ваших расчётов (Ctrl+Alt+O)' },
    { action: 'printPdf',   label: 'PDF',         iconName: 'printer',     testId: 'header-print-pdf',  requiresActive: true,  ariaLabel: 'Печать или сохранение в PDF',     desc: 'Распечатать или сохранить активную вкладку в PDF (Ctrl+Alt+P)' },
    { action: 'openReset',  label: 'Сброс',       iconName: 'rotate-ccw',  testId: 'header-reset',      requiresActive: false, danger: true, ariaLabel: 'Сбросить все расчёты', desc: 'Удалить все расчёты и восстановить исходный набор шаблонов. Действие необратимо.' }
]);

export function renderSidebar(state, ctx) {
    const hasActive = !!state.activeCalc;
    const advancedMode = !!state.ui?.advancedModeEnabled;
    const visibleSections = NAV_SECTIONS.filter(s => !s.advancedOnly || advancedMode);
    return el('aside', {
        class: 'app-sidebar',
        attrs: { 'aria-label': 'Главное меню', 'data-testid': 'app-sidebar' }
    },
        renderBrand(),
        el('nav', { class: 'sidebar-nav', attrs: { role: 'navigation' } },
            // Разделитель между КАЖДОЙ группой (в icon-only заголовки скрыты —
            // дивайдер единственный визуальный маркер границы групп).
            ...visibleSections.flatMap((section, i) => i === 0
                ? [renderSection(section, state, ctx, hasActive)]
                : [renderDivider(), renderSection(section, state, ctx, hasActive)]),
            renderDivider(),
            renderDataGroup(state, ctx, hasActive)
        ),
        renderFooter(state, ctx, advancedMode)
    );
}

function renderDivider() {
    return el('div', { class: 'sidebar-divider', attrs: { 'aria-hidden': 'true' } });
}

function renderBrand() {
    return el('div', {
        class: 'sidebar-brand',
        title: `${APP_NAME} v${APP_VERSION}`,
        // role=img+aria-label дают доступное имя продукта screen-reader'у
        // (на title неинтерактивного div полагаться нельзя). Полное имя длинное
        // для узкого rail → остаётся только в title/aria-label.
        attrs: { role: 'img', 'aria-label': `${APP_NAME} v${APP_VERSION}` }
    },
        // Иконка приложения (вариант K) — единый источник js/ui/appIcon.js.
        el('span', { class: 'sidebar-brand-logo' }, appIconEl({ size: 34 })),
        // Номер версии — видимая подпись ПОД иконкой (по требованию пользователя).
        // Текст ровно `v<версия>` — на него завязан published-smoke.spec.js.
        el('div', { class: 'sidebar-brand-version', text: `v${APP_VERSION}` })
    );
}

function renderSection(section, state, ctx, hasActive) {
    return el('div', { class: 'sidebar-section' },
        el('div', { class: 'sidebar-section-title', text: section.title }),
        ...section.items.map(item => renderNavItem(item, state, ctx, hasActive))
    );
}

function renderNavItem(item, state, ctx, hasActive) {
    const isActive = state.activeTab === item.id;
    const isDisabled = item.requiresActive && !hasActive;
    const title = isDisabled
        ? `${item.label} — сначала откройте расчёт`
        : `${item.label} (${item.hotkey}) — ${item.desc}`;

    return el('button', {
        class: ['sidebar-nav-item',
                isActive   && 'sidebar-nav-item-active',
                isDisabled && 'sidebar-nav-item-disabled'],
        title,
        disabled: isDisabled,
        attrs: {
            // Навигация по экранам (не вкладки внутри области) → НЕ role=tab:
            // tablist без tabpanel/aria-controls/roving-tabindex = невалидная ARIA.
            // Активный экран помечается aria-current='page' внутри <nav role=navigation>.
            type: 'button',
            'data-testid': `nav-${item.id}`,
            'aria-label': item.label,
            'aria-current': isActive ? 'page' : undefined
        },
        onClick: () => !isDisabled && ctx.setActiveTab(item.id)
    },
        el('span', { class: 'sidebar-nav-item-icon' }, icon(item.iconName, { size: 18 })),
        el('span', { class: 'sidebar-nav-item-label', text: item.label })
    );
}

/* Группа «Данные»: действия импорта/экспорта/печати (icon-only, хинт + aria-label). */
function renderDataGroup(state, ctx, hasActive) {
    return el('div', { class: 'sidebar-section' },
        el('div', { class: 'sidebar-section-title', text: 'Данные' }),
        ...DATA_ACTIONS.map(a => {
            const disabled = a.requiresActive && !hasActive;
            const title = disabled ? `${a.label} — сначала откройте расчёт` : a.desc;
            return el('button', {
                class: ['sidebar-nav-item', 'sidebar-action-item',
                        a.danger && 'sidebar-footer-danger',
                        disabled && 'sidebar-nav-item-disabled'],
                title,
                disabled,
                attrs: {
                    type: 'button',
                    'data-testid': a.testId,
                    'aria-label': a.ariaLabel
                },
                onClick: (e) => ctx[a.action]?.(e)
            },
                el('span', { class: 'sidebar-nav-item-icon' }, icon(a.iconName, { size: 18 })),
                el('span', { class: 'sidebar-nav-item-label', text: a.label })
            );
        })
    );
}

/* Footer (группа «Система»): расширенные настройки → справка → тема.
 * Тема под Справкой. Сброс перенесён в группу «Данные» (под PDF). */
function renderFooter(state, ctx, advancedMode) {
    const isLight = state.ui?.theme === 'light';
    const themeNext = isLight ? 'Тёмная тема' : 'Светлая тема';
    const advancedActionLabel = advancedMode
        ? 'Выключить расширенные настройки'
        : 'Включить расширенные настройки';

    return el('div', { class: 'sidebar-footer' },
        // Stage 17.2 Phase 3c: toggle «Расширенные настройки». При advancedMode=true
        // в навигации появляется группа «Администрирование» (Элементы / Вопросы).
        el('button', {
            class: ['sidebar-footer-btn', 'sidebar-advanced-toggle',
                    advancedMode && 'sidebar-advanced-toggle-on'],
            title: advancedActionLabel,
            attrs: {
                type: 'button',
                'data-testid': 'sidebar-advanced-toggle',
                'aria-pressed': advancedMode ? 'true' : 'false',
                'aria-label': advancedActionLabel
            },
            onClick: () => ctx.toggleAdvancedMode?.()
        },
            el('span', { class: 'sidebar-nav-item-icon' },
                icon('sliders-horizontal', { size: 18 })),
            el('span', { class: 'sidebar-nav-item-label',
                text: 'Расширенные настройки' })
        ),
        el('button', {
            class: 'sidebar-footer-btn',
            title: 'Открыть справку (F1)',
            attrs: {
                type: 'button',
                'data-testid': 'sidebar-help-button',
                'aria-label': 'Открыть справку'
            },
            onClick: () => ctx.openHelp?.()
        },
            el('span', { class: 'sidebar-nav-item-icon' }, icon('help-circle', { size: 18 })),
            el('span', { class: 'sidebar-nav-item-label', text: 'Справка' })
        ),
        // Переключатель темы — ПОД Справкой. Иконка показывает «куда переключим».
        el('button', {
            class: ['sidebar-footer-btn', 'theme-toggle'],
            title: `Переключить на ${themeNext.toLowerCase()} (текущая: ${isLight ? 'светлая' : 'тёмная'})`,
            attrs: {
                type: 'button',
                'data-testid': 'theme-toggle',
                'aria-label': `Переключить на ${themeNext.toLowerCase()}`,
                'aria-pressed': isLight ? 'true' : 'false'
            },
            onClick: () => ctx.toggleTheme?.()
        },
            el('span', { class: 'sidebar-nav-item-icon' }, icon(isLight ? 'moon' : 'sun', { size: 18 })),
            el('span', { class: 'sidebar-nav-item-label', text: themeNext })
        )
        // Сброс перенесён в группу «Данные» (под «Распечатать»/PDF) — см. DATA_ACTIONS.
    );
}
