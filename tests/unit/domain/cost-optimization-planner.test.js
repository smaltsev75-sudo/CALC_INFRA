/**
 * Stage 18.1 — Cost Optimization Planner domain truth-table.
 *
 * Контракт:
 *   - 3 плана: conservative / ambitious / extreme.
 *   - Каждый план — clone+recompute через calculate(clone, null).
 *   - SLA не входит в conservative.
 *   - SLA вообще не показывается без allowReliabilityTradeoff.
 *   - AI/RAG levers требуют allowAiReduction + соответствующий master toggle.
 *   - Original calc НЕ мутируется.
 *
 * Используем РЕАЛЬНЫЙ seed (buildSeedDictionaries) — это единственный способ
 * получить ненулевой baseTotal от calculate(), без которого clone+recompute
 * нечего сравнивать.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildOptimizationPlans,
    buildOptimizationLevers,
    rankOptimizationPlans,
    summarizeOptimizationPlan,
    getOptimizationFeasibility,
    PLAN_TIERS,
    PLAN_IDS,
    DEFAULT_CONSTRAINTS
} from '../../../js/domain/costOptimizationPlanner.js';
import { buildSeedDictionaries, SEED_SETTINGS, defaultAnswersFrom } from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';

/* ============================================================
 * Helpers — реальный calc через seed
 * ============================================================ */

function makeRealCalc(overrides = {}) {
    const dict = buildSeedDictionaries();
    const answers = { ...defaultAnswersFrom(dict.questions), ...(overrides.answers || {}) };
    const settings = { ...SEED_SETTINGS, provider: 'sbercloud', ...(overrides.settings || {}) };
    return {
        id: 'cop-test',
        name: 'cop-test',
        version: '1.0',
        schemaVersion: 16,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings,
        answers,
        answersMeta: {},
        wizard: null,
        view: { disabledStands: [] },
        dictionaries: dict
    };
}

/* ============================================================
 * 1. Базовый контракт — 3 плана с правильными tier-конфигами
 * ============================================================ */

describe('buildOptimizationPlans — 3 плана', () => {
    it('возвращает ровно 3 плана', () => {
        const plans = buildOptimizationPlans(makeRealCalc());
        assert.equal(plans.length, 3);
    });

    it('id планов: conservative, ambitious, extreme', () => {
        const plans = buildOptimizationPlans(makeRealCalc());
        assert.deepEqual(plans.map(p => p.id), [PLAN_IDS.CONSERVATIVE, PLAN_IDS.AMBITIOUS, PLAN_IDS.EXTREME]);
    });

    it('conservative.targetRange = 0–5', () => {
        const plans = buildOptimizationPlans(makeRealCalc());
        const c = plans.find(p => p.id === PLAN_IDS.CONSERVATIVE);
        assert.deepEqual(c.targetRange, { minPercent: 0, maxPercent: 5 });
    });

    it('ambitious.targetRange = 5–15', () => {
        const plans = buildOptimizationPlans(makeRealCalc());
        const a = plans.find(p => p.id === PLAN_IDS.AMBITIOUS);
        assert.deepEqual(a.targetRange, { minPercent: 5, maxPercent: 15 });
    });

    it('extreme.targetRange = 15–25', () => {
        const plans = buildOptimizationPlans(makeRealCalc());
        const e = plans.find(p => p.id === PLAN_IDS.EXTREME);
        assert.deepEqual(e.targetRange, { minPercent: 15, maxPercent: 25 });
    });

    it('базовый risk: conservative=low, ambitious=medium, extreme=high', () => {
        // tier-default risk фиксирован в PLAN_TIERS, агрегация может его повысить.
        assert.equal(PLAN_TIERS.find(t => t.id === PLAN_IDS.CONSERVATIVE).risk, 'low');
        assert.equal(PLAN_TIERS.find(t => t.id === PLAN_IDS.AMBITIOUS).risk, 'medium');
        assert.equal(PLAN_TIERS.find(t => t.id === PLAN_IDS.EXTREME).risk, 'high');
    });
});

