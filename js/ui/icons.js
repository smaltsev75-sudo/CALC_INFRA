/**
 * Набор line-иконок (inline SVG из Lucide, ISC-лицензия — copy-paste).
 *
 * API:
 *   icon('home')                      // span с SVG, размер 20px
 *   icon('home', { size: 16 })        // явный размер
 *   icon('home', { class: 'foo' })    // дополнительный класс
 *
 * Все SVG используют `stroke="currentColor"` и `fill="none"` —
 * перекрашиваются через CSS `color:` родителя.
 *
 * Эмодзи в UI больше не используются (см. memory feedback_no_emojis_in_ui).
 *
 * Источник: https://lucide.dev (v0.x). Иконки — только тех имён, что используются
 * в приложении; добавлять новые — копировать `inner` из lucide.dev и регистрировать
 * в `ICONS`.
 */

import { el, trustedHtml } from './dom.js';

const ICONS = Object.freeze({
    /* ---------- Sidebar ---------- */
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    /* 14.U1: Quick Start CTA — sparkles из lucide.dev */
    sparkles:
        '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>' +
        '<path d="M20 3v4"/><path d="M22 5h-4"/>' +
        '<path d="M4 17v2"/><path d="M5 18H3"/>',
    'clipboard-list':
        '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>' +
        '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>' +
        '<path d="M12 11h4"/><path d="M12 16h4"/>' +
        '<path d="M8 11h.01"/><path d="M8 16h.01"/>',
    package:
        '<path d="M16.5 9.4l-9-5.19"/>' +
        '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>' +
        '<polyline points="3.27 6.96 12 12.01 20.73 6.96"/>' +
        '<line x1="12" y1="22.08" x2="12" y2="12"/>',
    calculator:
        '<rect width="16" height="20" x="4" y="2" rx="2"/>' +
        '<line x1="8" x2="16" y1="6" y2="6"/>' +
        '<line x1="16" x2="16" y1="14" y2="18"/>' +
        '<path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/>' +
        '<path d="M12 14h.01"/><path d="M8 14h.01"/>' +
        '<path d="M12 18h.01"/><path d="M8 18h.01"/>',
    'git-compare':
        '<circle cx="5" cy="6" r="3"/>' +
        '<path d="M12 6h5a2 2 0 0 1 2 2v7"/>' +
        '<path d="m15 9-3-3 3-3"/>' +
        '<circle cx="19" cy="18" r="3"/>' +
        '<path d="M12 18H7a2 2 0 0 1-2-2V9"/>' +
        '<path d="m9 15 3 3-3 3"/>',
    'help-circle':
        '<circle cx="12" cy="12" r="10"/>' +
        '<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>' +
        '<line x1="12" x2="12.01" y1="17" y2="17"/>',
    'table-2':
        '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>',
    settings:
        '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>' +
        '<circle cx="12" cy="12" r="3"/>',

    /* ---------- TopBar / actions ---------- */
    save:
        '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>' +
        '<polyline points="17 21 17 13 7 13 7 21"/>' +
        '<polyline points="7 3 7 8 15 8"/>',
    download:
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
        '<polyline points="7 10 12 15 17 10"/>' +
        '<line x1="12" x2="12" y1="15" y2="3"/>',
    upload:
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
        '<polyline points="17 8 12 3 7 8"/>' +
        '<line x1="12" x2="12" y1="3" y2="15"/>',
    'folder-open':
        '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    printer:
        '<polyline points="6 9 6 2 18 2 18 9"/>' +
        '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>' +
        '<rect width="12" height="8" x="6" y="14"/>',
    'rotate-ccw':
        '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>' +
        '<path d="M21 3v5h-5"/>' +
        '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>' +
        '<path d="M8 16H3v5"/>',
    'refresh-cw':
        '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>' +
        '<path d="M21 3v5h-5"/>' +
        '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>' +
        '<path d="M3 21v-5h5"/>',
    /* Lucide: clock — для кнопки «История прайсов» (Stage 10.3). */
    clock:
        '<circle cx="12" cy="12" r="10"/>' +
        '<polyline points="12 6 12 12 16 14"/>',

    /* ---------- Состояния / алерты ---------- */
    'alert-triangle':
        '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>' +
        '<path d="M12 9v4"/>' +
        '<path d="M12 17h.01"/>',
    info:
        '<circle cx="12" cy="12" r="10"/>' +
        '<path d="M12 16v-4"/>' +
        '<path d="M12 8h.01"/>',
    check:
        '<polyline points="20 6 9 17 4 12"/>',
    x:
        '<line x1="18" x2="6" y1="6" y2="18"/>' +
        '<line x1="6" x2="18" y1="6" y2="18"/>',
    'loader-2':
        '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',

    /* ---------- Dashboard / навигация ---------- */
    'arrow-up-right':
        '<line x1="7" x2="17" y1="17" y2="7"/>' +
        '<polyline points="7 7 17 7 17 17"/>',
    'trending-up':
        '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>' +
        '<polyline points="16 7 22 7 22 13"/>',
    award:
        '<circle cx="12" cy="8" r="6"/>' +
        '<path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
    server:
        '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/>' +
        '<rect width="20" height="8" x="2" y="14" rx="2" ry="2"/>' +
        '<line x1="6" x2="6.01" y1="6" y2="6"/>' +
        '<line x1="6" x2="6.01" y1="18" y2="18"/>',
    zap:
        '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',

    /* ---------- Прочее ---------- */
    'chevron-left':
        '<polyline points="15 18 9 12 15 6"/>',
    'chevron-right':
        '<polyline points="9 18 15 12 9 6"/>',
    'chevron-down':
        '<polyline points="6 9 12 15 18 9"/>',
    'chevron-up':
        '<polyline points="18 15 12 9 6 15"/>',
    'more-horizontal':
        '<circle cx="12" cy="12" r="1"/>' +
        '<circle cx="19" cy="12" r="1"/>' +
        '<circle cx="5" cy="12" r="1"/>',
    'edit-3':
        '<path d="M12 20h9"/>' +
        '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    'trash-2':
        '<polyline points="3 6 5 6 21 6"/>' +
        '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
        '<line x1="10" x2="10" y1="11" y2="17"/>' +
        '<line x1="14" x2="14" y1="11" y2="17"/>',
    search:
        '<circle cx="11" cy="11" r="8"/>' +
        '<line x1="21" x2="16.65" y1="21" y2="16.65"/>',
    edit:
        '<path d="M12 20h9"/>' +
        '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash:
        '<polyline points="3 6 5 6 21 6"/>' +
        '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    copy:
        '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>' +
        '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    plus:
        '<line x1="12" x2="12" y1="5" y2="19"/>' +
        '<line x1="5" x2="19" y1="12" y2="12"/>',
    minus:
        '<line x1="5" x2="19" y1="12" y2="12"/>',
    'check-circle':
        '<circle cx="12" cy="12" r="10"/>' +
        '<polyline points="9 12 12 15 16 10"/>',
    'x-circle':
        '<circle cx="12" cy="12" r="10"/>' +
        '<line x1="15" x2="9" y1="9" y2="15"/>' +
        '<line x1="9" x2="15" y1="9" y2="15"/>',
    'bar-chart-3':
        '<path d="M3 3v18h18"/>' +
        '<path d="M18 17V9"/>' +
        '<path d="M13 17V5"/>' +
        '<path d="M8 17v-3"/>',
    'git-branch':
        '<line x1="6" x2="6" y1="3" y2="15"/>' +
        '<circle cx="18" cy="6" r="3"/>' +
        '<circle cx="6" cy="18" r="3"/>' +
        '<path d="M18 9a9 9 0 0 1-9 9"/>',
    scale:
        '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/>' +
        '<path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/>' +
        '<path d="M7 21h10"/>' +
        '<path d="M12 3v18"/>' +
        '<path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
    archive:
        '<rect width="20" height="5" x="2" y="3" rx="1"/>' +
        '<path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>' +
        '<path d="M10 12h4"/>',
    puzzle:
        '<path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/>',
    'sliders-horizontal':
        '<line x1="21" x2="14" y1="4" y2="4"/>' +
        '<line x1="10" x2="3" y1="4" y2="4"/>' +
        '<line x1="21" x2="12" y1="12" y2="12"/>' +
        '<line x1="8" x2="3" y1="12" y2="12"/>' +
        '<line x1="21" x2="16" y1="20" y2="20"/>' +
        '<line x1="12" x2="3" y1="20" y2="20"/>' +
        '<line x1="14" x2="14" y1="2" y2="6"/>' +
        '<line x1="8" x2="8" y1="10" y2="14"/>' +
        '<line x1="16" x2="16" y1="18" y2="22"/>',
    'file-spreadsheet':
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<polyline points="14 2 14 8 20 8"/>' +
        '<path d="M8 13h2"/>' +
        '<path d="M14 13h2"/>' +
        '<path d="M8 17h2"/>' +
        '<path d="M14 17h2"/>',
    'pie-chart':
        '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>' +
        '<path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    play:
        '<polygon points="6 3 20 12 6 21 6 3"/>',
    'book-open':
        '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>' +
        '<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    /* 12.U33: переключатель темы dark/light. */
    sun:
        '<circle cx="12" cy="12" r="4"/>' +
        '<path d="M12 2v2"/><path d="M12 20v2"/>' +
        '<path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/>' +
        '<path d="M2 12h2"/><path d="M20 12h2"/>' +
        '<path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon:
        '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    /* PATCH 2.4.26 (Stage 7 / Provider block visual refresh): иконки категорий
       тарифов провайдера. Источник — Lucide v0.x (ISC). Используются в
       PROVIDER_PRICE_CATEGORIES → renderProviderPriceSummary. */
    cpu:
        '<rect x="4" y="4" width="16" height="16" rx="2"/>' +
        '<rect x="9" y="9" width="6" height="6"/>' +
        '<path d="M15 2v2"/><path d="M15 20v2"/>' +
        '<path d="M2 15h2"/><path d="M2 9h2"/>' +
        '<path d="M20 15h2"/><path d="M20 9h2"/>' +
        '<path d="M9 2v2"/><path d="M9 20v2"/>',
    'memory-stick':
        '<path d="M6 19v-3"/><path d="M10 19v-3"/>' +
        '<path d="M14 19v-3"/><path d="M18 19v-3"/>' +
        '<path d="M8 11V9"/><path d="M16 11V9"/><path d="M12 11V9"/>' +
        '<path d="M2 15h20"/>' +
        '<path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z"/>',
    database:
        '<ellipse cx="12" cy="5" rx="9" ry="3"/>' +
        '<path d="M3 5V19A9 3 0 0 0 21 19V5"/>' +
        '<path d="M3 12A9 3 0 0 0 21 12"/>',
    network:
        '<rect x="16" y="16" width="6" height="6" rx="1"/>' +
        '<rect x="2" y="16" width="6" height="6" rx="1"/>' +
        '<rect x="9" y="2" width="6" height="6" rx="1"/>' +
        '<path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/>' +
        '<path d="M12 12V8"/>',
    'file-text':
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<polyline points="14 2 14 8 20 8"/>' +
        '<line x1="16" y1="13" x2="8" y2="13"/>' +
        '<line x1="16" y1="17" x2="8" y2="17"/>' +
        '<polyline points="10 9 9 9 8 9"/>',
    mail:
        '<rect width="20" height="16" x="2" y="4" rx="2"/>' +
        '<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    lock:
        '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>' +
        '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
});

