/**
 * Stage 11.4: cross-tab события НЕ авто-применяют override к активному calc'у.
 *
 * Семантика:
 *   - Когда другая вкладка обновляет прайс провайдера, в текущей вкладке
 *     срабатывает storage-event handler → пишет в state.ui.providerCrossTabUpdated.
 *   - Тoast показывается через subscriber.
 *   - **НО**: calc.providerVersion и calc.dictionaries.items НЕ меняются
 *     автоматически. Пользователь должен явно нажать «Пересчитать на новом
 *     прайсе» чтобы применить.
 *
 * Это намеренное поведение: F5-safe + предсказуемость + защита от того, что
 * посередине работы калькулятор молча получит другие числа из-за активности
 * в соседней вкладке.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let crossTab;
let store;
let constants;
let persist;

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

function makeCalcWithProviderVersion(providerId, version) {
    return {
        id: 'c1', name: 'Calc-1',
        settings: { provider: providerId },
        providerVersion: { id: providerId, version, timestamp: '2026-04-01T12:00:00.000Z' },
        answers: {},
        dictionaries: {
            items: [
                { id: 'cpu-vcpu-shared', pricePerUnit: 800, vendor: 'X', priceSource: 'y' }
            ],
            questions: []
        },
        view: { disabledStands: [] },
        updatedAt: '2026-04-01T12:00:00.000Z'
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
    crossTab = await import('../../../js/state/crossTabSync.js');
    ({ store } = await import('../../../js/state/store.js'));
    constants = await import('../../../js/utils/constants.js');
    persist = await import('../../../js/state/persistence.js');
});

beforeEach(() => {
    installLocalStorage();
    if (globalThis.sessionStorage?.clear) globalThis.sessionStorage.clear();
    crossTab._resetTabIdForTesting();
    store.setActiveCalc(null);
    store.setUi({ providerCrossTabUpdated: {}, providerCrossTabLocks: {} });
});

describe('Stage 11.4 cross-tab event НЕ мутирует активный calc', () => {
    it('storage-event на OVERLAY_OVERRIDES не меняет calc.providerVersion', () => {
        const calc = makeCalcWithProviderVersion('sbercloud', 'old-version');
        store.setActiveCalc(calc);
        const beforeVersion = store.getState().activeCalc.providerVersion.version;

        const newOverride = makeOverride('sbercloud', 'NEW-from-other-tab');
        crossTab.handleStorageEvent({
            key: constants.STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES,
            newValue: JSON.stringify({ sbercloud: newOverride }),
            oldValue: null
        }, store);

        const afterVersion = store.getState().activeCalc.providerVersion.version;
        assert.equal(afterVersion, beforeVersion,
            'cross-tab event не должен менять calc.providerVersion — нужна явная команда apply');
    });

    it('storage-event не меняет calc.dictionaries.items', () => {
        const calc = makeCalcWithProviderVersion('sbercloud', 'old-version');
        store.setActiveCalc(calc);
        const beforePrice = store.getState().activeCalc.dictionaries.items[0].pricePerUnit;

        crossTab.handleStorageEvent({
            key: constants.STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES,
            newValue: JSON.stringify({ sbercloud: makeOverride('sbercloud', 'NEW') }),
            oldValue: null
        }, store);

        const afterPrice = store.getState().activeCalc.dictionaries.items[0].pricePerUnit;
        assert.equal(afterPrice, beforePrice,
            'items[].pricePerUnit не должны меняться от cross-tab event');
    });

    it('storage-event только пишет в providerCrossTabUpdated (для toast)', () => {
        crossTab.handleStorageEvent({
            key: constants.STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES,
            newValue: JSON.stringify({ sbercloud: makeOverride('sbercloud', 'NEW') }),
            oldValue: null
        }, store);

        const updated = store.getState().ui.providerCrossTabUpdated;
        assert.ok(updated.sbercloud);
        assert.equal(updated.sbercloud.version, 'NEW');
    });
});

describe('Stage 11.4 ctx.isActiveCalcStale корректно реагирует на cross-tab updates', () => {
    it('после cross-tab override → calc становится stale (isCalcStale=true)', async () => {
        const providerCtl = await import('../../../js/controllers/providerController.js');

        const calc = makeCalcWithProviderVersion('sbercloud', 'old-version');
        store.setActiveCalc(calc);
        /* Симулируем: другая вкладка обновила override на NEW. */
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'NEW'));

        const isStale = providerCtl.isActiveCalcStale();
        assert.equal(isStale, true,
            'getCurrentOverrideVersion=NEW vs calc.providerVersion=old → stale');
    });
});

describe('Stage 11.4 explicit apply работает после cross-tab event', () => {
    it('пользователь применяет вручную → providerVersion обновлён', async () => {
        const providerCtl = await import('../../../js/controllers/providerController.js');

        const calc = makeCalcWithProviderVersion('sbercloud', 'old-version');
        store.setActiveCalc(calc);
        persist.saveProviderOverride('sbercloud', makeOverride('sbercloud', 'NEW'));

        /* Симулируем cross-tab event — записываем в state.ui.providerCrossTabUpdated. */
        crossTab.handleStorageEvent({
            key: constants.STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES,
            newValue: JSON.stringify({ sbercloud: makeOverride('sbercloud', 'NEW') }),
            oldValue: null
        }, store);
        /* Calc всё ещё на old-version. */
        assert.equal(store.getState().activeCalc.providerVersion.version, 'old-version');

        /* Пользователь жмёт «Пересчитать на новом прайсе». */
        const r = providerCtl.applyOverrideToActiveCalc();
        assert.equal(r.ok, true);
        assert.equal(store.getState().activeCalc.providerVersion.version, 'NEW',
            'после явного apply — версия обновлена');
    });
});
