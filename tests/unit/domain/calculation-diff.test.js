/**
 * Stage 17.1 (MINOR 2.10.0) — Calculation Diff domain tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCalculationDiff,
    diffAnswers,
    diffSettings,
    diffScenarios,
    diffProviderPriceState,
    diffTotals,
    groupDiffBySection,
    summarizeCalculationDiff
} from '../../../js/domain/calculationDiff.js';

/* ============================================================
 * Factory helpers
 * ============================================================ */

function makeCalc(overrides = {}) {
    return {
        id: 'cdt-1',
        name: 'Diff Test',
        schemaVersion: 12,
        answers: { peak_rps: 1000, sla_target: 99.9, ...(overrides.answers || {}) },
        answersMeta: {},
        settings: {
            applyRiskFactors: false,
            vatEnabled: false,
            vatRate: 0.2,
            planningHorizonYears: 1,
            phaseDurationMonths: 12,
            bufferTask: 0.3, bufferProject: 0.15,
            kInflation: 0, kSeasonal: 0, kScheduleShift: 0.15, kContingency: 0.05,
            standSizeRatio: { DEV: 0.16, IFT: 0.4, PSI: 0.5, LOAD: 0.8, PROD: 1.0 },
            resourceRatio: {},
            aiStandFactor: { DEV: 0.02, IFT: 0.2, PSI: 0.5, PROD: 1.0, LOAD: 1.0 },
            ...(overrides.settings || {})
        },
        dictionaries: overrides.dictionaries || {
            questions: [
                { id: 'peak_rps', section: 'load_profile', title: 'Пиковый RPS' },
                { id: 'sla_target', section: 'sla', title: 'Целевой SLA' }
            ],
            items: [],
            settings: {}
        },
        view: {},
        scenarios: overrides.scenarios,
        activeScenarioId: overrides.activeScenarioId,
        providerVersion: overrides.providerVersion ?? null
    };
}

/* ============================================================
 * 1. diffAnswers
 * ============================================================ */

describe('diffAnswers', () => {
    const catalog = [
        { id: 'peak_rps', section: 'load_profile', title: 'Пиковый RPS' },
        { id: 'sla_target', section: 'sla', title: 'Целевой SLA' },
        { id: 'ai_llm_used', section: 'ai_llm', title: 'AI-режим' }
    ];

    it('обнаруживает изменённое числовое поле', () => {
        const items = diffAnswers({ peak_rps: 1000 }, { peak_rps: 1500 }, catalog);
        assert.equal(items.length, 1);
        const it0 = items[0];
        assert.equal(it0.id, 'answers.peak_rps');
        assert.equal(it0.type, 'changed');
        assert.equal(it0.category, 'answers');
        assert.equal(it0.before, 1000);
        assert.equal(it0.after, 1500);
        assert.equal(it0.delta, 500);
        assert.equal(it0.deltaPercent, 50);
        assert.equal(it0.label, 'Пиковый RPS');
        assert.equal(it0.sectionId, 'load_profile');
    });

    it('обнаруживает добавленное поле', () => {
        const items = diffAnswers({}, { sla_target: 99.99 }, catalog);
        assert.equal(items.length, 1);
        assert.equal(items[0].type, 'added');
        assert.equal(items[0].before, null);
        assert.equal(items[0].after, 99.99);
    });

    it('обнаруживает удалённое поле', () => {
        const items = diffAnswers({ sla_target: 99.99 }, {}, catalog);
        assert.equal(items.length, 1);
        assert.equal(items[0].type, 'removed');
        assert.equal(items[0].before, 99.99);
        assert.equal(items[0].after, null);
    });

    it('одинаковые значения — пустой результат', () => {
        const items = diffAnswers({ peak_rps: 1000 }, { peak_rps: 1000 }, catalog);
        assert.equal(items.length, 0);
    });

    it('null === null, undefined === undefined — не diff', () => {
        const items = diffAnswers(
            { peak_rps: null, sla_target: undefined },
            { peak_rps: null, sla_target: undefined },
            catalog
        );
        assert.equal(items.length, 0);
    });

    it('null → значение → added (а не changed)', () => {
        const items = diffAnswers({ peak_rps: null }, { peak_rps: 100 }, catalog);
        assert.equal(items.length, 1);
        assert.equal(items[0].type, 'added');
    });

    it('значение → null → removed', () => {
        const items = diffAnswers({ peak_rps: 100 }, { peak_rps: null }, catalog);
        assert.equal(items.length, 1);
        assert.equal(items[0].type, 'removed');
    });

    it('boolean toggle обнаруживается', () => {
        const items = diffAnswers({ ai_llm_used: false }, { ai_llm_used: true }, catalog);
        assert.equal(items.length, 1);
        assert.equal(items[0].type, 'changed');
        assert.equal(items[0].before, false);
        assert.equal(items[0].after, true);
        assert.equal(items[0].delta, null);
        assert.equal(items[0].deltaPercent, null);
    });

    it('unknown fieldId — label = fieldId', () => {
        const items = diffAnswers({ unknown_field: 1 }, { unknown_field: 2 }, catalog);
        assert.equal(items.length, 1);
        assert.equal(items[0].label, 'unknown_field');
        assert.equal(items[0].sectionId, null);
    });

    it('null catalog — fallback', () => {
        const items = diffAnswers({ a: 1 }, { a: 2 }, null);
        assert.equal(items.length, 1);
        assert.equal(items[0].label, 'a');
    });

    it('массивные значения обнаруживаются', () => {
        const items = diffAnswers({ list: [1, 2] }, { list: [1, 2, 3] }, catalog);
        assert.equal(items.length, 1);
        assert.equal(items[0].type, 'changed');
    });

    it('массивы с одинаковыми значениями — не diff', () => {
        const items = diffAnswers({ list: [1, 2] }, { list: [1, 2] }, catalog);
        assert.equal(items.length, 0);
    });

    it('null/undefined args — пустой результат', () => {
        assert.deepEqual(diffAnswers(null, null, catalog), []);
        assert.deepEqual(diffAnswers(undefined, undefined, catalog), []);
    });

    it('не мутирует входные объекты', () => {
        const a = { peak_rps: 1000 };
        const b = { peak_rps: 1500 };
        const ja = JSON.stringify(a), jb = JSON.stringify(b);
        diffAnswers(a, b, catalog);
        assert.equal(JSON.stringify(a), ja);
        assert.equal(JSON.stringify(b), jb);
    });
});

