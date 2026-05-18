/**
 * Минималистичный безопасный Markdown-рендер для встроенной справки.
 * Поддерживает: заголовки h1..h4, списки ul/ol, **жирный**, *курсив*, `code`,
 * --- горизонтальные разделители, таблицы | a | b |, ссылки [text](url),
 * параграфы, code-блоки ```.
 *
 * Все строки экранируются перед обработкой; ссылки фильтруются (только http/https/#).
 * Не использует innerHTML напрямую для пользовательского текста — только escapeHtml.
 */

import { escapeHtml } from '../utils/escapeHtml.js';

const SAFE_URL_RE = /^(?:https?:\/\/|#|mailto:)/i;

function safeUrl(url) {
    const trimmed = String(url).trim();
    if (SAFE_URL_RE.test(trimmed)) return escapeHtml(trimmed);
    return '#';
}

/**
 * Inline-обработка: bold, italic, code, links.
 * На вход — уже экранированная (escapeHtml) строка.
 * Замены делаются по плейсхолдерам, чтобы исключить HTML-инъекцию через метасимволы.
 */
function inline(escaped) {
    let s = escaped;
    // Сначала inline-code, чтобы маркеры внутри ``...`` не интерпретировались.
    s = s.replace(/`([^`]+?)`/g, (_, code) => `<code>${code}</code>`);
    // Ссылки [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) =>
        `<a href="${safeUrl(url)}" rel="noopener noreferrer">${text}</a>`);
    // Жирный
    s = s.replace(/\*\*([^*]+?)\*\*/g, (_, t) => `<strong>${t}</strong>`);
    // Курсив (одиночные звёздочки, без коллизий с **)
    s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, (_, pre, t) => `${pre}<em>${t}</em>`);
    return s;
}

/**
 * Главная функция. Возвращает HTML-строку.
 */
/**
 * Slugify для id-атрибутов heading'ов. Поддерживает кириллицу
 * (`\p{L}` — любая буква, `\p{N}` — любая цифра). Используется в `[](#anchor)`
 * ссылках TOC внутри `UserManual.md`. Контракт sanitization: возвращает строку,
 * содержащую только `[a-zа-яё0-9_-]` lowercase → safe для подстановки в HTML
 * id-атрибут без дополнительного escape.
 */
function slugifyHeadingId(text) {
    return String(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')   // оставить только буквы / цифры / пробелы / _ / -
        .trim()
        .replace(/\s+/g, '-')                  // пробелы → один дефис
        .replace(/-+/g, '-');                  // схлопнуть последовательные дефисы
}

export function renderMarkdown(text) {
    if (!text || typeof text !== 'string') return '';

    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;

    /* Счётчик id для уникальности при дубликатах заголовков (например, в
     * UserManual.md «### Decision Memo» появляется дважды). Второе вхождение
     * получает `-1` суффикс, как в GitHub. Карта живёт ОДИН прогон renderMarkdown
     * (не module-level) — иначе повторные вызовы накапливали бы счётчики. */
    const headingIdCounts = new Map();
    function makeHeadingId(headingText) {
        const base = slugifyHeadingId(headingText);
        if (!base) return '';
        const n = headingIdCounts.get(base) || 0;
        headingIdCounts.set(base, n + 1);
        return n === 0 ? base : `${base}-${n}`;
    }

    let listType = null; // 'ul' | 'ol' | null
    const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

    let inCodeBlock = false;
    const codeBuf = [];

    let inTable = false;
    const tableRows = [];
    const flushTable = () => {
        if (!inTable) return;
        if (tableRows.length === 0) { inTable = false; return; }
        out.push('<table>');
        // Первая строка — заголовок, вторая — разделитель |---|---|, дальше — данные.
        const header = tableRows[0];

        /* Stage 18.1.11: парсим alignment из separator-строки `|---|--:|:--|:-:|`.
           До этого мы её игнорировали → cells выводились без `align`-атрибута,
           CSS-правила вида `td[align="right"]` не срабатывали → числовые
           колонки не выравнивались по правому краю. Глобальное правило проекта:
           «все цифровые значения в таблицах должны быть выровнены по правому
           краю» — обеспечивается через separator `--:` в markdown + CSS. */
        const sep = tableRows[1] || [];
        const alignments = sep.map(cell => {
            const c = cell.trim();
            const left = c.startsWith(':');
            const right = c.endsWith(':');
            if (left && right) return 'center';
            if (right) return 'right';
            if (left) return 'left';
            return null; // default — без атрибута
        });
        const alignAttr = (i) => alignments[i] ? ` align="${alignments[i]}"` : '';

        out.push('<thead><tr>' + header.map((c, i) =>
            `<th${alignAttr(i)}>${inline(escapeHtml(c.trim()))}</th>`
        ).join('') + '</tr></thead>');
        out.push('<tbody>');
        for (let r = 2; r < tableRows.length; r++) {
            out.push('<tr>' + tableRows[r].map((c, i) =>
                `<td${alignAttr(i)}>${inline(escapeHtml(c.trim()))}</td>`
            ).join('') + '</tr>');
        }
        out.push('</tbody></table>');
        tableRows.length = 0;
        inTable = false;
    };

    while (i < lines.length) {
        const raw = lines[i];

        // Code-блок ```
        if (/^\s*```/.test(raw)) {
            if (inCodeBlock) {
                out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
                codeBuf.length = 0;
                inCodeBlock = false;
            } else {
                closeList(); flushTable();
                inCodeBlock = true;
            }
            i++;
            continue;
        }
        if (inCodeBlock) {
            codeBuf.push(raw);
            i++;
            continue;
        }

        // Таблица: строки с | в начале/середине
        if (/^\s*\|.*\|\s*$/.test(raw)) {
            closeList();
            const cells = raw.trim().slice(1, -1).split('|');
            tableRows.push(cells);
            inTable = true;
            i++;
            continue;
        } else if (inTable) {
            flushTable();
        }

        const line = raw.trim();

        if (line === '') {
            closeList();
            i++;
            continue;
        }

        // Заголовки
        const h = /^(#{1,4})\s+(.*)$/.exec(line);
        if (h) {
            closeList();
            const level = h[1].length;
            const headingText = h[2];
            const id = makeHeadingId(headingText);
            const idAttr = id ? ` id="${id}"` : '';
            out.push(`<h${level}${idAttr}>${inline(escapeHtml(headingText))}</h${level}>`);
            i++;
            continue;
        }

        // Горизонтальная линия
        if (/^---+$/.test(line)) {
            closeList();
            out.push('<hr>');
            i++;
            continue;
        }

        // Маркированный список
        const ul = /^[-*]\s+(.*)$/.exec(line);
        if (ul) {
            if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
            out.push(`<li>${inline(escapeHtml(ul[1]))}</li>`);
            i++;
            continue;
        }

        // Нумерованный список
        const ol = /^\d+\.\s+(.*)$/.exec(line);
        if (ol) {
            if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
            out.push(`<li>${inline(escapeHtml(ol[1]))}</li>`);
            i++;
            continue;
        }

        // Параграф
        closeList();
        out.push(`<p>${inline(escapeHtml(line))}</p>`);
        i++;
    }

    closeList();
    flushTable();
    if (inCodeBlock) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
    }
    return out.join('\n');
}
