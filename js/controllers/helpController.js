/**
 * Справка: загрузка UserManual.md (через fetch) и подготовка содержимого.
 *
 * Кэш — process-scoped: документ не меняется в рантайме, повторные вызовы
 * возвращают тот же результат без сетевого запроса. `clearReadmeCache()`
 * вызывается из контроллера сброса приложения для гигиены.
 *
 * Stage 14.4 (PATCH 2.7.2): источник кнопки «Справка» переключён с README.md
 * на UserManual.md. README остаётся для установки/troubleshoot'а до запуска,
 * UserManual — для уже запущенного приложения (workflow / ошибки в работе).
 */

import { renderMarkdown } from '../services/markdown.js';
import { escapeHtml } from '../utils/escapeHtml.js';

let _cachedHtml = null;

export async function loadReadmeHtml() {
    if (_cachedHtml) return _cachedHtml;
    try {
        const res = await fetch('UserManual.md', { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        _cachedHtml = renderMarkdown(text);
        return _cachedHtml;
    } catch (e) {
        // Сообщение исключения может быть подконтрольно среде/HTTP-серверу
        // (напр. ответ от прокси). Экранируем перед вставкой в innerHTML —
        // иначе теоретически возможен XSS-вектор через ответ сервера (10.2.1).
        return `<p>Не удалось загрузить UserManual.md: ${escapeHtml(e.message)}</p>` +
               `<p>Убедитесь, что приложение открыто через локальный HTTP-сервер.</p>`;
    }
}

export function clearReadmeCache() {
    _cachedHtml = null;
}
