/**
 * Audit Пакет 1 — очевидные баги без доменных коэффициентов (TDD).
 *
 * 1. ai-low-latency-inference-reserve: вопрос ai_inference_latency_ms хранит СТРОКОВЫЕ
 *    option values («<500ms» и т.д.), а формула сравнивала как число (<=1500) → reserve
 *    никогда не срабатывал. Fix: сравнение по строковому значению «<500ms» (единственный
 *    режим ≤1500мс по существующему порогу). Golden не дрейфит (default «<2s» → 0).
 * 2. cpu-vcpu-gpu: GPU считались при ai_hosting_mode=on_prem_gpu даже если ai_llm_used=false.
 *    Fix: gate по Q.ai_llm_used. Default ai_hosting_mode=external_api → GPU и так 0 (no drift).
 * 3. ai-agent ЭК (sandbox-vcpu, memory-storage-tb) отсутствовали в _AGENT_FORMULA_REFRESH_IDS
 *    → legacy JSON со старой формулой «0» не получали актуальную ai_agent_mode-формулу.
 * 6. checkDdosBasicTierForCritical: неизвестный/битый ddos_tier гасил нудж для критичного
 *    профиля. Fix: гасим только при ЯВНЫХ валидных l7/premium; unknown трактуем как basic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSeedDictionaries, defaultAnswersFrom, SEED_ITEMS, enrichLegacyDictionaryWithAgentSeed
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { evaluateCalculationHealth } from '../../../js/domain/calculationHealth.js';

function prodQty(answers, itemId) {
    const D = buildSeedDictionaries();
    const A = defaultAnswersFrom(D.questions);
    const calc = {
        id: 't', name: 't', schemaVersion: 12,
        answers: { ...A, ...answers }, answersMeta: {},
        settings: { ...D.settings }, dictionaries: D,
        view: { disabledStands: [] }, providerVersion: null
    };
    const r = calculate(calc, null);
    const c = r.stands.PROD.items.find(x => x.itemId === itemId);
    return c ? c.qty : 0;
}

describe('Пакет 1 / item 1 — ai-low-latency-inference-reserve по строковому latency', () => {
    const ID = 'ai-low-latency-inference-reserve';
    it('ai on + latency «<500ms» → reserve ПРОМ qty=1', () => {
        assert.equal(prodQty({ ai_llm_used: true, ai_inference_latency_ms: '<500ms' }, ID), 1);
    });
    it('ai on + latency «<2s» (default) → reserve 0 (без дрейфа)', () => {
        assert.equal(prodQty({ ai_llm_used: true, ai_inference_latency_ms: '<2s' }, ID), 0);
    });
    it('ai on + latency «<10s»/«batch» → reserve 0', () => {
        assert.equal(prodQty({ ai_llm_used: true, ai_inference_latency_ms: '<10s' }, ID), 0);
        assert.equal(prodQty({ ai_llm_used: true, ai_inference_latency_ms: 'batch' }, ID), 0);
    });
    it('ai off + «<500ms» → reserve 0', () => {
        assert.equal(prodQty({ ai_llm_used: false, ai_inference_latency_ms: '<500ms' }, ID), 0);
    });
});

describe('Пакет 1 / item 2 — cpu-vcpu-gpu gate по ai_llm_used', () => {
    const ID = 'cpu-vcpu-gpu';
    const heavy = {
        registered_users_total: 1000000, dau_share_of_registered_percent: 30,
        ai_users_share: 50, ai_requests_per_user_day: 10
    };
    it('ai off + on_prem_gpu → GPU qty=0 (баг закрыт)', () => {
        assert.equal(prodQty({ ...heavy, ai_llm_used: false, ai_hosting_mode: 'on_prem_gpu' }, ID), 0);
    });
    it('ai on + on_prem_gpu → GPU qty>0 (нормальный путь сохранён)', () => {
        assert.ok(prodQty({ ...heavy, ai_llm_used: true, ai_hosting_mode: 'on_prem_gpu' }, ID) > 0);
    });
    it('ai on + external_api → GPU qty=0', () => {
        assert.equal(prodQty({ ...heavy, ai_llm_used: true, ai_hosting_mode: 'external_api' }, ID), 0);
    });
});

describe('Пакет 1 / item 3 — AI-agent ЭК в _AGENT_FORMULA_REFRESH_IDS (legacy refresh)', () => {
    it('старый calc с flat-формулой «0» получает ai_agent_mode-формулу', () => {
        const D = buildSeedDictionaries();
        const dict = JSON.parse(JSON.stringify(D));
        for (const it of dict.items) {
            if (it.id === 'ai-agent-sandbox-vcpu' || it.id === 'ai-agent-memory-storage-tb') {
                it.qtyFormulas = { PROD: '0' };
                it.formulaHelp = 'OLD flat 0';
            }
        }
        const calc = {
            id: 'leg', name: 'l', schemaVersion: 12, answers: {}, answersMeta: {},
            settings: { ...D.settings }, dictionaries: dict, view: { disabledStands: [] }, providerVersion: null
        };
        enrichLegacyDictionaryWithAgentSeed(calc);
        const sandbox = calc.dictionaries.items.find(i => i.id === 'ai-agent-sandbox-vcpu');
        const memory = calc.dictionaries.items.find(i => i.id === 'ai-agent-memory-storage-tb');
        assert.match(sandbox.qtyFormulas.PROD, /ai_agent_mode/, 'sandbox должен получить реальную формулу');
        assert.match(memory.qtyFormulas.PROD, /agent_memory_used/, 'memory должен получить реальную формулу');
    });
    it('unit/price ai-agent ЭК не меняются после enrich', () => {
        const D = buildSeedDictionaries();
        const before = D.items.find(i => i.id === 'ai-agent-sandbox-vcpu');
        const dict = JSON.parse(JSON.stringify(D));
        dict.items.find(i => i.id === 'ai-agent-sandbox-vcpu').qtyFormulas = { PROD: '0' };
        const calc = {
            id: 'leg', name: 'l', schemaVersion: 12, answers: {}, answersMeta: {},
            settings: { ...D.settings }, dictionaries: dict, view: { disabledStands: [] }, providerVersion: null
        };
        enrichLegacyDictionaryWithAgentSeed(calc);
        const after = calc.dictionaries.items.find(i => i.id === 'ai-agent-sandbox-vcpu');
        assert.equal(after.unit, before.unit);
        assert.equal(after.pricePerUnit, before.pricePerUnit);
    });
});

describe('Пакет 1 / item 6 — DDoS unknown tier не гасит нудж для критичного профиля', () => {
    function makeCalc(answers) {
        return {
            id: 't', name: 't', schemaVersion: 12, answers: { ...answers },
            settings: { applyRiskFactors: true }, answersMeta: {},
            dictionaries: { questions: [], items: [], settings: {} }, view: {}
        };
    }
    const find = (c) => evaluateCalculationHealth(c).findings.find(f => f.id === 'security-ddos-basic-tier-critical');

    it('basic + критичный (fstec) → нудж есть', () => {
        assert.ok(find(makeCalc({ ddos_protection_required: true, ddos_tier: 'basic_l3_l4', fstec_certification_required: true })));
    });
    it('unknown tier «enterprise» + критичный → нудж ВСЁ РАВНО есть (баг закрыт)', () => {
        assert.ok(find(makeCalc({ ddos_protection_required: true, ddos_tier: 'enterprise', fstec_certification_required: true })));
    });
    it('явный l7 + критичный → нудж подавлен', () => {
        assert.equal(find(makeCalc({ ddos_protection_required: true, ddos_tier: 'l7', fstec_certification_required: true })), undefined);
    });
    it('явный premium + критичный → нудж подавлен', () => {
        assert.equal(find(makeCalc({ ddos_protection_required: true, ddos_tier: 'premium', fstec_certification_required: true })), undefined);
    });
    it('basic + НЕ критичный профиль → нудж не показывается', () => {
        assert.equal(find(makeCalc({ ddos_protection_required: true, ddos_tier: 'basic_l3_l4', product_type: 'b2c' })), undefined);
    });
});
