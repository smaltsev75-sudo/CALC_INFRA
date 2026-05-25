/**
 * Unit-тесты Stage 15.1 — Calculation Health Check.
 *
 * Покрывает: правила проверки + getHealthScore + groupHealthFindings +
 * edge-cases (null calc, отсутствие answers, scenario absent).
 *
 * Формат findings и шкала score зафиксированы в плане Stage 15:
 *   - severity: 'error' | 'warning' | 'recommendation' | 'info'
 *   - score = clamp(100 - sum(HEALTH_PENALTY[severity]), 0, 100)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    evaluateCalculationHealth,
    getHealthScore,
    groupHealthFindings
} from '../../../js/domain/calculationHealth.js';
import { HEALTH_PENALTY, HEALTH_SEVERITIES, HEALTH_CATEGORIES }
    from '../../../js/utils/constants.js';

/* ---------- Маленький фабричный helper для test-fixture'ов ---------- */

function makeCalc(answers = {}, overrides = {}) {
    return {
        id: 't1',
        name: 'Test calc',
        schemaVersion: 12,
        answers: { ...answers },
        settings: {
            applyRiskFactors: true,
            ...(overrides.settings || {})
        },
        answersMeta: overrides.answersMeta || {},
        dictionaries: overrides.dictionaries || {
            // минимальный seed-like справочник вопросов с defaultValue
            // (для completeness-too-many-defaults / -low-answer-rate)
            questions: overrides.questions || [
                { id: 'pcu_target', type: 'number', defaultValue: 500 },
                { id: 'sla_target', type: 'select', defaultValue: 99.9 },
                { id: 'product_type', type: 'select', defaultValue: 'b2c' }
            ],
            items: overrides.items || [],
            settings: {}
        },
        view: overrides.view || {}
    };
}

function findById(findings, id) {
    return findings.find(f => f.id === id);
}

/* ============================================================
 * evaluateCalculationHealth — структура результата
 * ============================================================ */

describe('evaluateCalculationHealth: контракт результата', () => {
    it('возвращает { findings, score, counts } для пустого calc', () => {
        const r = evaluateCalculationHealth(makeCalc());
        assert.ok(Array.isArray(r.findings));
        assert.equal(typeof r.score, 'number');
        assert.ok(r.counts && typeof r.counts === 'object');
        for (const sev of HEALTH_SEVERITIES) {
            assert.ok(typeof r.counts[sev] === 'number',
                `counts.${sev} должен быть number`);
        }
    });

    it('null calc → safe-result без падения (score=100, findings=[])', () => {
        const r = evaluateCalculationHealth(null);
        assert.equal(r.score, 100);
        assert.deepEqual(r.findings, []);
    });

    it('каждое finding имеет валидную severity и category', () => {
        const r = evaluateCalculationHealth(makeCalc({
            avg_rps: 200, peak_rps: 100,                  // consistency error
            rag_needed: true, ai_llm_used: false,         // ai-rag-without-llm error
            pdn_152fz: true, encryption_at_rest: false,   // security warning
            sla_target: 99.99, georedundancy_required: false
        }));
        for (const f of r.findings) {
            assert.ok(typeof f.id === 'string' && f.id.length > 0);
            assert.ok(HEALTH_SEVERITIES.includes(f.severity), `severity=${f.severity}`);
            assert.ok(HEALTH_CATEGORIES.includes(f.category), `category=${f.category}`);
            assert.ok(typeof f.title === 'string' && f.title.length > 0);
            assert.ok(typeof f.message === 'string' && f.message.length > 0);
            assert.ok(Array.isArray(f.fieldIds));
        }
    });

    it('НЕ мутирует входной calc', () => {
        const calc = makeCalc({ avg_rps: 200, peak_rps: 100 });
        const snapshot = JSON.stringify(calc);
        evaluateCalculationHealth(calc);
        assert.equal(JSON.stringify(calc), snapshot);
    });
});

/* ============================================================
 * Группа: Консистентность нагрузки (4)
 * ============================================================ */

describe('rule: consistency-avg-rps-gt-peak (error)', () => {
    it('срабатывает при avg_rps > peak_rps', () => {
        const r = evaluateCalculationHealth(makeCalc({ avg_rps: 200, peak_rps: 100 }));
        const f = findById(r.findings, 'consistency-avg-rps-gt-peak');
        assert.ok(f, 'finding должен быть');
        assert.equal(f.severity, 'error');
        assert.equal(f.category, 'consistency');
        assert.ok(f.fieldIds.includes('avg_rps'));
        assert.ok(f.fieldIds.includes('peak_rps'));
    });
    it('НЕ срабатывает при avg_rps <= peak_rps', () => {
        const r = evaluateCalculationHealth(makeCalc({ avg_rps: 50, peak_rps: 100 }));
        assert.ok(!findById(r.findings, 'consistency-avg-rps-gt-peak'));
    });
    it('НЕ срабатывает при null/undefined', () => {
        const r = evaluateCalculationHealth(makeCalc({ avg_rps: null, peak_rps: 100 }));
        assert.ok(!findById(r.findings, 'consistency-avg-rps-gt-peak'));
    });
});

