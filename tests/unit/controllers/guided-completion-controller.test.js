/**
 * Stage 16.1 — guidedCompletionController integration tests.
 *
 * Покрывает жизненный цикл мастера: открытие, apply, skip, prev/next,
 * finish, rollback. Использует реальный store + calcController.setAnswer.
 *
 * Mock localStorage перед import'ом (storage.js делает probe при загрузке).
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let store, gc;

before(async () => {
    const m = new Map();
    globalThis.localStorage = {
        getItem: k => m.has(k) ? m.get(k) : null,
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k),
        key: i => Array.from(m.keys())[i] ?? null,
        get length() { return m.size; }
    };
    // crypto.randomUUID для uuid.js — встроен в Node 19+
    if (!globalThis.crypto) globalThis.crypto = await import('node:crypto');

    const storeModule = await import('../../../js/state/store.js');
    const gcModule    = await import('../../../js/controllers/guidedCompletionController.js');
    store = storeModule.store;
    gc    = gcModule;
});

/* ---------- Test calc factory ---------- */

function setupCalc({ answers = {}, questions = null } = {}) {
    const defaultQuestions = [
        // ai_llm_used → master для rag_corpus_size_gb
        { id: 'ai_llm_used', type: 'boolean', title: 'LLM',
            defaultValue: false, defaultIfUnknown: false },
        // rag_corpus_size_gb — gated, в CRITICAL_FIELDS
        { id: 'rag_corpus_size_gb', type: 'number', title: 'RAG corpus',
            dependsOn: ['ai_llm_used'] },
        // peak_rps — в CRITICAL_FIELDS, без default
        { id: 'peak_rps', type: 'number', title: 'Peak RPS' },
        // sla_target — в CRITICAL_FIELDS
        { id: 'sla_target', type: 'select', title: 'SLA',
            defaultValue: 99.9 }
    ];
    const calc = {
        id: 'test-' + Math.random().toString(36).slice(2, 8),
        name: 'Test calc',
        schemaVersion: 12,
        answers: { ...answers },
        answersMeta: {},
        settings: { applyRiskFactors: true },
        dictionaries: {
            questions: questions || defaultQuestions,
            items: [],
            settings: {}
        },
        view: {}
    };
    store.setActiveCalc(calc);
    return calc;
}

function ui() { return store.getState().ui?.guidedCompletion; }

/* ============================================================
 * openGuidedCompletion
 * ============================================================ */

describe('openGuidedCompletion', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ guidedCompletion: null });
    });

    it('открывает модалку и пишет transient state', () => {
        setupCalc({ answers: {} });
        gc.openGuidedCompletion();
        const state = store.getState();
        assert.equal(state.modals.guidedCompletion.open, true);
        const u = state.ui.guidedCompletion;
        assert.ok(u);
        assert.equal(u.active, true);
        assert.equal(typeof u.startScore, 'number');
        assert.ok(u.snapshot);
        assert.ok(u.plan);
        assert.equal(u.currentIndex, 0);
        assert.deepEqual(u.completedStepIds, []);
        assert.deepEqual(u.skippedStepIds, []);
    });

    it('snapshot содержит полную копию answers/answersMeta/settings', () => {
        setupCalc({ answers: { peak_rps: 1000 } });
        gc.openGuidedCompletion();
        const u = ui();
        assert.equal(u.snapshot.answers.peak_rps, 1000);
        // Snapshot не должен ссылаться на тот же объект, что и activeCalc.answers
        // (если бы был reference-shared, любая правка через setAnswer ниже
        // отразилась бы в snapshot и rollback стал бы no-op).
        gc.applyGuidedAnswer(2500);
        // applyGuidedAnswer изменил activeCalc.answers, но snapshot должен
        // остаться с прежним значением.
        const u2 = ui();
        assert.equal(u2.snapshot.answers.peak_rps, 1000,
            'snapshot должен сохранить исходное значение peak_rps=1000');
    });

    it('без активного calc — no-op (модалка не открывается)', () => {
        store.setActiveCalc(null);
        gc.openGuidedCompletion();
        assert.notEqual(store.getState().modals.guidedCompletion.open, true);
        assert.equal(store.getState().ui.guidedCompletion, null);
    });

    it('открывает модалку даже при пустом плане (UI покажет empty-state)', () => {
        // Расчёт с заполненными CRITICAL_FIELDS и без findings → plan пустой.
        setupCalc({
            answers: {
                peak_rps: 5000, sla_target: 99.95, pcu_target: 200, avg_rps: 1000,
                db_size_initial_gb: 100, db_replicas_count: 2,
                file_storage_volume_tb: 1, georedundancy_required: true,
                ai_users_share: 0.3, ai_requests_per_user_day: 10,
                ai_avg_input_tokens: 500, ai_avg_output_tokens: 1500,
                rag_corpus_size_gb: 10, pdn_152fz: false, product_type: 'b2b'
            }
        });
        gc.openGuidedCompletion();
        assert.equal(store.getState().modals.guidedCompletion.open, true);
    });
});

/* ============================================================
 * applyGuidedAnswer
 * ============================================================ */

