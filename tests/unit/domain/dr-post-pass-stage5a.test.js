/**
 * Stage 5A — DR post-pass: prod-derived DR-ЭК масштабируются от объёма ПРОМ.
 *
 * Решения (DECISIONS.md, Stage 5A; ответы 2A/3A/5-i/6-i):
 *   - S.prodComputeVcpu = Σ сырых PROD cell.qty по dashboardResource='CPU'
 *     (cpu-vcpu-shared + cpu-vcpu-dedicated + ai-agent-sandbox-vcpu).
 *     Сырое qty — БЕЗ capacity-буфера / риск-множителей (2A).
 *   - res-georedundancy (active-passive): qty = ceil(0.30 × S.prodComputeVcpu)
 *     при Q.georedundancy_required.
 *   - res-dr-active (active-active): qty = ceil(1.00 × S.prodComputeVcpu)
 *     при SLA≥99.95 || RTO≤1 || RPO≤5.
 *   - Цикл невозможен: DR-ЭК не имеют dashboardResource ⇒ не входят в агрегат.
 *   - Стоимость DR попадает в итоги ровно один раз (без двойного учёта).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSeedDictionaries, defaultAnswersFrom } from '../../../js/domain/seed.js';
import { calculate, computeProdAggregates } from '../../../js/domain/calculator.js';
import { buildQuantityTrace } from '../../../js/domain/quantityTrace.js';

const DICT = buildSeedDictionaries();
const BASE = defaultAnswersFrom(DICT.questions);

/* Контролируемый сценарий: PROD-compute = ровно 8 vCPU.
 * cpu-vcpu-shared: max(max(peak_rps/50, pcu/200)+micro+async+0, min_inst)
 *   = max(max(100/50,0)+4+2, 0) = 8.
 * cpu-vcpu-dedicated: if(peak_rps>100,...) = 0 (peak_rps=100).
 * ai-agent-sandbox: ai_agent_mode=false → 0.  ⇒ prodComputeVcpu = 8. */
const COMPUTE8 = {
    cpu_advanced_model: false,
    peak_rps: 100, pcu_target: 0,
    microservices_count: 4, async_workers_count: 2,
    realtime_required: false, min_instances_per_stand: 0,
    ai_agent_mode: false, ai_llm_used: false
};

function calcWith(answers = {}, settings = {}) {
    return {
        id: 'dr-stage5a',
        answers: { ...BASE, ...COMPUTE8, ...answers },
        settings: { ...DICT.settings, ...settings },
        answersMeta: {},
        dictionaries: { questions: DICT.questions, items: DICT.items },
        view: {}
    };
}
function qtyPROD(res, id) { return res.items?.[id]?.stands?.PROD?.qty ?? 0; }

describe('Stage 5A DR — computeProdAggregates', () => {
    it('prodComputeVcpu = сумма PROD-qty по dashboardResource=CPU (=8)', () => {
        const res = calculate(calcWith());
        const agg = computeProdAggregates(res, DICT.items);
        assert.equal(agg.prodComputeVcpu, 8);
    });
    it('prodComputeVcpu НЕ включает DR-ЭК (нет dashboardResource) — цикл невозможен', () => {
        // даже при включённом георезерве агрегат остаётся 8, не растёт от DR
        const res = calculate(calcWith({ georedundancy_required: true }));
        const agg = computeProdAggregates(res, DICT.items);
        assert.equal(agg.prodComputeVcpu, 8);
    });
    it('возвращает три агрегата (compute/ram/storage), все конечные ≥ 0', () => {
        const res = calculate(calcWith());
        const agg = computeProdAggregates(res, DICT.items);
        for (const k of ['prodComputeVcpu', 'prodRamGb', 'prodStorageTb']) {
            assert.ok(Number.isFinite(agg[k]) && agg[k] >= 0, `${k}=${agg[k]}`);
        }
    });
});