describe('rule: consistency-pcu-gt-users-total (error)', () => {
    it('срабатывает при pcu_target > users_total', () => {
        const r = evaluateCalculationHealth(makeCalc({ pcu_target: 5000, users_total: 1000 }));
        const f = findById(r.findings, 'consistency-pcu-gt-users-total');
        assert.ok(f);
        assert.equal(f.severity, 'error');
    });
    it('НЕ срабатывает при pcu_target <= users_total', () => {
        const r = evaluateCalculationHealth(makeCalc({ pcu_target: 500, users_total: 1000 }));
        assert.ok(!findById(r.findings, 'consistency-pcu-gt-users-total'));
    });
});

describe('rule: consistency-peak-duration-gt-24 (error)', () => {
    it('срабатывает при peak_duration_hours > 24', () => {
        const r = evaluateCalculationHealth(makeCalc({ peak_duration_hours: 25 }));
        const f = findById(r.findings, 'consistency-peak-duration-gt-24');
        assert.ok(f);
        assert.equal(f.severity, 'error');
    });
    it('НЕ срабатывает при peak_duration_hours <= 24', () => {
        const r = evaluateCalculationHealth(makeCalc({ peak_duration_hours: 12 }));
        assert.ok(!findById(r.findings, 'consistency-peak-duration-gt-24'));
    });
});

describe('rule: consistency-registered-gt-active (warning)', () => {
    it('срабатывает при registered > users_total × 100', () => {
        const r = evaluateCalculationHealth(makeCalc({
            registered_users_total: 100_001, users_total: 1000
        }));
        const f = findById(r.findings, 'consistency-registered-gt-active');
        assert.ok(f);
        assert.equal(f.severity, 'warning');
    });
    it('НЕ срабатывает при разумном соотношении (registered/active=10)', () => {
        const r = evaluateCalculationHealth(makeCalc({
            registered_users_total: 10_000, users_total: 1000
        }));
        assert.ok(!findById(r.findings, 'consistency-registered-gt-active'));
    });
});

describe('rule: consistency-dau-share-lower-than-1-percent (warning)', () => {
    it('срабатывает при DAU-доле меньше 1%', () => {
        const r = evaluateCalculationHealth(makeCalc({
            registered_users_total: 500,
            dau_share_of_registered_percent: 0.7
        }));
        const f = findById(r.findings, 'consistency-dau-share-lower-than-1-percent');
        assert.ok(f);
        assert.equal(f.severity, 'warning');
        assert.ok(f.fieldIds.includes('dau_share_of_registered_percent'));
    });

    it('НЕ срабатывает при 1% и выше', () => {
        const r = evaluateCalculationHealth(makeCalc({
            registered_users_total: 500,
            dau_share_of_registered_percent: 1
        }));
        assert.ok(!findById(r.findings, 'consistency-dau-share-lower-than-1-percent'));
    });
});

describe('rule: consistency-traffic-*-explicit-differs-from-auto (warning)', () => {
    it('срабатывает, если явный egress отличается от автооценки в 3+ раза', () => {
        const r = evaluateCalculationHealth(makeCalc({
            avg_rps: 80,
            avg_response_size_kb: 20,
            traffic_egress_tb_month: 15
        }));
        const f = findById(r.findings, 'consistency-traffic-egress-explicit-differs-from-auto');
        assert.ok(f);
        assert.equal(f.severity, 'warning');
    });

    it('НЕ срабатывает, если явный egress равен 0 и включён авторасчёт', () => {
        const r = evaluateCalculationHealth(makeCalc({
            avg_rps: 80,
            avg_response_size_kb: 20,
            traffic_egress_tb_month: 0
        }));
        assert.ok(!findById(r.findings, 'consistency-traffic-egress-explicit-differs-from-auto'));
    });

    it('срабатывает, если явный ingress отличается от автооценки в 3+ раза', () => {
        const r = evaluateCalculationHealth(makeCalc({
            avg_rps: 80,
            avg_request_size_kb: 5,
            traffic_ingress_tb_month: 4
        }));
        assert.ok(findById(r.findings, 'consistency-traffic-ingress-explicit-differs-from-auto'));
    });
});

