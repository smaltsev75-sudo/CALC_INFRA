/**
 * Stage 2 (LLM-токены) — доработка qty-модели ПРОМ.
 *
 * Решения (DECISIONS.md «ПЛАН: Доработка qty-модели ПРОМ» + уточнения C):
 *   1. ai_caching_share влияет только на ВХОДНЫЕ токены (output не трогает).
 *   2. ai_safety_overhead_percent (0-50, default 10) заменяет хардкод 0.10;
 *      одинаково в Details (calculate) и Dashboard (fallback).
 *   3. Детальный режим входных токенов (ai_token_breakdown_manual): input =
 *      системный промпт + запрос + история + RAG-контекст(если rag_needed) +
 *      контекст инструментов(если ai_agent_mode). OFF по умолчанию → golden не меняется.
 *   4. rag_needed + simple-режим → recommendation про RAG-контекст.
 *   5. ai_llm_used + нулевой спрос → ai-llm-enabled-no-demand.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    SEED_QUESTIONS, defaultAnswersFrom, buildSeedDictionaries
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { evaluateCalculationHealth } from '../../../js/domain/calculationHealth.js';
import { deriveLlmTokenItemQty } from '../../../js/ui/dashboardAggregates.js';

const DICT = buildSeedDictionaries();
const BASE_ANSWERS = defaultAnswersFrom(DICT.questions);

function calcWith(answers = {}) {
    return {
        id: 'llm-stage2',
        answers: { ...BASE_ANSWERS, ...answers },
        settings: { ...DICT.settings },
        answersMeta: {},
        dictionaries: { questions: DICT.questions, items: DICT.items },
        view: {}
    };
}
function qty(answers, itemId, stand = 'PROD') {
    return calculate(calcWith(answers)).items?.[itemId]?.stands?.[stand]?.qty ?? 0;
}
function q(id) { return SEED_QUESTIONS.find(x => x.id === id); }

/* Базовый AI-сетап: external, agent off (agentStepFactor=1), model mid (×1).
 * requestsPerMonth = 100000 × 10% × 50% × 10 × 30 = 1.5e6. */
const AI = {
    ai_llm_used: true, ai_hosting_mode: 'external_api',
    registered_users_total: 100000, dau_share_of_registered_percent: 10,
    ai_users_share: 50, ai_requests_per_user_day: 10,
    ai_avg_input_tokens: 2000, ai_avg_output_tokens: 500, ai_caching_share: 0,
    ai_model_tier: 'mid', ai_agent_mode: false
};

describe('Stage 2 LLM — новые параметры опросника', () => {
    for (const id of ['ai_token_breakdown_manual', 'ai_input_system_prompt_tokens',
        'ai_input_user_query_tokens', 'ai_input_history_tokens', 'ai_input_rag_context_tokens',
        'ai_input_tool_context_tokens', 'ai_safety_overhead_percent']) {
        it(`вопрос ${id} существует, опционален, имеет defaultIfUnknown`, () => {
            const def = q(id);
            assert.ok(def, `${id} в SEED_QUESTIONS`);
            assert.equal(def.allowUnknown, true);
            assert.ok(Object.prototype.hasOwnProperty.call(def, 'defaultIfUnknown'));
        });
    }
    it('ai_safety_overhead_percent.defaultIfUnknown=10', () => {
        assert.equal(q('ai_safety_overhead_percent').defaultIfUnknown, 10);
    });
    it('ai_token_breakdown_manual по умолчанию false', () => {
        assert.equal(q('ai_token_breakdown_manual').defaultIfUnknown, false);
    });
});

describe('Stage 2 LLM — caching и output', () => {
    it('ai_caching_share снижает input-токены, output не трогает', () => {
        const inp0 = qty({ ...AI, ai_caching_share: 0 }, 'llm-tokens-input-1m');
        const inp50 = qty({ ...AI, ai_caching_share: 50 }, 'llm-tokens-input-1m');
        const out0 = qty({ ...AI, ai_caching_share: 0 }, 'llm-tokens-output-1m');
        const out50 = qty({ ...AI, ai_caching_share: 50 }, 'llm-tokens-output-1m');
        assert.equal(inp0, 3000);
        assert.equal(inp50, 1500);
        assert.equal(out0, out50, 'output не должен зависеть от caching');
        assert.equal(out0, 750);
    });
});

describe('Stage 2 LLM — safety overhead параметр', () => {
    it('overhead=10 даёт прежний результат (= хардкод 0.10)', () => {
        // safety = ceil((input_mln×(1-cache) + output_mln) × overhead) = (3000+750)×0.10 = 375
        assert.equal(qty({ ...AI, ai_safety_layer: true, ai_safety_overhead_percent: 10 }, 'ai-safety-moderation-tokens-1m'), 375);
    });
    it('overhead=20 удваивает safety-токены', () => {
        assert.equal(qty({ ...AI, ai_safety_layer: true, ai_safety_overhead_percent: 20 }, 'ai-safety-moderation-tokens-1m'), 750);
    });
    it('overhead влияет на Dashboard-fallback (deriveLlmTokenItemQty) так же, как на Details', () => {
        const c10 = calcWith({ ...AI, ai_safety_layer: true, ai_safety_overhead_percent: 10 });
        const c20 = calcWith({ ...AI, ai_safety_layer: true, ai_safety_overhead_percent: 20 });
        const d10 = deriveLlmTokenItemQty(c10, 'ai-safety-moderation-tokens-1m', 'PROD');
        const d20 = deriveLlmTokenItemQty(c20, 'ai-safety-moderation-tokens-1m', 'PROD');
        assert.equal(d10, 375, 'dashboard-fallback safety при overhead=10');
        assert.equal(d20, 750, 'dashboard-fallback safety при overhead=20');
        // и совпадает с Details
        assert.equal(d10, qty({ ...AI, ai_safety_layer: true, ai_safety_overhead_percent: 10 }, 'ai-safety-moderation-tokens-1m'));
    });
});

