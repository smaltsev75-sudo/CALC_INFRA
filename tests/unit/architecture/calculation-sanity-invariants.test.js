/**
 * Calculation sanity invariants for the reference product profiles.
 *
 * These checks are intentionally numeric/domain-level: no NaN/Infinity,
 * no negative money, aggregate totals reconcile, reference profiles grow
 * monotonically, and global risk/VAT multipliers have the expected effect.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as seed from '../../../js/domain/seed.js';
import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import { getVatRateForDate } from '../../../js/domain/vatRateTable.js';
import { STAND_IDS } from '../../../js/utils/constants.js';

const EPS = 0.01;
const CALC_CREATED_AT = '2026-05-02T00:00:00Z';
const VAT_RATE_2026 = getVatRateForDate('2026-01-01');
const FREE_PRICE_ITEM_IDS = new Set(['traffic-ingress-tb']);

const profiles = {
    startup: {
        label: 'Startup MVP',
        answers: {
            users_total: 5000, registered_users_total: 5000, dau_target: 500, pcu_target: 50,
            peak_rps: 20, avg_rps: 5, microservices_count: 3, async_workers_count: 1,
            db_count: 1, db_replicas_count: 0, db_size_initial_gb: 20, db_growth_gb_month: 2,
            backup_retention_days: 14, file_storage_volume_tb: 0.1, file_storage_growth_tb_year: 0.1,
            email_per_month: 5000, sms_per_month: 500, push_per_month: 100000,
            avg_response_size_kb: 5, avg_request_size_kb: 2, ram_per_vcpu_ratio: 4, cache_size_gb: 4,
            sla_target: 99.5, georedundancy_required: false, pdn_152fz: false,
            pentest_external: true, pentest_internal: false, load_test_before_prod: true,
            pentest_per_year: 1, load_test_per_year: 1
        }
    },
    smb: {
        label: 'SMB B2B SaaS',
        answers: {
            users_total: 50000, registered_users_total: 50000, dau_target: 10000, pcu_target: 1000,
            peak_rps: 200, avg_rps: 50, microservices_count: 10, async_workers_count: 4,
            db_count: 3, db_replicas_count: 1, db_size_initial_gb: 100, db_growth_gb_month: 10,
            backup_retention_days: 30, file_storage_volume_tb: 1, file_storage_growth_tb_year: 1,
            email_per_month: 50000, sms_per_month: 5000, push_per_month: 1000000,
            avg_response_size_kb: 5, avg_request_size_kb: 2, ram_per_vcpu_ratio: 4, cache_size_gb: 16,
            sla_target: 99.9, georedundancy_required: false, pdn_152fz: true, encryption_at_rest: true,
            waf_required: true, pentest_external: true, pentest_internal: true, load_test_before_prod: true,
            pentest_per_year: 2, load_test_per_year: 2
        }
    },
    enterprise: {
        label: 'Enterprise',
        answers: {
            users_total: 500000, registered_users_total: 500000, dau_target: 100000, pcu_target: 10000,
            peak_rps: 1000, avg_rps: 200, microservices_count: 30, async_workers_count: 12,
            db_count: 5, db_replicas_count: 2, db_size_initial_gb: 1000, db_growth_gb_month: 100,
            backup_retention_days: 90, file_storage_volume_tb: 50, file_storage_growth_tb_year: 30,
            email_per_month: 1000000, sms_per_month: 100000, push_per_month: 50000000,
            avg_response_size_kb: 10, avg_request_size_kb: 4, ram_per_vcpu_ratio: 4, cache_size_gb: 128,
            sla_target: 99.95, georedundancy_required: true, pdn_152fz: true, encryption_at_rest: true,
            waf_required: true, fstec_certification_required: true, pentest_external: true, pentest_internal: true,
            load_test_before_prod: true, pentest_per_year: 4, load_test_per_year: 4
        }
    }
};

const clone = value => JSON.parse(JSON.stringify(value));
const sum = values => values.reduce((acc, v) => acc + v, 0);

function close(actual, expected, message, eps = EPS) {
    assert.ok(Math.abs(actual - expected) <= eps,
        `${message}: expected ${expected}, got ${actual}, delta=${Math.abs(actual - expected)}`);
}

function buildCalc(answersOverrides, settingsOverrides = {}) {
    const dictionaries = seed.buildSeedDictionaries();
    const answers = seed.defaultAnswersFrom(dictionaries.questions);
    Object.assign(answers, answersOverrides);

    return {
        version: '1.0',
        id: 'calculation-sanity',
        name: 'calculation-sanity',
        schemaVersion: 19,
        createdAt: CALC_CREATED_AT,
        updatedAt: CALC_CREATED_AT,
        settings: { ...clone(seed.SEED_SETTINGS), ...clone(settingsOverrides) },
        answers,
        dictionaries
    };
}

function runProfile(profile, settings = {}) {
    clearCalculationCache();
    return calculate(buildCalc(profile.answers, settings));
}

function assertFiniteNonNegative(value, label) {
    assert.equal(Number.isFinite(value), true, `${label} must be finite`);
    assert.ok(value >= 0, `${label} must be non-negative, got ${value}`);
}

function assertResultHasNoNumericAnomalies(result, label) {
    assertFiniteNonNegative(result.totalMonthly, `${label}.totalMonthly`);
    assertFiniteNonNegative(result.totalAnnual, `${label}.totalAnnual`);
    close(result.totalAnnual, result.totalMonthly * 12, `${label}.totalAnnual = monthly * 12`);

    const standMonthly = STAND_IDS.map(stand => result.stands[stand].totalMonthly);
    close(result.totalMonthly, sum(standMonthly), `${label}.totalMonthly = sum(stands)`);
    close(result.totalMonthly, sum(Object.values(result.byCategory)), `${label}.totalMonthly = sum(byCategory)`);
    close(result.totalMonthly, sum(Object.values(result.byCostType)), `${label}.totalMonthly = sum(byCostType)`);
    close(result.totalMonthly, sum(Object.values(result.byBillingInterval)), `${label}.totalMonthly = sum(byBillingInterval)`);

    for (const stand of STAND_IDS) {
        const bucket = result.stands[stand];
        assertFiniteNonNegative(bucket.totalMonthly, `${label}.${stand}.totalMonthly`);
        close(bucket.totalAnnual, bucket.totalMonthly * 12, `${label}.${stand}.totalAnnual = monthly * 12`);
        close(bucket.totalMonthly, sum(bucket.items.map(cell => cell.costFinal)), `${label}.${stand}.totalMonthly = sum(cells)`);
        close(bucket.totalMonthly, sum(Object.values(bucket.byCategory)), `${label}.${stand}.totalMonthly = sum(byCategory)`);

        for (const cell of bucket.items) {
            assert.equal(cell.error, null, `${label}.${stand}.${cell.itemId} formula error`);
            assertFiniteNonNegative(cell.qty, `${label}.${stand}.${cell.itemId}.qty`);
            assertFiniteNonNegative(cell.costBase, `${label}.${stand}.${cell.itemId}.costBase`);
            assertFiniteNonNegative(cell.costFinal, `${label}.${stand}.${cell.itemId}.costFinal`);
            assert.ok(cell.riskBreakdown && Number.isFinite(cell.riskBreakdown.total),
                `${label}.${stand}.${cell.itemId}.riskBreakdown.total must be finite`);
            assert.ok(cell.riskBreakdown.total > 0,
                `${label}.${stand}.${cell.itemId}.riskBreakdown.total must be positive`);
        }
    }

    for (const [itemId, item] of Object.entries(result.items)) {
        const itemTotal = sum(STAND_IDS.map(stand => item.stands[stand].costFinal));
        close(item.totalMonthly, itemTotal, `${label}.${itemId}.totalMonthly = sum(item.stands)`);
        close(item.totalAnnual, item.totalMonthly * 12, `${label}.${itemId}.totalAnnual = monthly * 12`);
    }
}

describe('calculation sanity: reference profiles', () => {
    it('all seed items have positive prices or explicit free-price allowlist', () => {
        const dictionaries = seed.buildSeedDictionaries();
        const bad = dictionaries.items
            .filter(item => {
                const price = Number(item.pricePerUnit);
                if (!Number.isFinite(price) || price < 0) return true;
                if (price === 0) return !FREE_PRICE_ITEM_IDS.has(item.id);
                return false;
            })
            .map(item => item.id);

        assert.deepEqual(bad, [], `Items with invalid or unexpected zero pricePerUnit: ${bad.join(', ')}`);
    });

    for (const profile of Object.values(profiles)) {
        it(`${profile.label}: no NaN/Infinity, negative costs or aggregate drift`, () => {
            assertResultHasNoNumericAnomalies(runProfile(profile), profile.label);
        });
    }

    it('profile scale is monotonic: Startup < SMB < Enterprise', () => {
        const totals = Object.values(profiles).map(profile => runProfile(profile).totalMonthly);
        assert.ok(totals[0] < totals[1], `Startup total should be below SMB: ${totals.join(' < ')}`);
        assert.ok(totals[1] < totals[2], `SMB total should be below Enterprise: ${totals.join(' < ')}`);
    });
});

describe('calculation sanity: global multipliers', () => {
    const neutral = {
        ...clone(seed.SEED_SETTINGS),
        bufferTask: 0,
        bufferProject: 0,
        kInflation: 0,
        kSeasonal: 0,
        kScheduleShift: 0,
        kContingency: 0,
        vatEnabled: false,
        vatRate: 0,
        planningHorizonYears: 1,
        applyRiskFactors: true
    };

    function total(settings) {
        return runProfile(profiles.smb, settings).totalMonthly;
    }

    it('global risk and VAT coefficients match expected ratios on SMB profile', () => {
        const baseline = total(neutral);
        const cases = [
            {
                name: 'task/project buffers',
                expected: 1.495,
                settings: { ...neutral, bufferTask: 0.30, bufferProject: 0.15 }
            },
            {
                name: '10% inflation over 3 years',
                expected: 1.331,
                settings: { ...neutral, kInflation: 0.10, planningHorizonYears: 3 }
            },
            {
                name: '5% contingency',
                expected: 1.05,
                settings: { ...neutral, kContingency: 0.05 }
            },
            {
                name: 'VAT 2026',
                expected: 1 + VAT_RATE_2026,
                settings: { ...neutral, vatEnabled: true, vatRate: VAT_RATE_2026 }
            }
        ];

        for (const c of cases) {
            close(total(c.settings) / baseline, c.expected, c.name, 0.001);
        }
    });

    it('applyRiskFactors=false disables risks but keeps VAT as an independent axis', () => {
        const noRisksNoVat = total({ ...clone(seed.SEED_SETTINGS), applyRiskFactors: false, vatEnabled: false, vatRate: 0 });
        const noRisksWithVat = total({ ...clone(seed.SEED_SETTINGS), applyRiskFactors: false, vatEnabled: true, vatRate: VAT_RATE_2026 });
        const defaultRisksNoVat = total({ ...clone(seed.SEED_SETTINGS), applyRiskFactors: true, vatEnabled: false, vatRate: 0 });

        close(noRisksWithVat / noRisksNoVat, 1 + VAT_RATE_2026, 'VAT still applies when risks are disabled', 0.001);
        assert.ok(noRisksNoVat < defaultRisksNoVat,
            `Risk-disabled total should be below default-risk total: ${noRisksNoVat} vs ${defaultRisksNoVat}`);
    });
});