/**
 * Возвращает span с inline SVG.
 * @param {string} name - имя иконки из ICONS
 * @param {object} [opts]
 * @param {number} [opts.size=20] - размер в px (квадрат)
 * @param {string|string[]} [opts.class] - доп. класс
 * @param {string} [opts.title] - title-атрибут
 */
export function icon(name, opts = {}) {
    const inner = ICONS[name];
    if (!inner) {
        // Не падаем — возвращаем заглушку, чтобы не ломать UI на опечатке.
        const fallback = el('span', { class: 'icon icon-missing', text: '?' });
        if (typeof console !== 'undefined' && console.warn) {
            console.warn(`icon(): неизвестное имя "${name}"`);
        }
        return fallback;
    }
    const size = opts.size || 20;
    const cls = ['icon', `icon-${name}`];
    if (opts.class) {
        if (Array.isArray(opts.class)) cls.push(...opts.class);
        else cls.push(opts.class);
    }
    const svgHtml =
        `<svg width="${size}" height="${size}" viewBox="0 0 24 24" ` +
        `fill="none" stroke="currentColor" stroke-width="1.75" ` +
        `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        inner +
        `</svg>`;
    return el('span', {
        class: cls,
        trustedHtml: trustedHtml(svgHtml),
        title: opts.title,
        attrs: { 'aria-hidden': opts.title ? undefined : 'true' }
    });
}

/** Список зарегистрированных имён иконок (для тестов и отладки). */
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));
