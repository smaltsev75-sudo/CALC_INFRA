/**
 * Модальное окно справки (UserManual.md).
 *
 * Контент UserManual загружается через ctx.loadReadmeHtml() — обёртка в app.js
 * над helpController. Прямой импорт controllers/* из ui/* запрещён
 * (см. tests/unit/architecture/layer-imports.test.js).
 */

import { el, trustedHtml, setTrustedHtml } from '../dom.js';
import { modalShell } from './baseModal.js';
import { appIconEl } from '../appIcon.js';
import { HOTKEYS, APP_NAME, APP_VERSION } from '../../utils/constants.js';

export function renderHelpModal(state, ctx) {
    const m = state.modals.help;
    if (!m.open) return null;
    const onClose = () => ctx.closeModal('help');

    const manualContent = el('div', {
        class: 'help-content',
        trustedHtml: trustedHtml('<p>Загрузка справки…</p>')
    });

    ctx.loadReadmeHtml().then(html => {
        // `loadReadmeHtml` возвращает уже санитизированный HTML (renderMarkdown),
        // поэтому помечаем как trusted перед вставкой в innerHTML.
        setTrustedHtml(manualContent, trustedHtml(html));
    });

    return modalShell({
        title: 'Справка',
        size: 'xl',
        onClose,
        children: el('div', null,
            renderHelpHeader(state),
            manualContent,
            renderHotkeysSection()
        ),
        footer: el('button', {
            class: 'btn btn-primary',
            title: 'Закрыть справку (Esc)',
            onClick: onClose
        }, 'Закрыть')
    });
}

/**
 * Брендовая шапка на первой странице Справки: иконка приложения + название +
 * номер версии. Иконка — единый источник js/ui/appIcon.js (та же, что favicon и
 * бренд в sidebar). Декоративна (aria-hidden) — доступное имя даёт видимый текст.
 */
function renderHelpHeader(state) {
    const iconVariant = state?.ui?.theme === 'light' ? 'light' : 'dark';
    return el('div', { class: 'help-title-card' },
        el('span', { class: 'help-title-logo' }, appIconEl({ size: 64, variant: iconVariant })),
        el('div', { class: 'help-title-meta' },
            el('div', { class: 'help-title-name', text: APP_NAME }),
            el('div', { class: 'help-title-version', text: `Версия ${APP_VERSION}` })
        )
    );
}

/**
 * Секция «Горячие клавиши» (Этап 12.2.6) — таблица из массива HOTKEYS,
 * чтобы пользователь мог посмотреть все шорткаты в одном месте.
 */
function renderHotkeysSection() {
    return el('div', { class: 'help-content' },
        el('hr'),
        el('h2', { text: 'Горячие клавиши' }),
        el('table', null,
            el('thead', null,
                el('tr', null,
                    el('th', { text: 'Сочетание' }),
                    el('th', { text: 'Действие' })
                )
            ),
            el('tbody', null,
                ...HOTKEYS.map(h =>
                    el('tr', null,
                        el('td', null, el('code', { text: h.keys })),
                        el('td', { text: h.label })
                    )
                )
            )
        )
    );
}
