/**
 * Stage 11.1: cross-tab синхронизация — pure helpers + storage-event handler
 * для блокировок и уведомлений между вкладками.
 *
 * API:
 *   - getTabId() — uuid для текущей вкладки. Идемпотент в рамках сессии.
 *   - acquireProviderLock(providerId) → {ok, lockedByTab?} — пытается захватить
 *     lock в localStorage; если занят другой вкладкой и не stale — false.
 *   - releaseProviderLock(providerId) — снимает lock, если он наш.
 *   - isProviderLockedByOtherTab(providerId) → boolean — для UI.
 *   - getProviderLockMap() → snapshot всех current locks.
 *   - handleStorageEvent(event, store) — для тестов: эмулируем
 *     storage-event и проверяем reducer-эффекты.
 *
 * Lock-структура:
 *   { [providerId]: { tabId, startedAt } }
 *
 * TTL: PROVIDER_TAB_LOCK_TTL_MS (60_000ms по умолчанию). Lock старше TTL
 * считается мёртвым (вкладка крашнулась) и не блокирует.
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let crossTab;
let store;
let constants;

before(async () => {
    installLocalStorage();
    /* sessionStorage mock — некоторые helpers используют для tab-id persist'а
       внутри сессии. Простейший in-memory shim. */
    if (typeof globalThis.sessionStorage === 'undefined') {
        const _sessionMap = new Map();
        globalThis.sessionStorage = {
            getItem: (k) => _sessionMap.has(k) ? _sessionMap.get(k) : null,
            setItem: (k, v) => _sessionMap.set(k, String(v)),
            removeItem: (k) => _sessionMap.delete(k),
            clear: () => _sessionMap.clear()
        };
    }
    crossTab = await import('../../../js/state/crossTabSync.js');
    ({ store } = await import('../../../js/state/store.js'));
    constants = await import('../../../js/utils/constants.js');
});

beforeEach(() => {
    installLocalStorage();
    /* Reset session-side tab-id, чтобы каждый тест получал свежий. */
    if (globalThis.sessionStorage?.clear) globalThis.sessionStorage.clear();
    crossTab._resetTabIdForTesting();
    store.setUi({ providerCrossTabLocks: {} });
});

after(() => {
    /* node:test после suite не цепляет global state, но clean-up для гигиены. */
});

describe('Stage 11.1 getTabId — uuid тaba', () => {
    it('возвращает строку', () => {
        const id = crossTab.getTabId();
        assert.equal(typeof id, 'string');
        assert.ok(id.length > 0);
    });

    it('идемпотентен в рамках одной сессии (повторный вызов = тот же id)', () => {
        const a = crossTab.getTabId();
        const b = crossTab.getTabId();
        assert.equal(a, b);
    });

    it('после _resetTabIdForTesting — другой id', () => {
        const a = crossTab.getTabId();
        crossTab._resetTabIdForTesting();
        const b = crossTab.getTabId();
        assert.notEqual(a, b);
    });
});

describe('Stage 11.1 acquireProviderLock', () => {
    it('успешный захват → ok=true, lock записан в localStorage', () => {
        const r = crossTab.acquireProviderLock('sbercloud');
        assert.equal(r.ok, true);
        const map = crossTab.getProviderLockMap();
        assert.equal(map.sbercloud.tabId, crossTab.getTabId());
        assert.ok(map.sbercloud.startedAt);
    });

    it('повторный захват той же вкладкой → ok=true (idempotent)', () => {
        crossTab.acquireProviderLock('sbercloud');
        const r = crossTab.acquireProviderLock('sbercloud');
        assert.equal(r.ok, true);
    });

    it('захват уже залоченного другой вкладкой → ok=false, lockedByTab=other', () => {
        /* Симулируем чужую вкладку: пишем lock с другим tabId напрямую. */
        const otherTabId = 'other-tab-uuid';
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: otherTabId, startedAt: new Date().toISOString() }
        });
        const r = crossTab.acquireProviderLock('sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.lockedByTab, otherTabId);
    });

    it('stale lock (старше TTL) другой вкладки игнорируется → ok=true', () => {
        const oldTime = new Date(Date.now() - constants.PROVIDER_TAB_LOCK_TTL_MS - 5_000).toISOString();
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: 'dead-tab', startedAt: oldTime }
        });
        const r = crossTab.acquireProviderLock('sbercloud');
        assert.equal(r.ok, true, 'stale lock не должен блокировать');
    });

    it('non-string providerId → ok=false', () => {
        const r = crossTab.acquireProviderLock(null);
        assert.equal(r.ok, false);
    });
});