/* ============================================================
 * Группа: AI / RAG
 * ============================================================ */

describe('rule: ai-rag-without-llm (error)', () => {
    it('срабатывает при rag_needed && !ai_llm_used', () => {
        const r = evaluateCalculationHealth(makeCalc({ rag_needed: true, ai_llm_used: false }));
        const f = findById(r.findings, 'ai-rag-without-llm');
        assert.ok(f);
        assert.equal(f.severity, 'error');
    });
    it('НЕ срабатывает при rag_needed && ai_llm_used', () => {
        const r = evaluateCalculationHealth(makeCalc({ rag_needed: true, ai_llm_used: true }));
        assert.ok(!findById(r.findings, 'ai-rag-without-llm'));
    });
});

describe('rule: ai-agent-without-llm (error)', () => {
    it('срабатывает при ai_agent_mode && !ai_llm_used', () => {
        const r = evaluateCalculationHealth(makeCalc({ ai_agent_mode: true, ai_llm_used: false }));
        const f = findById(r.findings, 'ai-agent-without-llm');
        assert.ok(f);
        assert.equal(f.severity, 'error');
    });
});

describe('rule: ai-token-volume-without-llm (error)', () => {
    it('срабатывает, если пользователь задал объём токенов, но LLM выключен', () => {
        const r = evaluateCalculationHealth(makeCalc({
            ai_llm_used: false,
            ai_avg_input_tokens: 3000,
            ai_avg_output_tokens: 500,
            ai_caching_share: 30
        }));
        const f = findById(r.findings, 'ai-token-volume-without-llm');
        assert.ok(f);
        assert.equal(f.severity, 'error');
        assert.ok(f.fieldIds.includes('ai_llm_used'));
        assert.ok(f.fieldIds.includes('ai_avg_input_tokens'));
    });

    it('срабатывает даже при дефолтном числе, если поле явно изменено вручную', () => {
        const r = evaluateCalculationHealth(makeCalc({
            ai_llm_used: false,
            ai_avg_input_tokens: 1500
        }, {
            answersMeta: { ai_avg_input_tokens: { source: 'manual' } }
        }));
        assert.ok(findById(r.findings, 'ai-token-volume-without-llm'));
    });

    it('НЕ срабатывает для обычных дефолтов не-AI расчёта', () => {
        const r = evaluateCalculationHealth(makeCalc({
            ai_llm_used: false,
            ai_avg_input_tokens: 1500,
            ai_avg_output_tokens: 500,
            ai_caching_share: 20
        }));
        assert.ok(!findById(r.findings, 'ai-token-volume-without-llm'));
    });

    it('НЕ срабатывает, если LLM включён', () => {
        const r = evaluateCalculationHealth(makeCalc({
            ai_llm_used: true,
            ai_avg_input_tokens: 3000,
            ai_avg_output_tokens: 1000,
            ai_caching_share: 50
        }));
        assert.ok(!findById(r.findings, 'ai-token-volume-without-llm'));
    });
});

describe('rule: ai-token-volume-without-token-resources (error)', () => {
    const tokenDemand = {
        ai_llm_used: true,
        ai_hosting_mode: 'external_api',
        registered_users_total: 500,
        dau_share_of_registered_percent: 0.7,
        ai_users_share: 75,
        ai_requests_per_user_day: 30,
        ai_avg_input_tokens: 3000,
        ai_avg_output_tokens: 500,
        target_capex_rub: 1_000_000
    };

    const tokenItem = qty => ({
        id: 'test-token-item',
        name: 'Тестовые токены',
        unit: '1 млн токенов',
        pricePerUnit: 1,
        billingInterval: 'monthly',
        category: 'AI',
        resourceClass: 'AI_LLM',
        dashboardAiMetric: 'TOKENS',
        applicableStands: ['PROD'],
        qtyFormulas: { PROD: String(qty) }
    });

    it('срабатывает, если LLM и объём токенов включены, но TOKENS-ЭК дают 0', () => {
        const r = evaluateCalculationHealth(makeCalc(tokenDemand, {
            items: [tokenItem(0)],
            view: { disabledStands: ['DEV', 'IFT', 'PSI', 'LOAD'] }
        }));
        const f = findById(r.findings, 'ai-token-volume-without-token-resources');
        assert.ok(f);
        assert.equal(f.severity, 'error');
        assert.ok(f.fieldIds.includes('ai_avg_input_tokens'));
    });

    it('НЕ срабатывает, когда хотя бы один TOKENS-ЭК рассчитался', () => {
        const r = evaluateCalculationHealth(makeCalc(tokenDemand, {
            items: [tokenItem(1)],
            view: { disabledStands: ['DEV', 'IFT', 'PSI', 'LOAD'] }
        }));
        assert.ok(!findById(r.findings, 'ai-token-volume-without-token-resources'));
    });

    it('НЕ срабатывает для собственного GPU, где токены не являются биллинговым ЭК', () => {
        const r = evaluateCalculationHealth(makeCalc({
            ...tokenDemand,
            ai_hosting_mode: 'on_prem_gpu'
        }, {
            items: [],
            view: { disabledStands: ['DEV', 'IFT', 'PSI', 'LOAD'] }
        }));
        assert.ok(!findById(r.findings, 'ai-token-volume-without-token-resources'));
    });
});

