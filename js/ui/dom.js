/**
 * DOM-утилиты: создание элементов, безопасная установка содержимого,
 * декларативный builder вместо innerHTML.
 */

import { escapeHtml } from '../utils/escapeHtml.js';

/**
 * Маркер «доверенного HTML» — обёртка для значений, которые автор кода явно
 * подтвердил как безопасные для вставки через innerHTML. Любой другой формат
 * (plain string и т.п.) отклоняется в `el()` и `setTrustedHtml()`.
 *
 * Этап 10.3.1: жёсткое запрещение `props.html: '<...>'` без обёртки —
 * чтобы случайно не подсунуть пользовательский ввод в innerHTML.
 *
 * @param {string|null|undefined} value - HTML-строка, безопасность которой гарантирует вызывающий
 * @returns {{__trusted: true, value: string}}
 */
export function trustedHtml(value) {
    return { __trusted: true, value: String(value ?? '') };
}

/**
 * Проверить, что `v` — branded-объект из `trustedHtml()`.
 * @param {unknown} v
 * @returns {boolean}
 */
function isTrustedHtml(v) {
    return v !== null && typeof v === 'object' && v.__trusted === true && typeof v.value === 'string';
}

/**
 * Создание элемента: el(tag, props, ...children)
 *   props.class        — строка или массив
 *   props.style        — объект
 *   props.dataset      — объект (data-* атрибуты)
 *   props.attrs        — объект произвольных атрибутов
 *   props.on*          — обработчики событий: onClick, onInput и т.д.
 *   props.trustedHtml  — установить innerHTML; принимает ТОЛЬКО объект из `trustedHtml()`
 *   props.html         — устаревший alias, всегда бросает (Этап 10.3.1) — используйте `trustedHtml`
 *   props.text         — установить textContent
 *   children           — массив элементов или строк (строки превращаются в textNode)
 */
export function el(tag, props = null, ...children) {
    const node = document.createElement(tag);
    if (props) {
        if (props.class) {
            const cls = Array.isArray(props.class) ? props.class.filter(Boolean).join(' ') : props.class;
            if (cls) node.className = cls;
        }
        if (props.id) node.id = props.id;
        if (props.style) Object.assign(node.style, props.style);
        if (props.dataset) for (const k in props.dataset) node.dataset[k] = props.dataset[k];
        if (props.attrs) for (const k in props.attrs) {
            const v = props.attrs[k];
            if (v === false || v === null || v === undefined) continue;
            node.setAttribute(k, v === true ? '' : String(v));
        }
        for (const k in props) {
            if (k.startsWith('on') && typeof props[k] === 'function') {
                node.addEventListener(k.slice(2).toLowerCase(), props[k]);
            }
        }
        if (props.disabled) node.disabled = true;
        if (props.placeholder) node.placeholder = props.placeholder;
        if (props.type && tag === 'input') node.type = props.type;
        if (props.text !== undefined) node.textContent = String(props.text);
        if (props.html !== undefined) {
            // Жёсткая блокировка: plain string в innerHTML запрещён, нужно явное доверие.
            throw new Error('Use trustedHtml() helper to mark HTML as trusted');
        }
        if (props.trustedHtml !== undefined) {
            if (!isTrustedHtml(props.trustedHtml)) {
                throw new Error('trustedHtml expects branded object — use trustedHtml() helper');
            }
            node.innerHTML = props.trustedHtml.value;
        }
        if (props.title) node.title = props.title;
        if (props.ariaLabel) node.setAttribute('aria-label', props.ariaLabel);
    }
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        if (Array.isArray(child)) {
            for (const c of child) {
                if (c === null || c === undefined || c === false) continue;
                node.appendChild(typeof c === 'string' || typeof c === 'number'
                    ? document.createTextNode(String(c))
                    : c);
            }
        } else if (typeof child === 'string' || typeof child === 'number') {
            node.appendChild(document.createTextNode(String(child)));
        } else {
            node.appendChild(child);
        }
    }
    // value/checked устанавливаются ПОСЛЕ детей, чтобы <select value=...>
    // корректно выбирал option (на пустом <select> значение игнорировалось бы).
    //
    // 12.U21: <option> ТОЖЕ должен получать value через IDL-property. Раньше
    // `el('option', { value: t.id }, label)` тихо игнорировал value: option
    // не входил в whitelist, а другие пути (props.attrs / setAttribute) для
    // value тоже не шли. В итоге `option.value` падал в дефолт `option.text`,
    // и `<select>.value` возвращал label вместо id — баг проявлялся в любом
    // селекте, читающем `e.target.value` (newCalcModal: выбор шаблона).
    if (props) {
        if (props.value !== undefined && (
            tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option'
        )) {
            node.value = props.value;
        }
        if (props.checked !== undefined && tag === 'input') {
            node.checked = !!props.checked;
        }
    }
    return node;
}

