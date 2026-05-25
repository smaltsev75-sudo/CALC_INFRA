/**
 * Этап 13: AI-агенты в Опроснике — тесты на корректность множителя.
 *
 * Контракт `S.agentStepFactor` (домножается к LLM-токенам и Sandbox-vCPU):
 *   - ai_agent_mode = false / undefined         → 1
 *   - ai_agent_mode = true, simple              → 3
 *   - ai_agent_mode = true, medium              → 8
 *   - ai_agent_mode = true, complex             → 15
 *   - + multi_agent с N специалистов            → ×N сверху
 *   - tool_use всегда ×1 параллельных
 *
 * Контракт `S.agentToolFactor` (для Sandbox-vCPU):
 *   - = agentStepFactor × (agent_tool_use_share / 100)
 *   - = 0 при выключенном ai_agent_mode
 *
 * Поведенческий контракт:
 *   - При ai_agent_mode=false поведение = v7 (LLM-токены не растут).
 *   - При ai_agent_mode=true, multi_agent+complex+parallel=3 — токены ×45.
 *   - ЭК ai-agent-sandbox-vcpu даёт qty=0 без агентского режима.
 *   - ЭК ai-agent-memory-storage даёт qty=0 без agent_memory_used.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../../../js/domain/calculator.js';
import { migrateCalculation, LATEST_SCHEMA_VERSION } from '../../../js/state/migrations.js';
import { SEED_QUESTIONS, SEED_ITEMS } from '../../../js/domain/seed.js';

/** Заготовка минимального расчёта v8 c LLM-параметрами. */
function buildLlmCalc(overrides = {}) {
    const calc = {
        id: 'test', name: 'agent-test',
        schemaVersion: 8,
        settings: {
            phaseDurationMonths: 12,
            daysPerMonth: 30,
            planningHorizonYears: 1,
            applyRiskFactors: false,  // изолируем влияние риск-коэффициентов на тестируемое qty
            bufferTask: 0, bufferProject: 0,
            kInflation: 0, kSeasonal: 0, kScheduleShift: 0, kContingency: 0,
            vatEnabled: false, vatRate: 0,
            standSizeRatio: { DEV: 0.16, IFT: 0.4, PSI: 0.5, PROD: 1, LOAD: 0.8 }
        },
        answers: {
            // LLM включён, но без агентов — базовое поведение.
            ai_llm_used: true,
            ai_hosting_mode: 'external_api',
            registered_users_total: 1000,
            dau_share_of_registered_percent: 100,  // 1000 DAU
            ai_users_share: 100,                   // все пользователи AI
            ai_requests_per_user_day: 1,           // 1 запрос/день
            ai_avg_input_tokens: 1000,
            ai_avg_output_tokens: 1000,
            ai_caching_share: 0,                   // без кэширования — формула проще
            ai_agent_mode: false,
            ...overrides
        },
        answersMeta: {},
        dictionaries: {
            items: SEED_ITEMS,
            questions: SEED_QUESTIONS
        }
    };
    return calc;
}

function getQty(result, itemId, stand = 'PROD') {
    return result.items[itemId]?.stands[stand]?.qty ?? 0;
}

function withZeroTokenFormulas(calc) {
    const zeroFormulas = { DEV: '0', IFT: '0', PSI: '0', PROD: '0', LOAD: '0' };
    return {
        ...calc,
        dictionaries: {
            ...calc.dictionaries,
            items: calc.dictionaries.items.map(item => (
                ['llm-tokens-input-1m', 'llm-tokens-output-1m', 'ai-safety-moderation-tokens-1m'].includes(item.id)
                    ? { ...item, qtyFormulas: { ...zeroFormulas } }
                    : item
            ))
        }
    };
}

