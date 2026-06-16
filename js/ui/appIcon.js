/**
 * Иконка приложения (вариант K — AI-чип со знаком ₽) — единый источник для UI.
 *
 * Канонический исходник: assets/app-icon.svg. Здесь — встраиваемая inline-копия
 * для бренда в sidebar и шапки модалки «Справка». Favicon на вкладке браузера
 * хранится отдельно как статический data-URI в index.html (грузится до JS, без
 * мерцания); это та же иконка, отрисованная из того же исходника.
 *
 * id градиентов/фильтра параметризованы счётчиком: иконка может оказаться в DOM
 * сразу в нескольких экземплярах (бренд + открытая Справка), а одинаковые id
 * ломали бы ссылки `url(#...)` (браузер берёт первый по порядку). Уникальный
 * префикс на каждый вызов исключает коллизию.
 */

import { el, trustedHtml } from './dom.js';

let _uidSeq = 0;

/**
 * SVG-разметка иконки приложения с уникальными id.
 * @param {number} size — сторона в px (квадрат). По умолчанию 512.
 * @returns {string}
 */
export function appIconSvg(size = 512) {
    const u = `appicon-${++_uidSeq}`;
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
        `<defs>` +
            `<linearGradient id="${u}-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16233f"/><stop offset="1" stop-color="#0a101f"/></linearGradient>` +
            `<linearGradient id="${u}-gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` +
            `<linearGradient id="${u}-chip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#27395d"/><stop offset="1" stop-color="#1a2742"/></linearGradient>` +
            `<linearGradient id="${u}-spark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a3e635"/><stop offset="0.55" stop-color="#84cc16"/><stop offset="1" stop-color="#26d49a"/></linearGradient>` +
            `<radialGradient id="${u}-core" cx="0.5" cy="0.42" r="0.65"><stop offset="0" stop-color="#1e3556"/><stop offset="1" stop-color="#101d33"/></radialGradient>` +
            `<linearGradient id="${u}-badge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2ee6a6"/><stop offset="1" stop-color="#15a877"/></linearGradient>` +
            `<filter id="${u}-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
        `</defs>` +
        `<rect width="512" height="512" rx="112" fill="url(#${u}-bg)"/>` +
        `<rect width="512" height="512" rx="112" fill="url(#${u}-gloss)"/>` +
        `<rect x="2" y="2" width="508" height="508" rx="110" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="3"/>` +
        `<g fill="#3a4d72">` +
            `<rect x="178" y="118" width="20" height="36" rx="7"/><rect x="226" y="118" width="20" height="36" rx="7"/>` +
            `<rect x="274" y="118" width="20" height="36" rx="7"/><rect x="322" y="118" width="20" height="36" rx="7"/>` +
            `<rect x="178" y="358" width="20" height="36" rx="7"/><rect x="226" y="358" width="20" height="36" rx="7"/>` +
            `<rect x="274" y="358" width="20" height="36" rx="7"/><rect x="322" y="358" width="20" height="36" rx="7"/>` +
            `<rect x="118" y="178" width="36" height="20" rx="7"/><rect x="118" y="226" width="36" height="20" rx="7"/>` +
            `<rect x="118" y="274" width="36" height="20" rx="7"/><rect x="118" y="322" width="36" height="20" rx="7"/>` +
            `<rect x="358" y="178" width="36" height="20" rx="7"/><rect x="358" y="226" width="36" height="20" rx="7"/>` +
            `<rect x="358" y="274" width="36" height="20" rx="7"/><rect x="358" y="322" width="36" height="20" rx="7"/>` +
        `</g>` +
        `<rect x="146" y="146" width="220" height="220" rx="40" fill="url(#${u}-chip)" stroke="#46608f" stroke-width="3"/>` +
        `<g fill="none" stroke="#37507a" stroke-width="4" stroke-linecap="round" opacity="0.8">` +
            `<path d="M166 196 H196 V176"/><path d="M346 196 H316 V176"/>` +
            `<path d="M166 316 H196 V336"/><path d="M346 316 H316 V336"/>` +
        `</g>` +
        `<rect x="184" y="184" width="144" height="144" rx="28" fill="url(#${u}-core)" stroke="#4d6aa0" stroke-width="2.5"/>` +
        `<g filter="url(#${u}-glow)">` +
            `<path d="M256 196 C262 232 280 250 316 256 C280 262 262 280 256 316 C250 280 232 262 196 256 C232 250 250 232 256 196 Z" fill="url(#${u}-spark)"/>` +
            `<path d="M306 300 C309 314 316 321 330 324 C316 327 309 334 306 348 C303 334 296 327 282 324 C296 321 303 314 306 300 Z" fill="#a3e635"/>` +
        `</g>` +
        `<g>` +
            `<circle cx="372" cy="372" r="62" fill="url(#${u}-badge)" stroke="#0a101f" stroke-width="6"/>` +
            `<g fill="none" stroke="#0a101f" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">` +
                `<path d="M361 334 V406"/>` +
                `<path d="M361 334 H383 A19 19 0 0 1 383 372 H361"/>` +
                `<path d="M341 390 H389"/>` +
            `</g>` +
        `</g>` +
        `</svg>`
    );
}

/**
 * span с inline-SVG иконки приложения, готовый к вставке в DOM.
 * Декоративный (aria-hidden на SVG) — доступное имя дают родительские
 * контейнеры (бренд: role=img+aria-label; Справка: видимый заголовок).
 * @param {{size?: number, class?: string|string[]}} [opts]
 */
export function appIconEl(opts = {}) {
    const size = opts.size || 32;
    const cls = ['app-icon'];
    if (opts.class) cls.push(...(Array.isArray(opts.class) ? opts.class : [opts.class]));
    return el('span', { class: cls, trustedHtml: trustedHtml(appIconSvg(size)) });
}