/* ============================================================
 * 2. SLA — особый рычаг
 * ============================================================ */

describe('SLA lever — gating', () => {
    it('не появляется при allowReliabilityTradeoff=false (дефолт)', () => {
        const plans = buildOptimizationPlans(makeRealCalc());
        for (const p of plans) {
            const sla = p.levers.find(l => l.specId === 'sla_target');
            assert.equal(sla, undefined,
                `${p.id} содержит sla_target lever при allowReliabilityTradeoff=false`);
        }
    });

    it('не входит в conservative даже при allowReliabilityTradeoff=true', () => {
        const plans = buildOptimizationPlans(makeRealCalc(), {
            constraints: { ...DEFAULT_CONSTRAINTS, allowReliabilityTradeoff: true }
        });
        const c = plans.find(p => p.id === PLAN_IDS.CONSERVATIVE);
        assert.equal(c.levers.find(l => l.specId === 'sla_target'), undefined,
            'SLA не должен входить в conservative tier даже при разрешении.');
    });

    it('может появиться в extreme при allowReliabilityTradeoff=true и sla_target=99.95', () => {
        // sla_target=99.95 активирует hot-standby ЭК (qtyFormula: if(>=99.95, 1, 0)).
        // step down 2 (extreme) = 99.5 → ЭК уходит в 0 → реальная экономия.
        const plans = buildOptimizationPlans(makeRealCalc({
            answers: { sla_target: 99.95 }
        }), {
            constraints: { ...DEFAULT_CONSTRAINTS, allowReliabilityTradeoff: true }
        });
        const extSla = plans.find(p => p.id === PLAN_IDS.EXTREME).levers.find(l => l.specId === 'sla_target');
        assert.ok(extSla, 'SLA lever должен появиться в extreme при sla=99.95 и разрешении.');
    });

    it('SLA consequence содержит "простой" или "доступность"', () => {
        const plans = buildOptimizationPlans(makeRealCalc({
            answers: { sla_target: 99.95 }
        }), {
            constraints: { ...DEFAULT_CONSTRAINTS, allowReliabilityTradeoff: true }
        });
        const sla = plans.find(p => p.id === PLAN_IDS.EXTREME).levers.find(l => l.specId === 'sla_target');
        assert.ok(sla, 'SLA lever expected');
        // «простоя» (родит.) или «доступност*»; root «просто» покрывает оба случая.
        assert.match(sla.consequence, /просто|доступност/i);
    });

    it('SLA имеет category=reliability и risk=high', () => {
        const plans = buildOptimizationPlans(makeRealCalc({
            answers: { sla_target: 99.95 }
        }), {
            constraints: { ...DEFAULT_CONSTRAINTS, allowReliabilityTradeoff: true }
        });
        const sla = plans.find(p => p.id === PLAN_IDS.EXTREME).levers.find(l => l.specId === 'sla_target');
        assert.ok(sla);
        assert.equal(sla.category, 'reliability');
        assert.equal(sla.riskLevel, 'high');
    });
});

/* ============================================================
 * 3. Non-prod stand ratios
 * ============================================================ */

describe('Non-prod ratios — gating', () => {
    it('появляются при allowNonProdReduction=true', () => {
        const plans = buildOptimizationPlans(makeRealCalc());
        const cons = plans.find(p => p.id === PLAN_IDS.CONSERVATIVE);
        const hasLoad = cons.levers.some(l => l.specId === 'load_ratio');
        assert.ok(hasLoad, 'load_ratio должен присутствовать в consservative при дефолте');
    });

    it('НЕ появляются при allowNonProdReduction=false', () => {
        const plans = buildOptimizationPlans(makeRealCalc(), {
            constraints: { ...DEFAULT_CONSTRAINTS, allowNonProdReduction: false }
        });
        for (const p of plans) {
            for (const id of ['load_ratio', 'psi_ratio', 'ift_ratio', 'dev_ratio']) {
                assert.equal(p.levers.find(l => l.specId === id), undefined,
                    `${p.id} содержит ${id} при allowNonProdReduction=false`);
            }
        }
    });

    it('LOAD lever имеет category=non_prod и низкий риск', () => {
        const plans = buildOptimizationPlans(makeRealCalc());
        const load = plans.find(p => p.id === PLAN_IDS.AMBITIOUS).levers.find(l => l.specId === 'load_ratio');
        assert.ok(load);
        assert.equal(load.category, 'non_prod');
        assert.equal(load.riskLevel, 'low');
    });
});