describe('Этап 13: agent multiplier — буква контракта', () => {
    /* Базовая формула токенов:
       DAU × ai_users_share/100 × ai_requests_per_user_day × ai_avg_tokens × 30 / 1M
       С DAU=1000 и avg_tokens=1000: 1000 × 1 × 1 × 1000 × 30 / 1_000_000 = 30 (млн ток./мес)
       С DAU=100000: 3000 (млн ток./мес).
       Множитель агентов умножается на эту базу. */

    it('ai_agent_mode = false → токены LLM как в v7 (множитель = 1)', () => {
        const calc = buildLlmCalc({ ai_agent_mode: false });
        const r = calculate(calc);
        // 1000 DAU × 1 × 1000 токенов × 30 / 1M = 30
        assert.equal(getQty(r, 'llm-tokens-input-1m'), 30);
        assert.equal(getQty(r, 'llm-tokens-output-1m'), 30);
    });

    it('ai_agent_mode = true, simple, tool_use → токены ×3', () => {
        const calc = buildLlmCalc({
            registered_users_total: 100000,
            ai_agent_mode: true, ai_agent_type: 'tool_use',
            agent_complexity: 'simple',
            agent_tool_use_share: 50, agent_tool_avg_seconds: 1
        });
        const r = calculate(calc);
        // 100k DAU × 1000 × 30 / 1M = 3000, × 3 (simple) = 9000
        assert.equal(getQty(r, 'llm-tokens-input-1m'), 9000);
        assert.equal(getQty(r, 'llm-tokens-output-1m'), 9000);
    });

    it('ai_agent_mode = true, medium, tool_use → токены ×8', () => {
        const calc = buildLlmCalc({
            registered_users_total: 100000,
            ai_agent_mode: true, ai_agent_type: 'tool_use',
            agent_complexity: 'medium',
            agent_tool_use_share: 50, agent_tool_avg_seconds: 1
        });
        const r = calculate(calc);
        // 3000 × 8 = 24000
        assert.equal(getQty(r, 'llm-tokens-input-1m'), 24000);
        assert.equal(getQty(r, 'llm-tokens-output-1m'), 24000);
    });

    it('ai_agent_mode = true, complex, tool_use → токены ×15', () => {
        const calc = buildLlmCalc({
            registered_users_total: 100000,
            ai_agent_mode: true, ai_agent_type: 'tool_use',
            agent_complexity: 'complex',
            agent_tool_use_share: 50, agent_tool_avg_seconds: 1
        });
        const r = calculate(calc);
        // 3000 × 15 = 45000
        assert.equal(getQty(r, 'llm-tokens-input-1m'), 45000);
        assert.equal(getQty(r, 'llm-tokens-output-1m'), 45000);
    });

    it('multi_agent + complex + parallel=3 → токены ×45 (15×3)', () => {
        const calc = buildLlmCalc({
            registered_users_total: 100000,
            ai_agent_mode: true, ai_agent_type: 'multi_agent',
            agent_complexity: 'complex',
            agent_parallel_specialists: 3,
            agent_tool_use_share: 50, agent_tool_avg_seconds: 1
        });
        const r = calculate(calc);
        // 3000 × 15 × 3 = 135 000
        assert.equal(getQty(r, 'llm-tokens-input-1m'), 135000);
        assert.equal(getQty(r, 'llm-tokens-output-1m'), 135000);
    });

    it('tool_use IGNORES parallel_specialists (всегда ×1)', () => {
        const calc = buildLlmCalc({
            registered_users_total: 100000,
            ai_agent_mode: true, ai_agent_type: 'tool_use',
            agent_complexity: 'simple',
            agent_parallel_specialists: 10, // должно игнорироваться при tool_use
            agent_tool_use_share: 50, agent_tool_avg_seconds: 1
        });
        const r = calculate(calc);
        // 3000 × 3 (simple) × 1 (tool_use, parallel=10 игнор) = 9000, НЕ 90 000
        assert.equal(getQty(r, 'llm-tokens-input-1m'), 9000);
    });

    it('stale zero token formulas still produce external LLM token qty and cost from answers', () => {
        const calc = withZeroTokenFormulas(buildLlmCalc({
            ai_safety_layer: true
        }));
        const r = calculate(calc);

        assert.equal(getQty(r, 'llm-tokens-input-1m'), 30);
        assert.equal(getQty(r, 'llm-tokens-output-1m'), 30);
        assert.equal(getQty(r, 'ai-safety-moderation-tokens-1m'), 6);
        assert.ok(r.items['llm-tokens-input-1m'].stands.PROD.costFinal > 0);
        assert.ok(r.items['llm-tokens-output-1m'].stands.PROD.costFinal > 0);
    });

    it('explicit token volume answers produce LLM token qty even if ai_llm_used is stale/off', () => {
        const calc = withZeroTokenFormulas(buildLlmCalc({
            ai_llm_used: false,
            ai_safety_layer: true
        }));
        calc.answersMeta = {
            ai_requests_per_user_day: { source: 'manual' },
            ai_avg_input_tokens: { source: 'manual' },
            ai_avg_output_tokens: { source: 'manual' }
        };

        const r = calculate(calc);

        assert.equal(getQty(r, 'llm-tokens-input-1m'), 30);
        assert.equal(getQty(r, 'llm-tokens-output-1m'), 30);
        assert.equal(getQty(r, 'ai-safety-moderation-tokens-1m'), 6);
        assert.ok(r.items['llm-tokens-input-1m'].stands.PROD.costFinal > 0);
        assert.ok(r.items['llm-tokens-output-1m'].stands.PROD.costFinal > 0);
    });

    it('RAG feature with positive token inputs restores LLM token qty for legacy master-toggle drift', () => {
        const calc = withZeroTokenFormulas(buildLlmCalc({
            ai_llm_used: false,
            rag_needed: true,
            ai_users_share: 30,
            ai_requests_per_user_day: 5,
            ai_avg_input_tokens: 1500,
            ai_avg_output_tokens: 500,
            ai_caching_share: 20
        }));
        calc.answersMeta = {};

        const r = calculate(calc);

        assert.equal(getQty(r, 'llm-tokens-input-1m'), 54);
        assert.equal(getQty(r, 'llm-tokens-output-1m'), 23);
        assert.ok(r.items['llm-tokens-input-1m'].stands.PROD.costFinal > 0);
        assert.ok(r.items['llm-tokens-output-1m'].stands.PROD.costFinal > 0);
    });

    it('stale zero token formulas do not bill external tokens for on-prem GPU hosting', () => {
        const calc = withZeroTokenFormulas(buildLlmCalc({
            ai_hosting_mode: 'on_prem_gpu',
            ai_safety_layer: true
        }));
        const r = calculate(calc);

        assert.equal(getQty(r, 'llm-tokens-input-1m'), 0);
        assert.equal(getQty(r, 'llm-tokens-output-1m'), 0);
        assert.equal(getQty(r, 'ai-safety-moderation-tokens-1m'), 0);
        assert.equal(r.items['llm-tokens-input-1m'].stands.PROD.costFinal, 0);
        assert.equal(r.items['llm-tokens-output-1m'].stands.PROD.costFinal, 0);
    });
});

