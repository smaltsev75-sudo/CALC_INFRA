/**
 * Stage 11.2: subscriber-helper, который реагирует на изменения cross-tab
 * derived state (state.ui.providerCrossTabLocks, providerCrossTabUpdated)
 * и вызывает snackbar-callback'и для уведомления пользователя.
 *
 * Зачем отдельный модуль:
 *   - app.js boot уже многословный, добавление ещё одной subscribe-логики
 *     в общий subscriber усложняет его.
 *   - Тесты subscribe'а проще писать в изоляции (без mount UI).
 *   - Subscriber pattern позволяет unsubscribe в hot-reload / тестах.
 *
 * Используется из app.js: `subscribe(store, snackbar)` после mountUi.
 */

import { PROVIDER_OVERLAYS } from '../domain/providerOverlay.js';

function _providerLabel(providerId) {
    return PROVIDER_OVERLAYS[providerId]?.label || providerId;
}

/**
 * Подписаться на cross-tab events store'а. Возвращает unsubscribe-функцию.
 *
 * @param {Object} store — Store instance с subscribe / setUi / getState.
 * @param {{info, success, warning, error}} snackbarFns — snackbar API
 *     (info/success/warning принимают message string).
 * @returns {Function} unsubscribe.
 */
export function subscribe(store, snackbarFns) {
    let lastUpdated = store.getState().ui.providerCrossTabUpdated || {};
    let lastLocks   = store.getState().ui.providerCrossTabLocks || {};

    const unsubscribe = store.subscribe((state) => {
        const updated = state.ui.providerCrossTabUpdated || {};
        const locks   = state.ui.providerCrossTabLocks || {};

        /* (a) Новые записи в providerCrossTabUpdated → success toast + clear. */
        const newUpdates = [];
        for (const [providerId, info] of Object.entries(updated)) {
            const prev = lastUpdated[providerId];
            if (!prev || prev.version !== info.version || prev.at !== info.at) {
                newUpdates.push({ providerId, info });
            }
        }
        if (newUpdates.length > 0 && typeof snackbarFns?.success === 'function') {
            for (const { providerId, info } of newUpdates) {
                const label = _providerLabel(providerId);
                snackbarFns.success(
                    `Прайс «${label}» обновлён в другой вкладке до ${info.version}.`
                );
            }
            /* Clear показанные записи, чтобы повторный show не повторял toast. */
            const remaining = { ...updated };
            for (const { providerId } of newUpdates) delete remaining[providerId];
            /* Sequence: store.setUi триггернет следующий subscriber-вызов с
               пустым updated; lastUpdated будет пустой к тому моменту. */
            lastUpdated = remaining;
            store.setUi({ providerCrossTabUpdated: remaining });
        } else {
            lastUpdated = updated;
        }

        /* (b) Новые locks (не было → стало) → info toast.
              Снятие lock'а само по себе не toast'им — closing-message приходит
              через providerCrossTabUpdated. */
        for (const [providerId, lock] of Object.entries(locks)) {
            const prev = lastLocks[providerId];
            const isNew = !prev || prev.tabId !== lock.tabId || prev.startedAt !== lock.startedAt;
            if (isNew && typeof snackbarFns?.info === 'function') {
                const label = _providerLabel(providerId);
                snackbarFns.info(`Прайс «${label}» обновляется в другой вкладке…`);
            }
        }
        lastLocks = locks;
    });

    return unsubscribe;
}
