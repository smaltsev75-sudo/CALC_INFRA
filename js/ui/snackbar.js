/**
 * Snackbar: уведомления внизу экрана с очередью.
 *
 * Сообщения стекируются как стек карточек. Каждое автоматически закрывается
 * через `duration` мс или вручную (×). Поддерживается опциональная кнопка
 * действия (например, «Отменить» для удалений).
 */

import { el, clear } from './dom.js';
import {
    SNACKBAR_DURATION_MS,
    SNACKBAR_DURATION_BY_TYPE,
    SNACKBAR_TRANSITION_MS
} from '../utils/constants.js';

let _container = null;
let _idSeq = 1;

function ensureContainer() {
    if (_container) return _container;
    _container = el('div', {
        id: 'snackbar-stack',
        class: 'snackbar-stack',
        attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' }
    });
    document.body.appendChild(_container);
    return _container;
}

export function showSnackbar({ message, action, onAction, type = 'info', duration }) {
    // Если duration не передан — берём по типу из таблицы. Error держится дольше,
    // чтобы пользователь успел прочитать сообщение и нажать «×».
    const effectiveDuration = duration ??
        SNACKBAR_DURATION_BY_TYPE[type] ?? SNACKBAR_DURATION_MS;
    const root = ensureContainer();
    const id = _idSeq++;

    const item = el('div', {
        class: ['snackbar', `snackbar-${type}`],
        attrs: { 'data-snackbar-id': id }
    });

    const close = () => {
        if (!item.parentNode) return;
        item.classList.remove('show');
        // Подождать конец CSS-transition перед удалением узла.
        setTimeout(() => { if (item.parentNode) item.parentNode.removeChild(item); }, SNACKBAR_TRANSITION_MS);
    };

    const text = el('span', { class: 'snackbar-text', text: message });
    item.appendChild(text);

    if (action && typeof onAction === 'function') {
        const btn = el('button', {
            class: 'snackbar-action',
            text: action,
            title: `Выполнить действие: ${action}`,
            attrs: { type: 'button' },
            onClick: () => { onAction(); close(); }
        });
        item.appendChild(btn);
    }
    const closeBtn = el('button', {
        class: 'snackbar-close',
        text: '×',
        title: 'Закрыть уведомление',
        attrs: { type: 'button', 'aria-label': 'Закрыть' },
        onClick: close
    });
    item.appendChild(closeBtn);

    root.appendChild(item);
    // requestAnimationFrame — чтобы class .show применился после mount и сработала анимация.
    requestAnimationFrame(() => item.classList.add('show'));

    setTimeout(close, effectiveDuration);
    return { id, close };
}

export const success = m => showSnackbar({ message: m, type: 'success' });
export const error   = m => showSnackbar({ message: m, type: 'error' });
export const warning = m => showSnackbar({ message: m, type: 'warning' });
export const info    = m => showSnackbar({ message: m, type: 'info' });

/**
 * Snackbar для деструктивного действия с возможностью «Отменить».
 * onUndo вызывается, если пользователь нажал «Отменить» в течение duration.
 */
export function showUndoableSnackbar(message, onUndo, duration = SNACKBAR_DURATION_MS) {
    return showSnackbar({
        message,
        action: 'Отменить',
        onAction: onUndo,
        type: 'info',
        duration
    });
}

/**
 * Stage 10.1: progress-snackbar для длительных bulk-операций (например,
 * обновление прайсов нескольких провайдеров одной кнопкой). Не закрывается
 * автоматически — caller обязан вызвать `success / error / warning / close`
 * после завершения операции.
 *
 * Шаблон:
 *   const h = showProgressSnackbar({ message: 'Обновление…', total: 3 });
 *   for (let i = 0; i < total; i++) { …; h.update(i + 1, `Шаг ${i + 1}`); }
 *   h.success(`Готово: ${total} провайдеров обновлено.`);
 *
 * @param {Object} opts
 * @param {string} opts.message — текст в начале операции.
 * @param {number} opts.total   — общее число шагов (для % и счётчика «N / total»).
 * @returns {{
 *     id: number,
 *     update: (value: number, message?: string) => void,
 *     success: (msg: string) => void,
 *     error:   (msg: string) => void,
 *     warning: (msg: string) => void,
 *     close:   () => void
 * }}
 */
export function showProgressSnackbar({ message, total }) {
    const root = ensureContainer();
    const id = _idSeq++;
    const safeTotal = Math.max(0, Number(total) || 0);

    const item = el('div', {
        class: ['snackbar', 'snackbar-progress'],
        attrs: { 'data-snackbar-id': id, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(safeTotal) }
    });

    const text = el('span', { class: 'snackbar-text', text: message || 'Выполняется…' });
    item.appendChild(text);

    const bar = el('div', { class: 'snackbar-progress-bar' });
    const fill = el('div', { class: 'snackbar-progress-fill' });
    fill.style.width = '0%';
    bar.appendChild(fill);
    item.appendChild(bar);

    const counter = el('span', { class: 'snackbar-progress-counter', text: `0 / ${safeTotal}` });
    item.appendChild(counter);

    root.appendChild(item);
    requestAnimationFrame(() => item.classList.add('show'));

    let finalized = false;

    const close = () => {
        if (!item.parentNode) return;
        item.classList.remove('show');
        setTimeout(() => { if (item.parentNode) item.parentNode.removeChild(item); }, SNACKBAR_TRANSITION_MS);
    };

    const update = (value, newMessage) => {
        if (finalized) return;
        const v = Math.min(Math.max(0, Number(value) || 0), safeTotal);
        const pct = safeTotal > 0 ? (v / safeTotal) * 100 : 0;
        fill.style.width = pct + '%';
        counter.textContent = `${v} / ${safeTotal}`;
        item.setAttribute('aria-valuenow', String(v));
        if (typeof newMessage === 'string') text.textContent = newMessage;
    };

    const finalize = (type, msg) => {
        if (finalized) return;
        finalized = true;
        item.classList.remove('snackbar-progress');
        item.classList.add(`snackbar-${type}`);
        item.setAttribute('role', 'status');
        text.textContent = msg;
        if (bar.parentNode) bar.parentNode.removeChild(bar);
        if (counter.parentNode) counter.parentNode.removeChild(counter);

        const closeBtn = el('button', {
            class: 'snackbar-close',
            text: '×',
            title: 'Закрыть уведомление',
            attrs: { type: 'button', 'aria-label': 'Закрыть' },
            onClick: close
        });
        item.appendChild(closeBtn);

        const duration = SNACKBAR_DURATION_BY_TYPE[type] ?? SNACKBAR_DURATION_MS;
        setTimeout(close, duration);
    };

    return {
        id,
        update,
        success: (msg) => finalize('success', msg),
        error:   (msg) => finalize('error', msg),
        warning: (msg) => finalize('warning', msg),
        close
    };
}