describe('rule: ai-rag-incomplete-corpus (warning)', () => {
    it('срабатывает при rag_needed && rag_corpus_size_gb=0', () => {
        const r = evaluateCalculationHealth(makeCalc({
            rag_needed: true, ai_llm_used: true,
            rag_corpus_size_gb: 0, rag_embeddings_million: 5
        }));
        const f = findById(r.findings, 'ai-rag-incomplete-corpus');
        assert.ok(f);
        assert.equal(f.severity, 'warning');
    });
    it('срабатывает при rag_needed && rag_embeddings_million=0', () => {
        const r = evaluateCalculationHealth(makeCalc({
            rag_needed: true, ai_llm_used: true,
            rag_corpus_size_gb: 5, rag_embeddings_million: 0
        }));
        assert.ok(findById(r.findings, 'ai-rag-incomplete-corpus'));
    });
    it('НЕ срабатывает при заполненном корпусе и эмбеддингах', () => {
        const r = evaluateCalculationHealth(makeCalc({
            rag_needed: true, ai_llm_used: true,
            rag_corpus_size_gb: 5, rag_embeddings_million: 5
        }));
        assert.ok(!findById(r.findings, 'ai-rag-incomplete-corpus'));
    });
});

describe('rule: ai-agent-incomplete-tools (warning)', () => {
    it('срабатывает при ai_agent_mode && agent_tool_avg_seconds=0', () => {
        const r = evaluateCalculationHealth(makeCalc({
            ai_agent_mode: true, ai_llm_used: true, agent_tool_avg_seconds: 0
        }));
        const f = findById(r.findings, 'ai-agent-incomplete-tools');
        assert.ok(f);
        assert.equal(f.severity, 'warning');
    });
});

/* ============================================================
 * Группа: ПДн / безопасность (4)
 * ============================================================ */

describe('rule: security-pdn-without-encryption (warning)', () => {
    it('срабатывает при pdn_152fz=true && encryption_at_rest=false', () => {
        const r = evaluateCalculationHealth(makeCalc({
            pdn_152fz: true, encryption_at_rest: false
        }));
        const f = findById(r.findings, 'security-pdn-without-encryption');
        assert.ok(f);
        assert.equal(f.severity, 'warning');
        assert.equal(f.category, 'security');
    });
    it('НЕ срабатывает при !pdn_152fz', () => {
        const r = evaluateCalculationHealth(makeCalc({
            pdn_152fz: false, encryption_at_rest: false
        }));
        assert.ok(!findById(r.findings, 'security-pdn-without-encryption'));
    });
});

describe('rule: security-pdn-without-category (warning)', () => {
    it('срабатывает при pdn_152fz=true && pdn_category=null', () => {
        const r = evaluateCalculationHealth(makeCalc({
            pdn_152fz: true, pdn_category: null
        }));
        assert.ok(findById(r.findings, 'security-pdn-without-category'));
    });
    it('НЕ срабатывает при заполненной категории', () => {
        const r = evaluateCalculationHealth(makeCalc({
            pdn_152fz: true, pdn_category: 'cat-3'
        }));
        assert.ok(!findById(r.findings, 'security-pdn-without-category'));
    });
});

describe('rule: security-public-without-waf (warning)', () => {
    it('срабатывает при product_type=b2c && !waf_required', () => {
        const r = evaluateCalculationHealth(makeCalc({
            product_type: 'b2c', waf_required: false
        }));
        assert.ok(findById(r.findings, 'security-public-without-waf'));
    });
    it('срабатывает при product_type=b2g && !waf_required', () => {
        const r = evaluateCalculationHealth(makeCalc({
            product_type: 'b2g', waf_required: false
        }));
        assert.ok(findById(r.findings, 'security-public-without-waf'));
    });
    it('НЕ срабатывает при product_type=internal', () => {
        const r = evaluateCalculationHealth(makeCalc({
            product_type: 'internal', waf_required: false
        }));
        assert.ok(!findById(r.findings, 'security-public-without-waf'));
    });
});