/* ============================================================
 * 2. diffSettings
 * ============================================================ */

describe('diffSettings', () => {
    it('обнаруживает изменения скалярных полей', () => {
        const items = diffSettings(
            { vatRate: 0.2, applyRiskFactors: false },
            { vatRate: 0.18, applyRiskFactors: true }
        );
        assert.equal(items.length, 2);
        const ids = items.map(i => i.id).sort();
        assert.deepEqual(ids, ['settings.applyRiskFactors', 'settings.vatRate']);
    });

    it('обнаруживает изменения вложенных объектов (standSizeRatio)', () => {
        const items = diffSettings(
            { standSizeRatio: { DEV: 0.16, LOAD: 0.8 } },
            { standSizeRatio: { DEV: 0.16, LOAD: 1.0 } }
        );
        assert.equal(items.length, 1);
        assert.equal(items[0].id, 'settings.standSizeRatio.LOAD');
        assert.equal(items[0].before, 0.8);
        assert.equal(items[0].after, 1.0);
    });

    it('одинаковые settings — пустой результат', () => {
        const s = { vatRate: 0.2, standSizeRatio: { DEV: 0.16 } };
        assert.equal(diffSettings(s, s).length, 0);
    });

    it('category = settings для всех элементов', () => {
        const items = diffSettings({ vatRate: 0.2 }, { vatRate: 0.18 });
        assert.equal(items[0].category, 'settings');
    });
});

/* ============================================================
 * 3. diffScenarios
 * ============================================================ */

describe('diffScenarios', () => {
    it('добавленный сценарий', () => {
        const before = [{ id: 's1', label: 'A', answers: {}, answersMeta: {} }];
        const after = [
            { id: 's1', label: 'A', answers: {}, answersMeta: {} },
            { id: 's2', label: 'B', answers: {}, answersMeta: {} }
        ];
        const diff = diffScenarios(before, after);
        assert.equal(diff.added.length, 1);
        assert.equal(diff.added[0].id, 's2');
        assert.equal(diff.removed.length, 0);
        assert.equal(diff.changed.length, 0);
    });

    it('удалённый сценарий', () => {
        const before = [
            { id: 's1', label: 'A', answers: {}, answersMeta: {} },
            { id: 's2', label: 'B', answers: {}, answersMeta: {} }
        ];
        const after = [{ id: 's1', label: 'A', answers: {}, answersMeta: {} }];
        const diff = diffScenarios(before, after);
        assert.equal(diff.removed.length, 1);
        assert.equal(diff.removed[0].id, 's2');
    });

    it('изменённый сценарий (label)', () => {
        const before = [{ id: 's1', label: 'Old', answers: {}, answersMeta: {} }];
        const after = [{ id: 's1', label: 'New', answers: {}, answersMeta: {} }];
        const diff = diffScenarios(before, after);
        assert.equal(diff.changed.length, 1);
        assert.equal(diff.changed[0].id, 's1');
        assert.ok(diff.changed[0].labelChanged);
    });

    it('изменённый сценарий (answers)', () => {
        const before = [{ id: 's1', label: 'A', answers: { peak_rps: 100 }, answersMeta: {} }];
        const after = [{ id: 's1', label: 'A', answers: { peak_rps: 200 }, answersMeta: {} }];
        const diff = diffScenarios(before, after);
        assert.equal(diff.changed.length, 1);
        assert.ok(diff.changed[0].answersChanged);
    });

    it('одинаковые сценарии — все массивы пустые', () => {
        const s = [{ id: 's1', label: 'A', answers: { x: 1 }, answersMeta: {} }];
        const diff = diffScenarios(s, s);
        assert.equal(diff.added.length, 0);
        assert.equal(diff.removed.length, 0);
        assert.equal(diff.changed.length, 0);
    });

    it('null/undefined → пустой diff', () => {
        const diff = diffScenarios(null, null);
        assert.deepEqual(diff, { added: [], removed: [], changed: [] });
    });

    it('legacy calc (нет scenarios) → ничего не меняется', () => {
        const diff = diffScenarios(undefined, undefined);
        assert.equal(diff.added.length, 0);
    });
});