/** Очистить содержимое узла. */
export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
}

/** Заменить содержимое узла одним новым ребёнком. */
export function replace(node, newChild) {
    clear(node);
    if (newChild) node.appendChild(newChild);
}

/**
 * Установка innerHTML из branded-объекта `trustedHtml()`. Любой другой формат
 * (plain string и т.п.) бросает ошибку — это страховка от случайной вставки
 * не санитизированного пользовательского ввода.
 *
 * @param {Element} node
 * @param {{__trusted: true, value: string}} trustedObj
 */
export function setTrustedHtml(node, trustedObj) {
    if (!isTrustedHtml(trustedObj)) {
        throw new Error('setTrustedHtml expects branded object — use trustedHtml() helper');
    }
    node.innerHTML = trustedObj.value;
}

/** Создать SVG-элемент. */
export function svg(tag, attrs = null, ...children) {
    const ns = 'http://www.w3.org/2000/svg';
    const node = document.createElementNS(ns, tag);
    if (attrs) for (const k in attrs) {
        if (k.startsWith('on') && typeof attrs[k] === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else {
            node.setAttribute(k, String(attrs[k]));
        }
    }
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        if (Array.isArray(child)) for (const c of child) node.appendChild(c);
        else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
        else node.appendChild(child);
    }
    return node;
}

/**
 * Универсальная info-кнопка («i» в кружке) с обработчиком клика.
 * Использует общий стиль `.info-icon` (см. css/components.css).
 *
 * Inline-SVG здесь, чтобы избежать циклической зависимости dom.js → icons.js
 * (icons.js импортирует dom.js). SVG-разметка идентична `icon('info')`.
 */
export function infoIcon(onClick, title = 'Показать формулу') {
    const svgHtml =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="10"/>' +
        '<path d="M12 16v-4"/>' +
        '<path d="M12 8h.01"/>' +
        '</svg>';
    return el('button', {
        class: 'info-icon',
        title,
        ariaLabel: title,
        attrs: { type: 'button' },
        trustedHtml: trustedHtml(svgHtml),
        onClick: e => { e.stopPropagation(); onClick(e); }
    });
}

/**
 * Поставить/снять loading-state на кнопке. Блокирует повторный клик и показывает
 * CSS-spinner (см. .btn-loading в css/components.css). Безопасно к null/undefined.
 *
 * Используется в ctx-обёртках длительных async-операций (импорт bundle, экспорт CSV,
 * печать PDF) — UI получает явную обратную связь, что операция идёт.
 *
 * @param {HTMLButtonElement|null|undefined} btn
 * @param {boolean} isLoading
 */
export function setButtonLoading(btn, isLoading) {
    if (!btn || typeof btn.classList === 'undefined') return;
    if (isLoading) {
        btn.classList.add('btn-loading');
        btn.disabled = true;
    } else {
        btn.classList.remove('btn-loading');
        btn.disabled = false;
    }
}

export { escapeHtml };
