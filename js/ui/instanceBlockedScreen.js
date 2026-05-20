/**
 * Stage 19.x: blocked-screen для случая, когда single-instance lock занят
 * другим экземпляром приложения (см. services/appInstanceLock.js).
 *
 * Принципы (по ТЗ):
 *   1. Не читать и не писать calc.* данные. Этот экран рендерится ДО
 *      `calcList.initFromStorage()` — store ещё пустой, persist subscribers
 *      ещё не подписаны. Если бы мы тут что-то прочитали, второй экземпляр
 *      мог бы тихо повредить состояние первого.
 *   2. Никакой кнопки «Открыть всё равно». Никакого bypass через query.
 *      Только: «Проверить снова» (перезагрузить страницу — обычный boot
 *      сделает свежую попытку acquire) и «Скопировать диагностику» для
 *      обращения в поддержку.
 *   3. Не импортировать controllers/state/persist — у блокированного
 *      экземпляра нет права трогать store. Только utils/dom.
 */

import { el, replace } from './dom.js';

/* ============================================================
 * Helpers
 * ============================================================ */

function formatLockTimestamp(iso) {
    if (typeof iso !== 'string' || iso.length === 0) return '—';
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return '—';
    try {
        return new Date(ts).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    } catch {
        return new Date(ts).toISOString();
    }
}

/**
 * Сформировать диагностический текст для копирования в буфер обмена.
 * Содержит: причину блокировки, метаданные текущего владельца lock'а,
 * текущий URL и времён. Не содержит секретов.
 */
function buildDiagnosticsText(lockResult) {
    const lines = [
        '— Калькулятор инфраструктуры: блокировка запуска —',
        ''
    ];
    if (lockResult && lockResult.reason === 'occupied') {
        lines.push('Причина: уже запущен другой экземпляр приложения.');
    } else if (lockResult && lockResult.reason === 'write-failed') {
        lines.push('Причина: не удалось записать lock в хранилище (возможно, исчерпана квота localStorage или включён приватный режим).');
    } else {
        lines.push('Причина: ' + (lockResult && lockResult.reason ? lockResult.reason : 'неизвестно') + '.');
    }
    lines.push('');
    const existing = lockResult && lockResult.existing;
    if (existing && typeof existing === 'object') {
        lines.push('Текущий владелец lock:');
        if (existing.startedAt) lines.push('  Запущен: ' + formatLockTimestamp(existing.startedAt));
        if (existing.lastSeenAt) lines.push('  Последний heartbeat: ' + formatLockTimestamp(existing.lastSeenAt));
        if (existing.appVersion) lines.push('  Версия: ' + existing.appVersion);
        if (existing.url) lines.push('  URL: ' + existing.url);
        if (existing.ownerId) lines.push('  Owner ID: ' + existing.ownerId);
    } else {
        lines.push('Lock не найден в хранилище (необычно).');
    }
    lines.push('');
    if (typeof location !== 'undefined') {
        lines.push('Этот экземпляр: ' + location.href);
    }
    lines.push('Время: ' + formatLockTimestamp(new Date().toISOString()));
    return lines.join('\n');
}

/* ============================================================
 * Render
 * ============================================================ */

/**
 * Отрендерить blocked-screen в #app (создаёт #app если контейнера нет).
 *
 * @param {{ ok?: boolean, reason?: string, existing?: Object|null }} lockResult
 *      Результат `acquireAppInstanceLock()` со значением `ok=false`.
 */
