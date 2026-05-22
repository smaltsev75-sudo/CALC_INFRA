/**
 * Stage 16.5 (PATCH 2.9.4) — Health Score Trend domain tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildHealthScoreSnapshot,
    shouldAppendHealthScoreSnapshot,
    appendHealthScoreSnapshot,
    getHealthScoreTrendSummary,
    formatHealthScoreTrend,
    HEALTH_SCORE_TREND_LIMIT,
    HEALTH_SCORE_TREND_DEDUP_WINDOW_MS,
    HEALTH_SCORE_TREND_SOURCE_LABELS
} from '../../../js/domain/healthScoreTrend.js';

/* ============================================================
 * 1. buildHealthScoreSnapshot
 * ============================================================ */

describe('buildHealthScoreSnapshot', () => {
    it('строит snapshot из health-result', () => {
        const result = {
            score: 78,
            counts: { error: 1, warning: 4, recommendation: 3, info: 0 }
        };
        const snap = buildHealthScoreSnapshot(result, 'health_check', new Date('2026-05-10T12:00:00Z'));
        assert.equal(snap.score, 78);
        assert.equal(snap.errorCount, 1);
        assert.equal(snap.warningCount, 4);
        assert.equal(snap.recommendationCount, 3);
        assert.equal(snap.source, 'health_check');
        assert.equal(snap.timestamp, '2026-05-10T12:00:00.000Z');
    });

    it('counts undefined → fallback 0', () => {
        const snap = buildHealthScoreSnapshot({ score: 91 }, 'manual_recheck', new Date());
        assert.equal(snap.errorCount, 0);
        assert.equal(snap.warningCount, 0);
        assert.equal(snap.recommendationCount, 0);
    });

    it('частично переданные counts — остальные 0', () => {
        const snap = buildHealthScoreSnapshot(
            { score: 50, counts: { warning: 5 } },
            'health_check',
            new Date()
        );
        assert.equal(snap.errorCount, 0);
        assert.equal(snap.warningCount, 5);
        assert.equal(snap.recommendationCount, 0);
    });

    it('score отсутствует / null / NaN → null snapshot', () => {
        assert.equal(buildHealthScoreSnapshot(null, 'health_check', new Date()), null);
        assert.equal(buildHealthScoreSnapshot({}, 'health_check', new Date()), null);
        assert.equal(buildHealthScoreSnapshot({ score: null }, 'health_check', new Date()), null);
        assert.equal(buildHealthScoreSnapshot({ score: NaN }, 'health_check', new Date()), null);
        assert.equal(buildHealthScoreSnapshot({ score: 'abc' }, 'health_check', new Date()), null);
    });

    it('неизвестный source — fallback "manual_recheck"', () => {
        const snap = buildHealthScoreSnapshot(
            { score: 60, counts: {} },
            'something-bogus',
            new Date()
        );
        assert.equal(snap.source, 'manual_recheck');
    });

    it('дефолтный now=Date.now()', () => {
        const before = new Date();
        const snap = buildHealthScoreSnapshot({ score: 80 }, 'health_check');
        const after = new Date();
        const snapDate = new Date(snap.timestamp);
        assert.ok(snapDate >= before && snapDate <= after,
            `snap timestamp ${snap.timestamp} not in [${before.toISOString()}, ${after.toISOString()}]`);
    });
});

/* ============================================================
 * 2. shouldAppendHealthScoreSnapshot
 * ============================================================ */

