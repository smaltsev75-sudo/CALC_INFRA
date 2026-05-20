/**
 * Helpers for decimal numeric inputs.
 *
 * HTML `<input type="number">` is hostile to ru-RU decimal input: comma is not
 * a valid programmatic value, and intermediate states like `1,` are easy to
 * lose on re-render. Use a text input with decimal keyboard hint instead.
 */

import { NUMBER_INPUT_FRACTION_DIGITS } from '../services/format.js';

export const DECIMAL_INPUT_TYPE = 'text';

export function decimalInputAttrs(attrs = {}) {
    return {
        inputmode: 'decimal',
        autocomplete: 'off',
        ...attrs
    };
}

export function limitDecimalInputPrecision(raw, opts = {}) {
    const maxFractionDigits = Number.isInteger(opts.maxFractionDigits)
        ? Math.max(0, opts.maxFractionDigits)
        : NUMBER_INPUT_FRACTION_DIGITS;
    const value = String(raw ?? '').replace(/\./g, ',');
    const sepIndex = value.indexOf(',');
    if (sepIndex === -1) return value;

    const head = value.slice(0, sepIndex + 1);
    const fraction = value.slice(sepIndex + 1).replace(/,/g, '');
    return head + fraction.slice(0, maxFractionDigits);
}

export function applyDecimalInputPrecision(input, opts = {}) {
    const value = limitDecimalInputPrecision(input?.value ?? '', opts);
    if (input && input.value !== value) input.value = value;
    return value;
}

function formatFiniteDecimal(n, maxFractionDigits) {
    const rounded = Math.abs(n) < 1e12
        ? Number(n.toFixed(maxFractionDigits))
        : n;

    return String(Object.is(rounded, -0) ? 0 : rounded).replace('.', ',');
}

export function formatDecimalInputValue(value, opts = {}) {
    if (value === null || value === undefined || value === '') return '';

    const maxFractionDigits = Number.isInteger(opts.maxFractionDigits)
        ? Math.max(0, opts.maxFractionDigits)
        : NUMBER_INPUT_FRACTION_DIGITS;

    if (typeof value === 'string') {
        const normalized = value.replace(/\s+/g, '').replace(',', '.');
        if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) {
            const n = Number(normalized);
            if (Number.isFinite(n)) return formatFiniteDecimal(n, maxFractionDigits);
        }
        return value.replace(/\./g, ',');
    }

    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return formatFiniteDecimal(n, maxFractionDigits);
}