describe('Этап 13: ai-agent-sandbox-vcpu', () => {
    it('agent выключен → qty = 0 на всех стендах', () => {
        const calc = buildLlmCalc({ ai_agent_mode: false });
        const r = calculate(calc);
        for (const stand of ['DEV','IFT','PSI','PROD','LOAD']) {
            assert.equal(getQty(r, 'ai-agent-sandbox-vcpu', stand), 0,
                `expected 0 vCPU on ${stand} when agent_mode=false`);
        }
    });

    it('agent включён + tool_use_share=0 → sandbox qty = 0', () => {
        const calc = buildLlmCalc({
            registered_users_total: 100000,
            ai_agent_mode: true, ai_agent_type: 'tool_use',
            agent_complexity: 'medium',
            agent_tool_use_share: 0, agent_tool_avg_seconds: 3
        });
        const r = calculate(calc);
        // share=0 → toolFactor=0 → qty=0
        assert.equal(getQty(r, 'ai-agent-sandbox-vcpu', 'PROD'), 0);
    });

    it('agent включён + tool_use_share>0 → sandbox qty > 0 (PROD ≥ DEV)', () => {
        const calc = buildLlmCalc({
            registered_users_total: 1000000,
            ai_agent_mode: true, ai_agent_type: 'tool_use',
            agent_complexity: 'medium',
            agent_tool_use_share: 100, agent_tool_avg_seconds: 5
        });
        const r = calculate(calc);
        const prod = getQty(r, 'ai-agent-sandbox-vcpu', 'PROD');
        const dev  = getQty(r, 'ai-agent-sandbox-vcpu', 'DEV');
        assert.ok(prod > 0, 'expected PROD vCPU > 0');
        assert.ok(prod >= dev, 'PROD должен быть не меньше DEV (через standSizeRatio)');
    });

    it('multi_agent с большим parallel — sandbox растёт пропорционально', () => {
        const baseCalc = buildLlmCalc({
            registered_users_total: 1000000,
            ai_agent_mode: true, ai_agent_type: 'multi_agent',
            agent_complexity: 'medium',
            agent_parallel_specialists: 1,
            agent_tool_use_share: 100, agent_tool_avg_seconds: 5
        });
        const r1 = calculate(baseCalc);
        const baseQty = getQty(r1, 'ai-agent-sandbox-vcpu', 'PROD');

        const x4Calc = { ...baseCalc, answers: { ...baseCalc.answers, agent_parallel_specialists: 4 } };
        const r4 = calculate(x4Calc);
        const x4Qty = getQty(r4, 'ai-agent-sandbox-vcpu', 'PROD');

        // x4 параллели → ×4 vCPU. С учётом ceil допуск ±1 (rounding).
        const ratio = x4Qty / baseQty;
        assert.ok(Math.abs(ratio - 4) < 0.05,
            `expected ratio ≈ 4, got base=${baseQty}, x4=${x4Qty}, ratio=${ratio.toFixed(3)}`);
    });
});