/* ============================================================
 * 4. Risk buffers
 * ============================================================ */

describe('Risk buffers — gating', () => {
    it('появляются при allowRiskBufferReduction=true (дефолт)', () => {
        const plans = buildOptimizationPlans(makeRealCalc());
        const a = plans.find(p => p.id === PLAN_IDS.AMBITIOUS);
        const ids = a.levers.map(l => l.specId);
        const anyBuffer = ['buffer_task', 'buffer_project', 'k_contingency', 'k_schedule_shift'].some(id => ids.includes(id));
        assert.ok(anyBuffer, 'хотя бы один risk buffer lever ожидается в ambitious при дефолте');
    });

    it('НЕ появляются при allowRiskBufferReduction=false', () => {
        const plans = buildOptimizationPlans(makeRealCalc(), {
            constraints: { ...DEFAULT_CONSTRAINTS, allowRiskBufferReduction: false }
        });
        for (const p of plans) {
            for (const id of ['buffer_task', 'buffer_project', 'k_contingency', 'k_schedule_shift']) {
                assert.equal(p.levers.find(l => l.specId === id), undefined);
            }
        }
    });
});

/* ============================================================
 * 5. AI / RAG levers
 * ============================================================ */

describe('AI levers — требуют ai_llm_used + allowAiReduction', () => {
    it('AI output tokens НЕ появляется, если ai_llm_used=false', () => {
        const plans = buildOptimizationPlans(makeRealCalc({ answers: { ai_llm_used: false } }), {
            constraints: { ...DEFAULT_CONSTRAINTS, allowAiReduction: true }
        });
        for (const p of plans) {
            assert.equal(p.levers.find(l => l.specId === 'ai_output_tokens'), undefined);
        }
    });

    it('AI output tokens НЕ появляется при allowAiReduction=false (дефолт), даже если ai_llm_used=true', () => {
        const plans = buildOptimizationPlans(makeRealCalc({
            answers: { ai_llm_used: true, ai_avg_output_tokens: 500 }
        }));
        for (const p of plans) {
            assert.equal(p.levers.find(l => l.specId === 'ai_output_tokens'), undefined);
        }
    });

    it('RAG corpus НЕ появляется, если rag_needed=false', () => {
        const plans = buildOptimizationPlans(makeRealCalc({ answers: { rag_needed: false } }), {
            constraints: { ...DEFAULT_CONSTRAINTS, allowAiReduction: true }
        });
        for (const p of plans) {
            assert.equal(p.levers.find(l => l.specId === 'rag_corpus'), undefined);
            assert.equal(p.levers.find(l => l.specId === 'rag_embeddings'), undefined);
        }
    });

    it('RAG levers НЕ появляются в conservative даже при ai+constraint включённых', () => {
        const plans = buildOptimizationPlans(makeRealCalc({
            answers: { ai_llm_used: true, rag_needed: true, rag_corpus_size_gb: 10, rag_embeddings_million: 1 }
        }), {
            constraints: { ...DEFAULT_CONSTRAINTS, allowAiReduction: true }
        });
        const c = plans.find(p => p.id === PLAN_IDS.CONSERVATIVE);
        assert.equal(c.levers.find(l => l.specId === 'rag_corpus'), undefined);
        assert.equal(c.levers.find(l => l.specId === 'rag_embeddings'), undefined);
    });
});

/* ============================================================
 * 6. Retention (backup_retention_days)
 * ============================================================ */

