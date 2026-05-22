/**
 * Stage 8.5: applyOverrideToAllCalcsForProvider — массовое применение override
 * ко всем calc'ам с тем же providerId в localStorage.
 *
 * Тесты:
 *   - happy path: 3 calc'а на sbercloud, все получают providerVersion+items.
 *   - mixed providers: yandex calc'и не трогаются.
 *   - already fresh: повторный apply пропускает up-to-date calc'и.
 *   - no override → reason='no-override'.
 *   - active calc обновляется через store.
 *   - errors: сохранение failed → один calc в errors[], остальные применены.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let providerCtl;
let store;
let persist;

const VALID_OVERRIDE = Object.freeze({
    schemaVersion: 1,
    providerId: 'sbercloud',
    version: '2026-Q3-test',
    timestamp: '2026-05-09T12:00:00.000Z',
    source: 'test',
    prices: {
        'cpu-vcpu-shared': { pricePerUnit: 999, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q3-test' }
    }
});

function makeCalc(id, providerId) {
    return {
        id, name: `Calc-${id}`,
        settings: { provider: providerId },
        answers: {},
        dictionaries: {
            items: [
                { id: 'cpu-vcpu-shared', pricePerUnit: 840, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q2' },
                { id: 'ram-gb',          pricePerUnit: 226, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q2' }
            ],
            questions: []
        },
        view: { disabledStands: [] },
        updatedAt: '2026-01-01T00:00:00.000Z'
    };
}

before(async () => {
    installLocalStorage();
    providerCtl = await import('../../../js/controllers/providerController.js');
    ({ store } = await import('../../../js/state/store.js'));
    persist = await import('../../../js/state/persistence.js');
});

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setUi({ providerOverlayUpdate: {} });
});

function seedCalcList(calcs) {
    persist.saveCalcList(calcs.map(c => ({
        id: c.id, name: c.name, updatedAt: c.updatedAt, totalMonthly: 0
    })));
    for (const c of calcs) persist.saveCalc(c);
}

describe('Stage 8.5 applyOverrideToAllCalcsForProvider — happy path', () => {
    it('применяет override ко всем calc\'ам с этим провайдером', () => {
        persist.saveProviderOverride('sbercloud', VALID_OVERRIDE);
        const calcs = ['c1', 'c2', 'c3'].map(id => makeCalc(id, 'sbercloud'));
        seedCalcList(calcs);

        const result = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');

        assert.equal(result.ok, true);
        assert.equal(result.applied, 3);
        assert.equal(result.alreadyFresh, 0);
        assert.deepEqual(result.errors, []);

        // Проверим, что в storage у каждого появился providerVersion
        for (const id of ['c1', 'c2', 'c3']) {
            const stored = persist.loadCalc(id);
            assert.equal(stored.providerVersion?.version, '2026-Q3-test');
            const cpu = stored.dictionaries.items.find(i => i.id === 'cpu-vcpu-shared');
            assert.equal(cpu.pricePerUnit, 999);
        }
    });

    it('mixed providers: yandex calc\'и не трогаются', () => {
        persist.saveProviderOverride('sbercloud', VALID_OVERRIDE);
        const calcs = [
            makeCalc('c1', 'sbercloud'),
            makeCalc('c2', 'yandex'),
            makeCalc('c3', 'sbercloud')
        ];
        seedCalcList(calcs);

        const result = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(result.applied, 2);

        const yandexCalc = persist.loadCalc('c2');
        assert.equal(yandexCalc.providerVersion, undefined,
            'yandex calc должен остаться без providerVersion');
        const sber1 = persist.loadCalc('c1');
        assert.equal(sber1.providerVersion?.version, '2026-Q3-test');
    });

    it('already-fresh calc\'и пропускаются (alreadyFresh count)', () => {
        persist.saveProviderOverride('sbercloud', VALID_OVERRIDE);
        const c1 = makeCalc('c1', 'sbercloud');
        c1.providerVersion = { id: 'sbercloud', version: '2026-Q3-test', timestamp: 't' };
        const c2 = makeCalc('c2', 'sbercloud');
        seedCalcList([c1, c2]);

        const result = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(result.applied, 1);
        assert.equal(result.alreadyFresh, 1);
    });
});

describe('Stage 8.5 applyOverrideToAllCalcsForProvider — fail paths', () => {
    it('нет override → reason=no-override', () => {
        const result = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'no-override');
    });

    it('пустой providerId → reason=invalid-provider', () => {
        const result = providerCtl.applyOverrideToAllCalcsForProvider('');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'invalid-provider');
    });

    it('пустой calcList → applied=0, ok=true', () => {
        persist.saveProviderOverride('sbercloud', VALID_OVERRIDE);
        const result = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');
        assert.equal(result.ok, true);
        assert.equal(result.applied, 0);
    });
});

describe('Stage 8.5 applyOverrideToAllCalcsForProvider — active calc', () => {
    it('active calc обновляется через store (триггерит ре-рендер)', () => {
        persist.saveProviderOverride('sbercloud', VALID_OVERRIDE);
        const c1 = makeCalc('c1', 'sbercloud');
        seedCalcList([c1]);
        store.setActiveCalc(c1);

        providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');

        const active = store.getState().activeCalc;
        assert.equal(active.providerVersion?.version, '2026-Q3-test');
        const cpu = active.dictionaries.items.find(i => i.id === 'cpu-vcpu-shared');
        assert.equal(cpu.pricePerUnit, 999);
    });
});