describe('rule: security-public-without-ddos (recommendation)', () => {
    it('срабатывает при product_type=b2c && !ddos_protection_required', () => {
        const r = evaluateCalculationHealth(makeCalc({
            product_type: 'b2c', ddos_protection_required: false
        }));
        const f = findById(r.findings, 'security-public-without-ddos');
        assert.ok(f);
        assert.equal(f.severity, 'recommendation');
    });
});

/* ============================================================
 * Группа: SLA / резервирование (3)
 * ============================================================ */

describe('rule: sla-high-without-georedundancy (warning)', () => {
    it('срабатывает при sla_target=99.95 && !georedundancy_required', () => {
        const r = evaluateCalculationHealth(makeCalc({
            sla_target: 99.95, georedundancy_required: false
        }));
        assert.ok(findById(r.findings, 'sla-high-without-georedundancy'));
    });
    it('срабатывает при sla_target=99.99 && !georedundancy_required', () => {
        const r = evaluateCalculationHealth(makeCalc({
            sla_target: 99.99, georedundancy_required: false
        }));
        assert.ok(findById(r.findings, 'sla-high-without-georedundancy'));
    });
    it('НЕ срабатывает при sla_target=99.9 (стандарт)', () => {
        const r = evaluateCalculationHealth(makeCalc({
            sla_target: 99.9, georedundancy_required: false
        }));
        assert.ok(!findById(r.findings, 'sla-high-without-georedundancy'));
    });
});

describe('rule: sla-strict-rto-rpo-without-georedundancy (warning)', () => {
    it('срабатывает при rto_hours <= 1 && !georedundancy_required', () => {
        const r = evaluateCalculationHealth(makeCalc({
            rto_hours: 1, rpo_minutes: 60, georedundancy_required: false
        }));
        assert.ok(findById(r.findings, 'sla-strict-rto-rpo-without-georedundancy'));
    });
    it('срабатывает при rpo_minutes <= 5 && !georedundancy_required', () => {
        const r = evaluateCalculationHealth(makeCalc({
            rto_hours: 4, rpo_minutes: 5, georedundancy_required: false
        }));
        assert.ok(findById(r.findings, 'sla-strict-rto-rpo-without-georedundancy'));
    });
});

describe('rule: sla-zero-rpo-without-replicas (warning)', () => {
    it('срабатывает при rpo_minutes=0 && db_replicas_count<2', () => {
        const r = evaluateCalculationHealth(makeCalc({
            rpo_minutes: 0, db_replicas_count: 1
        }));
        assert.ok(findById(r.findings, 'sla-zero-rpo-without-replicas'));
    });
    it('НЕ срабатывает при db_replicas_count >= 2', () => {
        const r = evaluateCalculationHealth(makeCalc({
            rpo_minutes: 0, db_replicas_count: 2
        }));
        assert.ok(!findById(r.findings, 'sla-zero-rpo-without-replicas'));
    });
});

/* ============================================================
 * Группа: Риск-коэффициенты
 * ============================================================ */

describe('rule: risk-seasonal-activity-not-applied (warning)', () => {
    it('срабатывает, если сезонность включена, но kSeasonal=0', () => {
        const r = evaluateCalculationHealth(makeCalc({
            seasonal_activity: true
        }, {
            settings: { kSeasonal: 0, applyRiskFactors: true }
        }));
        const f = findById(r.findings, 'risk-seasonal-activity-not-applied');
        assert.ok(f);
        assert.equal(f.category, 'risk');
        assert.equal(f.severity, 'warning');
    });

    it('срабатывает, если сезонность включена, но риск-коэффициенты отключены', () => {
        const r = evaluateCalculationHealth(makeCalc({
            seasonal_activity: true
        }, {
            settings: { kSeasonal: 0.15, applyRiskFactors: false }
        }));
        assert.ok(findById(r.findings, 'risk-seasonal-activity-not-applied'));
    });

    it('НЕ срабатывает, если сезонная надбавка реально применяется', () => {
        const r = evaluateCalculationHealth(makeCalc({
            seasonal_activity: true
        }, {
            settings: { kSeasonal: 0.15, applyRiskFactors: true }
        }));
        assert.ok(!findById(r.findings, 'risk-seasonal-activity-not-applied'));
    });
});

/* ============================================================
 * Группа: Прайсы (3)
 * ============================================================ */

