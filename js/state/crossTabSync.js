/**
 * Stage 11.1: Cross-tab синхронизация для provider-prices update flow.
 *
 * Цель: когда у пользователя открыто несколько вкладок, и одна из них
 * обновляет прайс провайдера (fetch JSON / file-pick), другие вкладки
 * должны (а) видеть «обновляется в другой вкладке» и блокировать свои
 * кнопки этого провайдера, (б) после завершения — узнать о новой версии
 * без F5 (toast + сводки/badge'и обновляются на следующем render'е).
 *
 * Архитектура:
 *   - **Tab-ID** — uuid на сессию вкладки. Persist в sessionStorage (выживает
 *     F5 в той же вкладке, разный для двух вкладок одной страницы).
 *   - **Lock map** — `STORAGE_KEYS.PROVIDER_TAB_LOCKS` в localStorage:
 *     `{ [providerId]: { tabId, startedAt: ISO } }`. Stale lock (старше TTL)
 *     игнорируется как «вкладка-владелец крашнулась».
 *   - **Storage-event listener** — слушает изменения релевантных ключей,
 *     обновляет `state.ui.providerCrossTabLocks` (для блокировки кнопок) и
 *     `state.ui.providerCrossTabUpdated` (триггер toast'а в UI subscriber'e
 *     или в Stage 11.2 helper'е).
 *
 * Lock — это UX-hint, не data-integrity guard. Если из-за race conditions
 * два tab'а одновременно решат, что lock у них — последний writer в
 * localStorage победит, и все вкладки сойдутся на финальном override.
 * Это приемлемо: pricing JSON идёмпотентен, а UX «одновременно тыкнули» —
 * редкий случай.
 */

import { readJson, writeJson } from '../services/storage.js';
import { STORAGE_KEYS, PROVIDER_TAB_LOCK_TTL_MS } from '../utils/constants.js';
import { uuid } from '../utils/uuid.js';

const TAB_ID_KEY = 'calc.tabId';

let _tabId = null;

/**
 * Получить uuid текущей вкладки. Idempotent: первый вызов генерирует и
 * пишет в sessionStorage; повторные — читают из cache. После F5 в той же
 * вкладке id восстанавливается из sessionStorage.
 *
 * @returns {string}
 */
export function getTabId() {
    if (_tabId) return _tabId;
    if (typeof sessionStorage !== 'undefined') {
        try {
            const cached = sessionStorage.getItem(TAB_ID_KEY);
            if (cached) {
                _tabId = cached;
                return cached;
            }
            const fresh = uuid();
            sessionStorage.setItem(TAB_ID_KEY, fresh);
            _tabId = fresh;
            return fresh;
        } catch {
            /* Safari Private / отсутствие sessionStorage — fallback на in-memory. */
        }
    }
    _tabId = uuid();
    return _tabId;
}

/* Сброс tab-id для тестов (между тестами). НЕ для production-кода. */
export function _resetTabIdForTesting() {
    _tabId = null;
    if (typeof sessionStorage !== 'undefined') {
        try { sessionStorage.removeItem(TAB_ID_KEY); } catch { /* ignore */ }
    }
}

/* Прямая запись lock-map (для тестов: симулировать чужую вкладку). */
export function _writeLockMapForTesting(map) {
    writeJson(STORAGE_KEYS.PROVIDER_TAB_LOCKS, map);
}

/* ---------- Lock-map management ---------- */

function _readLockMap() {
    const v = readJson(STORAGE_KEYS.PROVIDER_TAB_LOCKS, null);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return v;
}

function _isStale(lock) {
    if (!lock || !lock.startedAt) return true;
    const t = Date.parse(lock.startedAt);
    if (!Number.isFinite(t)) return true;
    return (Date.now() - t) > PROVIDER_TAB_LOCK_TTL_MS;
}

/**
 * Snapshot текущей lock-map (для UI / диагностики).
 *
 * @returns {Object<string, { tabId, startedAt }>}
 */
export function getProviderLockMap() {
    return _readLockMap();
}

/**
 * Захватить lock на провайдера для текущей вкладки.
 * Если уже залочено другой вкладкой и lock не stale — ok=false.
 *
 * @param {string} providerId
 * @returns {{ ok: true } | { ok: false, reason?: string, lockedByTab?: string }}
 */
export function acquireProviderLock(providerId) {
    if (!providerId || typeof providerId !== 'string') {
        return { ok: false, reason: 'invalid-provider' };
    }
    const map = _readLockMap();
    const myTabId = getTabId();
    const existing = map[providerId];
    if (existing && existing.tabId !== myTabId && !_isStale(existing)) {
        return { ok: false, reason: 'locked-by-other', lockedByTab: existing.tabId };
    }
    map[providerId] = { tabId: myTabId, startedAt: new Date().toISOString() };
    writeJson(STORAGE_KEYS.PROVIDER_TAB_LOCKS, map);
    return { ok: true };
}

