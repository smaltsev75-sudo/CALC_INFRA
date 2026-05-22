/**
 * Stage 16.5 (PATCH 2.9.4) — Health Score Trend persistence tests.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let persist;
let STORAGE_KEYS;

before(async () => {
    installLocalStorage();
    persist = await import('../../../js/state/persistence.js');
    ({ STORAGE_KEYS } = await import('../../../js/utils/constants.js'));
});

beforeEach(() => installLocalStorage());

const baseSnap = {
    timestamp: '2026-05-10T12:00:00.000Z',
    score: 78, errorCount: 1, warningCount: 4, recommendationCount: 3,
    source: 'health_check'
};

describe('STORAGE_KEYS.HEALTH_SCORE_TREND', () => {
    it('зарегистрирован как calc.healthScoreTrend', () => {
        assert.equal(STORAGE_KEYS.HEALTH_SCORE_TREND, 'calc.healthScoreTrend');
    });
});

describe('loadHealthScoreTrend', () => {
    it('пустой storage → {}', () => {
        assert.deepEqual(persist.loadHealthScoreTrend(), {});
    });

    it('round-trip: save → load', () => {
        persist.saveHealthScoreTrend({ 'c1': [baseSnap] });
        const out = persist.loadHealthScoreTrend();
        assert.deepEqual(out, { 'c1': [baseSnap] });
    });

    it('corrupt JSON → {}', () => {
        localStorage.setItem(STORAGE_KEYS.HEALTH_SCORE_TREND, '{not json');
        assert.deepEqual(persist.loadHealthScoreTrend(), {});
    });

    it('массив вместо объекта → {}', () => {
        localStorage.setItem(STORAGE_KEYS.HEALTH_SCORE_TREND, JSON.stringify([1, 2, 3]));
        assert.deepEqual(persist.loadHealthScoreTrend(), {});
    });

    it('non-array значения отфильтрованы', () => {
        localStorage.setItem(STORAGE_KEYS.HEALTH_SCORE_TREND, JSON.stringify({
            'c1': [baseSnap],
            'c2': 'garbage',
            'c3': { not: 'array' }
        }));
        assert.deepEqual(persist.loadHealthScoreTrend(), { 'c1': [baseSnap] });
    });
});

describe('saveHealthScoreTrend', () => {
    it('массив вместо объекта → false', () => {
        assert.equal(persist.saveHealthScoreTrend([baseSnap]), false);
    });

    it('null → false', () => {
        assert.equal(persist.saveHealthScoreTrend(null), false);
    });

    it('пустой объект → ok', () => {
        assert.equal(persist.saveHealthScoreTrend({}), true);
    });
});

describe('appendHealthScoreTrendSnapshot', () => {
    it('добавляет snapshot к новому calcId', () => {
        const ok = persist.appendHealthScoreTrendSnapshot('c1', baseSnap);
        assert.equal(ok, true);
        const trend = persist.loadHealthScoreTrend();
        assert.equal(trend.c1.length, 1);
        assert.deepEqual(trend.c1[0], baseSnap);
    });

    it('добавляет к существующему массиву', () => {
        persist.appendHealthScoreTrendSnapshot('c1', baseSnap);
        const newer = { ...baseSnap, score: 90, timestamp: '2026-05-10T12:05:00.000Z' };
        persist.appendHealthScoreTrendSnapshot('c1', newer);
        const trend = persist.loadHealthScoreTrend();
        assert.equal(trend.c1.length, 2);
    });

    it('dedup в рамках 60s — возвращает false', () => {
        persist.appendHealthScoreTrendSnapshot('c1', baseSnap);
        const dup = { ...baseSnap, timestamp: '2026-05-10T12:00:30.000Z' };
        const ok = persist.appendHealthScoreTrendSnapshot('c1', dup);
        assert.equal(ok, false);
        const trend = persist.loadHealthScoreTrend();
        assert.equal(trend.c1.length, 1);
    });

    it('null calcId → false', () => {
        assert.equal(persist.appendHealthScoreTrendSnapshot(null, baseSnap), false);
    });

    it('null snapshot → false', () => {
        assert.equal(persist.appendHealthScoreTrendSnapshot('c1', null), false);
    });

    it('разные calcId не смешиваются', () => {
        persist.appendHealthScoreTrendSnapshot('c1', baseSnap);
        persist.appendHealthScoreTrendSnapshot('c2', { ...baseSnap, score: 50 });
        const trend = persist.loadHealthScoreTrend();
        assert.equal(trend.c1.length, 1);
        assert.equal(trend.c2.length, 1);
        assert.equal(trend.c1[0].score, 78);
        assert.equal(trend.c2[0].score, 50);
    });

    it('обрезает историю до limit (20)', () => {
        for (let i = 0; i < 25; i++) {
            const snap = {
                ...baseSnap,
                score: 50 + i,
                timestamp: new Date(2026, 0, 1, 0, i * 2).toISOString()
            };
            persist.appendHealthScoreTrendSnapshot('c1', snap);
        }
        const trend = persist.loadHealthScoreTrend();
        assert.equal(trend.c1.length, 20);
        assert.equal(trend.c1[trend.c1.length - 1].score, 74);  // последний 50+24=74
    });
});

describe('clearHealthScoreTrend', () => {
    it('удаляет историю одного calcId', () => {
        persist.appendHealthScoreTrendSnapshot('c1', baseSnap);
        persist.appendHealthScoreTrendSnapshot('c2', baseSnap);
        const ok = persist.clearHealthScoreTrend('c1');
        assert.equal(ok, true);
        const trend = persist.loadHealthScoreTrend();
        assert.equal(trend.c1, undefined);
        assert.equal(trend.c2.length, 1);
    });

    it('несуществующий calcId → false', () => {
        assert.equal(persist.clearHealthScoreTrend('nope'), false);
    });

    it('null calcId → false', () => {
        assert.equal(persist.clearHealthScoreTrend(null), false);
    });
});