describe('applyGuidedAnswer', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ guidedCompletion: null });
    });

    it('применяет ответ через setAnswer и помечает шаг completed', () => {
        setupCalc({ answers: {} });
        gc.openGuidedCompletion();
        const before = ui();
        const step = before.plan.steps[before.currentIndex];
        if (!step) return;  // нет шагов — ничего не тестируем
        const targetField = step.fieldId;

        gc.applyGuidedAnswer(123);

        const after = store.getState();
        // Ответ записан в calc.answers
        assert.equal(after.activeCalc.answers[targetField], 123);
        // Шаг помечен completed
        assert.ok(after.ui.guidedCompletion.completedStepIds.includes(step.id));
        // currentIndex продвинулся (или = total если шагов больше нет)
        assert.ok(after.ui.guidedCompletion.currentIndex > before.currentIndex
            || after.ui.guidedCompletion.currentIndex === before.plan.totalSteps);
    });

    it('без активного мастера — no-op', () => {
        setupCalc({ answers: { peak_rps: 100 } });
        // не открываем мастер
        gc.applyGuidedAnswer(999);
        // peak_rps не изменился
        assert.equal(store.getState().activeCalc.answers.peak_rps, 100);
    });
});

/* ============================================================
 * skipGuidedStep
 * ============================================================ */

describe('skipGuidedStep', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ guidedCompletion: null });
    });

    it('добавляет step.id в skippedStepIds, продвигает индекс', () => {
        setupCalc({ answers: {} });
        gc.openGuidedCompletion();
        const before = ui();
        const step = before.plan.steps[before.currentIndex];
        if (!step) return;

        gc.skipGuidedStep();

        const after = ui();
        assert.ok(after.skippedStepIds.includes(step.id));
        assert.equal(after.completedStepIds.length, 0);
    });

    it('skipped поле НЕ изменено в calc.answers', () => {
        setupCalc({ answers: { peak_rps: 100 } });
        gc.openGuidedCompletion();
        gc.skipGuidedStep();
        // peak_rps — критичное и без default, шаг был incomplete; после skip
        // значение НЕ должно поменяться
        assert.equal(store.getState().activeCalc.answers.peak_rps, 100);
    });
});

/* ============================================================
 * goPrevGuidedStep
 * ============================================================ */

describe('goPrevGuidedStep', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ guidedCompletion: null });
    });

    it('возвращает на предыдущий шаг', () => {
        setupCalc({ answers: {} });
        gc.openGuidedCompletion();
        if (ui().plan.totalSteps < 2) return;
        gc.skipGuidedStep();
        const afterSkip = ui();
        if (afterSkip.currentIndex === 0) return;
        const prevIndex = afterSkip.currentIndex;
        gc.goPrevGuidedStep();
        const afterPrev = ui();
        assert.equal(afterPrev.currentIndex, prevIndex - 1);
    });

    it('на нулевом шаге — no-op', () => {
        setupCalc({ answers: {} });
        gc.openGuidedCompletion();
        if (ui().plan.totalSteps === 0) return;
        gc.goPrevGuidedStep();
        assert.equal(ui().currentIndex, 0);
    });
});

/* ============================================================
 * finishGuidedCompletion
 * ============================================================ */

describe('finishGuidedCompletion', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ guidedCompletion: null });
    });

    it('закрывает модалку и очищает transient state', () => {
        setupCalc({ answers: {} });
        gc.openGuidedCompletion();
        assert.equal(store.getState().modals.guidedCompletion.open, true);
        gc.finishGuidedCompletion();
        assert.notEqual(store.getState().modals.guidedCompletion.open, true);
        assert.equal(store.getState().ui.guidedCompletion, null);
    });

    it('применённые изменения сохраняются (НЕ откатываются)', () => {
        setupCalc({ answers: { peak_rps: 100 } });
        gc.openGuidedCompletion();
        // выберем первый шаг с fieldId='peak_rps' если есть, иначе пропустим
        const u = ui();
        const peakStep = u.plan.steps.find(s => s.fieldId === 'peak_rps');
        if (!peakStep) return;
        // переход к шагу peak_rps + apply
        gc.gotoGuidedStep(u.plan.steps.indexOf(peakStep));
        gc.applyGuidedAnswer(2500);
        gc.finishGuidedCompletion();
        // Значение осталось в calc.answers
        assert.equal(store.getState().activeCalc.answers.peak_rps, 2500);
    });
});

/* ============================================================
 * rollbackGuidedCompletion
 * ============================================================ */

describe('rollbackGuidedCompletion', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ guidedCompletion: null });
    });

    it('восстанавливает answers из snapshot и закрывает модалку', () => {
        setupCalc({ answers: { peak_rps: 100, sla_target: 99.9 } });
        gc.openGuidedCompletion();
        const u = ui();
        const peakStep = u.plan.steps.find(s => s.fieldId === 'peak_rps');
        if (!peakStep) return;
        gc.gotoGuidedStep(u.plan.steps.indexOf(peakStep));
        gc.applyGuidedAnswer(2500);
        // peak_rps изменился
        assert.equal(store.getState().activeCalc.answers.peak_rps, 2500);

        gc.rollbackGuidedCompletion();

        // Откат: peak_rps вернулся к 100
        assert.equal(store.getState().activeCalc.answers.peak_rps, 100);
        // Модалка закрыта
        assert.notEqual(store.getState().modals.guidedCompletion.open, true);
        // Transient state очищен
        assert.equal(store.getState().ui.guidedCompletion, null);
    });

    it('без активного мастера — просто закрывает модалку', () => {
        store.openModal('guidedCompletion');
        gc.rollbackGuidedCompletion();
        assert.notEqual(store.getState().modals.guidedCompletion.open, true);
    });
});

/* ============================================================
 * gotoGuidedStep
 * ============================================================ */

describe('gotoGuidedStep', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ guidedCompletion: null });
    });

    it('clamp в диапазон [0..totalSteps-1]', () => {
        setupCalc({ answers: {} });
        gc.openGuidedCompletion();
        const total = ui().plan.totalSteps;
        if (total === 0) return;
        gc.gotoGuidedStep(-100);
        assert.equal(ui().currentIndex, 0);
        gc.gotoGuidedStep(9999);
        assert.equal(ui().currentIndex, total - 1);
    });
});