describe('rule: pricing-stale-bundle (warning)', () => {
    it('срабатывает при bundle.timestamp старше 6 месяцев', () => {
        const oldDate = new Date();
        oldDate.setMonth(oldDate.getMonth() - 7);
        const r = evaluateCalculationHealth(makeCalc(), {
            bundleMeta: { providerId: 'sbercloud', version: '2025-Q1', timestamp: oldDate.toISOString() }
        });
        const f = findById(r.findings, 'pricing-stale-bundle');
        assert.ok(f);
        assert.equal(f.severity, 'warning');
        assert.equal(f.category, 'pricing');
    });
    it('НЕ срабатывает при свежем bundle (1 мес)', () => {
        const fresh = new Date();
        fresh.setMonth(fresh.getMonth() - 1);
        const r = evaluateCalculationHealth(makeCalc(), {
            bundleMeta: { providerId: 'sbercloud', version: '2026-Q2', timestamp: fresh.toISOString() }
        });
        assert.ok(!findById(r.findings, 'pricing-stale-bundle'));
    });
});

describe('rule: pricing-stub-bundle (recommendation)', () => {
    it('срабатывает при version содержит "stub"', () => {
        const r = evaluateCalculationHealth(makeCalc(), {
            bundleMeta: { providerId: 'yandex', version: '2026-Q3-stub', timestamp: new Date().toISOString() }
        });
        const f = findById(r.findings, 'pricing-stub-bundle');
        assert.ok(f);
        assert.equal(f.severity, 'recommendation');
    });
    it('срабатывает при "test" / "fixture" в version', () => {
        const r1 = evaluateCalculationHealth(makeCalc(), {
            bundleMeta: { providerId: 'x', version: 'test-fixture', timestamp: new Date().toISOString() }
        });
        assert.ok(findById(r1.findings, 'pricing-stub-bundle'));
    });
    it('НЕ срабатывает при production version', () => {
        const r = evaluateCalculationHealth(makeCalc(), {
            bundleMeta: { providerId: 'sbercloud', version: '2026-Q3', timestamp: new Date().toISOString() }
        });
        assert.ok(!findById(r.findings, 'pricing-stub-bundle'));
    });
});

describe('rule: pricing-bundle-not-applied (warning)', () => {
    it('срабатывает при bundleMeta.isStale=true', () => {
        const r = evaluateCalculationHealth(makeCalc(), {
            bundleMeta: {
                providerId: 'sbercloud', version: '2026-Q3',
                timestamp: new Date().toISOString(),
                isStale: true
            }
        });
        const f = findById(r.findings, 'pricing-bundle-not-applied');
        assert.ok(f);
        assert.equal(f.severity, 'warning');
    });
    it('НЕ срабатывает при isStale=false', () => {
        const r = evaluateCalculationHealth(makeCalc(), {
            bundleMeta: {
                providerId: 'sbercloud', version: '2026-Q3',
                timestamp: new Date().toISOString(),
                isStale: false
            }
        });
        assert.ok(!findById(r.findings, 'pricing-bundle-not-applied'));
    });
});

describe('rule: pricing-vk-security-by-request (warning)', () => {
    it('срабатывает для VK Cloud, если WAF или DDoS включены', () => {
        const r = evaluateCalculationHealth(makeCalc({
            waf_required: true,
            ddos_protection_required: true
        }, {
            settings: { provider: 'vk' }
        }));
        const f = findById(r.findings, 'pricing-vk-security-by-request');
        assert.ok(f);
        assert.equal(f.severity, 'warning');
        assert.equal(f.category, 'pricing');
        assert.match(f.message, /WAF\/DDoS включены/);
        assert.match(f.message, /12\.01\.2026/);
        assert.ok(f.fieldIds.includes('waf_required'));
        assert.ok(f.fieldIds.includes('ddos_protection_required'));
    });

    it('НЕ срабатывает для VK Cloud, если WAF и DDoS выключены', () => {
        const r = evaluateCalculationHealth(makeCalc({
            waf_required: false,
            ddos_protection_required: false
        }, {
            settings: { provider: 'vk' }
        }));
        assert.ok(!findById(r.findings, 'pricing-vk-security-by-request'));
    });

    it('НЕ срабатывает для провайдера с опубликованной WAF-ценой', () => {
        const r = evaluateCalculationHealth(makeCalc({
            waf_required: true,
            ddos_protection_required: true
        }, {
            settings: { provider: 'yandex' }
        }));
        assert.ok(!findById(r.findings, 'pricing-vk-security-by-request'));
    });
});

/* ============================================================
 * Группа: Полнота данных (3)
 * ============================================================ */

