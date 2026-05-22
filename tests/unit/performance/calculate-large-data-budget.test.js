/**
 * Performance budget for production calculate() on a large local dictionary.
 *
 * Bulk provider operations already have stress tests. This file protects the
 * core calculation path used by Dashboard, Details, PDF and CSV when the user
 * extends the catalog with many custom items.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { CATEGORY_IDS, MONTHS_PER_YEAR, STAND_IDS } from '../../../js/utils/constants.js';

const ITEM_MULTIPLIER = 8;
const FULL_CALCULATE_BUDGET_MS = 1500;
const CACHE_HIT_BUDGET_MS = 100;
const EPS = 0.01;

function close(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) <= EPS,
        `${label}: expected ${expected}, got ${actual}, delta=${Math.abs(actual - expected)}`);
}

function sum(values) {
    return values.reduce((acc, value) => acc + value, 0);
}

function buildLargeCalc() {
    const base = buildSeedDictionaries();
    const answers = defaultAnswersFrom(base.questions);
    Object.assign(answers, {
        registered_users_total: 500_000,
        pcu_target: 10_000,
        peak_rps: 1_000,
        avg_rps: 200,
        microservices_count: 30,
        async_workers_count: 12,
        db_count: 5,
        db_replicas_count: 2,
        db_size_initial_gb: 1_000,
        db_growth_gb_month: 100,
        file_storage_volume_tb: 50,
        sms_per_month: 100_000,
        push_per_month: 50_000_000,
        pdn_152fz: true,
        waf_required: true,
        georedundancy_required: true,
        fstec_certification_required: true
    });

    const items = [];
    for (let batch = 0; batch < ITEM_MULTIPLIER; batch += 1) {
        for (const item of base.items) {
            items.push({
                ...item,
                id: `${item.id}__perf_${batch}`,
                name: `${item.name} ${batch + 1}`
            });
        }
    }

    return {
        id: 'large-calculate-budget',
        name: 'Large calculate budget',
        schemaVersion: 20,
        createdAt: '2026-05-22T00:00:00Z',
        updatedAt: '2026-05-22T00:00:00Z',
        settings: { ...SEED_SETTINGS },
        answers,
        dictionaries: { questions: base.questions, items }
    };
}

function assertAggregateInvariants(result, itemCount) {
    assert.equal(Object.keys(result.items).length, itemCount);
    assert.ok(Number.isFinite(result.totalMonthly), 'totalMonthly must be finite');
    assert.ok(result.totalMonthly > 0, 'totalMonthly must be positive');
    close(result.totalAnnual, result.totalMonthly * MONTHS_PER_YEAR, 'totalAnnual');
    close(result.totalMonthly, sum(STAND_IDS.map(sid => result.stands[sid].totalMonthly)), 'sum(stands)');
    close(result.totalMonthly, sum(CATEGORY_IDS.map(cat => result.byCategory[cat] || 0)), 'sum(categories)');

    for (const sid of STAND_IDS) {
        const bucket = result.stands[sid];
        assert.equal(bucket.items.length, itemCount, `${sid}.items.length`);
        close(bucket.totalMonthly, sum(bucket.items.map(cell => cell.costFinal)), `${sid}.sum(items)`);
    }
}

describe('calculate() large data performance budget', () => {
    it(`calculates ${ITEM_MULTIPLIER}x seed catalog under ${FULL_CALCULATE_BUDGET_MS}ms and keeps aggregates coherent`, () => {
        const calc = buildLargeCalc();
        clearCalculationCache();

        const startedAt = performance.now();
        const result = calculate(calc);
        const elapsedMs = performance.now() - startedAt;

        assertAggregateInvariants(result, calc.dictionaries.items.length);
        assert.ok(elapsedMs < FULL_CALCULATE_BUDGET_MS,
            `calculate() for ${calc.dictionaries.items.length} items took ${elapsedMs.toFixed(1)}ms, budget ${FULL_CALCULATE_BUDGET_MS}ms`);
    });

    it(`revision cache hit returns under ${CACHE_HIT_BUDGET_MS}ms and preserves object identity`, () => {
        const calc = buildLargeCalc();
        clearCalculationCache();

        const first = calculate(calc, 'rev-1');
        const startedAt = performance.now();
        const second = calculate(calc, 'rev-1');
        const elapsedMs = performance.now() - startedAt;

        assert.equal(second, first, 'same calc id + revision should return cached result object');
        assert.ok(elapsedMs < CACHE_HIT_BUDGET_MS,
            `calculate() cache hit took ${elapsedMs.toFixed(3)}ms, budget ${CACHE_HIT_BUDGET_MS}ms`);
    });
});
