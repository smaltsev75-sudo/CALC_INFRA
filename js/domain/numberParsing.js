const GROUP_SPACES_RE = /[\s\u00a0\u202f\u2007]/g;
const NUMERIC_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function parseLocalizedNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (typeof value !== 'string') return NaN;
    const compact = value.trim()
        .replace(GROUP_SPACES_RE, '')
        .replace(',', '.');
    if (compact === '' || !NUMERIC_RE.test(compact)) return NaN;
    const parsed = Number(compact);
    return Number.isFinite(parsed) ? parsed : NaN;
}

export function toFiniteNumber(value, fallback = 0) {
    const parsed = parseLocalizedNumber(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
