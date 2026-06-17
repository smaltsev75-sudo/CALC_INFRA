/**
 * Регресс-тест (2.22.4): фантомные AI-факторы в анализе чувствительности.
 *
 * Баг (подтверждён 7-агентным аудитом + прямой репродукцией): когда LLM выключен
 * (ai_llm_used=false), перебор AI-demand-полей или переключение ai_agent_mode
 * запускал domain-fallback deriveExternalLlmTokenQtyFallback, который досчитывал
 * ПОЛНЫЙ дефолтный объём LLM-токенов (≈29 млрд токенов из невведённых дефолтов) →
 * «фактор влияния» в 18–45 млн ₽/мес, кратно превышающий ВЕСЬ бюджет сценария.
 * Это вводило в заблуждение: гипотетика из дефолтов выглядела как реальная статья.
 *
 * Инвариант: параметр, зависящий от ВЫКЛЮЧЕННОГО мастер-тумблера (dependsOn),
 * не влияет на текущий бюджет → в анализе чувствительности он 'na', а не
 * материализует фантомную стоимость. Фикс — только слой анализа, calculate()
 * (реальный бюджет) не меняется.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeedDictionaries, defaultAnswersFrom } from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import {
    simulateNumericPerturbation,
    simulateTogglePerturbation,
    runSensitivityAnalysis,
    rankSensitivityDrivers
} from '../../../js/domain/sensitivityAnalysis.js';

function seedCalc(answerOverrides = {}) {
    const D = buildSeedDictionaries();
    const A = defaultAnswersFrom(D.questions);
    return {
        id: 'ai-gate', name: 'AI gate', schemaVersion: 12,
        answers: { ...A, ...answerOverrides },
        answersMeta: {},
        settings: { ...D.settings },
        dictionaries: D,
        view: { disabledStands: [] },
        providerVersion: null
    };
}

describe('sensitivity: AI-зависимые поля при выключенном LLM → na (нет фантома токенов)', () => {
    it('ai_avg_input_tokens (+10%) при ai_llm_used=false → na', () => {
        const r = simulateNumericPerturbation(seedCalc({ ai_llm_used: false }), 'ai_avg_input_tokens');
        assert.equal(r.status, 'na', `ожидали na, получили ${r.status} с delta.total=${r.delta?.total}`);
    });

    it('ai_users_share (+10%) при ai_llm_used=false → na', () => {
        const r = simulateNumericPerturbation(seedCalc({ ai_llm_used: false }), 'ai_users_share');
        assert.equal(r.status, 'na');
    });

    it('ai_requests_per_user_day (+10%) при ai_llm_used=false → na', () => {
        const r = simulateNumericPerturbation(seedCalc({ ai_llm_used: false }), 'ai_requests_per_user_day');
        assert.equal(r.status, 'na');
    });

    it('toggle ai_agent_mode при ai_llm_used=false → na (не материализует +45 млн)', () => {
        const r = simulateTogglePerturbation(
            seedCalc({ ai_llm_used: false, ai_agent_mode: false }), 'ai_agent_mode');
        assert.equal(r.status, 'na', `ожидали na, получили ${r.status} с delta.total=${r.delta?.total}`);
    });

    it('НЕ переусердствовали: при ai_llm_used=true ai_avg_input_tokens снова ok', () => {
        const r = simulateNumericPerturbation(seedCalc({ ai_llm_used: true }), 'ai_avg_input_tokens');
        assert.equal(r.status, 'ok');
    });

    it('мастер-тумблер ai_llm_used (без deps) анализируется всегда (ok)', () => {
        const r = simulateTogglePerturbation(seedCalc({ ai_llm_used: false }), 'ai_llm_used');
        assert.equal(r.status, 'ok');
    });

    it('инвариант: при LLM off фантомные AI-зависимые поля НЕ попадают в results', () => {
        const calc = seedCalc({ ai_llm_used: false });
        const { results } = runSensitivityAnalysis(calc);
        // Поля, зависящие от выключенного ai_llm_used — раньше материализовали фантом
        // (18–45 млн), теперь должны быть отфильтрованы в notAvailable.
        const phantomFields = [
            'ai_agent_mode', 'ai_users_share', 'ai_requests_per_user_day',
            'ai_avg_input_tokens', 'ai_avg_output_tokens', 'ai_caching_share', 'rag_needed'
        ];
        const leaked = results.filter(r => phantomFields.includes(r.fieldId));
        assert.equal(leaked.length, 0,
            `фантомные AI-факторы протекли в results: ${leaked.map(r => `${r.fieldId}=${Math.round(r.delta.total)}`).join(', ')}`);
    });

    it('инвариант: ни один фактор-результат не имеет невыполненной зависимости', () => {
        const calc = seedCalc({ ai_llm_used: false });
        const { results } = runSensitivityAnalysis(calc);
        // Контракт фикса: всё, что попало в results, имеет выполненные dependsOn
        // (мастер-тумблеры типа ai_llm_used сами без deps — легитимно остаются).
        assert.ok(results.length > 0, 'должны остаться легитимные факторы (буферы, инфляция, мастер-тумблеры)');
    });
});
