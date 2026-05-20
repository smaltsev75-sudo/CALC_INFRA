/**
 * Stage 19.x: blocked-screen для случая, когда single-instance lock занят
 * другим экземпляром приложения (см. services/appInstanceLock.js).
 *
 * Принципы (по ТЗ):
 *   1. Не читать и не писать calc.* данные. Этот экран рендерится ДО
 *      `calcList.initFromStorage()` — store ещё пустой, persist subscribers
 *      ещё не подписаны. Если бы мы тут что-то прочитали, второй экземпляр
 *      мог бы тихо повредить состояние первого.
 *   2. Никакого bypass: ни кнопки «Открыть всё равно», ни query-параметра.
 *      PATCH 2.20.4: убраны также кнопки «Закрыть эту вкладку» (browser
 *      блокировал window.close() для вкладок с историей навигации — silent-
 *      fail UX), «Скопировать диагностику» и сам диагностический блок
 *      (требование пользователя 2026-05-20 — лишние на этом экране).
 *      Единственное действие — «Проверить снова». Закрыть вкладку — через
 *      нативный shortcut браузера Ctrl+W / Cmd+W, упомянутый в инструкции.
 *   3. Не импортировать controllers/state/persist — у блокированного
 *      экземпляра нет права трогать store. Только utils/dom.
 */

import { el, replace } from './dom.js';

/**
 * Отрендерить blocked-screen в #app (создаёт #app если контейнера нет).
 *
 * @param {{ ok?: boolean, reason?: string, existing?: Object|null }} lockResult
 *      Результат `acquireAppInstanceLock()` со значением `ok=false`.
 */
export function renderInstanceBlockedScreen(lockResult) {
    const reason = lockResult && lockResult.reason;

    const headline = 'Приложение уже открыто';
    const body = (reason === 'write-failed')
        ? 'Не удалось установить защитную блокировку запуска: хранилище браузера недоступно или переполнено. Без неё одновременный запуск нескольких окон может повредить ваши расчёты.'
        : 'Чтобы защитить ваши расчёты от потери данных, одновременно можно работать только в одном окне приложения.';

    /* Платформенно-адаптивный shortcut в инструкции. */
    const ua = (typeof navigator !== 'undefined' && navigator.platform) || '';
    const isMac = /Mac|iPhone|iPad|iPod/i.test(ua);
    const closeShortcut = isMac ? 'Cmd+W' : 'Ctrl+W';
    const instruction = (reason === 'write-failed')
        ? 'Закройте лишние окна с приложением (' + closeShortcut + '), освободите место в хранилище браузера и нажмите «Проверить снова».'
        : 'Закройте эту вкладку клавишами ' + closeShortcut + ' или нажмите «Проверить снова», когда другое окно будет закрыто.';

    const recheckBtn = el('button', {
        class: 'btn btn-primary',
        attrs: { type: 'button' },
        text: 'Проверить снова',
        onClick: () => {
            try { location.reload(); } catch { /* no-op для node-env */ }
        }
    });

    const root = el('div', {
        class: 'boot-fallback instance-blocked-screen',
        attrs: { role: 'alert', 'aria-live': 'assertive' }
    },
        el('h1', { class: 'boot-fallback-title', text: headline }),
        el('p', { text: body }),
        el('p', { text: instruction }),
        el('div', { class: 'instance-blocked-actions' }, recheckBtn)
    );

    /* Не зависим от store/ctx: пишем напрямую в #app. Если контейнера нет
     * (теоретически возможно при экзотических ошибках загрузки) — создаём. */
    let host = typeof document !== 'undefined' ? document.getElementById('app') : null;
    if (!host && typeof document !== 'undefined') {
        host = el('div', { id: 'app' });
        document.body.appendChild(host);
    }
    if (host) replace(host, root);
    return root;
}