describe('Stage 5A DR — res-georedundancy (active-passive, 30%)', () => {
    it('georedundancy ON → qty = ceil(0.30 × 8) = 3', () => {
        const res = calculate(calcWith({ georedundancy_required: true }));
        assert.equal(qtyPROD(res, 'res-georedundancy'), 3);
    });
    it('georedundancy OFF → qty = 0', () => {
        const res = calculate(calcWith({ georedundancy_required: false }));
        assert.equal(qtyPROD(res, 'res-georedundancy'), 0);
    });
    it('стоимость DR попадает в итог (costFinal > 0 при ON)', () => {
        const res = calculate(calcWith({ georedundancy_required: true }));
        const cell = res.items['res-georedundancy'].stands.PROD;
        assert.ok(cell.costFinal > 0, 'costFinal DR должен быть положительным');
        assert.equal(cell.error, null);
    });
});

describe('Stage 5A DR — res-dr-active (active-active, 100%)', () => {
    it('active gate ON (rto=1) → qty = ceil(1.00 × 8) = 8', () => {
        const res = calculate(calcWith({ rto_hours: 1, sla_target: 99.9, rpo_minutes: 60 }));
        assert.equal(qtyPROD(res, 'res-dr-active'), 8);
    });
    it('active gate OFF → qty = 0', () => {
        const res = calculate(calcWith({ rto_hours: 4, sla_target: 99.9, rpo_minutes: 60 }));
        assert.equal(qtyPROD(res, 'res-dr-active'), 0);
    });
});

describe('Stage 5A DR — сырое qty (2A): буфер не влияет на qty DR', () => {
    it('qty DR одинаков с риск-буфером и без него', () => {
        const withBuf = calculate(calcWith({ georedundancy_required: true },
            { applyRiskFactors: true, bufferTask: 0.5, bufferProject: 0.5, kContingency: 0.5 }));
        const noBuf = calculate(calcWith({ georedundancy_required: true },
            { applyRiskFactors: false }));
        assert.equal(qtyPROD(withBuf, 'res-georedundancy'), 3);
        assert.equal(qtyPROD(noBuf, 'res-georedundancy'), 3);
    });
});

describe('Stage 5A DR — детерминизм и отсутствие двойного учёта', () => {
    it('повторный расчёт даёт тот же qty (нет зависимости от порядка)', () => {
        const a = calculate(calcWith({ georedundancy_required: true }));
        const b = calculate(calcWith({ georedundancy_required: true }));
        assert.equal(qtyPROD(a, 'res-georedundancy'), qtyPROD(b, 'res-georedundancy'));
    });
    it('итог по res-georedundancy = costFinal ячейки PROD (учтён один раз)', () => {
        const res = calculate(calcWith({ georedundancy_required: true }));
        const cell = res.items['res-georedundancy'].stands.PROD;
        // res-georedundancy применим только к PROD ⇒ месячный итог item = costFinal PROD
        assert.equal(res.items['res-georedundancy'].totalMonthly, cell.costFinal);
    });
    it('масштаб растёт с ПРОМ: 16 vCPU → georedundancy qty = ceil(0.30×16)=5', () => {
        // удваиваем нагрузку: peak_rps=100→микс, добираем микросервисами до 16
        const res = calculate(calcWith({ georedundancy_required: true,
            microservices_count: 12, async_workers_count: 2 })); // 2 + 12 + 2 = 16
        assert.equal(computeProdAggregates(res, DICT.items).prodComputeVcpu, 16);
        assert.equal(qtyPROD(res, 'res-georedundancy'), 5);
    });
});

describe('Stage 5A DR — объяснимость (trace)', () => {
    it('trace res-georedundancy показывает реальный S.prodComputeVcpu (=8, не 0)', () => {
        const calc = calcWith({ georedundancy_required: true });
        const trace = buildQuantityTrace(calc, 'res-georedundancy', 'PROD');
        const s = trace.settingInputs.find(x => x.path === 'prodComputeVcpu');
        assert.ok(s, 'S.prodComputeVcpu должен быть в settingInputs');
        assert.equal(s.exists, true);
        assert.equal(s.value, 8);
        // трасса совпадает с реальным расчётом
        assert.equal(trace.evaluatedQty, 3);
        assert.equal(trace.qty, 3);
    });
});