describe('shouldAppendHealthScoreSnapshot', () => {
    const baseSnap = {
        timestamp: '2026-05-10T12:00:00.000Z',
        score: 78, errorCount: 1, warningCount: 4, recommendationCount: 3,
        source: 'health_check'
    };

    it('пустая история → true', () => {
        assert.equal(shouldAppendHealthScoreSnapshot([], baseSnap), true);
    });

    it('null история → true', () => {
        assert.equal(shouldAppendHealthScoreSnapshot(null, baseSnap), true);
    });

    it('одинаковые score+counts+source за 60s → false', () => {
        const newer = { ...baseSnap, timestamp: '2026-05-10T12:00:30.000Z' };
        assert.equal(shouldAppendHealthScoreSnapshot([baseSnap], newer), false);
    });

    it('одинаковые score+counts+source через >60s → true', () => {
        const newer = { ...baseSnap, timestamp: '2026-05-10T12:01:30.000Z' };
        assert.equal(shouldAppendHealthScoreSnapshot([baseSnap], newer), true);
    });

    it('изменился score — всегда true (даже за 1s)', () => {
        const newer = { ...baseSnap, score: 82, timestamp: '2026-05-10T12:00:01.000Z' };
        assert.equal(shouldAppendHealthScoreSnapshot([baseSnap], newer), true);
    });

    it('изменился errorCount — всегда true', () => {
        const newer = { ...baseSnap, errorCount: 0, timestamp: '2026-05-10T12:00:10.000Z' };
        assert.equal(shouldAppendHealthScoreSnapshot([baseSnap], newer), true);
    });

    it('изменился source — всегда true', () => {
        const newer = { ...baseSnap, source: 'guided_completion', timestamp: '2026-05-10T12:00:10.000Z' };
        assert.equal(shouldAppendHealthScoreSnapshot([baseSnap], newer), true);
    });

    it('null snap → false', () => {
        assert.equal(shouldAppendHealthScoreSnapshot([baseSnap], null), false);
    });

    it('сравнение идёт с ПОСЛЕДНЕЙ точкой истории', () => {
        const old1 = { ...baseSnap, score: 50, timestamp: '2026-05-10T11:00:00.000Z' };
        const old2 = { ...baseSnap, timestamp: '2026-05-10T12:00:00.000Z' };
        const newer = { ...baseSnap, timestamp: '2026-05-10T12:00:30.000Z' };
        assert.equal(shouldAppendHealthScoreSnapshot([old1, old2], newer), false);
    });
});

/* ============================================================
 * 3. appendHealthScoreSnapshot
 * ============================================================ */

describe('appendHealthScoreSnapshot', () => {
    const baseSnap = {
        timestamp: '2026-05-10T12:00:00.000Z',
        score: 78, errorCount: 1, warningCount: 4, recommendationCount: 3,
        source: 'health_check'
    };

    it('добавляет к пустой истории', () => {
        const out = appendHealthScoreSnapshot([], baseSnap);
        assert.equal(out.length, 1);
        assert.deepEqual(out[0], baseSnap);
    });

    it('null history treated as empty', () => {
        const out = appendHealthScoreSnapshot(null, baseSnap);
        assert.equal(out.length, 1);
    });

    it('не мутирует входной массив', () => {
        const history = [baseSnap];
        const before = JSON.stringify(history);
        appendHealthScoreSnapshot(history, { ...baseSnap, score: 82, timestamp: '2026-05-10T12:01:00.000Z' });
        assert.equal(JSON.stringify(history), before);
    });

    it('обрезает историю до limit', () => {
        const history = [];
        for (let i = 0; i < HEALTH_SCORE_TREND_LIMIT + 5; i++) {
            history.push({
                ...baseSnap,
                score: 50 + i,
                timestamp: new Date(2026, 0, 1, 0, i).toISOString()
            });
        }
        const out = appendHealthScoreSnapshot(history, {
            ...baseSnap,
            score: 99,
            timestamp: new Date(2026, 1, 1).toISOString()
        });
        assert.equal(out.length, HEALTH_SCORE_TREND_LIMIT);
        assert.equal(out[out.length - 1].score, 99);
    });

    it('пропускает dedup в рамках 60s по умолчанию', () => {
        const newer = { ...baseSnap, timestamp: '2026-05-10T12:00:30.000Z' };
        const out = appendHealthScoreSnapshot([baseSnap], newer);
        assert.equal(out.length, 1);  // dedup'нуто
    });

    it('options.force=true — игнорирует dedup', () => {
        const newer = { ...baseSnap, timestamp: '2026-05-10T12:00:30.000Z' };
        const out = appendHealthScoreSnapshot([baseSnap], newer, { force: true });
        assert.equal(out.length, 2);
    });

    it('null snap → возвращает unchanged copy истории', () => {
        const out = appendHealthScoreSnapshot([baseSnap], null);
        assert.equal(out.length, 1);
        assert.deepEqual(out[0], baseSnap);
    });
});

/* ============================================================
 * 4. getHealthScoreTrendSummary
 * ============================================================ */

