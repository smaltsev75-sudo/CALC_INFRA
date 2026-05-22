import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../../js/state/store.js';

describe('Store: basic', () => {
    let s;
    beforeEach(() => { s = new Store(); });

    it('initial state has expected shape', () => {
        const st = s.getState();
        assert.equal(st.activeTab, 'calculations');
        assert.equal(st.activeCalc, null);
        assert.equal(st.calcRevision, 0);
        assert.equal(st.persistStatus, 'idle');
        assert.deepEqual(st.calcList, []);
    });

    it('subscribers are notified on update', () => {
        let n = 0;
        s.subscribe(() => n++);
        s.setActiveTab('dashboard');
        assert.equal(n, 1);
    });

    it('unsubscribe stops notifications', () => {
        let n = 0;
        const unsub = s.subscribe(() => n++);
        s.setActiveTab('dashboard');
        unsub();
        s.setActiveTab('details');
        assert.equal(n, 1);
    });
});

describe('Store: activeCalc', () => {
    let s;
    beforeEach(() => { s = new Store(); });

    it('setActiveCalc increments revision', () => {
        const r0 = s.getState().calcRevision;
        s.setActiveCalc({ id: 'a', name: 'A' });
        const r1 = s.getState().calcRevision;
        assert.ok(r1 > r0);
    });

    it('updateActiveCalc updates updatedAt and revision', async () => {
        s.setActiveCalc({ id: 'a', name: 'A', updatedAt: '2026-01-01T00:00:00Z' });
        const t0 = s.getState().activeCalc.updatedAt;
        const r0 = s.getState().calcRevision;
        await new Promise(r => setTimeout(r, 5));
        s.updateActiveCalc({ name: 'B' });
        const st = s.getState();
        assert.equal(st.activeCalc.name, 'B');
        assert.notEqual(st.activeCalc.updatedAt, t0);
        assert.ok(st.calcRevision > r0);
    });

    it('updateActiveCalc with no active is no-op', () => {
        const r0 = s.getState().calcRevision;
        s.updateActiveCalc({ name: 'X' });
        assert.equal(s.getState().calcRevision, r0);
    });
});

describe('Store: deep freeze', () => {
    it('top-level is frozen', () => {
        const s = new Store();
        const st = s.getState();
        assert.ok(Object.isFrozen(st));
    });
    it('nested activeCalc is frozen', () => {
        const s = new Store();
        s.setActiveCalc({ id: 'a', dictionaries: { items: [{ id: 'x' }] } });
        const calc = s.getState().activeCalc;
        assert.ok(Object.isFrozen(calc));
        assert.ok(Object.isFrozen(calc.dictionaries));
        assert.ok(Object.isFrozen(calc.dictionaries.items));
        assert.ok(Object.isFrozen(calc.dictionaries.items[0]));
    });
    it('mutations throw in strict mode', () => {
        'use strict';
        const s = new Store();
        s.setActiveCalc({ id: 'a' });
        assert.throws(() => { s.getState().activeCalc.id = 'b'; });
    });
});

describe('Store: modals', () => {
    let s;
    beforeEach(() => { s = new Store(); });

    it('openModal sets open and payload', () => {
        s.openModal('confirm', { title: 'T', message: 'M' });
        const m = s.getState().modals.confirm;
        assert.equal(m.open, true);
        assert.equal(m.title, 'T');
        assert.equal(m.message, 'M');
    });

    it('patchModal merges into open modal', () => {
        s.openModal('itemEdit', { draft: { name: 'A' } });
        s.patchModal('itemEdit', { draft: { name: 'B' } });
        assert.equal(s.getState().modals.itemEdit.draft.name, 'B');
    });

    it('patchModal on closed modal is no-op', () => {
        s.patchModal('itemEdit', { draft: { name: 'B' } });
        assert.equal(s.getState().modals.itemEdit.open, false);
        assert.equal(s.getState().modals.itemEdit.draft, undefined);
    });

    it('closeModal sets open=false', () => {
        s.openModal('help');
        s.closeModal('help');
        assert.equal(s.getState().modals.help.open, false);
    });

    it('closeAllModals closes all', () => {
        s.openModal('help');
        s.openModal('reset');
        s.closeAllModals();
        assert.equal(s.getState().modals.help.open, false);
        assert.equal(s.getState().modals.reset.open, false);
    });
});

describe('Store: per-tab search', () => {
    it('setSearchForTab stores per-tab queries', () => {
        const s = new Store();
        s.setSearchForTab('details', 'foo');
        s.setSearchForTab('items', 'bar');
        const ui = s.getState().ui;
        assert.equal(ui.searchByTab.details, 'foo');
        assert.equal(ui.searchByTab.items, 'bar');
    });
});