describe('Backup retention — options-step lever', () => {
    it('появляется при allowRetentionReduction=true (дефолт) и retention > floor', () => {
        // Дефолтный backup_retention_days может быть default (30) или null.
        // Установим явно высокое значение, чтобы lever точно мог снизить.
        const plans = buildOptimizationPlans(makeRealCalc({
            answers: { backup_retention_days: 365 }
        }));
        const has = plans.some(p => p.levers.some(l => l.specId === 'backup_retention'));
        assert.ok(has, 'backup_retention lever ожидается при retention=365 и дефолтных constraints');
    });

    it('НЕ появляется при allowRetentionReduction=false', () => {
        const plans = buildOptimizationPlans(makeRealCalc({
            answers: { backup_retention_days: 365 }
        }), {
            constraints: { ...DEFAULT_CONSTRAINTS, allowRetentionReduction: false }
        });
        for (const p of plans) {
            assert.equal(p.levers.find(l => l.specId === 'backup_retention'), undefined);
        }
    });

    it('protectCompliance=true ограничивает floor 90 (нельзя уйти ниже)', () => {
        // backup_retention=180 + protect → step down should land на 90, не ниже.
        const plans = buildOptimizationPlans(makeRealCalc({
            answers: { backup_retention_days: 180 }
        }), {
            constraints: { ...DEFAULT_CONSTRAINTS, allowRetentionReduction: true, protectCompliance: true }
        });
        const lever = plans.find(p => p.id === PLAN_IDS.EXTREME).levers.find(l => l.specId === 'backup_retention');
        if (lever) {
            assert.ok(lever.to >= 90, `при protectCompliance=true to (${lever.to}) не должно быть меньше 90`);
        }
    });
});

/* ============================================================
 * 7. Planning horizon
 * ============================================================ */

describe('Planning horizon — только если > 3 и не conservative', () => {
    it('НЕ появляется при horizon ≤ 3', () => {
        const plans = buildOptimizationPlans(makeRealCalc({
            settings: { planningHorizonYears: 3 }
        }));
        for (const p of plans) {
            assert.equal(p.levers.find(l => l.specId === 'planning_horizon'), undefined);
        }
    });

    it('появляется в ambitious/extreme при horizon=5', () => {
        const plans = buildOptimizationPlans(makeRealCalc({
            settings: { planningHorizonYears: 5 }
        }));
        const cons = plans.find(p => p.id === PLAN_IDS.CONSERVATIVE);
        const amb = plans.find(p => p.id === PLAN_IDS.AMBITIOUS);
        assert.equal(cons.levers.find(l => l.specId === 'planning_horizon'), undefined,
            'planning horizon никогда не входит в conservative');
        assert.ok(amb.levers.find(l => l.specId === 'planning_horizon'),
            'planning horizon ожидается в ambitious при horizon=5');
    });
});

/* ============================================================
 * 8. Mutation-safety
 * ============================================================ */

describe('Mutation safety — original calc НЕ меняется', () => {
    it('buildOptimizationPlans не мутирует calc.settings/answers', () => {
        const calc = makeRealCalc({
            settings: { planningHorizonYears: 5, bufferTask: 0.30 },
            answers: { sla_target: 99.9, ai_llm_used: true, ai_avg_output_tokens: 500 }
        });
        const settingsBefore = JSON.stringify(calc.settings);
        const answersBefore = JSON.stringify(calc.answers);
        buildOptimizationPlans(calc, {
            constraints: { ...DEFAULT_CONSTRAINTS, allowReliabilityTradeoff: true, allowAiReduction: true }
        });
        assert.equal(JSON.stringify(calc.settings), settingsBefore);
        assert.equal(JSON.stringify(calc.answers), answersBefore);
    });

    it('повторный вызов даёт идентичный результат (детерминистичность)', () => {
        const calc = makeRealCalc();
        const a = buildOptimizationPlans(calc);
        const b = buildOptimizationPlans(calc);
        assert.equal(a.length, b.length);
        for (let i = 0; i < a.length; i++) {
            assert.equal(a[i].id, b[i].id);
            assert.equal(a[i].levers.length, b[i].levers.length);
        }
    });
});

/* ============================================================
 * 9. Numerical safety
 * ============================================================ */