describe('rule: completeness-too-many-defaults (warning)', () => {
    it('срабатывает при доле default-ответов > 0.7', () => {
        // 3 вопроса, все 3 = defaultValue
        const calc = makeCalc({
            pcu_target: 500,
            sla_target: 99.9,
            product_type: 'b2c'
        });
        const r = evaluateCalculationHealth(calc);
        assert.ok(findById(r.findings, 'completeness-too-many-defaults'));
    });
    it('НЕ срабатывает когда все ответы кастомные', () => {
        const calc = makeCalc({
            pcu_target: 1234,
            sla_target: 99.99,
            product_type: 'internal'
        });
        const r = evaluateCalculationHealth(calc);
        assert.ok(!findById(r.findings, 'completeness-too-many-defaults'));
    });
});

describe('rule: completeness-low-answer-rate (recommendation)', () => {
    it('срабатывает при <50% вопросов имеют значение', () => {
        // 3 вопроса, 1 ответ → answer-rate = 33%
        const calc = makeCalc({ pcu_target: 1234 });
        const r = evaluateCalculationHealth(calc);
        assert.ok(findById(r.findings, 'completeness-low-answer-rate'));
    });
    it('НЕ срабатывает при >= 50% вопросов', () => {
        // 3 вопроса, 2 ответа = 66%
        const calc = makeCalc({ pcu_target: 1234, sla_target: 99.99 });
        const r = evaluateCalculationHealth(calc);
        assert.ok(!findById(r.findings, 'completeness-low-answer-rate'));
    });
});

describe('rule: completeness-no-budget-target (recommendation)', () => {
    it('срабатывает при обоих null', () => {
        const calc = makeCalc({ target_capex_rub: null, target_opex_monthly_rub: null });
        const r = evaluateCalculationHealth(calc);
        assert.ok(findById(r.findings, 'completeness-no-budget-target'));
    });
    it('НЕ срабатывает если хотя бы один указан', () => {
        const calc = makeCalc({ target_capex_rub: 5_000_000, target_opex_monthly_rub: null });
        const r = evaluateCalculationHealth(calc);
        assert.ok(!findById(r.findings, 'completeness-no-budget-target'));
    });
});

/* ============================================================
 * getHealthScore — формула clamp(100 - sum(penalties), 0, 100)
 * ============================================================ */

describe('getHealthScore', () => {
    it('пустой массив → 100', () => {
        assert.equal(getHealthScore([]), 100);
    });
    it('1 error → 100 - 20 = 80', () => {
        const f = [{ id: 'x', severity: 'error', category: 'consistency',
            title: 't', message: 'm', fieldIds: [] }];
        assert.equal(getHealthScore(f), 100 - HEALTH_PENALTY.error);
    });
    it('1 warning → 92', () => {
        const f = [{ severity: 'warning' }];
        assert.equal(getHealthScore(f), 100 - HEALTH_PENALTY.warning);
    });
    it('1 recommendation → 97', () => {
        const f = [{ severity: 'recommendation' }];
        assert.equal(getHealthScore(f), 100 - HEALTH_PENALTY.recommendation);
    });
    it('1 info → 100 (нулевой штраф)', () => {
        assert.equal(getHealthScore([{ severity: 'info' }]), 100);
    });
    it('clamp на нижней границе: 100 errors → 0', () => {
        const f = Array(100).fill({ severity: 'error' });
        assert.equal(getHealthScore(f), 0);
    });
    it('1 error + 2 warning + 3 rec = 100 − 20 − 16 − 9 = 55', () => {
        const f = [
            { severity: 'error' },
            { severity: 'warning' }, { severity: 'warning' },
            { severity: 'recommendation' }, { severity: 'recommendation' }, { severity: 'recommendation' }
        ];
        assert.equal(getHealthScore(f), 55);
    });
    it('возвращает целое число (Math.round при дробях)', () => {
        // штрафы — целые, но проверяем, что результат не NaN/float
        const score = getHealthScore([{ severity: 'warning' }]);
        assert.ok(Number.isInteger(score));
    });
    it('null/undefined input → 100', () => {
        assert.equal(getHealthScore(null), 100);
        assert.equal(getHealthScore(undefined), 100);
    });
});

/* ============================================================
 * groupHealthFindings — группировка по severity
 * ============================================================ */

