/**
 * Audit Package 1 view consistency.
 *
 * These checks protect the old failure mode where domain tests were green, but
 * Dashboard / Details / Passport showed different quantities for the same EK.
 * The UI layers below must read the same calculate() result, not re-derive their
 * own incompatible values.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from '../../js/domain/calculator.js';
import { evaluateCalculationHealth } from '../../js/domain/calculationHealth.js';
import { buildQuantityTrace } from '../../js/domain/quantityTrace.js';
import { buildProdPassport } from '../../js/domain/prodPassport.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../js/domain/seed.js';
import { aggregateAiMetrics, aggregateResources } from '../../js/ui/dashboardAggregates.js';

const STANDS = ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD'];
const TARGET_ITEM_IDS = Object.freeze([
    'ai-low-latency-inference-reserve',
    'cpu-vcpu-gpu',
    'ai-agent-sandbox-vcpu',
    'ai-agent-memory-storage-tb',
    'security-siem-monitoring',
    'one-siem-integration',
    'security-dlp-license',
    'security-dlp-implementation',
    'network-ddos-protection'
]);

function makeCalc() {
    const dictionaries = buildSeedDictionaries();
    return {
        id: 'audit-package-1-view-consistency',
        name: 'Audit Package 1 view consistency',
        schemaVersion: 20,
        settings: {
            ...SEED_SETTINGS,
            applyRiskFactors: false,
            vatEnabled: false,
            provider: 'none'
        },
        answers: {
            ...defaultAnswersFrom(dictionaries.questions),

            registered_users_total: 1_000_000,
            dau_share_of_registered_percent: 30,
            pcu_target: 50_000,
            peak_rps: 2_000,

            ai_llm_used: true,
            ai_hosting_mode: 'on_prem_gpu',
            ai_model_tier: 'heavy',
            ai_users_share: 50,
            ai_requests_per_user_day: 10,
            ai_inference_latency_ms: '<500ms',

            ai_agent_mode: true,
            ai_agent_type: 'tool_use',
            agent_complexity: 'advanced',
            agent_tool_avg_seconds: 5,
            agent_memory_used: true,
            agent_memory_size_gb: 100,

            siem_integration_required: true,
            siem_log_gb_per_day: 100,
            siem_sources_count: 25,
            siem_tier: 'basic',

            dlp_required: true,
            dlp_protected_users_count: 1_200,
            dlp_channels_count: 7,

            ddos_protection_required: true,
            ddos_tier: 'l7'
        },
        answersMeta: {},
        dictionaries,
        view: { disabledStands: [] },
        providerVersion: null
    };
}

function sumItemQty(result, itemId, stands = STANDS) {
    return stands.reduce((sum, stand) => sum + (Number(result.items?.[itemId]?.stands?.[stand]?.qty) || 0), 0);
}

function sumDashboardResourceQty(calc, result, resource) {
    return calc.dictionaries.items
        .filter(item => item.dashboardResource === resource)
        .reduce((sum, item) => sum + sumItemQty(result, item.id), 0);
}

function findingIds(overrides) {
    return evaluateCalculationHealth(makeCalcWithAnswers(overrides)).findings.map(finding => finding.id);
}

function makeCalcWithAnswers(overrides) {
    const calc = makeCalc();
    calc.answers = { ...calc.answers, ...overrides };
    return calc;
}

describe('Audit Package 1: Dashboard / Details / Passport / quantityTrace consistency', () => {
    it('target EK quantities are positive where expected and visible in Passport PROD', () => {
        const calc = makeCalc();
        const result = calculate(calc);
        const passport = buildProdPassport(calc, {
            result,
            stand: 'PROD',
            limit: Number.MAX_SAFE_INTEGER
        });

        for (const itemId of TARGET_ITEM_IDS) {
            const prodCell = result.items[itemId]?.stands.PROD;
            assert.ok(prodCell, `${itemId}: calculate() must contain PROD cell`);
            assert.ok(prodCell.qty > 0, `${itemId}: PROD qty must be positive in acceptance fixture`);

            const row = passport.items.find(item => item.itemId === itemId);
            assert.ok(row, `${itemId}: Passport PROD must contain the EK row`);
            assert.equal(row.quantity, prodCell.qty, `${itemId}: Passport qty must match calculate()`);
            assert.equal(row.monthlyCost, prodCell.costFinal, `${itemId}: Passport cost must match calculate()`);
        }
    });

    it('quantityTrace uses the same PROD qty and cost as calculate() for all target EK', () => {
        const calc = makeCalc();
        const result = calculate(calc);

        for (const itemId of TARGET_ITEM_IDS) {
            const trace = buildQuantityTrace(calc, itemId, 'PROD', result);
            const prodCell = result.items[itemId].stands.PROD;

            assert.equal(trace.qty, prodCell.qty, `${itemId}: trace qty must match calculate()`);
            assert.equal(trace.costFinal, prodCell.costFinal, `${itemId}: trace cost must match calculate()`);
            assert.equal(trace.evaluateError, null, `${itemId}: trace formula must evaluate without error`);
        }
    });

    it('Dashboard resource aggregates include GPU, agent CPU and agent memory from the same item qty', () => {
        const calc = makeCalc();
        const result = calculate(calc);
        const resources = aggregateResources(result, calc.dictionaries.items, [], false, calc.answers);

        assert.equal(resources.total.GPU.qty, sumDashboardResourceQty(calc, result, 'GPU'));
        assert.equal(resources.total.CPU.qty, sumDashboardResourceQty(calc, result, 'CPU'));
        assert.equal(resources.total.SSD.qty, sumDashboardResourceQty(calc, result, 'SSD'));

        assert.ok(sumItemQty(result, 'cpu-vcpu-gpu') > 0, 'fixture must exercise GPU qty');
        assert.ok(sumItemQty(result, 'ai-agent-sandbox-vcpu') > 0, 'fixture must exercise agent CPU qty');
        assert.ok(sumItemQty(result, 'ai-agent-memory-storage-tb') > 0, 'fixture must exercise agent memory qty');
        assert.ok(resources.total.CPU.qty >= sumItemQty(result, 'ai-agent-sandbox-vcpu'),
            'agent CPU is part of the common CPU resource total, not a separate additive dashboard resource');
    });

    it('Dashboard AI metrics expose agent CPU only from ai-agent-sandbox-vcpu, not from GPU CPU', () => {
        const calc = makeCalc();
        const result = calculate(calc);
        const aiMetrics = aggregateAiMetrics(result, calc.dictionaries.items, [], false, calc);

        assert.equal(aiMetrics.total.AGENT_CPU.qty, sumItemQty(result, 'ai-agent-sandbox-vcpu'));
        assert.ok(sumItemQty(result, 'cpu-vcpu-gpu') > 0, 'fixture must exercise GPU CPU');
        assert.notEqual(aiMetrics.total.AGENT_CPU.qty, sumItemQty(result, 'cpu-vcpu-gpu'),
            'GPU CPU must not leak into the AI metric «CPU агентов»');
    });

    it('Health Check keeps SIEM/DLP partial-driver nudges separate and does not hide unknown DDoS tier', () => {
        assert.deepEqual(
            findingIds({ siem_integration_required: true, siem_log_gb_per_day: 0, siem_sources_count: 25 })
                .filter(id => id.includes('siem')),
            ['security-siem-monitoring-flat'],
            'SIEM sources-only must still nudge that monitoring log volume is flat'
        );
        assert.deepEqual(
            findingIds({ siem_integration_required: true, siem_log_gb_per_day: 100, siem_sources_count: 0 })
                .filter(id => id.includes('siem')),
            ['security-siem-integration-flat'],
            'SIEM log-only must still nudge that integration sources are flat'
        );
        assert.deepEqual(
            findingIds({ dlp_required: true, dlp_protected_users_count: 1200, dlp_channels_count: 0 })
                .filter(id => id.includes('dlp')),
            ['security-dlp-implementation-flat'],
            'DLP users-only must still nudge that implementation channels are flat'
        );
        assert.deepEqual(
            findingIds({ dlp_required: true, dlp_protected_users_count: 0, dlp_channels_count: 7 })
                .filter(id => id.includes('dlp')),
            ['security-dlp-license-flat'],
            'DLP channels-only must still nudge that license seats are flat'
        );
        assert.ok(
            findingIds({
                ddos_protection_required: true,
                ddos_tier: 'enterprise',
                fstec_certification_required: true
            }).includes('security-ddos-basic-tier-critical'),
            'Unknown imported ddos_tier must not suppress the critical-profile DDoS nudge'
        );
    });
});