describe('getHealthScoreTrendSummary', () => {
    it('пустая история — null', () => {
        assert.equal(getHealthScoreTrendSummary([]), null);
        assert.equal(getHealthScoreTrendSummary(null), null);
    });

    it('одна точка — first === current === best', () => {
        const snap = {
            timestamp: '2026-05-10T12:00:00.000Z',
            score: 78, errorCount: 1, warningCount: 4, recommendationCount: 3,
            source: 'health_check'
        };
        const sum = getHealthScoreTrendSummary([snap]);
        assert.equal(sum.first.score, 78);
        assert.equal(sum.current.score, 78);
        assert.equal(sum.best.score, 78);
        assert.equal(sum.count, 1);
        assert.equal(sum.delta, 0);
    });

    it('несколько точек — first/current/best/delta', () => {
        const history = [
            { score: 50, source: 'health_check', timestamp: 'a', errorCount: 2, warningCount: 5, recommendationCount: 1 },
            { score: 75, source: 'guided_completion', timestamp: 'b', errorCount: 0, warningCount: 3, recommendationCount: 2 },
            { score: 91, source: 'optimization_playbook', timestamp: 'c', errorCount: 0, warningCount: 1, recommendationCount: 0 },
            { score: 88, source: 'manual_recheck', timestamp: 'd', errorCount: 0, warningCount: 1, recommendationCount: 1 }
        ];
        const sum = getHealthScoreTrendSummary(history);
        assert.equal(sum.first.score, 50);
        assert.equal(sum.current.score, 88);
        assert.equal(sum.best.score, 91);
        assert.equal(sum.count, 4);
        assert.equal(sum.delta, 38);  // 88 - 50
    });
});

/* ============================================================
 * 5. formatHealthScoreTrend
 * ============================================================ */

describe('formatHealthScoreTrend', () => {
    it('пустая история — empty string', () => {
        assert.equal(formatHealthScoreTrend([]), '');
        assert.equal(formatHealthScoreTrend(null), '');
    });

    it('одна точка', () => {
        const history = [{ score: 78, source: 'health_check', timestamp: 'a',
            errorCount: 0, warningCount: 0, recommendationCount: 0 }];
        assert.equal(formatHealthScoreTrend(history), '78');
    });

    it('несколько точек — strelka separator', () => {
        const history = [
            { score: 50 }, { score: 75 }, { score: 91 }
        ];
        assert.equal(formatHealthScoreTrend(history), '50 → 75 → 91');
    });

    it('большая история — последние N точек по умолчанию 5', () => {
        const history = [];
        for (let i = 0; i < 10; i++) history.push({ score: 50 + i });
        const formatted = formatHealthScoreTrend(history);
        // последние 5: 55, 56, 57, 58, 59
        assert.equal(formatted, '55 → 56 → 57 → 58 → 59');
    });

    it('options.limit=3 — последние 3', () => {
        const history = [];
        for (let i = 0; i < 10; i++) history.push({ score: 50 + i });
        const formatted = formatHealthScoreTrend(history, { limit: 3 });
        assert.equal(formatted, '57 → 58 → 59');
    });

    it('options.limit=0 — вся история', () => {
        const history = [{ score: 1 }, { score: 2 }, { score: 3 }];
        assert.equal(formatHealthScoreTrend(history, { limit: 0 }), '1 → 2 → 3');
    });
});

/* ============================================================
 * 6. Source labels
 * ============================================================ */

describe('HEALTH_SCORE_TREND_SOURCE_LABELS', () => {
    it('содержит все 4 source-ключа', () => {
        assert.equal(typeof HEALTH_SCORE_TREND_SOURCE_LABELS.health_check, 'string');
        assert.equal(typeof HEALTH_SCORE_TREND_SOURCE_LABELS.guided_completion, 'string');
        assert.equal(typeof HEALTH_SCORE_TREND_SOURCE_LABELS.optimization_playbook, 'string');
        assert.equal(typeof HEALTH_SCORE_TREND_SOURCE_LABELS.manual_recheck, 'string');
    });
});

/* ============================================================
 * 7. Constants
 * ============================================================ */

describe('Constants', () => {
    it('HEALTH_SCORE_TREND_LIMIT = 20', () => {
        assert.equal(HEALTH_SCORE_TREND_LIMIT, 20);
    });

    it('HEALTH_SCORE_TREND_DEDUP_WINDOW_MS = 60000', () => {
        assert.equal(HEALTH_SCORE_TREND_DEDUP_WINDOW_MS, 60000);
    });
});