/* ============================================================
 * 4. diffProviderPriceState
 * ============================================================ */

describe('diffProviderPriceState', () => {
    it('null → version появилась', () => {
        const before = makeCalc({ providerVersion: null });
        const after = makeCalc({
            providerVersion: { id: 'cloud-ru', version: '2026-Q4', timestamp: 't' }
        });
        const diff = diffProviderPriceState(before, after);
        assert.notEqual(diff, null);
        assert.equal(diff.type, 'added');
        assert.equal(diff.after.id, 'cloud-ru');
    });

    it('изменённая версия provider', () => {
        const before = makeCalc({
            providerVersion: { id: 'cloud-ru', version: '2026-Q3', timestamp: 't1' }
        });
        const after = makeCalc({
            providerVersion: { id: 'cloud-ru', version: '2026-Q4', timestamp: 't2' }
        });
        const diff = diffProviderPriceState(before, after);
        assert.notEqual(diff, null);
        assert.equal(diff.type, 'changed');
        assert.equal(diff.before.version, '2026-Q3');
        assert.equal(diff.after.version, '2026-Q4');
    });

    it('одинаковые provider versions → null', () => {
        const before = makeCalc({
            providerVersion: { id: 'cloud-ru', version: '2026-Q3', timestamp: 't' }
        });
        const after = makeCalc({
            providerVersion: { id: 'cloud-ru', version: '2026-Q3', timestamp: 't' }
        });
        assert.equal(diffProviderPriceState(before, after), null);
    });

    it('оба null → null', () => {
        const before = makeCalc({ providerVersion: null });
        const after  = makeCalc({ providerVersion: null });
        assert.equal(diffProviderPriceState(before, after), null);
    });
});

/* ============================================================
 * 5. diffTotals
 * ============================================================ */

describe('diffTotals', () => {
    it('изменение totalMonthly', () => {
        const out = diffTotals(
            { totalMonthly: 1_000_000, byCostType: { capex: 0, opex: 1_000_000 } },
            { totalMonthly: 1_500_000, byCostType: { capex: 0, opex: 1_500_000 } }
        );
        assert.equal(out.totalMonthlyDelta, 500_000);
        assert.equal(out.opexDelta, 500_000);
        assert.equal(out.capexDelta, 0);
    });

    it('null totals → нули', () => {
        const out = diffTotals(null, null);
        assert.equal(out.totalMonthlyDelta, 0);
        assert.equal(out.opexDelta, 0);
        assert.equal(out.capexDelta, 0);
    });

    it('частично присутствующие поля', () => {
        const out = diffTotals(
            { totalMonthly: 100 },
            { totalMonthly: 200, byCostType: { opex: 200 } }
        );
        assert.equal(out.totalMonthlyDelta, 100);
        assert.equal(out.opexDelta, 200);
    });
});

/* ============================================================
 * 6. buildCalculationDiff
 * ============================================================ */

