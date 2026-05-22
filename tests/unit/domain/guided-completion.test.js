/**
 * Unit-тесты Stage 16.1 — Guided Data Completion (domain).
 *
 * Покрывает:
 *   - buildCompletionPlan: контракт результата, источники, приоритеты,
 *     дедуп по fieldId, сортировка, gated wrapping.
 *   - findUnmetMaster: dependsOn + boolean / select / numeric master.
 *   - getStepAt / findNextActionableIndex / getCompletionProgress.
 *
 * Не покрывает (в controller-тестах): snapshot/rollback, store-mutations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCompletionPlan,
    findUnmetMaster,
    getStepAt,
    getCompletionProgress,
    findNextActionableIndex
} from '../../../js/domain/guidedCompletion.js';

/* ---------- Фикстуры ---------- */

function makeQuestion(id, overrides = {}) {
    return {
        id,
        title: overrides.title || id,
        type: overrides.type || 'number',
        defaultValue: overrides.defaultValue,
        defaultIfUnknown: overrides.defaultIfUnknown,
        dependsOn: overrides.dependsOn,
        section: overrides.section,
        order: overrides.order
    };
}

function makeCalc({ answers = {}, questions = [] } = {}) {
    return {
        id: 'test-calc',
        name: 'Test',
        schemaVersion: 12,
        answers: { ...answers },
        answersMeta: {},
        settings: { applyRiskFactors: true },
        dictionaries: {
            questions,
            items: [],
            settings: {}
        },
        view: {}
    };
}

function makeFinding(severity, fieldIds, overrides = {}) {
    return {
        id: overrides.id || `${severity}-${fieldIds[0] || 'noop'}`,
        severity,
        category: overrides.category || 'consistency',
        title: overrides.title || `Test ${severity}`,
        message: overrides.message || 'Test message',
        fieldIds,
        suggestedAction: overrides.suggestedAction || 'Do something',
        scenarioId: null
    };
}

function makeAssumption(fieldId, overrides = {}) {
    return {
        fieldId,
        label: overrides.label || fieldId,
        value: overrides.value ?? null,
        source: 'default',
        confidence: 'low',
        reason: 'default value used',
        scenarioId: null
    };
}

/* ============================================================
 * Контракт результата
 * ============================================================ */

describe('buildCompletionPlan: контракт результата', () => {
    it('null calc → пустой план', () => {
        const r = buildCompletionPlan(null, {});
        assert.deepEqual(r.steps, []);
        assert.equal(r.totalSteps, 0);
        assert.deepEqual(r.sourceCounts, { errors: 0, warnings: 0, risky: 0, incomplete: 0 });
    });

    it('пустой calc + нет findings + нет assumptions + некритичные поля → пустой план', () => {
        // 'noncrit' не входит в CRITICAL_FIELDS, поэтому incomplete-шаг не создаётся.
        const calc = makeCalc({ questions: [makeQuestion('noncrit')] });
        const r = buildCompletionPlan(calc, { healthFindings: [], riskyAssumptions: [] });
        assert.equal(r.totalSteps, 0);
    });

    it('возвращает frozen-friendly steps с обязательными полями', () => {
        const calc = makeCalc({
            answers: { avg_rps: 200, peak_rps: 100 },
            questions: [makeQuestion('avg_rps'), makeQuestion('peak_rps')]
        });
        const r = buildCompletionPlan(calc, {
            healthFindings: [makeFinding('error', ['avg_rps', 'peak_rps'], {
                id: 'consistency-avg-rps-gt-peak',
                title: 'avg > peak'
            })],
            riskyAssumptions: []
        });
        assert.ok(r.steps.length > 0);
        const s = r.steps[0];
        assert.ok(typeof s.id === 'string' && s.id.length > 0);
        assert.ok(['finding', 'assumption', 'incomplete', 'master_toggle'].includes(s.kind));
        assert.ok(typeof s.priority === 'number');
        assert.ok(typeof s.title === 'string');
        assert.ok(typeof s.message === 'string');
    });
});

/* ============================================================
 * Источники и приоритеты
 * ============================================================ */

