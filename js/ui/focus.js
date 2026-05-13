/**
 * Управление фокусом при rerender'е и в модалках.
 *
 * Проблема: renderApp полностью пересобирает DOM, существующий <input> с фокусом
 * уничтожается, фокус уходит на body — пользователь теряет каретку при наборе.
 *
 * Решение: перед каждым render'ом снимаем «снимок» активного элемента (по
 * атрибуту data-focus-key и позиции каретки), а после render'а находим
 * соответствующий узел в новом дереве и восстанавливаем фокус и selection.
 */

const FOCUSABLE_SELECTOR =
    'input:not([disabled]):not([type="hidden"]),' +
    'textarea:not([disabled]),' +
    'select:not([disabled]),' +
    'button:not([disabled]),' +
    'a[href],' +
    '[tabindex]:not([tabindex="-1"])';

/**
 * Снять снимок текущего фокуса.
 * Возвращает { key, selectionStart, selectionEnd } или null.
 */
export function captureFocus() {
    const active = document.activeElement;
    if (!active || active === document.body) return null;
    const key = active.getAttribute && active.getAttribute('data-focus-key');
    if (!key) return null;
    let selectionStart = null, selectionEnd = null;
    try {
        if ('selectionStart' in active && active.selectionStart !== null) {
            selectionStart = active.selectionStart;
            selectionEnd = active.selectionEnd;
        }
    } catch { /* поля без selection (number/email) — пропускаем */ }
    return { key, selectionStart, selectionEnd };
}

/**
 * Восстановить фокус по снимку. Если соответствующего узла нет — no-op.
 */
export function restoreFocus(snapshot) {
    if (!snapshot) return false;
    const sel = `[data-focus-key="${cssEscape(snapshot.key)}"]`;
    const node = document.querySelector(sel);
    if (!node) return false;
    try {
        node.focus({ preventScroll: true });
        if (snapshot.selectionStart !== null && 'setSelectionRange' in node) {
            node.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
        }
    } catch { /* type=number и подобные — нормальный сценарий */ }
    return true;
}

/**
 * Сфокусировать первый focusable-элемент внутри узла (или элемент с data-autofocus).
 */
export function focusFirstIn(root) {
    if (!root) return false;
    const auto = root.querySelector('[data-autofocus]');
    if (auto) { auto.focus({ preventScroll: true }); return true; }
    const candidate = root.querySelector(FOCUSABLE_SELECTOR);
    if (candidate) { candidate.focus({ preventScroll: true }); return true; }
    return false;
}

/**
 * Установить focus-trap внутри модалки: Tab не уводит за пределы.
 *
 * Возвращает функцию-отписку. Trap должен пере-устанавливаться на каждый
 * render (т.к. DOM пересобирается).
 */
export function trapTabIn(modalEl) {
    if (!modalEl) return () => {};
    const onKeyDown = (e) => {
        if (e.key !== 'Tab') return;
        const list = Array.from(modalEl.querySelectorAll(FOCUSABLE_SELECTOR))
            .filter(el => el.offsetParent !== null || el === document.activeElement);
        if (list.length === 0) return;
        const first = list[0];
        const last  = list[list.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !modalEl.contains(active))) {
            e.preventDefault(); last.focus({ preventScroll: true });
        } else if (!e.shiftKey && active === last) {
            e.preventDefault(); first.focus({ preventScroll: true });
        }
    };
    modalEl.addEventListener('keydown', onKeyDown);
    return () => modalEl.removeEventListener('keydown', onKeyDown);
}

/* CSS.escape с фоллбеком для очень старых сред. */
function cssEscape(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
    return String(value).replace(/[^\w-]/g, ch => '\\' + ch);
}