export function renderInstanceBlockedScreen(lockResult) {
    const reason = lockResult && lockResult.reason;
    const existing = lockResult && lockResult.existing;

    /* Текст — на русском, прямо из ТЗ. Без эмодзи (правило проекта). */
    const headline = 'Приложение уже открыто';
    const body = (reason === 'write-failed')
        ? 'Не удалось установить защитную блокировку запуска: хранилище браузера недоступно или переполнено. Без неё одновременный запуск нескольких окон может повредить ваши расчёты.'
        : 'Чтобы защитить ваши расчёты от потери данных, одновременно можно работать только в одном окне приложения.';
    const instruction = (reason === 'write-failed')
        ? 'Закройте лишние окна с приложением, освободите место в хранилище браузера и нажмите «Проверить снова».'
        : 'Закройте другое окно и нажмите «Проверить снова».';

    /* Кнопки. Без bypass-кнопки «Открыть всё равно». */
    const recheckBtn = el('button', {
        class: 'btn btn-primary',
        attrs: { type: 'button' },
        text: 'Проверить снова',
        onClick: () => {
            try { location.reload(); } catch { /* no-op для node-env */ }
        }
    });

    /* Кнопка «Закрыть эту вкладку». По HTML-spec `window.close()` через скрипт
     * работает ТОЛЬКО когда session history вкладки содержит ровно 1 Document
     * (новая вкладка / Ctrl+T → URL → blocked-screen) ИЛИ когда окно было
     * открыто через `window.open()`. Если у вкладки есть история навигации
     * (F5, переход по ссылкам, восстановленная сессия) — браузер тихо
     * проигнорирует close().
     *
     * PATCH 2.20.2: silent-fail v2.20.1 → пользователь не видел разницы между
     * «успешно закрыто» и «браузер заблокировал». Теперь:
     *  - проверяем закрытие через 250 ms (если бы window.close() сработал,
     *    этот колбэк уже бы не выполнился);
     *  - если выполнился — переключаем blocked-screen в режим failure-hint:
     *    подсказка становится warning-блоком с явным сообщением и `<kbd>`-
     *    стилизованными клавишами, кнопка дизейблится с текстом-объяснением. */
    const closeBtn = el('button', {
        class: 'btn',
        attrs: { type: 'button' },
        text: 'Закрыть эту вкладку',
        onClick: () => {
            try { window.close(); } catch { /* no-op для node-env */ }
            setTimeout(() => {
                /* Если мы здесь — close() проигнорирован браузером. */
                const hint = document.querySelector('.instance-blocked-close-hint');
                if (hint) {
                    hint.classList.add('instance-blocked-close-hint-failed');
                    /* Очищаем default-текст и рендерим warning-структуру с <kbd>. */
                    while (hint.firstChild) hint.removeChild(hint.firstChild);
                    const ua = (typeof navigator !== 'undefined' && navigator.platform) || '';
                    const isMac = /Mac|iPhone|iPad|iPod/i.test(ua);
                    hint.appendChild(el('strong', { text: 'Браузер заблокировал программное закрытие этой вкладки.' }));
                    hint.appendChild(el('br'));
                    hint.appendChild(document.createTextNode('Это защита от malicious-сайтов: закрывать можно только вкладки, у которых нет истории навигации. Закройте вручную: '));
                    if (isMac) {
                        hint.appendChild(el('kbd', { class: 'instance-blocked-kbd', text: 'Cmd' }));
                        hint.appendChild(document.createTextNode(' + '));
                        hint.appendChild(el('kbd', { class: 'instance-blocked-kbd', text: 'W' }));
                    } else {
                        hint.appendChild(el('kbd', { class: 'instance-blocked-kbd', text: 'Ctrl' }));
                        hint.appendChild(document.createTextNode(' + '));
                        hint.appendChild(el('kbd', { class: 'instance-blocked-kbd', text: 'W' }));
                    }
                    hint.appendChild(document.createTextNode('.'));
                    /* Фокус на блок — screen-reader проговорит aria-live. */
                    if (typeof hint.focus === 'function') {
                        hint.setAttribute('tabindex', '-1');
                        hint.focus({ preventScroll: false });
                    }
                }
                /* Кнопку отключаем — повторный клик ничего не даст, лучше явно
                 * показать что путь «через клик» исчерпан. */
                closeBtn.disabled = true;
                closeBtn.textContent = 'Закрытие заблокировано браузером';
                closeBtn.setAttribute('aria-disabled', 'true');
            }, 250);
        }
    });

    const copyBtn = el('button', {
        class: 'btn',
        attrs: { type: 'button' },
        text: 'Скопировать диагностику',
        onClick: () => {
            const txt = buildDiagnosticsText(lockResult);
            const onCopied = () => {
                copyBtn.textContent = 'Скопировано';
                setTimeout(() => { copyBtn.textContent = 'Скопировать диагностику'; }, 2000);
            };
            try {
                if (navigator?.clipboard?.writeText) {
                    navigator.clipboard.writeText(txt).then(onCopied, () => {
                        /* На отказ clipboard-permission показываем raw текст в textarea
                         * и подсвечиваем — пользователь скопирует руками. */
                        const ta = document.querySelector('.instance-blocked-diag');
                        if (ta) { ta.value = txt; ta.select(); }
                    });
                } else {
                    const ta = document.querySelector('.instance-blocked-diag');
                    if (ta) { ta.value = txt; ta.select(); }
                }
            } catch {
                /* no-op */
            }
        }
    });

    /* Блок с краткой диагностикой (только если есть existing-владелец).
     * Не показываем ownerId — это внутренний uuid, бесполезен для UX. */
    const diagChildren = [];
    if (existing && typeof existing === 'object') {
        const rows = [];
        if (existing.startedAt) {
            rows.push(el('div', { class: 'instance-blocked-diag-row' },
                el('span', { class: 'instance-blocked-diag-label', text: 'Открыто:' }),
                el('span', { class: 'instance-blocked-diag-value',
                    text: formatLockTimestamp(existing.startedAt) })
            ));
        }
        if (existing.lastSeenAt) {
            rows.push(el('div', { class: 'instance-blocked-diag-row' },
                el('span', { class: 'instance-blocked-diag-label', text: 'Последняя активность:' }),
                el('span', { class: 'instance-blocked-diag-value',
                    text: formatLockTimestamp(existing.lastSeenAt) })
            ));
        }
        if (existing.appVersion) {
            rows.push(el('div', { class: 'instance-blocked-diag-row' },
                el('span', { class: 'instance-blocked-diag-label', text: 'Версия:' }),
                el('span', { class: 'instance-blocked-diag-value', text: existing.appVersion })
            ));
        }
        if (rows.length > 0) {
            diagChildren.push(el('div', { class: 'instance-blocked-diag-list' }, ...rows));
        }
    }

    /* Скрытое textarea как fallback для copy-операции в браузерах без
     * navigator.clipboard.writeText. tabIndex=-1 — не попадает в Tab-обход. */
    const fallbackTextarea = el('textarea', {
        class: 'instance-blocked-diag',
        attrs: {
            'aria-hidden': 'true',
            tabindex: '-1',
            readonly: 'readonly'
        }
    });

    const root = el('div', {
        class: 'boot-fallback instance-blocked-screen',
        attrs: { role: 'alert', 'aria-live': 'assertive' }
    },
        el('h1', { class: 'boot-fallback-title', text: headline }),
        el('p', { text: body }),
        el('p', { text: instruction }),
        ...diagChildren,
        el('div', { class: 'instance-blocked-actions' },
            recheckBtn,
            closeBtn,
            copyBtn
        ),
        el('p', {
            class: 'instance-blocked-close-hint',
            text: 'Если кнопка «Закрыть эту вкладку» не сработала, закройте её вручную клавишами Ctrl+W (Windows/Linux) или Cmd+W (macOS) — браузер защищает от программного закрытия вкладок, открытых не из приложения.'
        }),
        fallbackTextarea
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