describe('buildCompletionPlan: приоритеты источников', () => {
    it('error имеет priority=1, warning=2, risky=3, incomplete=4', () => {
        const calc = makeCalc({
            answers: {},
            questions: [
                makeQuestion('peak_rps', { defaultValue: 500 }),       // critical, default → incomplete
                makeQuestion('rag_corpus_size_gb'),                    // critical, blank → incomplete
                makeQuestion('sla_target', { defaultValue: 99.9 }),    // for finding warning
                makeQuestion('rto_hours'),                             // for finding error
                makeQuestion('georedundancy_required')
            ]
        });
        const r = buildCompletionPlan(calc, {
            healthFindings: [
                makeFinding('error', ['rto_hours'], { id: 'rto-error' }),
                makeFinding('warning', ['sla_target'], { id: 'sla-warn' })
            ],
            riskyAssumptions: [
                makeAssumption('georedundancy_required', { label: 'Geo' })
            ]
        });
        // Должен быть error → warning → risky → incomplete
        assert.ok(r.steps.length >= 4);
        const priorities = r.steps.map(s => s.priority);
        for (let i = 1; i < priorities.length; i++) {
            assert.ok(priorities[i] >= priorities[i - 1],
                `шаги не отсортированы: ${priorities}`);
        }
        assert.equal(r.sourceCounts.errors, 1);
        assert.equal(r.sourceCounts.warnings, 1);
        assert.equal(r.sourceCounts.risky, 1);
        assert.ok(r.sourceCounts.incomplete >= 1);
    });

    it('error идёт раньше warning, warning раньше risky, risky раньше incomplete', () => {
        const calc = makeCalc({
            questions: [
                makeQuestion('a'), makeQuestion('b'), makeQuestion('c'), makeQuestion('peak_rps')
            ]
        });
        const r = buildCompletionPlan(calc, {
            healthFindings: [
                makeFinding('warning', ['b']),
                makeFinding('error', ['a'])
            ],
            riskyAssumptions: [makeAssumption('c')]
        });
        const fieldIds = r.steps.map(s => s.fieldId);
        // a (error) < b (warning) < c (risky) < peak_rps (incomplete)
        const idxA = fieldIds.indexOf('a');
        const idxB = fieldIds.indexOf('b');
        const idxC = fieldIds.indexOf('c');
        const idxPR = fieldIds.indexOf('peak_rps');
        assert.ok(idxA >= 0 && idxB >= 0 && idxC >= 0);
        assert.ok(idxA < idxB);
        assert.ok(idxB < idxC);
        if (idxPR >= 0) assert.ok(idxC < idxPR);
    });

    it('игнорирует findings severity=recommendation и info', () => {
        const calc = makeCalc({
            questions: [makeQuestion('a'), makeQuestion('b')]
        });
        const r = buildCompletionPlan(calc, {
            healthFindings: [
                makeFinding('recommendation', ['a']),
                makeFinding('info', ['b'])
            ],
            riskyAssumptions: []
        });
        assert.equal(r.totalSteps, 0);
    });

    it('finding без fieldIds (pricing-checks) пропускается', () => {
        const calc = makeCalc({ questions: [] });
        const r = buildCompletionPlan(calc, {
            healthFindings: [makeFinding('warning', [], { id: 'pricing-stale-bundle' })],
            riskyAssumptions: []
        });
        assert.equal(r.totalSteps, 0);
    });
});

/* ============================================================
 * Дедуп по fieldId
 * ============================================================ */

describe('buildCompletionPlan: дедуп по fieldId', () => {
    it('одно поле в нескольких источниках → один шаг с наивысшим приоритетом', () => {
        const calc = makeCalc({ questions: [makeQuestion('peak_rps')] });
        const r = buildCompletionPlan(calc, {
            healthFindings: [
                makeFinding('error', ['peak_rps'], { id: 'rule1' }),
                makeFinding('warning', ['peak_rps'], { id: 'rule2' })
            ],
            riskyAssumptions: [makeAssumption('peak_rps')]
        });
        const peakSteps = r.steps.filter(s => s.fieldId === 'peak_rps' && s.kind !== 'master_toggle');
        assert.equal(peakSteps.length, 1);
        assert.equal(peakSteps[0].priority, 1);  // error победил
        assert.equal(peakSteps[0].kind, 'finding');
    });

    it('но sourceCounts учитывает оба finding\'а до дедупа', () => {
        const calc = makeCalc({ questions: [makeQuestion('peak_rps')] });
        const r = buildCompletionPlan(calc, {
            healthFindings: [
                makeFinding('error', ['peak_rps'], { id: 'rule1' }),
                makeFinding('warning', ['peak_rps'], { id: 'rule2' })
            ],
            riskyAssumptions: []
        });
        assert.equal(r.sourceCounts.errors, 1);
        assert.equal(r.sourceCounts.warnings, 1);
    });
});

/* ============================================================
 * Сортировка внутри одного приоритета
 * ============================================================ */

