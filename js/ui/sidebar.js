/**
 * Левая навигационная панель (sidebar).
 *
 * Заменяет горизонтальные табы. Структура:
 *   - бренд (логотип + название продукта)
 *   - секция «Расчёт»: список / опросник / дашборд / детализация / сравнение
 *   - секция «Администрирование» (Stage 17.2 Phase 3c): элементы / вопросы —
 *     показывается ТОЛЬКО при включённом режиме «Расширенные настройки».
 *   - footer: toggle «Расширенные настройки» + ссылка на справку
 *
 * Активный пункт подсвечивается тонкой зелёной полосой слева + лёгким glow.
 * Пункты, требующие активного расчёта, выводятся с opacity .45 если расчёт не открыт.
 *
 * Sidebar collapsible: полная ширина 220px (>1100px) и узкая 64px (≤1100px).
 * В узком режиме видны только иконки, текст скрыт; tooltip через title.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { APP_VERSION, APP_NAME } from '../utils/constants.js';

/**
 * Структура секций. id — соответствует state.activeTab; iconName — из icons.js.
 * requiresActive=true → пункт серый/недоступный, если нет активного расчёта.
 * advancedOnly=true → секция показывается только при state.ui.advancedModeEnabled.
 */
const NAV_SECTIONS = Object.freeze([
    {
        title: 'Расчёт',
        items: [
            { id: 'calculations',  label: 'Расчёты',     iconName: 'calculator',     requiresActive: false, hotkey: 'Ctrl+Alt+1', desc: 'Список расчётов' },
            { id: 'questionnaire', label: 'Опросник',    iconName: 'clipboard-list', requiresActive: true,  hotkey: 'Ctrl+Alt+2', desc: 'Ответы и параметры' },
            { id: 'dashboard',     label: 'Дэшборд',     iconName: 'home',           requiresActive: true,  hotkey: 'Ctrl+Alt+3', desc: 'Карточки стендов и ИТОГО' },
            { id: 'details',       label: 'Детализация', iconName: 'table-2',        requiresActive: true,  hotkey: 'Ctrl+Alt+4', desc: 'Таблица ЭК × стенд' },
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

export function renderSidebar(state, ctx) {
    const hasActive = !!state.activeCalc;
    const advancedMode = !!state.ui?.advancedModeEnabled;
    const visibleSections = NAV_SECTIONS.filter(s => !s.advancedOnly || advancedMode);
    return el('aside', { class: 'app-sidebar', attrs: { 'aria-label': 'Главное меню' } },
        renderBrand(),
        el('nav', { class: 'sidebar-nav', attrs: { role: 'navigation' } },
            ...visibleSections.map(section => renderSection(section, state, ctx, hasActive))
        ),
        renderFooter(ctx, advancedMode)
    );
}

function renderBrand() {
    return el('div', { class: 'sidebar-brand' },
        el('span', { class: 'sidebar-brand-logo' }, icon('zap', { size: 18 })),
        el('div', { class: 'sidebar-brand-text' },
            el('div', { class: 'sidebar-brand-title', text: APP_NAME }),
            el('div', { class: 'sidebar-brand-version', text: `v${APP_VERSION}` })
        )
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
            type: 'button',
            role: 'tab',
            'aria-selected': isActive ? 'true' : 'false',
            'aria-current': isActive ? 'page' : undefined
        },
        onClick: () => !isDisabled && ctx.setActiveTab(item.id)
    },
        el('span', { class: 'sidebar-nav-item-icon' }, icon(item.iconName, { size: 18 })),
        el('span', { class: 'sidebar-nav-item-label', text: item.label })
    );
}

function renderFooter(ctx, advancedMode) {
    return el('div', { class: 'sidebar-footer' },
        // Stage 17.2 Phase 3c: toggle «Расширенные настройки». При advancedMode=true
        // в навигации появляется группа «Администрирование» (Элементы / Вопросы).
        // Иконка sliders + текст-состояние помогают понять, что это admin-уровень.
        el('button', {
            class: ['sidebar-footer-btn', 'sidebar-advanced-toggle',
                    advancedMode && 'sidebar-advanced-toggle-on'],
            title: advancedMode
                ? 'Скрыть административные вкладки (Элементы, Вопросы)'
                : 'Показать административные вкладки (Элементы, Вопросы) — для архитектора',
            attrs: {
                type: 'button',
                'aria-pressed': advancedMode ? 'true' : 'false',
                'aria-label': advancedMode
                    ? 'Выключить расширенные настройки'
                    : 'Включить расширенные настройки'
            },
            onClick: () => ctx.toggleAdvancedMode?.()
        },
            el('span', { class: 'sidebar-nav-item-icon' },
                icon('sliders-horizontal', { size: 16 })),
            el('span', { class: 'sidebar-nav-item-label',
                text: 'Расширенные настройки' })
        ),
        el('button', {
            class: 'sidebar-footer-btn',
            title: 'Справка (F1)',
            attrs: { type: 'button' },
            onClick: () => ctx.openHelp?.()
        },
            el('span', { class: 'sidebar-nav-item-icon' }, icon('help-circle', { size: 16 })),
            el('span', { class: 'sidebar-nav-item-label', text: 'Справка' })
        )
    );
}
