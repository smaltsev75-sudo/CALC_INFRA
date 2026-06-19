/**
 * Stage 4 (CPU/RAM) — доработка qty-модели ПРОМ.
 *
 * Решения (DECISIONS.md + уточнения D + условия 1-10):
 *   - realtime: +1 → max(1, ceil(PCU/1000)) (сдвиг только при PCU≥1000).
 *   - Расширенная модель CPU (cpu_advanced_model, OFF по умолчанию): vCPU от CPU-времени
 *     запроса и целевой загрузки (10-90%); иначе RPS/50.
 *   - min_instances_per_stand — нижний порог vCPU (default 0).
 *   - Расширенная модель RAM (ram_advanced_model, OFF): + app baseline + realtime-память.
 *   - Условие 6/7: RAM выводится из полной базы vCPU. Package 9A намеренно капает
 *     cpu-vcpu-shared на ПСИ/ПРОМ/НТ, поэтому shared PROD больше не является proxy
 *     полной базы при peak_rps > 100.
 *   - Условие 8: advanced RAM не учитывает agent memory повторно.
 *   - Условие 9: health CPU>0, RAM=0.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SEED_QUESTIONS, defaultAnswersFrom, buildSeedDictionaries } from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { evaluateCalculationHealth } from '../../../js/domain/calculationHealth.js';

const DICT = buildSeedDictionaries();
const BASE = defaultAnswersFrom(DICT.questions);

function calcWith(answers = {}) {
    return {
        id: 'cpuram-stage4',
        answers: { ...BASE, ...answers },
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
function fullCpuBase(answers = {}) {
    const a = { ...BASE, ...answers };
    const targetUtil = Math.min(90, Math.max(10, Number(a.cpu_target_utilization_percent || 0))) / 100;
    const rpsCpu = a.cpu_advanced_model
        ? Number(a.peak_rps || 0) * Number(a.cpu_ms_per_request || 0) / 1000 / targetUtil
        : Number(a.peak_rps || 0) / 50;
    const pcuCpu = Number(a.pcu_target || 0) / 200;
    const realtimeCpu = a.realtime_required ? Math.max(1, Math.ceil(Number(a.pcu_target || 0) / 1000)) : 0;
    const base = Math.max(rpsCpu, pcuCpu)
        + Number(a.microservices_count || 0)
        + Number(a.async_workers_count || 0)
        + realtimeCpu;
    return Math.max(base, Number(a.min_instances_per_stand || 0));
}

// agent off (agentStepFactor=1), model mid.
const HW = {
    peak_rps: 300, pcu_target: 2000, microservices_count: 5, async_workers_count: 2,
    realtime_required: true, ram_per_vcpu_ratio: 4, cache_size_gb: 16, ai_agent_mode: false
};

describe('Stage 4 CPU/RAM — новые параметры и валидация', () => {
    for (const id of ['cpu_advanced_model', 'cpu_ms_per_request', 'cpu_target_utilization_percent',
        'min_instances_per_stand', 'ram_advanced_model', 'ram_app_baseline_gb_per_service',
        'ram_per_realtime_connection_kb']) {
        it(`вопрос ${id} опционален с defaultIfUnknown`, () => {
            const def = q(id);
            assert.ok(def, `${id} в SEED_QUESTIONS`);
            assert.equal(def.allowUnknown, true);
            assert.ok(Object.prototype.hasOwnProperty.call(def, 'defaultIfUnknown'));
        });
    }
    it('cpu_target_utilization_percent валидируется 10–90 (условие 2)', () => {
        assert.equal(q('cpu_target_utilization_percent').min, 10);
        assert.equal(q('cpu_target_utilization_percent').max, 90);
        assert.equal(q('cpu_target_utilization_percent').defaultIfUnknown, 65);
    });
    it('cpu_ms_per_request > 0 (условие 3)', () => {
        assert.ok(q('cpu_ms_per_request').min >= 1);
    });
});

describe('Stage 4 CPU — realtime ceil(PCU/1000)', () => {
    it('realtime добавляет ceil(PCU/1000), мин. 1', () => {
        const rtBig = qty({ ...HW, pcu_target: 2000, realtime_required: true }, 'cpu-vcpu-shared');
        const noRtBig = qty({ ...HW, pcu_target: 2000, realtime_required: false }, 'cpu-vcpu-shared');
        assert.equal(rtBig - noRtBig, 2, 'PCU=2000 → realtime +2 vCPU');
        const rtSmall = qty({ ...HW, pcu_target: 500, realtime_required: true }, 'cpu-vcpu-shared');
        const noRtSmall = qty({ ...HW, pcu_target: 500, realtime_required: false }, 'cpu-vcpu-shared');
        assert.equal(rtSmall - noRtSmall, 1, 'PCU=500 → realtime +1 (как прежнее +1)');
    });
});

describe('Stage 4 CPU — расширенная модель', () => {
    it('OFF (по умолчанию) → простая модель RPS/50 (19 vCPU на baseline)', () => {
        // max(300/50=6, 2000/200=10)+5+2+realtime(2)=19
        assert.equal(qty({ ...HW, cpu_advanced_model: false }, 'cpu-vcpu-shared'), 19);
    });
    it('ON с большим CPU-временем → больше vCPU, чем простая модель', () => {
        const adv = qty({ ...HW, cpu_advanced_model: true, cpu_ms_per_request: 200, cpu_target_utilization_percent: 65 }, 'cpu-vcpu-shared');
        const simple = qty({ ...HW, cpu_advanced_model: false }, 'cpu-vcpu-shared');
        assert.ok(adv > simple, 'cpu_ms=200 даёт больше vCPU');
    });
    it('min_instances_per_stand — нижний порог базы vCPU', () => {
        assert.equal(qty({ ...HW, min_instances_per_stand: 50 }, 'cpu-vcpu-shared'), 50);
        assert.equal(qty({ ...HW, min_instances_per_stand: 0 }, 'cpu-vcpu-shared'), 19);
    });
});

describe('Stage 4 — RAM выводится из полной базы vCPU (условие 6/7 + Package 9A)', () => {
    it('ram-gb PROD = ceil(полная база vCPU × RAM/vCPU + кэш), а не capped shared PROD', () => {
        for (const variant of [
            { ...HW },
            { ...HW, pcu_target: 5000 },
            { ...HW, cpu_advanced_model: true, cpu_ms_per_request: 120 },
            { ...HW, min_instances_per_stand: 40 }
        ]) {
            const ramProd = qty(variant, 'ram-gb');
            const expected = Math.ceil(Math.ceil(fullCpuBase(variant)) * variant.ram_per_vcpu_ratio + variant.cache_size_gb);
            assert.equal(ramProd, expected,
                `RAM должна выводиться из ПОЛНОЙ базы vCPU (${fullCpuBase(variant)}), не из capped shared: ${JSON.stringify(variant)}`);
        }
    });
});

describe('Stage 4 RAM — расширенная модель', () => {
    it('OFF → vCPU × RAM/vCPU + кэш', () => {
        // cpu=19 → 19×4+16 = 92
        assert.equal(qty({ ...HW, ram_advanced_model: false }, 'ram-gb'), 92);
    });
    it('ON → + app baseline + realtime-память', () => {
        const adv = qty({ ...HW, ram_advanced_model: true, ram_app_baseline_gb_per_service: 0.5, ram_per_realtime_connection_kb: 8 }, 'ram-gb');
        // 19×4+16 + 5×0.5 + 2000×8/1e6 = 92 + 2.5 + 0.016 = 94.516 → ceil 95
        assert.equal(adv, 95);
    });
    it('advanced RAM НЕ учитывает agent memory повторно (условие 8)', () => {
        const a = qty({ ...HW, ram_advanced_model: true, ai_agent_mode: true, agent_memory_used: true, agent_memory_size_gb: 0 }, 'ram-gb');
        const b = qty({ ...HW, ram_advanced_model: true, ai_agent_mode: true, agent_memory_used: true, agent_memory_size_gb: 500 }, 'ram-gb');
        assert.equal(a, b, 'память агентов (storage-ЭК) не должна попадать в RAM');
    });
});

describe('Stage 4 — Health Check CPU>0, RAM=0 (условие 9)', () => {
    function findings(answers) { return evaluateCalculationHealth(calcWith(answers)).findings; }
    it('CPU-драйверы есть, ram_per_vcpu_ratio=0 и кэш=0 → cpu-positive-ram-zero', () => {
        const f = findings({ ...HW, ram_per_vcpu_ratio: 0, cache_size_gb: 0 });
        assert.ok(f.some(x => x.id === 'cpu-positive-ram-zero'));
    });
    it('нормальный расчёт → нет cpu-positive-ram-zero', () => {
        const f = findings({ ...HW });
        assert.ok(!f.some(x => x.id === 'cpu-positive-ram-zero'));
    });
});
