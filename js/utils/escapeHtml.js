/**
 * Экранирование HTML-сущностей для безопасной вставки строк в DOM через innerHTML.
 * Используется везде, где пользовательский ввод выводится в HTML без textContent.
 */

const ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

// Backtick намеренно НЕ экранируется: он значащий в Markdown (inline-code),
// и markdown-рендер прогоняет экранирование ДО разбора структуры. Поскольку
// все атрибуты в нашем коде окружены кавычками, backtick безопасен в HTML.
const ESCAPE_RE = /[&<>"']/g;

export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    return str.replace(ESCAPE_RE, ch => ESCAPE_MAP[ch]);
}

/**
 * Экранирование значения для вставки в HTML-атрибут.
 * Эквивалентно escapeHtml, оставлено отдельно для семантической ясности кода.
 */
export function escapeAttr(value) {
    return escapeHtml(value);
}
