/**
 * Stage 8.3: applyOverrideToActiveCalc / isActiveCalcStale / getCurrentOverrideVersion.
 *
 * Закрывает full pipeline: после save override через 8.2 кнопку, пользователь
 * жмёт «Пересчитать на новом прайсе» → applyOverrideToActiveCalc → swap items
 * + providerVersion + persist. Калькулятор начинает использовать новые цены.
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let providerCtl;
let store;
let persist;
let calcPersistence;

const VALID_OVERRIDE = Object.freeze({
    schemaVersion: 1,
    providerId: 'sbercloud',
    version: '2026-Q3-test',
    timestamp: '2026-05-09T12:00:00.000Z',
    source: 'test',
    prices: {
        'cpu-vcpu-shared': { pricePerUnit: 999, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q3-test' },
        'ram-gb':          { pricePerUnit: 250, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q3-test' }
    }
});

function makeMinimalCalc() {
    return {
        id: 'calc-test',
        name: 'Test',
        settings: { provider: 'sbercloud' },
        answers: {},
        dictionaries: {
            items: [
                /* Phase 4: fixture использует bundled net-prices как «стартовое
                 * состояние» dict.items — отражает реальный snapshot после
                 * Phase 4 frozen baseline. Override меняет cpu-vcpu-shared и
                 * ram-gb (2 deltas); storage-ssd-tb остаётся unchanged. */
                { id: 'cpu-vcpu-shared', pricePerUnit: 583.61, vendor: 'SberCloud', priceSource: 'bundled net' },
                { id: 'ram-gb',          pricePerUnit: 152.46, vendor: 'SberCloud', priceSource: 'bundled net' },
                { id: 'storage-ssd-tb',  pricePerUnit: 9719.67, vendor: 'SberCloud', priceSource: 'bundled net' }
            ],
            questions: []
        },
        view: { disabledStands: [] }
    };
}

before(async () => {
    installLocalStorage();
    providerCtl = await import('../../../js/controllers/providerController.js');
    ({ store } = await import('../../../js/state/store.js'));
    persist = await import('../../../js/state/persistence.js');
    calcPersistence = await import('../../../js/services/calcPersistence.js');
});

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setUi({ providerOverlayUpdate: {} });
});

describe('Stage 8.3 getCurrentOverrideVersion', () => {
    it('возвращает version из applied override', () => {
        persist.saveProviderOverride('sbercloud', VALID_OVERRIDE);
        assert.equal(providerCtl.getCurrentOverrideVersion('sbercloud'), '2026-Q3-test');
    });

    it('null если override отсутствует', () => {
        assert.equal(providerCtl.getCurrentOverrideVersion('sbercloud'), null);
    });
});

describe('Stage 8.3 isActiveCalcStale', () => {
    it('false при отсутствии активного расчёта', () => {
        assert.equal(providerCtl.isActiveCalcStale(), false);
    });

    it('false при отсутствии override (нечего пересчитывать)', () => {
        store.setActiveCalc(makeMinimalCalc());
        assert.equal(providerCtl.isActiveCalcStale(), false);
    });

    it('true при наличии override и без providerVersion в calc', () => {
        persist.saveProviderOverride('sbercloud', VALID_OVERRIDE);
        store.setActiveCalc(makeMinimalCalc());
        assert.equal(providerCtl.isActiveCalcStale(), true);
    });

    it('false при совпадающих версиях calc.providerVersion и override', () => {
        persist.saveProviderOverride('sbercloud', VALID_OVERRIDE);
        const calc = { ...makeMinimalCalc(),
            providerVersion: { id: 'sbercloud', version: '2026-Q3-test', timestamp: 't' }
        };
        store.setActiveCalc(calc);
        assert.equal(providerCtl.isActiveCalcStale(), false);
    });

    it('true при разных версиях', () => {
        persist.saveProviderOverride('sbercloud', VALID_OVERRIDE);
        const calc = { ...makeMinimalCalc(),
            providerVersion: { id: 'sbercloud', version: '2026-Q1-test', timestamp: 't' }
        };
        store.setActiveCalc(calc);
        assert.equal(providerCtl.isActiveCalcStale(), true);
    });
});

describe('Stage 8.3 applyOverrideToActiveCalc — happy path', () => {
    it('swap items через resolver, providerVersion записан', () => {
        persist.saveProviderOverride('sbercloud', VALID_OVERRIDE);
        store.setActiveCalc(makeMinimalCalc());

        const result = providerCtl.applyOverrideToActiveCalc();

        assert.equal(result.ok, true);
        assert.equal(result.version, '2026-Q3-test');
        assert.equal(result.deltas.length, 2);  // cpu-vcpu-shared + ram-gb (storage-ssd-tb не в override)
        const ids = result.deltas.map(d => d.id).sort();
        assert.deepEqual(ids, ['cpu-vcpu-shared', 'ram-gb']);

        const calc = store.getState().activeCalc;
        assert.deepEqual(calc.providerVersion, {
            id: 'sbercloud',
            version: '2026-Q3-test',
            timestamp: '2026-05-09T12:00:00.000Z'
        });

        const cpu = calc.dictionaries.items.find(i => i.id === 'cpu-vcpu-shared');
        assert.equal(cpu.pricePerUnit, 999);
        const ram = calc.dictionaries.items.find(i => i.id === 'ram-gb');
        assert.equal(ram.pricePerUnit, 250);
        /* Phase 4: storage-ssd-tb не в override → перетирается на frozen-default.
         * После Phase 4 frozen приходит из bundled JSON net: 11858 gross /
         * 1.22 = 9719.67 (раньше было 12378 из hardcoded SBERCLOUD_PRICES). */
        const ssd = calc.dictionaries.items.find(i => i.id === 'storage-ssd-tb');
        assert.equal(ssd.pricePerUnit, 9719.67);
    });

    it('повторный apply с тем же override → providerVersion остаётся, deltas=[]', () => {
        persist.saveProviderOverride('sbercloud', VALID_OVERRIDE);
        store.setActiveCalc(makeMinimalCalc());

        providerCtl.applyOverrideToActiveCalc();
        const result2 = providerCtl.applyOverrideToActiveCalc();

        assert.equal(result2.ok, true);
        assert.deepEqual(result2.deltas, []);
        const calc = store.getState().activeCalc;
        assert.equal(calc.providerVersion.version, '2026-Q3-test');
    });
});

describe('Stage 8.3 applyOverrideToActiveCalc — fail paths', () => {
    it('нет активного расчёта → reason=no-active-calc', () => {
        const result = providerCtl.applyOverrideToActiveCalc();
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'no-active-calc');
    });

    it('calc без provider → reason=no-provider', () => {
        const calc = makeMinimalCalc();
        delete calc.settings.provider;
        store.setActiveCalc(calc);
        const result = providerCtl.applyOverrideToActiveCalc();
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'no-provider');
    });

    it('нет загруженного override → reason=no-override', () => {
        store.setActiveCalc(makeMinimalCalc());
        const result = providerCtl.applyOverrideToActiveCalc();
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'no-override');
    });
});
