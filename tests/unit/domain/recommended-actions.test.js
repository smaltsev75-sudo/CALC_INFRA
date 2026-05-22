/**
 * Stage 16.6 (PATCH 2.10.1) — Recommended Actions domain tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildRecommendedActions,
    rankRecommendedActions,
    groupRecommendedActions,
    ALLOWED_TARGETS
} from '../../../js/domain/recommendedActions.js';

function makeCalc(overrides = {}) {
    return {
        id: 'ra-t1',
        name: 'Test',
        schemaVersion: 12,
        answers: { ...(overrides.answers || {}) },
        answersMeta: {},
        settings: {
            applyRiskFactors: false, vatEnabled: false, vatRate: 0.2,
            planningHorizonYears: 1, phaseDurationMonths: 12,
            standSizeRatio: { DEV: 0.16, IFT: 0.4, PSI: 0.5, LOAD: 0.8, PROD: 1.0 },
            resourceRatio: {},
            aiStandFactor: { DEV: 0.02, IFT: 0.2, PSI: 0.5, PROD: 1.0, LOAD: 1.0 },
            ...(overrides.settings || {})
        },
        dictionaries: { questions: [], items: [], settings: {} },
        view: {},
        scenarios: overrides.scenarios,
        providerVersion: overrides.providerVersion ?? null
    };
}

describe('buildRecommendedActions — health-driven', () => {
    it('errors → guided_completion (severity=high)', () => {
        const out = buildRecommendedActions(makeCalc(), {
            healthResult: { score: 40, counts: { error: 2, warning: 0, recommendation: 0, info: 0 } }
        });
        const guided = out.find(a => a.target === 'guided_completion');
        assert.ok(guided);
        assert.equal(guided.severity, 'high');
    });

    it('low score без errors → guided_completion (severity=medium)', () => {
        const out = buildRecommendedActions(makeCalc(), {
            healthResult: { score: 50, counts: { error: 0, warning: 1, recommendation: 0, info: 0 } }
        });
        const guided = out.find(a => a.target === 'guided_completion');
        assert.ok(guided);
        assert.equal(guided.severity, 'medium');
    });

    it('high score без issues → no guided_completion action', () => {
        const out = buildRecommendedActions(makeCalc(), {
            healthResult: { score: 95, counts: { error: 0, warning: 0, recommendation: 0, info: 0 } },
            assumptionsRegister: { all: [], risky: [] },
            budgetStatus: { status: 'not_configured' }
        });
        assert.equal(out.find(a => a.target === 'guided_completion'), undefined);
    });

    it('много warnings → health_check action (medium)', () => {
        const out = buildRecommendedActions(makeCalc(), {
            healthResult: { score: 70, counts: { error: 0, warning: 4, recommendation: 0, info: 0 } }
        });
        const hc = out.find(a => a.target === 'health_check');
        assert.ok(hc);
        assert.equal(hc.severity, 'medium');
    });
});

describe('buildRecommendedActions — assumptions', () => {
    it('много risky assumptions → assumptions_register', () => {
        const risky = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
        const out = buildRecommendedActions(makeCalc(), {
            healthResult: { score: 90, counts: { error: 0, warning: 0, recommendation: 0, info: 0 } },
            assumptionsRegister: { all: risky, risky }
        });
        const a = out.find(a => a.target === 'assumptions_register');
        assert.ok(a);
        assert.equal(a.severity, 'medium');
    });

    it('мало risky → no assumptions action', () => {
        const out = buildRecommendedActions(makeCalc(), {
            healthResult: { score: 90, counts: { error: 0, warning: 0, recommendation: 0, info: 0 } },
            assumptionsRegister: { all: [], risky: [{ id: 'a' }] }
        });
        assert.equal(out.find(a => a.target === 'assumptions_register'), undefined);
    });
});

describe('buildRecommendedActions — budget', () => {
    it('warning → budget_guardrails + sensitivity_analysis', () => {
        const out = buildRecommendedActions(makeCalc(), {
            healthResult: { score: 90, counts: { error: 0, warning: 0, recommendation: 0, info: 0 } },
            budgetStatus: { status: 'warning' }
        });
        assert.ok(out.find(a => a.target === 'budget_guardrails'));
        assert.ok(out.find(a => a.target === 'sensitivity_analysis'));
    });

    it('ok → no budget action', () => {
        const out = buildRecommendedActions(makeCalc(), {
            healthResult: { score: 90, counts: {} },
            budgetStatus: { status: 'ok' }
        });
        assert.equal(out.find(a => a.target === 'budget_guardrails'), undefined);
    });
});

describe('buildRecommendedActions — provider stale', () => {
    it('stale=true → price_import_mapping', () => {
        const calc = makeCalc({ providerVersion: { id: 'p', version: 'v', stale: true } });
        const out = buildRecommendedActions(calc, {
            healthResult: { score: 90, counts: {} }
        });
        assert.ok(out.find(a => a.target === 'price_import_mapping'));
    });

    it('stale=false → no price import action', () => {
        const calc = makeCalc({ providerVersion: { id: 'p', version: 'v', stale: false } });
        const out = buildRecommendedActions(calc, {
            healthResult: { score: 90, counts: {} }
        });
        assert.equal(out.find(a => a.target === 'price_import_mapping'), undefined);
    });
});

describe('buildRecommendedActions — scenario_comparison', () => {
    it('≥2 сценариев → scenario_comparison', () => {
        const calc = makeCalc({
            scenarios: [
                { id: 's1', label: 'A', answers: {}, answersMeta: {} },
                { id: 's2', label: 'B', answers: {}, answersMeta: {} }
            ]
        });
        const out = buildRecommendedActions(calc, {
            healthResult: { score: 90, counts: {} }
        });
        assert.ok(out.find(a => a.target === 'scenario_comparison'));
    });

    it('1 сценарий → no scenario_comparison', () => {
        const calc = makeCalc({
            scenarios: [{ id: 's1', label: 'A', answers: {}, answersMeta: {} }]
        });
        const out = buildRecommendedActions(calc, {
            healthResult: { score: 90, counts: {} }
        });
        assert.equal(out.find(a => a.target === 'scenario_comparison'), undefined);
    });
});

describe('buildRecommendedActions — fallback', () => {
    it('здоровый calc → decision_memo as low-priority default', () => {
        const out = buildRecommendedActions(makeCalc(), {
            healthResult: { score: 95, counts: { error: 0, warning: 0, recommendation: 0, info: 0 } },
            assumptionsRegister: { all: [], risky: [] },
            budgetStatus: { status: 'not_configured' }
        });
        assert.equal(out.length, 1);
        assert.equal(out[0].target, 'decision_memo');
        assert.equal(out[0].severity, 'low');
    });

    it('null calc → []', () => {
        assert.deepEqual(buildRecommendedActions(null), []);
    });
});

describe('Forbidden targets — defensive lint', () => {
    it('все возвращаемые actions используют только ALLOWED_TARGETS', () => {
        const calc = makeCalc({
            scenarios: [
                { id: 's1', label: 'A', answers: {}, answersMeta: {} },
                { id: 's2', label: 'B', answers: {}, answersMeta: {} }
            ],
            providerVersion: { id: 'p', stale: true }
        });
        const out = buildRecommendedActions(calc, {
            healthResult: { score: 30, counts: { error: 3, warning: 5, recommendation: 0, info: 0 } },
            assumptionsRegister: { all: [], risky: [{}, {}, {}, {}] },
            budgetStatus: { status: 'warning' }
        });
        for (const a of out) {
            assert.ok(ALLOWED_TARGETS.includes(a.target),
                `Action ${a.id} имеет недопустимый target "${a.target}"`);
        }
    });

    it('никогда не возвращает mutation targets (apply_to_scenario / apply_playbook / what_if_modal / scenario_pack)', () => {
        const out = buildRecommendedActions(makeCalc(), {
            healthResult: { score: 30, counts: { error: 5 } },
            assumptionsRegister: { all: [], risky: [{}, {}, {}, {}] },
            budgetStatus: { status: 'warning' }
        });
        const mutationTargets = ['apply_to_scenario', 'mutate_scenario', 'apply_playbook',
            'what_if_modal', 'scenario_pack', 'price_simulation'];
        for (const t of mutationTargets) {
            assert.equal(out.find(a => a.target === t), undefined,
                `Найден запрещённый target ${t}`);
        }
    });
});

describe('rankRecommendedActions', () => {
    it('сортирует high → medium → low → info', () => {
        const items = [
            { id: 'a', severity: 'low' },
            { id: 'b', severity: 'high' },
            { id: 'c', severity: 'medium' },
            { id: 'd', severity: 'info' }
        ];
        const out = rankRecommendedActions(items);
        assert.deepEqual(out.map(i => i.id), ['b', 'c', 'a', 'd']);
    });

    it('не мутирует входной массив', () => {
        const items = [{ id: 'a', severity: 'low' }, { id: 'b', severity: 'high' }];
        const before = JSON.stringify(items);
        rankRecommendedActions(items);
        assert.equal(JSON.stringify(items), before);
    });

    it('null → []', () => {
        assert.deepEqual(rankRecommendedActions(null), []);
    });
});

describe('groupRecommendedActions', () => {
    it('группирует по severity', () => {
        const items = [
            { id: 'a', severity: 'high' }, { id: 'b', severity: 'low' },
            { id: 'c', severity: 'high' }, { id: 'd', severity: 'medium' }
        ];
        const out = groupRecommendedActions(items);
        assert.equal(out.high.length, 2);
        assert.equal(out.medium.length, 1);
        assert.equal(out.low.length, 1);
        assert.equal(out.info.length, 0);
    });

    it('null → пустые группы', () => {
        const out = groupRecommendedActions(null);
        assert.equal(out.high.length, 0);
        assert.equal(out.medium.length, 0);
    });

    it('неизвестный severity → info', () => {
        const out = groupRecommendedActions([{ id: 'x', severity: 'bogus' }]);
        assert.equal(out.info.length, 1);
    });
});

describe('Action object schema', () => {
    it('каждый action имеет id/title/reason/target/actionLabel/severity/source', () => {
        const calc = makeCalc({
            providerVersion: { id: 'p', stale: true },
            scenarios: [
                { id: 's1', label: 'A', answers: {}, answersMeta: {} },
                { id: 's2', label: 'B', answers: {}, answersMeta: {} }
            ]
        });
        const out = buildRecommendedActions(calc, {
            healthResult: { score: 30, counts: { error: 2, warning: 5 } },
            assumptionsRegister: { all: [], risky: [{}, {}, {}] },
            budgetStatus: { status: 'warning' }
        });
        for (const a of out) {
            assert.equal(typeof a.id, 'string');
            assert.equal(typeof a.title, 'string');
            assert.equal(typeof a.reason, 'string');
            assert.equal(typeof a.target, 'string');
            assert.equal(typeof a.actionLabel, 'string');
            assert.equal(typeof a.severity, 'string');
            assert.equal(typeof a.source, 'string');
        }
    });

    it('targets дедуплицируются (один target = одно действие)', () => {
        const out = buildRecommendedActions(makeCalc(), {
            healthResult: { score: 30, counts: { error: 5 } },
            // и low-score, и errors попытаются добавить guided_completion
            assumptionsRegister: { all: [], risky: [] },
            budgetStatus: { status: 'not_configured' }
        });
        const targets = out.map(a => a.target);
        const unique = new Set(targets);
        assert.equal(targets.length, unique.size, 'найдены дубликаты target');
    });
});
