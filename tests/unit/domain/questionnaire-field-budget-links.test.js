import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';

function makeCalc(override = {}, settingsOverride = {}) {
    const dictionaries = buildSeedDictionaries();
    const answers = defaultAnswersFrom(dictionaries.questions);
    Object.assign(answers, {
        traffic_egress_tb_month: 0,
        traffic_ingress_tb_month: 0,
        applyRiskFactors: false
    }, override);
    return {
        id: 'questionnaire-field-budget-links',
        name: 'Questionnaire field budget links',
        schemaVersion: 20,
        createdAt: '2026-05-25T00:00:00Z',
        updatedAt: '2026-05-25T00:00:00Z',
        settings: {
            ...SEED_SETTINGS,
            ...settingsOverride,
            applyRiskFactors: false,
            vatEnabled: false,
            vatRate: 0
        },
        answers,
        dictionaries
    };
}

function qty(itemId, answers, stand = 'PROD', settings = {}) {
    clearCalculationCache();
    const result = calculate(makeCalc(answers, settings));
    return result.items[itemId]?.stands?.[stand]?.qty ?? 0;
}

describe('questionnaire fields are wired to budget items', () => {
    it('business/load/storage fields affect concrete EK quantities', () => {
        assert.ok(qty('cpu-vcpu-shared', { pcu_target: 10000, peak_rps: 50 }) >
            qty('cpu-vcpu-shared', { pcu_target: 100, peak_rps: 50 }));

        assert.ok(qty('traffic-egress-tb', {
            avg_rps: 0,
            peak_rps: 240,
            peak_duration_hours: 4,
            avg_response_size_kb: 200
        }) > qty('traffic-egress-tb', {
            avg_rps: 0,
            peak_rps: 240,
            peak_duration_hours: 0,
            avg_response_size_kb: 200
        }));

        assert.ok(qty('storage-ssd-tb', {
            users_total: 10_000_000,
            file_storage_volume_tb: 10,
            hot_data_share_percent: 80
        }) > qty('storage-ssd-tb', {
            users_total: 1000,
            file_storage_volume_tb: 10,
            hot_data_share_percent: 10
        }));

        assert.equal(qty('license-db-per-vcpu', {
            db_commercial_license_required: false,
            db_count: 2,
            db_replicas_count: 1
        }), 0);
        assert.equal(qty('license-db-per-vcpu', {
            db_commercial_license_required: true,
            db_count: 2,
            db_replicas_count: 1
        }), 16);
    });

    it('integration/security/SLA fields activate their EK items', () => {
        assert.equal(qty('network-cdn-edge', { audience_geography: 'global' }), 2);
        assert.equal(qty('network-realtime-gateway', { realtime_required: true, pcu_target: 6000 }), 2);
        assert.equal(qty('one-seasonal-load-readiness', { seasonal_activity: true, peak_months: ['jan', 'sep'] }), 2);
        assert.equal(qty('security-pdn-category-hardening', { pdn_152fz: true, pdn_category: '1' }), 3);
        assert.equal(qty('one-payment-gateway-integration', { payment_gateway: true }), 1);
        assert.equal(qty('one-sso-integration', { sso_required: true }), 1);
        assert.equal(qty('service-antifraud-license', { antifraud_required: true }), 1);
        assert.equal(qty('one-edo-integration', { edo_required: true }), 1);
        assert.equal(qty('service-external-api-calls-1m', { external_api_calls_per_month: 2_500_000 }), 3);
        assert.equal(qty(
            'service-external-api-calls-1m',
            { external_api_calls_per_month: 1_400_000 },
            'LOAD',
            { standSizeRatio: { ...SEED_SETTINGS.standSizeRatio, LOAD: 1 } }
        ), 2);
        // Stage 5A: res-dr-active (active-active) = 100% от vCPU ПРОМ (prod-derived),
        // а не фикс. 1. Сверяем с суммой CPU-агрегата ПРОМ при тех же ответах.
        const drAnswers = { rto_hours: 1, rpo_minutes: 60, sla_target: 99.9 };
        const prodVcpu = qty('cpu-vcpu-shared', drAnswers)
            + qty('cpu-vcpu-dedicated', drAnswers)
            + qty('ai-agent-sandbox-vcpu', drAnswers);
        assert.ok(prodVcpu > 0, 'prodComputeVcpu должен быть положительным');
        assert.equal(qty('res-dr-active', drAnswers), prodVcpu);
        // Stage 5A: res-georedundancy (active-passive) = 30% от vCPU ПРОМ.
        assert.equal(qty('res-georedundancy', { georedundancy_required: true }),
            Math.ceil(0.3 * (qty('cpu-vcpu-shared', { georedundancy_required: true })
                + qty('cpu-vcpu-dedicated', { georedundancy_required: true })
                + qty('ai-agent-sandbox-vcpu', { georedundancy_required: true }))));
        assert.equal(qty('res-blue-green-deployment', { maintenance_window_hours_month: 0 }), 1);
        assert.equal(qty('one-dr-drill', { georedundancy_required: true, dr_drills_per_year: 4 }), 4);
    });

    it('AI model tier, latency, RAG retrievals and data sensitivity affect AI EK quantities', () => {
        const aiBase = {
            ai_llm_used: true,
            ai_hosting_mode: 'external_api',
            registered_users_total: 100000,
            dau_share_of_registered_percent: 10,
            ai_users_share: 50,
            ai_requests_per_user_day: 20,
            ai_avg_input_tokens: 3000,
            ai_avg_output_tokens: 1000,
            ai_caching_share: 0
        };
        assert.ok(qty('llm-tokens-input-1m', { ...aiBase, ai_model_tier: 'frontier' }) >
            qty('llm-tokens-input-1m', { ...aiBase, ai_model_tier: 'light' }));
        // Audit Пакет 1: latency — строковые option values; reserve только при «<500ms».
        assert.equal(qty('ai-low-latency-inference-reserve', { ...aiBase, ai_inference_latency_ms: '<500ms' }), 1);
        assert.equal(qty('ai-low-latency-inference-reserve', { ...aiBase, ai_inference_latency_ms: '<2s' }), 0);
        assert.equal(qty('ai-sensitive-data-gateway', { ...aiBase, ai_data_sensitivity: 'pdn' }), 1);
        assert.equal(qty('ai-sensitive-data-gateway', { ...aiBase, ai_data_sensitivity: 'public' }), 0);
        // Stage 1 (qty-модель ПРОМ): retrieval_calls переехал из размера vector-DB
        // (там он был ошибочным множителем) в эмбеддинги ЗАПРОСОВ ЭК «Эмбеддинги для RAG».
        // Размер vector-DB от retrieval НЕ зависит; стоимость поиска — зависит.
        const ragBase = { ...aiBase, rag_needed: true, rag_managed_used: false, rag_corpus_size_gb: 10 };
        assert.equal(
            qty('rag-vector-db-gb', { ...ragBase, rag_retrieval_calls_per_query: 20 }),
            qty('rag-vector-db-gb', { ...ragBase, rag_retrieval_calls_per_query: 4 }),
            'размер vector-DB не должен зависеть от числа поисков'
        );
        assert.ok(
            qty('rag-embeddings-1m', { ...ragBase, rag_retrieval_calls_per_query: 20 }) >
            qty('rag-embeddings-1m', { ...ragBase, rag_retrieval_calls_per_query: 4 }),
            'эмбеддинги запросов должны расти с числом поисков'
        );
    });
});
