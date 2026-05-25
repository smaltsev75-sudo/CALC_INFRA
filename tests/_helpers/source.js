/**
 * Shared helpers для тестов, которые анализируют исходники CSS/JS как текст.
 *
 * 12.U31 (Code Review Followup, Subagent D P1-2): regex по исходнику без
 * удаления комментариев — анти-паттерн (false-pass когда литерал остаётся
 * в комментарии после рефакторинга). Эти helpers удаляют комментарии перед
 * матчингом и предоставляют единый способ извлечь body конкретного CSS-правила
 * или содержимое @media-блока.
 *
 * Имя папки `_helpers/` начинается с `_` — не подбирается tests/run.js
 * (он берёт `*.test.js`), импортируется явно по относительному пути.
 */

/** Удалить /* ... *\/ блочные комментарии из CSS-исходника. */
export function normalizeLineEndings(src) {
    return String(src).replace(/\r\n?/g, '\n');
}

export function stripCssComments(src) {
    return normalizeLineEndings(src).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Удалить /* ... *\/ блочные и // строчные комментарии из JS-исходника. */
export function stripJsComments(src) {
    return normalizeLineEndings(src)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
}

/**
 * Извлечь body одного CSS-правила (содержимое между `{` и `}`).
 * Возвращает строку без комментариев. Бросает если правило не найдено.
 */
export function ruleBody(src, selector) {
    const stripped = stripCssComments(src);
    const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]+)\\}');
    const m = stripped.match(re);
    if (!m) throw new Error(`CSS-правило ${selector} не найдено`);
    return m[1];
}

/**
 * Извлечь body @media-блока, чтобы проверять литералы ВНУТРИ блока,
 * а не где-нибудь в файле. Балансирует фигурные скобки.
 *
 * Пример: extractAtMediaBody(css, 'prefers-reduced-motion: reduce')
 * вернёт всё содержимое между `@media (prefers-reduced-motion: reduce) {`
 * и соответствующей закрывающей `}`.
 */
export function extractAtMediaBody(src, queryFragment) {
    const stripped = stripCssComments(src);
    const headerRe = new RegExp(
        '@media\\s*\\([^)]*' + queryFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^)]*\\)\\s*\\{'
    );
    const m = stripped.match(headerRe);
    if (!m) return null;
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < stripped.length && depth > 0) {
        const ch = stripped[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        if (depth === 0) return stripped.slice(start, i);
        i++;
    }
    return null;
}