describe('buildCompletionPlan: сортировка по questionnaire order', () => {
    it('внутри одного priority — порядок словаря questions', () => {
        const calc = makeCalc({
            answers: {},
            questions: [
                makeQuestion('first'),     // index 0
                makeQuestion('second'),    // index 1
                makeQuestion('third')      // index 2
            ]
        });
        const r = buildCompletionPlan(calc, {
            healthFindings: [
                makeFinding('warning', ['third']),
                makeFinding('warning', ['first']),
                makeFinding('warning', ['second'])
            ],
            riskyAssumptions: []
        });
        const ids = r.steps.map(s => s.fieldId);
        assert.deepEqual(ids, ['first', 'second', 'third']);
    });
});

/* ============================================================
 * Gated handling
 * ============================================================ */

describe('findUnmetMaster: dependsOn + master state', () => {
    it('возвращает null если у вопроса нет dependsOn', () => {
        const calc = makeCalc({ questions: [makeQuestion('a')] });
        const step = { question: makeQuestion('a') };
        assert.equal(findUnmetMaster(step, calc), null);
    });

    it('возвращает master id если он === false', () => {
        const calc = makeCalc({ answers: { ai_llm_used: false } });
        const step = { question: makeQuestion('rag_corpus_size_gb', { dependsOn: ['ai_llm_used'] }) };
        assert.equal(findUnmetMaster(step, calc), 'ai_llm_used');
    });

    it('возвращает null если master === true', () => {
        const calc = makeCalc({ answers: { ai_llm_used: true } });
        const step = { question: makeQuestion('rag_corpus_size_gb', { dependsOn: ['ai_llm_used'] }) };
        assert.equal(findUnmetMaster(step, calc), null);
    });

    it('возвращает master id если он null/undefined', () => {
        const calc = makeCalc({ answers: {} });
        const step = { question: makeQuestion('rag_corpus_size_gb', { dependsOn: ['ai_llm_used'] }) };
        assert.equal(findUnmetMaster(step, calc), 'ai_llm_used');
    });

    it('многоуровневый dependsOn: ближайший выключенный', () => {
        const calc = makeCalc({ answers: { ai_llm_used: true, rag_needed: false } });
        const step = { question: makeQuestion('rag_refresh', { dependsOn: ['ai_llm_used', 'rag_needed'] }) };
        // ai_llm_used true (skip), rag_needed false → returns 'rag_needed'
        assert.equal(findUnmetMaster(step, calc), 'rag_needed');
    });

    it('select-master со значением "none" считается выключенным', () => {
        const calc = makeCalc({ answers: { product_type: 'none' } });
        const step = { question: makeQuestion('waf_required', { dependsOn: ['product_type'] }) };
        assert.equal(findUnmetMaster(step, calc), 'product_type');
    });
});

describe('buildCompletionPlan: gated wrapping', () => {
    it('перед dependent-step добавляется master_toggle, если master выключен', () => {
        const calc = makeCalc({
            answers: { ai_llm_used: false },
            questions: [
                makeQuestion('ai_llm_used', { type: 'boolean' }),
                makeQuestion('rag_corpus_size_gb', { dependsOn: ['ai_llm_used'] })
            ]
        });
        const r = buildCompletionPlan(calc, {
            healthFindings: [makeFinding('warning', ['rag_corpus_size_gb'])],
            riskyAssumptions: []
        });
        // должно быть: master_toggle для ai_llm_used → finding для rag_corpus_size_gb
        assert.equal(r.totalSteps, 2);
        assert.equal(r.steps[0].kind, 'master_toggle');
        assert.equal(r.steps[0].fieldId, 'ai_llm_used');
        assert.equal(r.steps[1].kind, 'finding');
        assert.equal(r.steps[1].fieldId, 'rag_corpus_size_gb');
    });

    it('master_toggle НЕ добавляется, если master уже включён', () => {
        const calc = makeCalc({
            answers: { ai_llm_used: true },
            questions: [
                makeQuestion('ai_llm_used', { type: 'boolean' }),
                makeQuestion('rag_corpus_size_gb', { dependsOn: ['ai_llm_used'] })
            ]
        });
        const r = buildCompletionPlan(calc, {
            healthFindings: [makeFinding('warning', ['rag_corpus_size_gb'])],
            riskyAssumptions: []
        });
        assert.equal(r.totalSteps, 1);
        assert.equal(r.steps[0].kind, 'finding');
    });

    it('master_toggle НЕ дублируется, если master уже идёт основным шагом', () => {
        const calc = makeCalc({
            answers: { ai_llm_used: false },
            questions: [
                makeQuestion('ai_llm_used', { type: 'boolean' }),
                makeQuestion('rag_corpus_size_gb', { dependsOn: ['ai_llm_used'] })
            ]
        });
        const r = buildCompletionPlan(calc, {
            healthFindings: [
                // оба finding — error на master + warning на dependent
                makeFinding('error', ['ai_llm_used'], { id: 'master-finding' }),
                makeFinding('warning', ['rag_corpus_size_gb'], { id: 'dep-finding' })
            ],
            riskyAssumptions: []
        });
        // ai_llm_used уже сам по себе будет шагом, gated-обёртка не нужна
        const masterToggleSteps = r.steps.filter(s => s.kind === 'master_toggle');
        assert.equal(masterToggleSteps.length, 0);
        // оба обычных шага присутствуют
        assert.ok(r.steps.some(s => s.fieldId === 'ai_llm_used'));
        assert.ok(r.steps.some(s => s.fieldId === 'rag_corpus_size_gb'));
    });
});

