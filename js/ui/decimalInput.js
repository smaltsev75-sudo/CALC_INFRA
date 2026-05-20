/**
 * Helpers for decimal numeric inputs.
 *
 * HTML `<input type="number">` is hostile to ru-RU decimal input: comma is not
 * a valid programmatic value, and intermediate states like `1,` are easy to
 * lose on re-render. Use a text input with decimal keyboard hint instead.
 */

export const DECIMAL_INPUT_TYPE = 'text';

export function decimalInputAttrs(attrs = {}) {
    return {
        inputmode: 'decimal',
        autocomplete: 'off',
        ...attrs
    };
}

export function formatDecimalInputValue(value, opts = {}) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'string') return value.replace('.', ',');

    const n = Number(value);
    if (!Number.isFinite(n)) return '';

    const maxFractionDigits = Number.isInteger(opts.maxFractionDigits)
        ? Math.max(0, opts.maxFractionDigits)
        : 6;
    const rounded = Math.abs(n) < 1e12
        ? Number(n.toFixed(maxFractionDigits))
        : n;

    return String(Object.is(rounded, -0) ? 0 : rounded).replace('.', ',');
}