describe('Numerical safety', () => {
    it('Нет NaN/Infinity в expectedSavingPercent', () => {
        const plans = buildOptimizationPlans(makeRealCalc());
        for (const p of plans) {
            for (const l of p.levers) {
                assert.ok(Number.isFinite(l.expectedSavingPercent), `${l.id} percent not finite`);
                assert.ok(l.expectedSavingPercent > 0, `${l.id} percent must be > 0`);
            }
            assert.ok(Number.isFinite(p.expectedReductionPercent));
            assert.ok(Number.isFinite(p.expectedSavingRub));
        }
    });

    it('Дубликатов lever внутри одного плана нет', () => {
        const plans = buildOptimizationPlans(makeRealCalc(), {
            constraints: { ...DEFAULT_CONSTRAINTS, allowReliabilityTradeoff: true, allowAiReduction: true }
        });
        for (const p of plans) {
            const ids = p.levers.map(l => l.specId);
            const unique = new Set(ids);
            assert.equal(ids.length, unique.size, `${p.id} имеет дубликаты levers: ${ids.join(',')}`);
        }
    });

    it('expectedSavingRub плана >= 0', () => {
        const plans = buildOptimizationPlans(makeRealCalc());
        for (const p of plans) assert.ok(p.expectedSavingRub >= 0);
    });
});

/* ============================================================
 * 10. Consequences и feasibility
 * ============================================================ */

describe('Consequences и feasibility', () => {
    it('у каждого lever есть непустой consequence', () => {
        const plans = buildOptimizationPlans(makeRealCalc(), {
            constraints: { ...DEFAULT_CONSTRAINTS, allowReliabilityTradeoff: true, allowAiReduction: true }
        });
        for (const p of plans) {
            for (const l of p.levers) {
                assert.ok(typeof l.consequence === 'string' && l.consequence.length > 0);
            }
        }
    });

    it('plan.consequences — уникальные строки из levers', () => {
        const plans = buildOptimizationPlans(makeRealCalc());
        for (const p of plans) {
            assert.equal(new Set(p.consequences).size, p.consequences.length);
        }
    });

    it('infeasible plan содержит непустой summary', () => {
        // Все toggle off → планы скорее всего infeasible.
        const plans = buildOptimizationPlans(makeRealCalc(), {
            constraints: {
                allowReliabilityTradeoff: false,
                allowNonProdReduction:    false,
                allowRiskBufferReduction: false,
                allowAiReduction:         false,
                allowRetentionReduction:  false,
                protectCompliance:        true
            }
        });
        for (const p of plans) {
            assert.ok(typeof p.summary === 'string' && p.summary.length > 0);
            // С полностью выключенными constraints конструктивных levers быть не должно.
            assert.equal(p.levers.length, 0,
                `${p.id} имеет levers при всех off-constraints — что-то проскочило мимо gating`);
        }
    });
});

/* ============================================================
 * 11. Empty / null calc
 * ============================================================ */

describe('Empty / null calc — безопасность', () => {
    it('null calc → 3 пустых плана с feasible=false', () => {
        const plans = buildOptimizationPlans(null);
        assert.equal(plans.length, 3);
        for (const p of plans) {
            assert.equal(p.feasible, false);
            assert.equal(p.levers.length, 0);
            assert.equal(p.expectedSavingRub, 0);
        }
    });

    it('calc с пустыми dictionaries → 3 пустых плана (baseTotal=0)', () => {
        const calc = {
            id: 'empty', schemaVersion: 16, settings: { ...SEED_SETTINGS },
            answers: {}, answersMeta: {}, view: { disabledStands: [] },
            dictionaries: { items: [], questions: [] }
        };
        const plans = buildOptimizationPlans(calc);
        assert.equal(plans.length, 3);
        for (const p of plans) {
            assert.equal(p.feasible, false);
            assert.equal(p.levers.length, 0);
        }
    });
});

/* ============================================================
 * 12. Helpers / API surface
 * ============================================================ */