/* ============================================================
 * Incomplete key fields
 * ============================================================ */

describe('buildCompletionPlan: incomplete key fields', () => {
    it('CRITICAL_FIELDS со значением null/undefined → шаг incomplete', () => {
        const calc = makeCalc({
            answers: { peak_rps: null, sla_target: undefined },
            questions: [
                makeQuestion('peak_rps'),
                makeQuestion('sla_target')
            ]
        });
        const r = buildCompletionPlan(calc, {
            healthFindings: [], riskyAssumptions: []
        });
        assert.ok(r.totalSteps >= 2);
        for (const s of r.steps) {
            assert.equal(s.kind, 'incomplete');
            assert.equal(s.priority, 4);
        }
    });

    it('CRITICAL_FIELDS с реальным значением (≠ defaultValue) НЕ создаёт incomplete-шаг', () => {
        const calc = makeCalc({
            answers: { peak_rps: 1234 },
            questions: [makeQuestion('peak_rps', { defaultValue: 500 })]
        });
        const r = buildCompletionPlan(calc, {
            healthFindings: [], riskyAssumptions: []
        });
        // peak_rps != defaultValue 500 → не incomplete
        const peak = r.steps.find(s => s.fieldId === 'peak_rps');
        assert.equal(peak, undefined);
    });

    it('поле НЕ из CRITICAL_FIELDS не попадает в incomplete-шаг', () => {
        const calc = makeCalc({
            answers: { random_field: null },
            questions: [makeQuestion('random_field')]
        });
        const r = buildCompletionPlan(calc, {
            healthFindings: [], riskyAssumptions: []
        });
        assert.equal(r.totalSteps, 0);
    });
});

/* ============================================================
 * Step navigation helpers
 * ============================================================ */

describe('getStepAt', () => {
    it('возвращает шаг по абсолютному индексу', () => {
        const plan = { steps: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], totalSteps: 3 };
        assert.equal(getStepAt(plan, 0).id, 'a');
        assert.equal(getStepAt(plan, 1).id, 'b');
        assert.equal(getStepAt(plan, 2).id, 'c');
    });

    it('возвращает null для out-of-range и null plan', () => {
        const plan = { steps: [{ id: 'a' }], totalSteps: 1 };
        assert.equal(getStepAt(plan, -1), null);
        assert.equal(getStepAt(plan, 5), null);
        assert.equal(getStepAt(null, 0), null);
    });
});

describe('getCompletionProgress', () => {
    it('возвращает корректные счётчики', () => {
        const plan = { steps: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], totalSteps: 4 };
        const r = getCompletionProgress(plan, ['a', 'b'], ['c']);
        assert.deepEqual(r, { completed: 2, skipped: 1, remaining: 1, total: 4 });
    });

    it('пустой plan → нули', () => {
        const r = getCompletionProgress({ steps: [], totalSteps: 0 }, [], []);
        assert.deepEqual(r, { completed: 0, skipped: 0, remaining: 0, total: 0 });
    });
});

describe('findNextActionableIndex', () => {
    it('пропускает completed и skipped, возвращает следующий', () => {
        const plan = {
            steps: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
            totalSteps: 4
        };
        assert.equal(findNextActionableIndex(plan, 0, ['a'], ['b']), 2);
        assert.equal(findNextActionableIndex(plan, 0, [], []), 0);
        assert.equal(findNextActionableIndex(plan, 2, ['c'], ['d']), -1);
    });
});