describe('Store: batch', () => {
    it('multiple updates inside batch fire single notify', () => {
        const s = new Store();
        let n = 0;
        s.subscribe(() => n++);
        s.batch(() => {
            s.setActiveTab('details');
            s.setActiveTab('dashboard');
            s.setActiveTab('items');
        });
        assert.equal(n, 1);
    });
});

describe('Store: persistStatus', () => {
    it('setPersistStatus updates and message', () => {
        const s = new Store();
        s.setPersistStatus('error', 'oops');
        assert.equal(s.getState().persistStatus, 'error');
        assert.equal(s.getState().persistMessage, 'oops');
    });
});

describe('Store: subscribe re-entrancy (10.2.5)', () => {
    it('subscribe inside subscriber does not invoke the new subscriber in the same notify', () => {
        // Подписчик A в момент своего вызова подписывает B. B не должен
        // получить нотификацию в текущем _notify(): он подписался ПОСЛЕ
        // того, как был сделан снапшот списка подписчиков.
        const s = new Store();
        let aCalls = 0;
        let bCalls = 0;
        s.subscribe(() => {
            aCalls++;
            s.subscribe(() => { bCalls++; });
        });
        s.setActiveTab('dashboard');
        assert.equal(aCalls, 1, 'A должен быть вызван ровно 1 раз');
        assert.equal(bCalls, 0, 'B не должен быть вызван — он подписался после снапшота');
        // На следующей нотификации B уже подписан и должен сработать.
        s.setActiveTab('details');
        assert.equal(bCalls, 1, 'B должен сработать на следующей нотификации');
    });

    it('unsubscribe inside subscriber does not skip already-snapshot listeners', () => {
        // Если A отписывает B во время своего вызова, B всё равно вызывается
        // в этом же _notify(): снапшот списка был зафиксирован до итерации,
        // и Set для B уже содержит ссылку на момент начала обхода.
        const s = new Store();
        let aCalls = 0;
        let bCalls = 0;
        let unsubB;
        s.subscribe(() => {
            aCalls++;
            if (unsubB) unsubB();
        });
        unsubB = s.subscribe(() => { bCalls++; });
        s.setActiveTab('dashboard');
        assert.equal(aCalls, 1);
        assert.equal(bCalls, 1, 'B вызван в том же notify (снапшот зафиксирован до итерации)');
        // На следующей нотификации B уже отписан.
        s.setActiveTab('details');
        assert.equal(bCalls, 1, 'B больше не вызывается после отписки');
    });
});

describe('Store: subscriber error isolation (11.1.2)', () => {
    it('subscriber A throws → subscribers B and C all still get called', () => {
        // Один сломанный подписчик не должен прерывать цепочку нотификаций
        // для остальных. Все три подписчика должны быть вызваны независимо.
        const s = new Store();
        let aCalls = 0;
        let bCalls = 0;
        let cCalls = 0;
        // Подменяем console.error на no-op, чтобы не замусоривать вывод тестов.
        const origConsoleError = globalThis.console.error;
        globalThis.console.error = () => {};
        try {
            s.subscribe(() => { aCalls++; throw new Error('boom from A'); });
            s.subscribe(() => { bCalls++; });
            s.subscribe(() => { cCalls++; });
            s.setActiveTab('dashboard');
        } finally {
            globalThis.console.error = origConsoleError;
        }
        assert.equal(aCalls, 1, 'A вызван (и бросил)');
        assert.equal(bCalls, 1, 'B вызван несмотря на ошибку в A');
        assert.equal(cCalls, 1, 'C вызван несмотря на ошибку в A');
    });

    it('console.error is called with the thrown error from subscriber', () => {
        // Когда подписчик бросает, мы должны увидеть запись в console.error
        // с переданной ошибкой (developer-level логирование).
        const s = new Store();
        const captured = [];
        const origConsoleError = globalThis.console.error;
        globalThis.console.error = (...args) => { captured.push(args); };
        const boom = new Error('boom from subscriber');
        try {
            s.subscribe(() => { throw boom; });
            s.setActiveTab('dashboard');
        } finally {
            globalThis.console.error = origConsoleError;
        }
        assert.equal(captured.length, 1, 'console.error вызван ровно 1 раз');
        // Первый аргумент — текстовая префикс-метка, второй — сама ошибка.
        assert.ok(captured[0].includes(boom), 'console.error получил ту самую ошибку');
    });
});