describe('groupHealthFindings', () => {
    it('возвращает 4 ключа для всех severities (даже пустых)', () => {
        const g = groupHealthFindings([]);
        assert.deepEqual(Object.keys(g).sort(),
            ['error', 'info', 'recommendation', 'warning']);
        for (const sev of HEALTH_SEVERITIES) {
            assert.ok(Array.isArray(g[sev]));
        }
    });
    it('правильно группирует по severity', () => {
        const findings = [
            { id: 'a', severity: 'error' },
            { id: 'b', severity: 'warning' },
            { id: 'c', severity: 'warning' },
            { id: 'd', severity: 'recommendation' }
        ];
        const g = groupHealthFindings(findings);
        assert.equal(g.error.length, 1);
        assert.equal(g.warning.length, 2);
        assert.equal(g.recommendation.length, 1);
        assert.equal(g.info.length, 0);
    });
    it('сохраняет порядок findings внутри группы', () => {
        const findings = [
            { id: 'a', severity: 'warning' },
            { id: 'b', severity: 'warning' }
        ];
        const g = groupHealthFindings(findings);
        assert.equal(g.warning[0].id, 'a');
        assert.equal(g.warning[1].id, 'b');
    });
    it('null/undefined input → пустые группы', () => {
        const g = groupHealthFindings(null);
        for (const sev of HEALTH_SEVERITIES) {
            assert.deepEqual(g[sev], []);
        }
    });
});

/* ============================================================
 * counts в результате evaluateCalculationHealth
 * ============================================================ */

describe('evaluateCalculationHealth: counts по severities', () => {
    it('counts отражают реальное число findings', () => {
        const r = evaluateCalculationHealth(makeCalc({
            avg_rps: 200, peak_rps: 100,                  // error
            rag_needed: true, ai_llm_used: false,         // error
            pdn_152fz: true, encryption_at_rest: false,   // warning
            sla_target: 99.95, georedundancy_required: false, // warning
            product_type: 'b2c', ddos_protection_required: false // recommendation
        }));
        assert.ok(r.counts.error >= 2);
        assert.ok(r.counts.warning >= 2);
        assert.ok(r.counts.recommendation >= 1);
    });

    it('пустой calc даёт >=1 recommendation (low-answer-rate)', () => {
        const r = evaluateCalculationHealth(makeCalc());
        assert.ok(r.counts.recommendation >= 1);
        assert.ok(r.score < 100);
    });

    it('calc без findings (с заполненным бюджетом и без вопросов) → score=100', () => {
        // calc, у которого нет вопросов и нет conflict-ов вообще; бюджет указан
        // явно — иначе сработает completeness-no-budget-target.
        const empty = {
            id: 'x', name: 'x', schemaVersion: 12,
            answers: { target_capex_rub: 1_000_000 },
            settings: { applyRiskFactors: true },
            dictionaries: { questions: [], items: [], settings: {} },
            view: {}
        };
        const r = evaluateCalculationHealth(empty);
        assert.equal(r.score, 100);
        assert.equal(r.findings.length, 0);
    });
});

describe('rule: architecture-core-infrastructure-missing', () => {
    const coreItem = (id, resource, qty) => ({
        id,
        name: id,
        unit: resource === 'RAM' ? 'ГБ' : resource === 'SSD' ? 'ТБ' : 'шт.',
        pricePerUnit: 1,
        billingInterval: 'monthly',
        category: 'HW',
        resourceClass: resource === 'SSD' ? 'STORAGE' : resource,
        dashboardResource: resource,
        applicableStands: ['PROD'],
        qtyFormulas: { PROD: String(qty) }
    });

    it('ловит стенд без RAM/SSD при наличии CPU', () => {
        const r = evaluateCalculationHealth(makeCalc({
            target_capex_rub: 1_000_000
        }, {
            items: [
                coreItem('cpu-test', 'CPU', 1),
                coreItem('ram-test', 'RAM', 0),
                coreItem('ssd-test', 'SSD', 0)
            ],
            view: { disabledStands: ['DEV', 'IFT', 'PSI', 'LOAD'] }
        }));
        const f = findById(r.findings, 'architecture-core-infrastructure-missing');
        assert.ok(f, 'finding должен быть найден');
        assert.equal(f.severity, 'error');
        assert.match(f.message, /PROD: RAM, SSD/);
    });

    it('не ругается, когда CPU/RAM/SSD рассчитаны на активном стенде', () => {
        const r = evaluateCalculationHealth(makeCalc({
            target_capex_rub: 1_000_000
        }, {
            items: [
                coreItem('cpu-test', 'CPU', 1),
                coreItem('ram-test', 'RAM', 4),
                coreItem('ssd-test', 'SSD', 0.1)
            ],
            view: { disabledStands: ['DEV', 'IFT', 'PSI', 'LOAD'] }
        }));
        assert.equal(findById(r.findings, 'architecture-core-infrastructure-missing'), undefined);
    });
});