describe('buildCalculationDiff', () => {
    it('возвращает структуру с answers/settings/scenarios/provider/totals/summary', () => {
        const before = makeCalc();
        const after = makeCalc({ answers: { peak_rps: 2000 } });
        const diff = buildCalculationDiff(before, after);
        assert.ok(Array.isArray(diff.answers));
        assert.ok(Array.isArray(diff.settings));
        assert.ok(diff.scenarios && Array.isArray(diff.scenarios.added));
        assert.ok('provider' in diff);
        assert.ok(diff.totals && 'totalMonthlyDelta' in diff.totals);
        assert.ok(diff.summary && typeof diff.summary.changedFields === 'number');
    });

    it('одинаковые calc → empty diff', () => {
        const c = makeCalc();
        const diff = buildCalculationDiff(c, c);
        assert.equal(diff.answers.length, 0);
        assert.equal(diff.settings.length, 0);
        assert.equal(diff.scenarios.added.length, 0);
        assert.equal(diff.scenarios.changed.length, 0);
        assert.equal(diff.provider, null);
        assert.equal(diff.summary.changedFields, 0);
    });

    it('null beforeCalc → all-added/empty', () => {
        const after = makeCalc();
        const diff = buildCalculationDiff(null, after);
        assert.ok(Array.isArray(diff.answers));
        // null before → diff = empty (нет понятия «было»). UI рисует empty-state.
        assert.equal(diff.answers.length, 0);
        assert.equal(diff.summary.changedFields, 0);
    });

    it('options.compute=false — totals.totalMonthlyDelta=0', () => {
        const before = makeCalc();
        const after = makeCalc({ answers: { peak_rps: 2000 } });
        const diff = buildCalculationDiff(before, after, { compute: false });
        assert.equal(diff.totals.totalMonthlyDelta, 0);
    });

    it('options.questionCatalog подставляется в labels', () => {
        const catalog = [{ id: 'peak_rps', section: 'load_profile', title: 'Custom Label' }];
        const before = makeCalc();
        const after = makeCalc({ answers: { peak_rps: 5000 } });
        const diff = buildCalculationDiff(before, after, { questionCatalog: catalog });
        assert.equal(diff.answers[0].label, 'Custom Label');
    });

    it('не мутирует before/after', () => {
        const before = makeCalc();
        const after = makeCalc({ answers: { peak_rps: 5000 } });
        const jb = JSON.stringify(before);
        const ja = JSON.stringify(after);
        buildCalculationDiff(before, after);
        assert.equal(JSON.stringify(before), jb);
        assert.equal(JSON.stringify(after), ja);
    });
});

/* ============================================================
 * 7. summarizeCalculationDiff
 * ============================================================ */

describe('summarizeCalculationDiff', () => {
    it('считает changedFields, addedScenarios, providerChanged', () => {
        const diff = {
            answers: [{ id: 'a' }, { id: 'b' }],
            settings: [{ id: 'c' }],
            scenarios: { added: [{ id: 's1' }, { id: 's2' }], removed: [], changed: [{ id: 's3' }] },
            provider: { type: 'changed' },
            totals: { totalMonthlyDelta: 100, opexDelta: 100, capexDelta: 0 }
        };
        const sum = summarizeCalculationDiff(diff);
        assert.equal(sum.changedFields, 3);  // answers + settings
        assert.equal(sum.addedScenarios, 2);
        assert.equal(sum.removedScenarios, 0);
        assert.equal(sum.changedScenarios, 1);
        assert.equal(sum.providerChanged, true);
        assert.equal(sum.totalDelta, 100);
        assert.equal(sum.opexDelta, 100);
    });

    it('пустой diff → все нули', () => {
        const diff = {
            answers: [], settings: [],
            scenarios: { added: [], removed: [], changed: [] },
            provider: null,
            totals: { totalMonthlyDelta: 0, opexDelta: 0, capexDelta: 0 }
        };
        const sum = summarizeCalculationDiff(diff);
        assert.equal(sum.changedFields, 0);
        assert.equal(sum.addedScenarios, 0);
        assert.equal(sum.providerChanged, false);
        assert.equal(sum.totalDelta, 0);
    });

    it('null diff → safe defaults', () => {
        const sum = summarizeCalculationDiff(null);
        assert.equal(sum.changedFields, 0);
        assert.equal(sum.totalDelta, 0);
    });
});

/* ============================================================
 * 8. groupDiffBySection
 * ============================================================ */

describe('groupDiffBySection', () => {
    it('группирует по sectionId', () => {
        const items = [
            { id: 'a', sectionId: 'sec1' },
            { id: 'b', sectionId: 'sec2' },
            { id: 'c', sectionId: 'sec1' }
        ];
        const out = groupDiffBySection(items);
        assert.equal(out['sec1'].length, 2);
        assert.equal(out['sec2'].length, 1);
    });

    it('null sectionId → группа "_other"', () => {
        const items = [{ id: 'x', sectionId: null }];
        const out = groupDiffBySection(items);
        assert.ok(out['_other']);
        assert.equal(out['_other'].length, 1);
    });

    it('пустой массив → пустой объект', () => {
        assert.deepEqual(groupDiffBySection([]), {});
    });

    it('null → пустой объект', () => {
        assert.deepEqual(groupDiffBySection(null), {});
    });
});
