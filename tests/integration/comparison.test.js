import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const { store } = await import('../../js/state/store.js');
const calcList = await import('../../js/controllers/calcListController.js');
const calc = await import('../../js/controllers/calcController.js');
const { calculate } = await import('../../js/domain/calculator.js');
const persist = await import('../../js/state/persistence.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setComparisonIds([]);
});

describe('Сравнение: store', () => {
    it('addComparisonId добавляет уникальные', () => {
        store.addComparisonId('a');
        store.addComparisonId('b');
        store.addComparisonId('a'); // дубль игнорируется
        assert.deepEqual(store.getState().comparisonIds, ['a', 'b']);
    });

    it('лимит 4 расчёта', () => {
        for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) store.addComparisonId(id);
        assert.equal(store.getState().comparisonIds.length, 4);
    });

    it('removeComparisonId убирает', () => {
        store.setComparisonIds(['a', 'b', 'c']);
        store.removeComparisonId('b');
        assert.deepEqual(store.getState().comparisonIds, ['a', 'c']);
    });

    it('setComparisonIds обрезает до 4', () => {
        store.setComparisonIds(['a','b','c','d','e','f']);
        assert.equal(store.getState().comparisonIds.length, 4);
    });
});

describe('Сравнение: end-to-end', () => {
    it('два расчёта с разными ответами дают разный qty одного ЭК', async () => {
        // ВАЖНО: в seed pricePerUnit=0, поэтому totalMonthly=0 везде. Проверяем
        // изменение qty на cpu-vcpu-shared (формула зависит от Q.peak_rps).
        const c1 = calcList.createCalc('Small');
        calc.setAnswer('peak_rps', 10);
        calc.setAnswer('microservices_count', 1);
        await new Promise(r => setTimeout(r, 150));
        const c2 = calcList.createCalc('Large');
        calc.setAnswer('peak_rps', 500);
        calc.setAnswer('microservices_count', 20);
        await new Promise(r => setTimeout(r, 150));

        store.setComparisonIds([c1.id, c2.id]);

        const loaded1 = persist.loadCalc(c1.id);
        const loaded2 = persist.loadCalc(c2.id);
        const r1 = calculate(loaded1);
        const r2 = calculate(loaded2);

        const q1 = r1.items['cpu-vcpu-shared']?.stands?.PROD?.qty ?? 0;
        const q2 = r2.items['cpu-vcpu-shared']?.stands?.PROD?.qty ?? 0;

        assert.ok(q2 > q1,
            `peak_rps=500 + microservices=20 должно дать больше vCPU чем peak_rps=10 + 1: q1=${q1}, q2=${q2}`);
    });

    it('comparisonIds хранятся в state', () => {
        const c1 = calcList.createCalc('A');
        const c2 = calcList.createCalc('B');
        store.setComparisonIds([c1.id, c2.id]);
        assert.deepEqual(store.getState().comparisonIds, [c1.id, c2.id]);
    });
});
