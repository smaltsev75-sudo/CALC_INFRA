/**
 * Stage 11.2: Live update notification — subscriber, который отслеживает
 * изменения state.ui.providerCrossTabUpdated и state.ui.providerCrossTabLocks
 * и вызывает snackbar-callback.
 *
 * Subscriber инкапсулируется в helper crossTabNotifier:
 *   - subscribe(store, snackbarFns) — wires; возвращает unsubscribe
 *   - snackbarFns: { info(msg), success(msg), warning(msg) }
 *
 * Эффекты:
 *   - Новая запись в providerCrossTabUpdated → snackbarFns.success(`Прайс ... обновлён в другой вкладке`)
 *     + reset записи (чтобы повторно не показывать)
 *   - Новая запись в providerCrossTabLocks (ранее не было) → snackbarFns.info(`... обновляется в другой вкладке`)
 *   - Исчезновение записи из locks → пропускаем (само по себе не toast'им)
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let crossTabNotifier;
let store;

before(async () => {
    installLocalStorage();
    if (typeof globalThis.sessionStorage === 'undefined') {
        const _m = new Map();
        globalThis.sessionStorage = {
            getItem: (k) => _m.has(k) ? _m.get(k) : null,
            setItem: (k, v) => _m.set(k, String(v)),
            removeItem: (k) => _m.delete(k),
            clear: () => _m.clear()
        };
    }
    crossTabNotifier = await import('../../../js/state/crossTabNotifier.js');
    ({ store } = await import('../../../js/state/store.js'));
});

beforeEach(() => {
    installLocalStorage();
    store.setUi({ providerCrossTabLocks: {}, providerCrossTabUpdated: {} });
});

function makeCallStub() {
    const calls = [];
    return {
        info:    (m) => calls.push({ type: 'info', message: m }),
        success: (m) => calls.push({ type: 'success', message: m }),
        warning: (m) => calls.push({ type: 'warning', message: m }),
        error:   (m) => calls.push({ type: 'error', message: m }),
        calls
    };
}

describe('Stage 11.2 crossTabNotifier — public API', () => {
    it('экспортирует subscribe', () => {
        assert.equal(typeof crossTabNotifier.subscribe, 'function');
    });

    it('subscribe возвращает unsubscribe-функцию', () => {
        const unsubscribe = crossTabNotifier.subscribe(store, makeCallStub());
        assert.equal(typeof unsubscribe, 'function');
        unsubscribe();
    });
});

describe('Stage 11.2 — реакция на providerCrossTabUpdated (новый override)', () => {
    it('новая запись → success-toast + clear', () => {
        const stub = makeCallStub();
        const unsubscribe = crossTabNotifier.subscribe(store, stub);

        store.setUi({
            providerCrossTabUpdated: {
                sbercloud: { version: 'Q3-other', timestamp: '2026-05-09T12:00:00.000Z', at: '2026-05-09T15:00:00.000Z' }
            }
        });

        const successCalls = stub.calls.filter(c => c.type === 'success');
        assert.equal(successCalls.length, 1);
        assert.match(successCalls[0].message, /sbercloud|SberCloud|Cloud\.ru/i);
        assert.match(successCalls[0].message, /Q3-other/);
        assert.match(successCalls[0].message, /другой\s+вкладке/i);

        /* После toast'а запись должна быть очищена. */
        assert.deepEqual(store.getState().ui.providerCrossTabUpdated, {});
        unsubscribe();
    });

    it('повторное обновление (после очистки) — снова toast', () => {
        const stub = makeCallStub();
        const unsubscribe = crossTabNotifier.subscribe(store, stub);

        store.setUi({
            providerCrossTabUpdated: {
                sbercloud: { version: 'v1', timestamp: '2026-05-09T12:00:00.000Z', at: '2026-05-09T15:00:00.000Z' }
            }
        });
        store.setUi({
            providerCrossTabUpdated: {
                sbercloud: { version: 'v2', timestamp: '2026-05-09T13:00:00.000Z', at: '2026-05-09T16:00:00.000Z' }
            }
        });

        assert.equal(stub.calls.filter(c => c.type === 'success').length, 2);
        unsubscribe();
    });

    it('пустой → пустой → no toast', () => {
        const stub = makeCallStub();
        const unsubscribe = crossTabNotifier.subscribe(store, stub);
        store.setUi({ providerCrossTabUpdated: {} });
        store.setUi({ providerCrossTabUpdated: {} });
        assert.equal(stub.calls.length, 0);
        unsubscribe();
    });
});

describe('Stage 11.2 — реакция на providerCrossTabLocks (другая вкладка начала update)', () => {
    it('появление нового lock → info-toast', () => {
        const stub = makeCallStub();
        const unsubscribe = crossTabNotifier.subscribe(store, stub);

        store.setUi({
            providerCrossTabLocks: {
                sbercloud: { tabId: 'other', startedAt: new Date().toISOString() }
            }
        });

        const infoCalls = stub.calls.filter(c => c.type === 'info');
        assert.equal(infoCalls.length, 1);
        assert.match(infoCalls[0].message, /sbercloud|cloud\.ru/i);
        assert.match(infoCalls[0].message, /обновля|обновляется/i);
        unsubscribe();
    });

    it('исчезновение lock → no toast (lock закрылся)', () => {
        const stub = makeCallStub();
        store.setUi({
            providerCrossTabLocks: {
                sbercloud: { tabId: 'other', startedAt: new Date().toISOString() }
            }
        });
        const unsubscribe = crossTabNotifier.subscribe(store, stub);

        store.setUi({ providerCrossTabLocks: {} });

        /* Само исчезновение lock'а — не toast (closing message ожидаем
           через providerCrossTabUpdated). */
        const lockCalls = stub.calls.filter(c => c.type === 'info' && /обновля/i.test(c.message));
        assert.equal(lockCalls.length, 0);
        unsubscribe();
    });

    it('тот же lock (без изменений) → no повторных toast', () => {
        const stub = makeCallStub();
        const unsubscribe = crossTabNotifier.subscribe(store, stub);
        const lock = { tabId: 'other', startedAt: '2026-05-09T15:00:00.000Z' };

        store.setUi({ providerCrossTabLocks: { sbercloud: lock } });
        store.setUi({ providerCrossTabLocks: { sbercloud: lock } });
        store.setUi({ providerCrossTabLocks: { sbercloud: lock } });

        const lockToasts = stub.calls.filter(c => c.type === 'info');
        assert.equal(lockToasts.length, 1, 'toast должен быть один — на appearance');
        unsubscribe();
    });
});

describe('Stage 11.2 — unsubscribe', () => {
    it('после unsubscribe — события не triggert toast', () => {
        const stub = makeCallStub();
        const unsubscribe = crossTabNotifier.subscribe(store, stub);
        unsubscribe();

        store.setUi({
            providerCrossTabUpdated: {
                sbercloud: { version: 'v1', timestamp: '2026-05-09T12:00:00.000Z', at: '2026-05-09T15:00:00.000Z' }
            }
        });

        assert.equal(stub.calls.length, 0);
    });
});
