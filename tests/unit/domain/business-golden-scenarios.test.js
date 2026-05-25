/**
 * Golden business scenarios for manually filled questionnaires.
 *
 * Quick Start snapshots protect wizard profiles. These scenarios pin the
 * maintainer sanity profiles used for product/architecture reviews, where
 * answers are entered directly instead of coming from wizardToAnswers().
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { CATEGORY_IDS, STAND_IDS } from '../../../js/utils/constants.js';

const CALC_CREATED_AT = '2026-05-02T00:00:00Z';

const BUSINESS_SCENARIOS = Object.freeze([
    {
        id: 'startup_mvp',
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
        },
        expected: {
            totalMonthly: 2_259_078,
            totalAnnual: 27_108_938,
            topCategory: 'SERVICES',
            byStandMonthly: { DEV: 39_666, IFT: 92_560, PSI: 146_421, PROD: 1_530_098, LOAD: 450_333 },
            byCategoryMonthly: { HW: 80_911, LICENSE: 499_967, TRAFFIC: 26_507, SERVICES: 1_302_443, RESERVES: 0, SECURITY: 349_249, AI: 0 },
            topProdItemIds: ['one-deployment', 'one-pentest-external', 'license-db-per-vcpu', 'network-ddos-protection', 'one-pentest-regular']
        }
    },
    {
        id: 'smb_b2b_saas',
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
        },
        expected: {
            totalMonthly: 5_251_082,
            totalAnnual: 63_012_987,
            topCategory: 'LICENSE',
            byStandMonthly: { DEV: 184_179, IFT: 393_623, PSI: 532_017, PROD: 2_674_416, LOAD: 1_466_848 },
            byCategoryMonthly: { HW: 279_450, LICENSE: 2_721_746, TRAFFIC: 26_507, SERVICES: 1_485_733, RESERVES: 0, SECURITY: 737_646, AI: 0 },
            topProdItemIds: ['one-deployment', 'license-db-per-vcpu', 'one-pentest-regular', 'one-pentest-external', 'one-pentest-internal']
        }
    },
    {
        id: 'enterprise',
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
        },
        expected: {
            totalMonthly: 18_293_251,
            totalAnnual: 219_519_012,
            topCategory: 'LICENSE',
            byStandMonthly: { DEV: 537_353, IFT: 1_458_930, PSI: 2_278_189, PROD: 8_424_027, LOAD: 5_594_752 },
            byCategoryMonthly: { HW: 3_557_907, LICENSE: 6_888_305, TRAFFIC: 106_029, SERVICES: 4_420_585, RESERVES: 1_474_623, SECURITY: 1_845_802, AI: 0 },
            topProdItemIds: ['license-db-per-vcpu', 'one-deployment', 'res-dr-active', 'storage-ssd-tb', 'service-sms-per-1k']
        }
    },
    {
        id: 'internal_ops_tool',
        answers: {
            users_total: 1200, registered_users_total: 1200, dau_target: 800, dau_share_of_registered_percent: 67, pcu_target: 80,
            peak_rps: 25, avg_rps: 6, microservices_count: 4, async_workers_count: 2,
            db_count: 1, db_replicas_count: 0, db_size_initial_gb: 30, db_growth_gb_month: 2,
            backup_retention_days: 14, file_storage_volume_tb: 0.2, file_storage_growth_tb_year: 0.1,
            email_per_month: 2000, sms_per_month: 0, push_per_month: 0,
            avg_response_size_kb: 4, avg_request_size_kb: 2, ram_per_vcpu_ratio: 4, cache_size_gb: 4,
            sla_target: 99.5, georedundancy_required: false, pdn_152fz: false,
            waf_required: false, pentest_external: false, pentest_internal: false, load_test_before_prod: false,
            pentest_per_year: 0, load_test_per_year: 0
        },
        expected: {
            totalMonthly: 1_794_308,
            totalAnnual: 21_531_702,
            topCategory: 'SERVICES',
            byStandMonthly: { DEV: 47_447, IFT: 91_743, PSI: 107_659, PROD: 1_316_483, LOAD: 230_976 },
            byCategoryMonthly: { HW: 98_791, LICENSE: 542_100, TRAFFIC: 26_507, SERVICES: 1_035_115, RESERVES: 0, SECURITY: 91_795, AI: 0 },
            topProdItemIds: ['one-deployment', 'license-db-per-vcpu', 'network-ddos-protection', 'license-os-per-node', 'one-staff-training']
        }
    },
    {
        id: 'regulated_fintech_high',
        answers: {
            users_total: 200000, registered_users_total: 200000, dau_target: 50000, dau_share_of_registered_percent: 25, pcu_target: 5000,
            peak_rps: 650, avg_rps: 160, microservices_count: 24, async_workers_count: 10,
            db_count: 6, db_replicas_count: 2, db_size_initial_gb: 800, db_growth_gb_month: 80,
            backup_retention_days: 120, file_storage_volume_tb: 20, file_storage_growth_tb_year: 12,
            email_per_month: 300000, sms_per_month: 80000, push_per_month: 15000000,
            avg_response_size_kb: 8, avg_request_size_kb: 4, ram_per_vcpu_ratio: 4, cache_size_gb: 96,
            sla_target: 99.95, georedundancy_required: true, pdn_152fz: true, pdn_category: '2', encryption_at_rest: true,
            waf_required: true, ddos_protection_required: true, iso_27001_required: true, fstec_certification_required: true,
            pentest_external: true, pentest_internal: true, load_test_before_prod: true,
            pentest_per_year: 4, load_test_per_year: 4, security_audit_per_year: 2
        },
        expected: {
            totalMonthly: 17_767_049,
            totalAnnual: 213_204_585,
            topCategory: 'LICENSE',
            byStandMonthly: { DEV: 589_112, IFT: 1_393_776, PSI: 2_191_232, PROD: 8_245_809, LOAD: 5_347_118 },
            byCategoryMonthly: { HW: 2_977_758, LICENSE: 7_993_349, TRAFFIC: 79_522, SERVICES: 3_344_110, RESERVES: 1_474_623, SECURITY: 1_897_687, AI: 0 },
            topProdItemIds: ['license-db-per-vcpu', 'one-deployment', 'res-dr-active', 'storage-ssd-tb', 'res-georedundancy']
        }
    },
    {
        id: 'ai_agent_support',
        answers: {
            users_total: 120000, registered_users_total: 120000, dau_target: 36000, dau_share_of_registered_percent: 30, pcu_target: 2400,
            peak_rps: 300, avg_rps: 80, microservices_count: 14, async_workers_count: 6,
            db_count: 3, db_replicas_count: 1, db_size_initial_gb: 250, db_growth_gb_month: 30,
            backup_retention_days: 45, file_storage_volume_tb: 4, file_storage_growth_tb_year: 3,
            email_per_month: 200000, sms_per_month: 25000, push_per_month: 8000000,
            avg_response_size_kb: 6, avg_request_size_kb: 3, ram_per_vcpu_ratio: 4, cache_size_gb: 48,
            sla_target: 99.9, georedundancy_required: false, pdn_152fz: true, encryption_at_rest: true, waf_required: true,
            pentest_external: true, pentest_internal: true, load_test_before_prod: true,
            pentest_per_year: 2, load_test_per_year: 3,
            ai_llm_used: true, ai_users_share: 35, ai_requests_per_user_day: 4,
            ai_model_tier: 'premium', ai_hosting_mode: 'api',
            ai_avg_input_tokens: 1800, ai_avg_output_tokens: 900, ai_caching_share: 25,
            rag_needed: true, rag_managed_used: true, rag_corpus_size_gb: 120,
            rag_embeddings_million: 8, rag_refresh_frequency: 'daily', rag_retrieval_calls_per_query: 4,
            ai_agent_mode: true, ai_agent_type: 'multi_agent', agent_complexity: 'complex',
            agent_parallel_specialists: 3, agent_tool_use_share: 60, agent_tool_avg_seconds: 12,
            agent_memory_used: true, agent_memory_size_gb: 250
        },
        expected: {
            totalMonthly: 466_600_970,
            totalAnnual: 5_599_211_644,
            topCategory: 'AI',
            byStandMonthly: { DEV: 3_597_097, IFT: 34_349_233, PSI: 85_296_058, PROD: 172_226_005, LOAD: 171_132_577 },
            byCategoryMonthly: { HW: 584_412, LICENSE: 2_847_211, TRAFFIC: 39_761, SERVICES: 2_089_978, RESERVES: 0, SECURITY: 786_428, AI: 460_253_181 },
            topProdItemIds: ['llm-tokens-input-1m', 'llm-tokens-output-1m', 'ai-safety-moderation-tokens-1m', 'ai-agent-sandbox-vcpu', 'one-deployment']
        }
    }
]);

function buildBusinessCalc(scenario) {
    const dictionaries = buildSeedDictionaries();
    const answers = defaultAnswersFrom(dictionaries.questions);
    Object.assign(answers, scenario.answers);
    return {
        id: `business-golden-${scenario.id}`,
        name: `Business golden ${scenario.id}`,
        schemaVersion: 20,
        createdAt: CALC_CREATED_AT,
        updatedAt: CALC_CREATED_AT,
        settings: { ...SEED_SETTINGS },
        answers,
        dictionaries
    };
}

function roundedByStand(result) {
    return Object.fromEntries(
        STAND_IDS.map(sid => [sid, Math.round(result.stands[sid]?.totalMonthly || 0)])
    );
}

function roundedByCategory(result) {
    return Object.fromEntries(
        CATEGORY_IDS.map(cat => [cat, Math.round(result.byCategory[cat] || 0)])
    );
}

function topCategory(result) {
    return CATEGORY_IDS
        .map(cat => [cat, result.byCategory[cat] || 0])
        .sort((a, b) => b[1] - a[1])[0][0];
}

function topProdItemIds(result) {
    return Object.entries(result.items)
        .map(([itemId, itemResult]) => ({
            itemId,
            prodMonthly: itemResult.stands.PROD?.costFinal || 0
        }))
        .filter(row => row.prodMonthly > 0)
        .sort((a, b) => b.prodMonthly - a.prodMonthly)
        .slice(0, 5)
        .map(row => row.itemId);
}

describe('business golden scenarios: manual questionnaire profiles', () => {
    for (const scenario of BUSINESS_SCENARIOS) {
        it(`${scenario.id}: totals, stands, categories and PROD drivers match snapshot`, () => {
            clearCalculationCache();
            const calc = buildBusinessCalc(scenario);
            const result = calculate(calc);

            assert.equal(Math.round(result.totalMonthly), scenario.expected.totalMonthly);
            assert.equal(Math.round(result.totalAnnual), scenario.expected.totalAnnual);
            assert.equal(topCategory(result), scenario.expected.topCategory);
            assert.deepEqual(roundedByStand(result), scenario.expected.byStandMonthly);
            assert.deepEqual(roundedByCategory(result), scenario.expected.byCategoryMonthly);
            assert.deepEqual(topProdItemIds(result), scenario.expected.topProdItemIds);
        });
    }

    it('manual business profiles remain monotonic from startup to SMB to enterprise', () => {
        const totals = BUSINESS_SCENARIOS.map(scenario => {
            clearCalculationCache();
            return calculate(buildBusinessCalc(scenario)).totalMonthly;
        });

        assert.ok(totals[1] > totals[0], 'SMB profile must be more expensive than startup MVP');
        assert.ok(totals[2] > totals[1], 'Enterprise profile must be more expensive than SMB');
    });

    it('manual business profiles cover low-security, regulated and AI-heavy review cases', () => {
        const ids = new Set(BUSINESS_SCENARIOS.map(scenario => scenario.id));
        assert.ok(ids.has('internal_ops_tool'), 'low-security internal tool profile must be pinned');
        assert.ok(ids.has('regulated_fintech_high'), 'regulated high-security fintech profile must be pinned');
        assert.ok(ids.has('ai_agent_support'), 'AI/RAG/agent support profile must be pinned');
    });
});