describe('Stage 11.1 releaseProviderLock', () => {
    it('снимает свой lock', () => {
        crossTab.acquireProviderLock('sbercloud');
        crossTab.releaseProviderLock('sbercloud');
        const map = crossTab.getProviderLockMap();
        assert.ok(!map.sbercloud);
    });

    it('не снимает чужой lock', () => {
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: 'other', startedAt: new Date().toISOString() }
        });
        crossTab.releaseProviderLock('sbercloud');
        const map = crossTab.getProviderLockMap();
        assert.equal(map.sbercloud.tabId, 'other', 'чужой lock остался нетронутым');
    });

    it('idempotent: release без acquire → no-op (no throw)', () => {
        assert.doesNotThrow(() => crossTab.releaseProviderLock('sbercloud'));
    });
});

describe('Stage 11.1 isProviderLockedByOtherTab', () => {
    it('false когда нет lock', () => {
        assert.equal(crossTab.isProviderLockedByOtherTab('sbercloud'), false);
    });

    it('false когда lock — наш', () => {
        crossTab.acquireProviderLock('sbercloud');
        assert.equal(crossTab.isProviderLockedByOtherTab('sbercloud'), false);
    });

    it('true когда lock — чужой и свежий', () => {
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: 'other', startedAt: new Date().toISOString() }
        });
        assert.equal(crossTab.isProviderLockedByOtherTab('sbercloud'), true);
    });

    it('false когда чужой lock stale', () => {
        const oldTime = new Date(Date.now() - constants.PROVIDER_TAB_LOCK_TTL_MS - 1000).toISOString();
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: 'dead', startedAt: oldTime }
        });
        assert.equal(crossTab.isProviderLockedByOtherTab('sbercloud'), false);
    });
});

describe('Stage 11.1 handleStorageEvent — обновление store при cross-tab events', () => {
    it('событие на PROVIDER_TAB_LOCKS → store.ui.providerCrossTabLocks обновлён', () => {
        const newValue = JSON.stringify({
            sbercloud: { tabId: 'other', startedAt: new Date().toISOString() }
        });
        crossTab.handleStorageEvent({
            key: constants.STORAGE_KEYS.PROVIDER_TAB_LOCKS,
            newValue,
            oldValue: null
        }, store);
        const locks = store.getState().ui.providerCrossTabLocks;
        assert.ok(locks.sbercloud);
        assert.equal(locks.sbercloud.tabId, 'other');
    });

    it('событие на нерелевантном ключе → store не меняется', () => {
        const before = JSON.stringify(store.getState().ui.providerCrossTabLocks);
        crossTab.handleStorageEvent({
            key: 'some.other.key',
            newValue: 'foo',
            oldValue: null
        }, store);
        const after = JSON.stringify(store.getState().ui.providerCrossTabLocks);
        assert.equal(after, before);
    });

    it('событие на PROVIDER_OVERLAY_OVERRIDES → store.ui.providerCrossTabUpdated обновлён', () => {
        const newValue = JSON.stringify({
            sbercloud: { schemaVersion: 1, providerId: 'sbercloud', version: 'Q3-from-other-tab',
                         timestamp: '2026-05-09T12:00:00.000Z', source: 'x', prices: {} }
        });
        crossTab.handleStorageEvent({
            key: constants.STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES,
            newValue,
            oldValue: null
        }, store);
        const updated = store.getState().ui.providerCrossTabUpdated;
        assert.ok(updated.sbercloud, 'для обновлённого провайдера должна быть запись');
        assert.equal(updated.sbercloud.version, 'Q3-from-other-tab');
    });

    it('null newValue (key cleared) → корректно сбрасывает локальные locks', () => {
        store.setUi({ providerCrossTabLocks: { sbercloud: { tabId: 'other', startedAt: new Date().toISOString() } } });
        crossTab.handleStorageEvent({
            key: constants.STORAGE_KEYS.PROVIDER_TAB_LOCKS,
            newValue: null,
            oldValue: 'something'
        }, store);
        assert.deepEqual(store.getState().ui.providerCrossTabLocks, {});
    });

    it('невалидный JSON в newValue → no throw, ничего не меняется', () => {
        const before = store.getState().ui.providerCrossTabLocks;
        assert.doesNotThrow(() => {
            crossTab.handleStorageEvent({
                key: constants.STORAGE_KEYS.PROVIDER_TAB_LOCKS,
                newValue: '{garbage{{',
                oldValue: null
            }, store);
        });
        assert.deepEqual(store.getState().ui.providerCrossTabLocks, before);
    });
});

describe('Stage 11.1 startCrossTabSync — public API', () => {
    it('экспортируется', () => {
        assert.equal(typeof crossTab.startCrossTabSync, 'function');
    });

    it('no-op в node-окружении (нет window)', () => {
        const result = crossTab.startCrossTabSync(store);
        /* В node без window это просто no-op; не должна throw'ить. */
        assert.ok(result === undefined || typeof result === 'function');
    });
});
