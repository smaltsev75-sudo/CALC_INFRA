import { dateForFilename } from './format.js';

/**
 * Экранирует строку для безопасного включения в Markdown:
 *   - убирает control-chars (NUL, RTL-override и т.п.);
 *   - escape Markdown-метасимволов, чтобы пользовательский ввод не превращал
 *     текст в фейковые заголовки / списки / жирные блоки;
 *   - усечение по длине (защита от 10MB-pasted значения).
 *
 * @param {*} value
 * @param {object} [opts]
 * @param {number} [opts.maxLen=500]
 */
export function sanitizeMemoText(value, opts = {}) {
    if (value == null) return '';
    const maxLen = Number.isFinite(opts.maxLen) && opts.maxLen > 0
        ? opts.maxLen : 500;
    let s = String(value);
    // Удаляем control-chars (кроме \n и \t — их превратим ниже).
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // Переводы строк/табы заменяем на пробел — memo всегда single-line per cell.
    s = s.replace(/[\r\n\t]+/g, ' ');
    // Markdown-escape ТОЛЬКО реальных inline-метасимволов: backslash, code,
    // emphasis-маркеры, square-brackets (link/image syntax), pipe (GFM tables),
    // защитный `#` (heading при попадании в start-of-line). НЕ escape'им:
    //   - `(`, `)`: метасимволы ТОЛЬКО внутри `[text](url)` — после
    //     square-bracket. В нашем inline-output после `**Label:**` они безвредны
    //     и не должны выводиться как `\(...\)` (Stage 18.1.6: пользователь
    //     поймал на «Cloud.ru \(бывший SberCloud\)» и «RAG \(поиск...\)»).
    //   - `{`, `}`: не CommonMark-метасимволы (только в PHP/GFM extensions).
    //   - `-`, `+`, `!`, `>`, `~`: meta только в start-of-line; sanitize
    //     возвращает inline-фрагмент, эти символы безвредны.
    s = s.replace(/([\\`*_\[\]#|])/g, '\\$1');
    // Trim + cap.
    s = s.trim();
    if (s.length > maxLen) s = s.slice(0, maxLen) + '…';
    return s;
}

/**
 * Форматирует деньги для memo: тыс./млн ₽ при больших, иначе целые.
 * Знак, NaN/null → «—».
 */
export function formatMemoMoney(value) {
    if (!Number.isFinite(value)) return '—';
    const sign = value < 0 ? '−' : '';
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)} млн ₽`;
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)} тыс. ₽`;
    return `${sign}${Math.round(abs)} ₽`;
}

/**
 * Форматирует процент: «+18.0%», «−5.5%», «—» для NaN.
 */
export function formatMemoPercent(value) {
    if (!Number.isFinite(value)) return '—';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
}

/**
 * UUID-like detector: проверяет, не выглядит ли строка как UUID v4
 * (8-4-4-4-12 hex). Используется для skip'a UUID'ов в user-facing полях.
 */
export function isUuidLike(s) {
    return typeof s === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Sanitize filename для скачиваемого .md.
 * Возвращает строку без spec-chars, lowercase.
 */
export function sanitizeFilename(name) {
    let s = String(name == null ? '' : name).trim();
    // Убираем control-chars и опасные для FS символы.
    s = s.replace(/[\x00-\x1F\x7F]/g, '');
    s = s.replace(/[\\/:*?"<>|]/g, '_');
    // Пробелы/множественные пробелы → один дефис.
    s = s.replace(/\s+/g, '-');
    // Убираем повторяющиеся дефисы и подчёркивания.
    s = s.replace(/-+/g, '-').replace(/_+/g, '_');
    s = s.toLowerCase();
    if (s.length === 0) return 'decision-memo.md';
    return s.length > 200 ? s.slice(0, 200) : s;
}

/**
 * Имя файла для memo конкретного расчёта.
 * Дата — RU-формат `dd.mm.yyyy` через services/format.js (единообразно с
 * остальными exports CSV/JSON; линтер `date-format-ru` запрещает ISO).
 *
 * @param {object|null} calc
 * @param {Date} [now=new Date()]
 */
export function buildMemoFilename(calc, now = new Date()) {
    const dateRu = dateForFilename(now);
    const baseName = (calc?.name || '').trim();
    if (!baseName) return `decision-memo-${dateRu}.md`;
    const safe = sanitizeFilename(baseName);
    return `decision-memo-${safe}-${dateRu}.md`.replace(/--+/g, '-');
}

export function bulletLine(label, value) {
    const v = value == null || value === '' ? '—' : value;
    return `- **${label}:** ${v}`;
}

/**
 * Stage 18.1.9: pipe-aligned Markdown-таблица.
 *
 * Возвращает строку из 3+ строк (header + separator + data), где каждая cell
 * padded'ом выровнена до ширины самой длинной cell в своей колонке. Markdown-
 * рендеры (GitHub, VS Code preview, и т.д.) понимают такие таблицы так же, как
 * и сжатый формат — но в plain-text view (когда .md открывается в простом
 * редакторе) таблица читается естественно.
 *
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {Array<'left'|'right'>} alignments — выравнивание для каждой колонки
 * @returns {string}
 */
export function formatMarkdownTable(headers, rows, alignments) {
    const widths = headers.map((h, i) => {
        let max = String(h ?? '').length;
        for (const row of rows) {
            const cellLen = String(row[i] ?? '').length;
            if (cellLen > max) max = cellLen;
        }
        return max;
    });

    const padCell = (val, i) => {
        const s = String(val ?? '');
        return alignments[i] === 'right' ? s.padStart(widths[i]) : s.padEnd(widths[i]);
    };

    const headerRow = '| ' + headers.map((h, i) => padCell(h, i)).join(' | ') + ' |';

    // Separator — `---` или `---:` под right-aligned. Длина = widths[i] + 2
    // (учитывая пробелы вокруг cell) минус 1 для двоеточия.
    const sepRow = '|' + widths.map((w, i) => {
        if (alignments[i] === 'right') {
            return '-'.repeat(w + 1) + ':';
        }
        return '-'.repeat(w + 2);
    }).join('|') + '|';

    const dataRows = rows.map(row =>
        '| ' + row.map((c, i) => padCell(c, i)).join(' | ') + ' |'
    );

    return [headerRow, sepRow, ...dataRows].join('\n');
}

/**
 * Русское склонение числительного: pluralRu(1, 'год', 'года', 'лет') → 'год'.
 * Stage 18.1.5.
 */
export function pluralRu(n, one, few, many) {
    const abs = Math.abs(n) % 100;
    if (abs >= 11 && abs <= 14) return many;
    const last = abs % 10;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
}
