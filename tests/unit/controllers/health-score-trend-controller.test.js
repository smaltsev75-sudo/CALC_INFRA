/**
 * Stage 16.5 (PATCH 2.9.4) — Health Score Trend controller tests.
 *
 * Все describe-блоки обёрнуты в один outer describe с concurrency:1,
 * чтобы beforeEach из соседних suites не очищал storage между двумя
 * последовательными вызовами внутри одного теста (default node:test
 * поведение — параллельно, что ломает state-зависимые тесты).
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let store;
let ctl;
let persist;

const sharedStorage = installLocalStorage();

before(async () => {
    ({ store } = await import('../../../js/state/store.js'));
    ctl = await import('../../../js/controllers/healthScoreTrendController.js');
    persist = await import('../../../js/state/persistence.js');
});

beforeEach(() => {
    sharedStorage.clear();
    store.closeAllModals();
    store._set({ activeCalc: null, calcRevision: 0 });
});

function makeCalc(id = 'calc-1') {
    return {
        id,
        name: 'T',
        schemaVersion: 12,
        answers: {},
        answersMeta: {},
        settings: {},
        dictionaries: { questions: [], items: [], settings: {} },
        view: {}
    };
}

const sampleHealth = {
    score: 78,
    findings: [],
    counts: { error: 1, warning: 4, recommendation: 3, info: 0 }
};

describe('Health Score Trend controller', { concurrency: 1 }, () => {

    describe('recordHealthScoreSnapshot', () => {
        it('пишет snapshot при наличии активного calc', () => {
            store._set({ activeCalc: makeCalc(), calcRevision: 1 });
            const result = ctl.recordHealthScoreSnapshot(null, sampleHealth, 'health_check');
            assert.equal(result.ok, true);
            assert.equal(result.written, true);
            const trend = persist.loadHealthScoreTrend();
            assert.equal(trend['calc-1'].length, 1);
            assert.equal(trend['calc-1'][0].score, 78);
            assert.equal(trend['calc-1'][0].source, 'health_check');
        });

        it('явный calcId перекрывает activeCalc', () => {
            store._set({ activeCalc: makeCalc('active-1'), calcRevision: 1 });
            const result = ctl.recordHealthScoreSnapshot('forced-id', sampleHealth, 'guided_completion');
            assert.equal(result.ok, true);
            const trend = persist.loadHealthScoreTrend();
            assert.equal(trend['active-1'], undefined);
            assert.equal(trend['forced-id'].length, 1);
        });

        it('без id и без activeCalc → no-calc-id', () => {
            const result = ctl.recordHealthScoreSnapshot(null, sampleHealth, 'health_check');
            assert.equal(result.ok, false);
            assert.equal(result.reason, 'no-calc-id');
        });

        it('без healthResult — calc.activeCalc evaluate (минимальный calc)', () => {
            store._set({ activeCalc: makeCalc(), calcRevision: 1 });
            const result = ctl.recordHealthScoreSnapshot(null, null, 'health_check');
            assert.equal(result.ok, true);
            const trend = persist.loadHealthScoreTrend();
            assert.equal(trend['calc-1'].length, 1);
        });

        it('healthResult с null score — invalid-result', () => {
            store._set({ activeCalc: makeCalc(), calcRevision: 1 });
            const r = ctl.recordHealthScoreSnapshot(null, { score: null, counts: {} }, 'health_check');
            assert.equal(r.ok, false);
            assert.equal(r.reason, 'invalid-result');
        });

        it('повтор в течение 60s — written=false', () => {
            store._set({ activeCalc: makeCalc(), calcRevision: 1 });
            ctl.recordHealthScoreSnapshot(null, sampleHealth, 'health_check');
            const second = ctl.recordHealthScoreSnapshot(null, sampleHealth, 'health_check');
            assert.equal(second.ok, true);
            assert.equal(second.written, false);
        });
    });

    describe('getHealthScoreTrendForActiveCalc', () => {
        it('возвращает массив snapshot\'ов', () => {
            store._set({ activeCalc: makeCalc(), calcRevision: 1 });
            ctl.recordHealthScoreSnapshot(null, sampleHealth, 'health_check');
            const trend = ctl.getHealthScoreTrendForActiveCalc();
            assert.equal(trend.length, 1);
        });

        it('без activeCalc → []', () => {
            assert.deepEqual(ctl.getHealthScoreTrendForActiveCalc(), []);
        });

        it('без истории для calc → []', () => {
            store._set({ activeCalc: makeCalc('no-history'), calcRevision: 1 });
            assert.deepEqual(ctl.getHealthScoreTrendForActiveCalc(), []);
        });
    });

    describe('getHealthScoreTrendForCalc', () => {
        it('явный id', () => {
            store._set({ activeCalc: makeCalc('a'), calcRevision: 1 });
            ctl.recordHealthScoreSnapshot(null, sampleHealth, 'health_check');
            const out = ctl.getHealthScoreTrendForCalc('a');
            assert.equal(out.length, 1);
        });

        it('null id → []', () => {
            assert.deepEqual(ctl.getHealthScoreTrendForCalc(null), []);
        });
    });

    describe('clearHealthScoreTrendForActiveCalc', () => {
        it('очищает только активного calc', () => {
            store._set({ activeCalc: makeCalc('a'), calcRevision: 1 });
            ctl.recordHealthScoreSnapshot('a', sampleHealth, 'health_check');
            ctl.recordHealthScoreSnapshot('b', sampleHealth, 'health_check');
            const ok = ctl.clearHealthScoreTrendForActiveCalc();
            assert.equal(ok, true);
            const trend = persist.loadHealthScoreTrend();
            assert.equal(trend.a, undefined);
            assert.equal(trend.b.length, 1);
        });

        it('без activeCalc → false', () => {
            assert.equal(ctl.clearHealthScoreTrendForActiveCalc(), false);
        });
    });

});