/**
 * Снять lock текущей вкладки. Чужие locks не трогаем.
 */
export function releaseProviderLock(providerId) {
    if (!providerId || typeof providerId !== 'string') return;
    const map = _readLockMap();
    const myTabId = getTabId();
    if (map[providerId]?.tabId === myTabId) {
        delete map[providerId];
        writeJson(STORAGE_KEYS.PROVIDER_TAB_LOCKS, map);
    }
}

/**
 * Заблокирован ли провайдер другой вкладкой (для UI: disable кнопки).
 *
 * @param {string} providerId
 * @returns {boolean}
 */
export function isProviderLockedByOtherTab(providerId) {
    if (!providerId || typeof providerId !== 'string') return false;
    const map = _readLockMap();
    const lock = map[providerId];
    if (!lock || _isStale(lock)) return false;
    return lock.tabId !== getTabId();
}

/* ---------- Storage-event handler ---------- */

const RELEVANT_KEYS = new Set([
    STORAGE_KEYS.PROVIDER_TAB_LOCKS,
    STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES,
    STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY
]);

function _safeParse(s) {
    if (typeof s !== 'string' || !s) return null;
    try { return JSON.parse(s); }
    catch { return null; }
}

/**
 * Обработать storage-event. В тестах вызывается напрямую с фейк-объектом;
 * в production — через `window.addEventListener('storage', ...)`.
 *
 * Эффекты:
 *   - PROVIDER_TAB_LOCKS изменён → store.ui.providerCrossTabLocks обновлён
 *     (только locks других вкладок; свои locks не отображаем).
 *   - PROVIDER_OVERLAY_OVERRIDES изменён → store.ui.providerCrossTabUpdated:
 *     map { [providerId]: { version, timestamp, at: now } } для UI-toast.
 *   - PROVIDER_OVERRIDE_HISTORY изменён → no-op в state (UI читает напрямую).
 *
 * @param {{key: string|null, newValue: string|null, oldValue: string|null}} event
 * @param {Object} store — Store instance с setUi(patch).
 */
export function handleStorageEvent(event, store) {
    if (!event || !event.key) return;
    if (!RELEVANT_KEYS.has(event.key)) return;

    if (event.key === STORAGE_KEYS.PROVIDER_TAB_LOCKS) {
        const parsed = _safeParse(event.newValue);
        const myTabId = getTabId();
        const otherLocks = {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [providerId, lock] of Object.entries(parsed)) {
                if (lock && lock.tabId && lock.tabId !== myTabId && !_isStale(lock)) {
                    otherLocks[providerId] = lock;
                }
            }
        }
        store.setUi({ providerCrossTabLocks: otherLocks });
        return;
    }

    if (event.key === STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES) {
        const parsed = _safeParse(event.newValue);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
        /* Diff: какие провайдеры обновились (новый version) относительно old. */
        const oldParsed = _safeParse(event.oldValue) || {};
        const updated = { ...(store.getState().ui.providerCrossTabUpdated || {}) };
        const at = new Date().toISOString();
        for (const [providerId, override] of Object.entries(parsed)) {
            const oldVer = oldParsed[providerId]?.version;
            const newVer = override?.version;
            if (newVer && newVer !== oldVer) {
                updated[providerId] = {
                    version: newVer,
                    timestamp: override.timestamp,
                    at
                };
            }
        }
        store.setUi({ providerCrossTabUpdated: updated });
        return;
    }

    /* PROVIDER_OVERRIDE_HISTORY: no derived state — UI всё равно читает
       loadProviderOverrideHistory при render'е (через ctx). */
}

/* ---------- Public bootstrap API ---------- */

/**
 * Зарегистрировать window-listener на storage-events. Вызывается из
 * app.js boot. Возвращает unsubscribe-функцию (для тестов / hot-reload'а).
 *
 * В node-окружении (тесты, SSR) — no-op.
 *
 * @param {Object} store
 * @returns {Function|undefined} — unsubscribe (если listener установлен).
 */
export function startCrossTabSync(store) {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const handler = (e) => handleStorageEvent(e, store);
    window.addEventListener('storage', handler);
    /* Init: на boot прочитаем текущий lock-map и расставим store.ui. */
    const map = _readLockMap();
    const myTabId = getTabId();
    const otherLocks = {};
    for (const [providerId, lock] of Object.entries(map)) {
        if (lock?.tabId && lock.tabId !== myTabId && !_isStale(lock)) {
            otherLocks[providerId] = lock;
        }
    }
    store.setUi({ providerCrossTabLocks: otherLocks });
    return () => window.removeEventListener('storage', handler);
}
