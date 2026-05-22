/**
 * Stage 11.3: conflict resolution — applyOverrideToActiveCalc и
 * applyOverrideToAllCalcsForProvider должны блокироваться, если другая
 * вкладка сейчас обновляет прайс этого же провайдера.
 *
 * Сценарий:
 *   Вкладка A: жмёт «Обновить прайс» → захватывает cross-tab lock, делает
 *              fetch (несколько секунд).
 *   Вкладка B: пытается «Пересчитать на новом прайсе» на stale calc'е.
 *              Без 11.3: применяет ТЕКУЩИЙ старый override; потом вкладка A
 *                        завершит fetch и calc снова станет stale.
 *              С 11.3: операция отвергается с reason='locked-by-other-tab'.
 *
 * Tests:
 *   1. applyOverrideToActiveCalc с lock от другой вкладки → reject.
 *   2. applyOverrideToActiveCalc без lock → proceed (no regression).
 *   3. applyOverrideToActiveCalc со своим lock (теоретически невозможно,
 *      но guard должен работать симметрично) → proceed.
 *   4. applyOverrideToAllCalcsForProvider с lock → reject.
 *   5. applyOverrideToAllCalcsForProvider без lock → proceed.
 *   6. stale lock не блокирует.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let providerCtl;
let store;
let persist;
let crossTab;
let constants;

function makeOverride(providerId, version) {
    return {
        schemaVersion: 1,
        providerId,
        version,
        timestamp: '2026-05-09T12:00:00.000Z',
        source: 'test',
        prices: { 'cpu-vcpu-shared': { pricePerUnit: 999, vendor: 'X', priceSource: 'y' } }
    };
}

function makeCalc(id, providerId) {
    return {
        id, name: `Calc-${id}`,
        settings: { provider: providerId },
        answers: {},
        dictionaries: {
            items: [
                { id: 'cpu-vcpu-shared', pricePerUnit: 800, vendor: 'X', priceSource: 'y' }
            ],
            questions: []
        },
        view: { disabledStands: [] },
        updatedAt: '2026-01-01T00:00:00.000Z'
    };
}

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
    providerCtl = await import('../../../js/controllers/providerController.js');
    ({ store } = await import('../../../js/state/store.js'));
    persist = await import('../../../js/state/persistence.js');
    crossTab = await import('../../../js/state/crossTabSync.js');
    constants = await import('../../../js/utils/constants.js');
});

beforeEach(() => {
    installLocalStorage();
    if (globalThis.sessionStorage?.clear) globalThis.sessionStorage.clear();
    crossTab._resetTabIdForTesting();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setUi({ providerOverlayUpdate: {}, providerCrossTabLocks: {} });
});

describe('Stage 11.3 applyOverrideToActiveCalc — conflict guard', () => {
    it('reject когда lock от другой вкладки активен', () => {
        const calc = makeCalc('c1', 'sbercloud');
        store.setActiveCalc(calc);
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'Q3'));
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: 'other-tab', startedAt: new Date().toISOString() }
        });

        const r = providerCtl.applyOverrideToActiveCalc();
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'locked-by-other-tab');
        assert.match(r.message, /другой вкладке/i);
    });

    it('proceed когда lock отсутствует', () => {
        const calc = makeCalc('c1', 'sbercloud');
        store.setActiveCalc(calc);
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'Q3'));

        const r = providerCtl.applyOverrideToActiveCalc();
        assert.equal(r.ok, true);
        assert.equal(r.version, 'Q3');
    });

    it('proceed когда lock — наш (own tabId)', () => {
        const calc = makeCalc('c1', 'sbercloud');
        store.setActiveCalc(calc);
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'Q3'));
        const myTabId = crossTab.getTabId();
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: myTabId, startedAt: new Date().toISOString() }
        });

        const r = providerCtl.applyOverrideToActiveCalc();
        assert.equal(r.ok, true);
    });

    it('proceed когда lock stale (TTL exceeded)', () => {
        const calc = makeCalc('c1', 'sbercloud');
        store.setActiveCalc(calc);
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'Q3'));
        const oldTime = new Date(Date.now() - constants.PROVIDER_TAB_LOCK_TTL_MS - 5_000).toISOString();
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: 'dead-tab', startedAt: oldTime }
        });

        const r = providerCtl.applyOverrideToActiveCalc();
        assert.equal(r.ok, true);
    });
});

describe('Stage 11.3 applyOverrideToAllCalcsForProvider — conflict guard', () => {
    it('reject когда lock от другой вкладки активен', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'Q3'));
        const list = [{ id: 'c1', name: 'Calc 1', updatedAt: '2026-01-01T00:00:00.000Z' }];
        store.setCalcList(list);
        persist.saveCalcList(list);
        persist.saveCalc(makeCalc('c1', 'sbercloud'));
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: 'other-tab', startedAt: new Date().toISOString() }
        });

        const r = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'locked-by-other-tab');
    });

    it('proceed когда lock отсутствует', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'Q3'));
        const list = [{ id: 'c1', name: 'Calc 1', updatedAt: '2026-01-01T00:00:00.000Z' }];
        store.setCalcList(list);
        persist.saveCalcList(list);
        persist.saveCalc(makeCalc('c1', 'sbercloud'));

        const r = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(r.ok, true);
        assert.equal(r.applied, 1);
    });

    it('proceed когда lock — наш', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'Q3'));
        const list = [{ id: 'c1', name: 'Calc 1', updatedAt: '2026-01-01T00:00:00.000Z' }];
        store.setCalcList(list);
        persist.saveCalcList(list);
        persist.saveCalc(makeCalc('c1', 'sbercloud'));
        const myTabId = crossTab.getTabId();
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: myTabId, startedAt: new Date().toISOString() }
        });

        const r = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(r.ok, true);
    });
});

describe('Stage 11.3 restoreProviderOverrideFromHistory — conflict guard', () => {
    it('reject restore когда lock от другой вкладки', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'curr'));
        persist.pushProviderOverrideHistory('sbercloud', {
            appliedJSON: makeOverride('sbercloud', 'h0'),
            appliedAt: '2026-04-01T12:00:00.000Z'
        });
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: 'other-tab', startedAt: new Date().toISOString() }
        });

        const r = providerCtl.restoreProviderOverrideFromHistory('sbercloud', 0);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'locked-by-other-tab');
    });

    it('proceed restore когда нет lock', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'curr'));
        persist.pushProviderOverrideHistory('sbercloud', {
            appliedJSON: makeOverride('sbercloud', 'h0'),
            appliedAt: '2026-04-01T12:00:00.000Z'
        });

        const r = providerCtl.restoreProviderOverrideFromHistory('sbercloud', 0);
        assert.equal(r.ok, true);
    });
});

describe('Stage 11.3 rollbackProvider — conflict guard', () => {
    it('reject rollback когда lock от другой вкладки', () => {
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'curr'));
        persist.pushProviderOverrideHistory('sbercloud', {
            appliedJSON: makeOverride('sbercloud', 'h0'),
            appliedAt: '2026-04-01T12:00:00.000Z'
        });
        crossTab._writeLockMapForTesting({
            sbercloud: { tabId: 'other-tab', startedAt: new Date().toISOString() }
        });

        const r = providerCtl.rollbackProvider('sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'locked-by-other-tab');
    });
});
