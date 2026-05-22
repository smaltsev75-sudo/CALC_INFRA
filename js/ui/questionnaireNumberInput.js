import { parseNumberInput } from '../services/format.js';
import {
    DECIMAL_INPUT_TYPE,
    applyDecimalInputPrecision,
    decimalInputAttrs,
    formatDecimalInputValue
} from './decimalInput.js';
import { el } from './dom.js';

/* ---------- Числовое поле с inline-валидацией ---------- */

export function renderNumberInput(q, value, isDisabled, focusKey, hoverHint, ctx) {
    // Placeholder при «нет информации»: показываем defaultIfUnknown курсивом серым.
    const placeholder = isDisabled && q.defaultIfUnknown !== undefined
        ? String(q.defaultIfUnknown)
        : (q.defaultValue !== undefined ? String(q.defaultValue) : '');

    const minAttr = q.min !== undefined ? q.min : undefined;
    const maxAttr = q.max !== undefined ? q.max : undefined;

    return el('input', {
        class: ['input', isDisabled && 'input-unknown'],
        type: DECIMAL_INPUT_TYPE,
        value: isDisabled ? '' : formatDecimalInputValue(value ?? ''),
        placeholder: formatDecimalInputValue(placeholder),
        title: hoverHint,
        attrs: decimalInputAttrs({
            disabled: isDisabled ? '' : undefined,
            'data-focus-key': focusKey
        }),
        onInput: e => {
            // Снимаем inline-ошибку при правке — пользователь должен видеть, что поле «жмётся».
            removeInlineError(e.target);
            const raw = applyDecimalInputPrecision(e.target);
            const n = parseNumberInput(raw);
            if (raw === '' || !Number.isFinite(n)) {
                // Промежуточное значение дроби (`1,` / `1.`) не коммитим,
                // иначе перерисовка удалит разделитель и пользователь не
                // сможет допечатать дробную часть.
                return;
            }
            // В границы — пишем; вне границ — НЕ пишем (старое значение сохраняется).
            if (isOutOfRange(n, minAttr, maxAttr)) {
                showInlineError(e.target, minAttr, maxAttr);
                return;
            }
            ctx.setAnswer(q.id, n);
        },
        onBlur: e => {
            const raw = applyDecimalInputPrecision(e.target);
            if (raw === '') {
                ctx.setAnswer(q.id, 0);
                removeInlineError(e.target);
                return;
            }
            const n = parseNumberInput(raw);
            if (!Number.isFinite(n)) return;
            if (isOutOfRange(n, minAttr, maxAttr)) {
                // На blur: не молчим — клампим и пишем clamped значение.
                const clamped = clamp(n, minAttr, maxAttr);
                e.target.value = String(clamped).replace('.', ',');
                ctx.setAnswer(q.id, clamped);
                showInlineError(e.target, minAttr, maxAttr, /*persist*/ true);
            } else {
                removeInlineError(e.target);
            }
        }
    });
}

function isOutOfRange(n, min, max) {
    if (min !== undefined && n < min) return true;
    if (max !== undefined && n > max) return true;
    return false;
}

function clamp(n, min, max) {
    let v = n;
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    return v;
}

function rangeLabel(min, max) {
    const lo = min !== undefined ? String(min) : '−∞';
    const hi = max !== undefined ? String(max) : '+∞';
    return `Допустимо: ${lo}…${hi}`;
}

/* WCAG 4.1.2 / WAI-ARIA 1.2: невалидное поле помечается `aria-invalid="true"`,
 * inline-сообщение получает уникальный id, поле связывается с ним через
 * `aria-describedby` — screen-reader озвучивает текст ошибки сразу после имени
 * поля. CSS-стиль красной рамки (.input[aria-invalid="true"]) — в components.css.
 * Сохраняем .input-invalid класс для обратной совместимости со старыми тестами. */
let _errIdSeq = 0;
function nextErrorId() {
    _errIdSeq += 1;
    return `field-err-${_errIdSeq}`;
}

function showInlineError(input, min, max, persist = false) {
    input.classList.add('input-invalid');
    input.setAttribute('aria-invalid', 'true');
    let err = input.parentElement && input.parentElement.querySelector(':scope > .field-inline-error');
    if (!err && input.parentElement) {
        const errId = input.getAttribute('aria-describedby') || nextErrorId();
        err = el('span', {
            class: 'field-inline-error',
            id: errId,
            attrs: { role: 'alert', 'aria-live': 'polite' }
        });
        if (input.nextSibling) input.parentElement.insertBefore(err, input.nextSibling);
        else input.parentElement.appendChild(err);
        input.setAttribute('aria-describedby', errId);
    }
    if (err) err.textContent = rangeLabel(min, max) + (persist ? ' — значение скорректировано' : '');
}

function removeInlineError(input) {
    input.classList.remove('input-invalid');
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    const err = input.parentElement && input.parentElement.querySelector(':scope > .field-inline-error');
    if (err) err.remove();
}