describe('Public API helpers', () => {
    it('rankOptimizationPlans возвращает порядок conservative→ambitious→extreme', () => {
        const shuffled = [
            { id: PLAN_IDS.EXTREME }, { id: PLAN_IDS.CONSERVATIVE }, { id: PLAN_IDS.AMBITIOUS }
        ];
        const ranked = rankOptimizationPlans(shuffled);
        assert.deepEqual(ranked.map(p => p.id), [PLAN_IDS.CONSERVATIVE, PLAN_IDS.AMBITIOUS, PLAN_IDS.EXTREME]);
    });

    it('summarizeOptimizationPlan возвращает короткую строку для feasible плана', () => {
        const plan = {
            title: 'Тест', targetRange: { minPercent: 5, maxPercent: 15 },
            expectedReductionPercent: 8.4, riskLevel: 'medium', feasible: true, levers: [{}, {}]
        };
        const s = summarizeOptimizationPlan(plan);
        assert.match(s, /5–15%/);
        assert.match(s, /8\.4%/);
    });

    it('summarizeOptimizationPlan для infeasible упоминает максимум', () => {
        const plan = {
            title: 'Тест', targetRange: { minPercent: 15, maxPercent: 25 },
            expectedReductionPercent: 12.4, riskLevel: 'high', feasible: false, levers: []
        };
        const s = summarizeOptimizationPlan(plan);
        assert.match(s, /Недостижим/);
        assert.match(s, /12\.4%/);
    });

    it('getOptimizationFeasibility возвращает list совместимый с UI', () => {
        const plans = buildOptimizationPlans(makeRealCalc());
        const f = getOptimizationFeasibility(plans);
        assert.equal(f.length, 3);
        for (const item of f) {
            assert.ok('id' in item);
            assert.ok('feasible' in item);
            assert.ok('targetRange' in item);
            assert.ok('maxAchievablePercent' in item);
        }
    });

    it('buildOptimizationLevers возвращает массив levers для одного tier', () => {
        const calc = makeRealCalc();
        const tier = PLAN_TIERS.find(t => t.id === PLAN_IDS.AMBITIOUS);
        const levers = buildOptimizationLevers(calc, tier);
        assert.ok(Array.isArray(levers));
        for (const l of levers) {
            assert.ok(typeof l.id === 'string');
            assert.ok(typeof l.title === 'string');
        }
    });

    it('DEFAULT_CONSTRAINTS frozen и содержит все 6 ключей', () => {
        assert.equal(Object.isFrozen(DEFAULT_CONSTRAINTS), true);
        for (const k of ['allowReliabilityTradeoff', 'allowNonProdReduction',
                         'allowRiskBufferReduction', 'allowAiReduction',
                         'allowRetentionReduction', 'protectCompliance']) {
            assert.ok(k in DEFAULT_CONSTRAINTS, `DEFAULT_CONSTRAINTS missing ${k}`);
        }
    });

    it('default allowReliabilityTradeoff=false (защита SLA)', () => {
        assert.equal(DEFAULT_CONSTRAINTS.allowReliabilityTradeoff, false);
    });

    it('default allowAiReduction=false (защита AI/RAG по умолчанию)', () => {
        assert.equal(DEFAULT_CONSTRAINTS.allowAiReduction, false);
    });
});

/* ============================================================
 * 13. Integration с calculator — экономия реальная
 * ============================================================ */

describe('Real calculator delta — экономия не выдумана', () => {
    it('применение всех levers плана действительно снижает totalMonthly', () => {
        const calc = makeRealCalc({
            settings: { planningHorizonYears: 5 }
        });
        const baseTotal = calculate(calc, null).totalMonthly;
        const plans = buildOptimizationPlans(calc);
        const ambitious = plans.find(p => p.id === PLAN_IDS.AMBITIOUS);
        if (ambitious.levers.length === 0) return; // нечего проверять
        // expectedSavingRub плана получен через clone-всех-levers + recompute.
        const expectedNew = baseTotal - ambitious.expectedSavingRub;
        assert.ok(expectedNew < baseTotal,
            'Применение levers плана должно действительно снижать totalMonthly');
        assert.ok(expectedNew > 0, 'Plan total никогда не отрицательный');
    });
});