describe('Этап 13: ai-agent-memory-storage-tb', () => {
    it('agent_memory_used = false → qty = 0 на всех стендах', () => {
        const calc = buildLlmCalc({
            ai_agent_mode: true, ai_agent_type: 'tool_use',
            agent_complexity: 'simple',
            agent_memory_used: false, agent_memory_size_gb: 100
        });
        const r = calculate(calc);
        for (const stand of ['DEV','IFT','PSI','PROD','LOAD']) {
            assert.equal(getQty(r, 'ai-agent-memory-storage-tb', stand), 0);
        }
    });

    it('agent_memory_used = true → qty = size × 1.5 / 1024 ТБ на PROD', () => {
        const calc = buildLlmCalc({
            ai_agent_mode: true, ai_agent_type: 'tool_use',
            agent_memory_used: true, agent_memory_size_gb: 1024  // ровно 1 ТБ исходных
        });
        const r = calculate(calc);
        const prodQty = getQty(r, 'ai-agent-memory-storage-tb', 'PROD');
        // 1024 × 1.5 / 1024 = 1.5 ТБ
        assert.ok(Math.abs(prodQty - 1.5) < 0.01,
            `expected 1.5 ТБ on PROD, got ${prodQty}`);
    });
});

describe('Этап 13: миграция v7 → LATEST (AI-агенты + per-stand AI factor + dev-traffic + restore agent defaults + clamp ratio)', () => {
    it('legacy v7 без ai_agent_mode → ставится false; aiStandFactor.DEV получает 0.02 (v10 default)', () => {
        const v7 = {
            id: 'old', schemaVersion: 7,
            settings: {}, answers: { ai_llm_used: true },
            dictionaries: { items: [], questions: [] }
        };
        const out = migrateCalculation(v7);
        assert.equal(out.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.equal(out.answers.ai_agent_mode, false);
        // 13.U7: миграция заполняет aiStandFactor sensible-defaults.
        // 13.U10: DEV переключается с 0 (старый v9 default) на 0.02 (новый v10 default
        //          — 2% разработческого AI-traffic'а для регрессионных тестов и демо).
        assert.ok(out.settings.aiStandFactor);
        assert.equal(out.settings.aiStandFactor.DEV, 0.02);
        assert.equal(out.settings.aiStandFactor.PROD, 1);
    });

    it('идемпотентность: повторное применение не меняет уже заданное ai_agent_mode', () => {
        const v8 = {
            id: 'new', schemaVersion: 8,
            settings: {},
            answers: { ai_llm_used: true, ai_agent_mode: true, agent_complexity: 'complex' },
            dictionaries: { items: [], questions: [] }
        };
        const out = migrateCalculation(v8);
        assert.equal(out.answers.ai_agent_mode, true);
        assert.equal(out.answers.agent_complexity, 'complex');
    });
});