describe('Stage 2 LLM — детальный режим входных токенов', () => {
    it('breakdown OFF (по умолчанию) → input от ai_avg_input_tokens (golden неизменен)', () => {
        assert.equal(qty({ ...AI, ai_token_breakdown_manual: false }, 'llm-tokens-input-1m'), 3000);
    });
    it('breakdown ON → input = сумма компонентов (rag/agent off → system+query+history)', () => {
        // 500 + 200 + 500 = 1200 → qty = 1.5e6 × 1200 / 1e6 = 1800
        const a = { ...AI, ai_token_breakdown_manual: true,
            ai_input_system_prompt_tokens: 500, ai_input_user_query_tokens: 200,
            ai_input_history_tokens: 500, ai_input_rag_context_tokens: 1500,
            ai_input_tool_context_tokens: 999, rag_needed: false, ai_agent_mode: false };
        assert.equal(qty(a, 'llm-tokens-input-1m'), 1800, 'rag/tool-компоненты не учитываются при выключенных флагах');
    });
    it('breakdown ON + rag_needed → добавляется RAG-контекст', () => {
        const a = { ...AI, ai_token_breakdown_manual: true,
            ai_input_system_prompt_tokens: 500, ai_input_user_query_tokens: 200,
            ai_input_history_tokens: 500, ai_input_rag_context_tokens: 1500,
            rag_needed: true, ai_agent_mode: false };
        // 500+200+500+1500 = 2700 → qty = 1.5e6 × 2700 / 1e6 = 4050
        assert.equal(qty(a, 'llm-tokens-input-1m'), 4050);
    });
});

describe('Stage 2 LLM — Health Checks', () => {
    function findings(answers) { return evaluateCalculationHealth(calcWith(answers)).findings; }

    it('rag_needed + simple-режим → recommendation про RAG-контекст', () => {
        const f = findings({ ...AI, rag_needed: true, ai_token_breakdown_manual: false });
        assert.ok(f.some(x => x.id === 'ai-rag-context-in-simple-mode'));
    });
    it('rag_needed + detailed-режим → нет recommendation про RAG-контекст', () => {
        const f = findings({ ...AI, rag_needed: true, ai_token_breakdown_manual: true });
        assert.ok(!f.some(x => x.id === 'ai-rag-context-in-simple-mode'));
    });
    it('ai_llm_used=true + нулевой спрос → ai-llm-enabled-no-demand', () => {
        const f = findings({ ai_llm_used: true, ai_users_share: 0, ai_requests_per_user_day: 0 });
        assert.ok(f.some(x => x.id === 'ai-llm-enabled-no-demand'));
    });
    it('ai_llm_used=true + положительный спрос → нет no-demand', () => {
        const f = findings({ ...AI });
        assert.ok(!f.some(x => x.id === 'ai-llm-enabled-no-demand'));
    });
});

describe('Stage 2 LLM — degenerate operational fallback зеркалит формулу (review-фикс)', () => {
    // Вырожденная user-base (registered=0 + подтверждённый baseline) → формула даёт 0,
    // срабатывает calculate-fallback (deriveExternalLlmTokenQtyFallback). Он ОБЯЗАН
    // использовать те же параметры, что и seed-формула: ai_safety_overhead_percent
    // (не хардкод 0.10) и эффективный объём входных токенов (детальный режим).
    function degenerate(extra) {
        const c = calcWith({ ...AI, registered_users_total: 0, ai_safety_layer: true, ...extra });
        c.healthAcknowledgements = { ack: { values: { registered_users_total: 100000 } } };
        return c;
    }
    function safetyQty(c) { return calculate(c).items?.['ai-safety-moderation-tokens-1m']?.stands?.PROD?.qty ?? 0; }
    function inputQty(c) { return calculate(c).items?.['llm-tokens-input-1m']?.stands?.PROD?.qty ?? 0; }

    it('safety overhead в fallback берётся из параметра, а не хардкод 0.10', () => {
        const q10 = safetyQty(degenerate({ ai_safety_overhead_percent: 10 }));
        const q20 = safetyQty(degenerate({ ai_safety_overhead_percent: 20 }));
        assert.ok(q10 > 0, 'fallback должен сработать на вырожденной базе');
        assert.ok(Math.abs(q20 - 2 * q10) <= 1, `overhead=20 ≈ 2× overhead=10 (got ${q10} / ${q20})`);
    });

    it('детальный режим входных токенов учитывается в fallback', () => {
        // изоляция: ai_avg_input_tokens одинаков (1000) в обоих; меняем ТОЛЬКО детальный режим.
        const simple = inputQty(degenerate({ ai_token_breakdown_manual: false, ai_avg_input_tokens: 1000 }));
        const detailed = inputQty(degenerate({
            ai_token_breakdown_manual: true, ai_avg_input_tokens: 1000,
            ai_input_system_prompt_tokens: 4000, ai_input_user_query_tokens: 0,
            ai_input_history_tokens: 0, rag_needed: false, ai_agent_mode: false
        }));
        // detailed sum = 4000 >> simple 1000 → input-токены в fallback должны вырасти
        assert.ok(detailed > simple, `детальный режим должен влиять на fallback (simple=${simple}, detailed=${detailed})`);
    });
});
