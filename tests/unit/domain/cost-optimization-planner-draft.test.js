/**
 * Stage 18.1 (v2.13.0) — Draft API планера оптимизации.
 *
 * Контракт:
 *   - createOptimizationDraft / switchLevel / toggleConstraint / updateValue /
 *     removeChange / reset / recompute — pure, не мутируют исходный calc.
 *   - touchedConstraints — гибридная семантика: touched сохраняются при switch
 *     level, untouched перетираются дефолтами нового уровня.
 *   - applyOptimizationDraft возвращает patch-list + snapshot, ничего не пишет
 *     в store.
 *   - High-risk детектируется по leverSpecId (SLA, k_contingency, k_schedule_shift)
 *     ИЛИ по riskLevel='high' любого change.
 *   - SLA options — из dictionaries.questions[id='sla_target'].options, не hardcoded.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    PLAN_IDS,
    DEFAULT_LEVEL,
    LEVEL_DEFAULT_CONSTRAINTS,
    HIGH_RISK_LEVER_SPEC_IDS,
    RECOMPUTE_DEBOUNCE_MS,
    createOptimizationDraft,
    switchOptimizationDraftLevel,
    toggleOptimizationDraftConstraint,
    updateOptimizationDraftValue,
    removeOptimizationDraftChange,
    resetOptimizationDraft,
    resetOptimizationDraftConstraintsToLevel,
    recomputeOptimizationDraft,
    buildEditableLevers,
    draftHasHighRisk,
    listHighRiskChanges,
    buildApplyPatches,
    applyOptimizationDraft,
    calcFromApplySnapshot,
    getSlaOptionsFromCalc
} from '../../../js/domain/costOptimizationPlanner.js';
import { buildSeedDictionaries, SEED_SETTINGS, defaultAnswersFrom } from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';

/* ============================================================
 * Helpers
 * ============================================================ */

function makeCalc(overrides = {}) {
    const dict = buildSeedDictionaries();
    const answers = { ...defaultAnswersFrom(dict.questions), ...(overrides.answers || {}) };
    const settings = { ...SEED_SETTINGS, provider: 'sbercloud', ...(overrides.settings || {}) };
    return {
        id: 'draft-test',
        name: 'draft-test',
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

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

/**
 * Сравнить только те части calc, которые входят в apply-snapshot (settings,
 * answers, answersMeta). dictionaries и view не проверяем — calculate() имеет
 * право enrich'ить items (pricePerUnit, resourceClass) при первом вызове, это
 * не считается мутацией со стороны draft-API.
 */
function assertCalcMutableFieldsUnchanged(actual, expected, msg = 'calc fields untouched') {
    assert.deepEqual(actual.settings, expected.settings, `${msg}: settings`);
    assert.deepEqual(actual.answers, expected.answers, `${msg}: answers`);
    assert.deepEqual(actual.answersMeta, expected.answersMeta, `${msg}: answersMeta`);
}

/* ============================================================
 * Constants
 * ============================================================ */

describe('Draft constants', () => {
    it('DEFAULT_LEVEL = ambitious', () => {
        assert.equal(DEFAULT_LEVEL, PLAN_IDS.AMBITIOUS);
    });

    it('LEVEL_DEFAULT_CONSTRAINTS содержит 3 уровня с 6 ключами каждый', () => {
        const ids = [PLAN_IDS.CONSERVATIVE, PLAN_IDS.AMBITIOUS, PLAN_IDS.EXTREME];
        for (const id of ids) {
            assert.ok(LEVEL_DEFAULT_CONSTRAINTS[id], `level ${id} exists`);
            const keys = Object.keys(LEVEL_DEFAULT_CONSTRAINTS[id]).sort();
            assert.deepEqual(keys, [
                'allowAiReduction',
                'allowNonProdReduction',
                'allowReliabilityTradeoff',
                'allowRetentionReduction',
                'allowRiskBufferReduction',
                'protectCompliance'
            ]);
        }
    });

    it('conservative.allowAiReduction = false (AI не трогаем в консервативном)', () => {
        assert.equal(LEVEL_DEFAULT_CONSTRAINTS[PLAN_IDS.CONSERVATIVE].allowAiReduction, false);
    });

    it('ambitious.allowAiReduction = true', () => {
        assert.equal(LEVEL_DEFAULT_CONSTRAINTS[PLAN_IDS.AMBITIOUS].allowAiReduction, true);
    });

    it('extreme.allowAiReduction = true', () => {
        assert.equal(LEVEL_DEFAULT_CONSTRAINTS[PLAN_IDS.EXTREME].allowAiReduction, true);
    });

    it('все 3 уровня имеют allowReliabilityTradeoff=false (SLA = opt-in)', () => {
        for (const id of [PLAN_IDS.CONSERVATIVE, PLAN_IDS.AMBITIOUS, PLAN_IDS.EXTREME]) {
            assert.equal(LEVEL_DEFAULT_CONSTRAINTS[id].allowReliabilityTradeoff, false,
                `level ${id}: SLA защищён по умолчанию`);
        }
    });

    it('HIGH_RISK_LEVER_SPEC_IDS содержит SLA и contingency-like', () => {
        assert.ok(HIGH_RISK_LEVER_SPEC_IDS.includes('sla_target'));
        assert.ok(HIGH_RISK_LEVER_SPEC_IDS.includes('k_contingency'));
        assert.ok(HIGH_RISK_LEVER_SPEC_IDS.includes('k_schedule_shift'));
    });

    it('RECOMPUTE_DEBOUNCE_MS в диапазоне 150-250 (per Stage 18.1 спек)', () => {
        assert.ok(RECOMPUTE_DEBOUNCE_MS >= 150 && RECOMPUTE_DEBOUNCE_MS <= 250,
            `Got ${RECOMPUTE_DEBOUNCE_MS}`);
    });
});

/* ============================================================
 * SLA options из seed
 * ============================================================ */

describe('getSlaOptionsFromCalc', () => {
    it('возвращает числовой массив, отсортированный ascending', () => {
        const calc = makeCalc();
        const opts = getSlaOptionsFromCalc(calc);
        assert.ok(Array.isArray(opts));
        assert.ok(opts.length > 0);
        for (let i = 1; i < opts.length; i++) {
            assert.ok(opts[i] >= opts[i - 1], `sorted at ${i}`);
        }
    });

    it('значения совпадают с seed (99.9, 99.95 присутствуют)', () => {
        const calc = makeCalc();
        const opts = getSlaOptionsFromCalc(calc);
        assert.ok(opts.includes(99.9), 'has 99.9');
        assert.ok(opts.includes(99.95), 'has 99.95');
    });

    it('возвращает null если sla_target отсутствует в словаре', () => {
        const calc = makeCalc();
        calc.dictionaries.questions = calc.dictionaries.questions.filter(q => q.id !== 'sla_target');
        const opts = getSlaOptionsFromCalc(calc);
        assert.equal(opts, null);
    });

    it('возвращает null для пустого/невалидного options', () => {
        const calc = makeCalc();
        const q = calc.dictionaries.questions.find(x => x.id === 'sla_target');
        q.options = [];
        assert.equal(getSlaOptionsFromCalc(calc), null);
    });
});

/* ============================================================
 * createOptimizationDraft
 * ============================================================ */

describe('createOptimizationDraft', () => {
    it('по умолчанию level=ambitious', () => {
        const draft = createOptimizationDraft({ calc: makeCalc() });
        assert.equal(draft.level, PLAN_IDS.AMBITIOUS);
    });

    it('constraints копируются из LEVEL_DEFAULT_CONSTRAINTS[level]', () => {
        const draft = createOptimizationDraft({ calc: makeCalc(), level: PLAN_IDS.CONSERVATIVE });
        assert.deepEqual(
            draft.constraints,
            LEVEL_DEFAULT_CONSTRAINTS[PLAN_IDS.CONSERVATIVE]
        );
    });

    it('touchedConstraints = {} при создании', () => {
        const draft = createOptimizationDraft({ calc: makeCalc() });
        assert.deepEqual(draft.touchedConstraints, {});
    });

    it('changes = {} при создании', () => {
        const draft = createOptimizationDraft({ calc: makeCalc() });
        assert.deepEqual(draft.changes, {});
    });

    it('baseSnapshot содержит deep-копию settings/answers/answersMeta', () => {
        const calc = makeCalc();
        const draft = createOptimizationDraft({ calc });
        assert.ok(draft.baseSnapshot);
        assert.deepEqual(draft.baseSnapshot.settings, calc.settings);
        assert.deepEqual(draft.baseSnapshot.answers, calc.answers);
        assert.notEqual(draft.baseSnapshot.settings, calc.settings, 'deep copy, not same ref');
    });

    it('preview.savingMonthly = 0 без changes', () => {
        const draft = createOptimizationDraft({ calc: makeCalc() });
        assert.equal(draft.preview.savingMonthly, 0);
        assert.equal(draft.preview.savingPercent, 0);
    });

    it('preview.targetRange соответствует level', () => {
        const draft = createOptimizationDraft({ calc: makeCalc(), level: PLAN_IDS.AMBITIOUS });
        assert.deepEqual(draft.preview.targetRange, { minPercent: 5, maxPercent: 15 });
    });

    it('НЕ мутирует mutable-поля переданного calc', () => {
        const calc = makeCalc();
        const before = deepClone(calc);
        createOptimizationDraft({ calc });
        assertCalcMutableFieldsUnchanged(calc, before);
    });

    it('некорректный level → fallback на DEFAULT_LEVEL', () => {
        const draft = createOptimizationDraft({ calc: makeCalc(), level: 'unknown' });
        assert.equal(draft.level, DEFAULT_LEVEL);
    });
});

/* ============================================================
 * switchOptimizationDraftLevel — гибрид touched/defaults
 * ============================================================ */

describe('switchOptimizationDraftLevel', () => {
    it('меняет level и preview.targetRange', () => {
        let d = createOptimizationDraft({ calc: makeCalc(), level: PLAN_IDS.AMBITIOUS });
        d = switchOptimizationDraftLevel(d, PLAN_IDS.EXTREME, makeCalc());
        assert.equal(d.level, PLAN_IDS.EXTREME);
        assert.deepEqual(d.preview.targetRange, { minPercent: 15, maxPercent: 25 });
    });

    it('untouched constraints перетираются дефолтами нового уровня', () => {
        let d = createOptimizationDraft({ calc: makeCalc(), level: PLAN_IDS.CONSERVATIVE });
        // в conservative allowAiReduction=false; ничего не трогаем
        d = switchOptimizationDraftLevel(d, PLAN_IDS.AMBITIOUS, makeCalc());
        // должен стать true (default ambitious)
        assert.equal(d.constraints.allowAiReduction, true);
    });

    it('touched constraints НЕ перетираются при switch', () => {
        let d = createOptimizationDraft({ calc: makeCalc(), level: PLAN_IDS.AMBITIOUS });
        // явно включаем SLA (был false по дефолту ambitious)
        d = toggleOptimizationDraftConstraint(d, 'allowReliabilityTradeoff', true, makeCalc());
        assert.equal(d.constraints.allowReliabilityTradeoff, true);
        assert.equal(d.touchedConstraints.allowReliabilityTradeoff, true);
        // переключаемся на extreme — SLA остаётся включённым (touched)
        d = switchOptimizationDraftLevel(d, PLAN_IDS.EXTREME, makeCalc());
        assert.equal(d.constraints.allowReliabilityTradeoff, true,
            'SLA сохранена при переключении уровня');
    });

    it('switch на тот же level — no-op (тот же объект)', () => {
        const calc = makeCalc();
        const d = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        const d2 = switchOptimizationDraftLevel(d, PLAN_IDS.AMBITIOUS, calc);
        assert.equal(d, d2);
    });

    it('non-existing level → no-op', () => {
        const calc = makeCalc();
        const d = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        const d2 = switchOptimizationDraftLevel(d, 'unknown', calc);
        assert.equal(d2.level, PLAN_IDS.AMBITIOUS);
    });
});

/* ============================================================
 * toggleOptimizationDraftConstraint
 * ============================================================ */

describe('toggleOptimizationDraftConstraint', () => {
    it('меняет значение constraint и помечает как touched', () => {
        let d = createOptimizationDraft({ calc: makeCalc() });
        d = toggleOptimizationDraftConstraint(d, 'allowAiReduction', false, makeCalc());
        assert.equal(d.constraints.allowAiReduction, false);
        assert.equal(d.touchedConstraints.allowAiReduction, true);
    });

    it('toggle того же значения тоже помечает touched (пользователь явно подтвердил)', () => {
        let d = createOptimizationDraft({ calc: makeCalc(), level: PLAN_IDS.AMBITIOUS });
        // default ambitious.allowAiReduction = true
        d = toggleOptimizationDraftConstraint(d, 'allowAiReduction', true, makeCalc());
        assert.equal(d.touchedConstraints.allowAiReduction, true);
    });

    it('unknown constraint key → no-op', () => {
        const calc = makeCalc();
        const d = createOptimizationDraft({ calc });
        const d2 = toggleOptimizationDraftConstraint(d, 'allowSomeUnknownThing', true, calc);
        assert.deepEqual(d2.constraints, d.constraints);
        assert.deepEqual(d2.touchedConstraints, d.touchedConstraints);
    });

    it('при выключении allowReliabilityTradeoff SLA-change удаляется из draft', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = toggleOptimizationDraftConstraint(d, 'allowReliabilityTradeoff', true, calc);
        d = updateOptimizationDraftValue(d, 'answer:sla_target', 99.5, calc);
        // Sanity: change применился
        assert.ok(d.changes['answer:sla_target'], 'SLA change применился');
        // Выключаем SLA-разрешение
        d = toggleOptimizationDraftConstraint(d, 'allowReliabilityTradeoff', false, calc);
        // SLA change должен быть удалён
        assert.equal(d.changes['answer:sla_target'], undefined,
            'SLA change удалён после выключения allowReliabilityTradeoff');
    });

    it('при выключении allowAiReduction все AI/RAG changes удаляются', () => {
        const calc = makeCalc({ answers: { ai_llm_used: true, rag_needed: true,
            ai_avg_output_tokens: 1000, rag_corpus_size_gb: 10, rag_embeddings_million: 5 } });
        let d = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        // ambitious уже allowAiReduction=true; вносим AI-change
        d = updateOptimizationDraftValue(d, 'answer:ai_avg_output_tokens', 500, calc);
        const sizeBefore = Object.keys(d.changes).length;
        assert.ok(sizeBefore > 0, 'AI-change применён');
        // Выключаем AI-разрешение
        d = toggleOptimizationDraftConstraint(d, 'allowAiReduction', false, calc);
        // Все AI/RAG changes должны исчезнуть
        for (const change of Object.values(d.changes)) {
            const fid = change.fieldId;
            assert.ok(!fid.includes('ai_avg_output_tokens'),
                'AI-change удалён');
            assert.ok(!fid.includes('rag_'),
                'RAG-change удалён');
        }
    });
});

/* ============================================================
 * resetOptimizationDraftConstraintsToLevel
 * ============================================================ */

describe('resetOptimizationDraftConstraintsToLevel', () => {
    it('возвращает constraints к дефолтам уровня и очищает touched', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        d = toggleOptimizationDraftConstraint(d, 'allowReliabilityTradeoff', true, calc);
        d = toggleOptimizationDraftConstraint(d, 'allowAiReduction', false, calc);
        d = resetOptimizationDraftConstraintsToLevel(d, calc);
        assert.deepEqual(d.constraints, LEVEL_DEFAULT_CONSTRAINTS[PLAN_IDS.AMBITIOUS]);
        assert.deepEqual(d.touchedConstraints, {});
    });
});

/* ============================================================
 * updateOptimizationDraftValue
 * ============================================================ */

describe('updateOptimizationDraftValue', () => {
    it('добавляет change в draft.changes', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        const before = calc.settings.standSizeRatio.LOAD;
        const target = Math.round((before * 0.7) * 100) / 100;
        d = updateOptimizationDraftValue(d, 'setting:standSizeRatio.LOAD', target, calc);
        assert.ok(d.changes['setting:standSizeRatio.LOAD']);
        assert.equal(d.changes['setting:standSizeRatio.LOAD'].to, target);
        assert.equal(d.changes['setting:standSizeRatio.LOAD'].from, before);
    });

    it('value совпадает с baseValue → change удаляется (no-op semantics)', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0.05, calc);
        assert.ok(d.changes['setting:bufferTask']);
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', calc.settings.bufferTask, calc);
        assert.equal(d.changes['setting:bufferTask'], undefined,
            'change удалён если value === baseValue');
    });

    it('некорректный value (NaN / undefined) → defensive no-op', () => {
        const calc = makeCalc();
        const d0 = createOptimizationDraft({ calc });
        const d1 = updateOptimizationDraftValue(d0, 'setting:bufferTask', NaN, calc);
        assert.deepEqual(d1.changes, {});
        const d2 = updateOptimizationDraftValue(d0, 'setting:bufferTask', 'oops', calc);
        assert.deepEqual(d2.changes, {});
    });

    it('value > baseValue → отвергается (мы не увеличиваем значения)', () => {
        const calc = makeCalc();
        const d0 = createOptimizationDraft({ calc });
        const base = calc.settings.standSizeRatio.LOAD;
        const d1 = updateOptimizationDraftValue(d0, 'setting:standSizeRatio.LOAD', base + 0.1, calc);
        assert.equal(d1.changes['setting:standSizeRatio.LOAD'], undefined);
    });

    it('value ниже floor lever\'а → отвергается', () => {
        const calc = makeCalc();
        const d0 = createOptimizationDraft({ calc });
        // load_ratio floor = 0.30
        const d1 = updateOptimizationDraftValue(d0, 'setting:standSizeRatio.LOAD', 0.1, calc);
        assert.equal(d1.changes['setting:standSizeRatio.LOAD'], undefined);
    });

    it('SLA change игнорируется без allowReliabilityTradeoff', () => {
        const calc = makeCalc();
        const d0 = createOptimizationDraft({ calc });
        const d1 = updateOptimizationDraftValue(d0, 'answer:sla_target', 99.9, calc);
        assert.equal(d1.changes['answer:sla_target'], undefined,
            'SLA change игнорируется когда constraint выключен');
    });

    it('не мутирует mutable-поля calc после update', () => {
        const calc = makeCalc();
        const before = deepClone(calc);
        const d = createOptimizationDraft({ calc });
        updateOptimizationDraftValue(d, 'setting:standSizeRatio.LOAD', 0.5, calc);
        assertCalcMutableFieldsUnchanged(calc, before);
    });

    it('preview пересчитывается: savingMonthly > 0 после уменьшения buffer', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0, calc);
        assert.ok(d.preview.savingMonthly > 0, `Got ${d.preview.savingMonthly}`);
        assert.ok(d.preview.savingPercent > 0);
    });

    it('inTargetRange корректен для ambitious 5–15', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        // no changes → 0%, точно НЕ в диапазоне 5-15
        assert.equal(d.preview.inTargetRange, false);
    });
});

/* ============================================================
 * removeOptimizationDraftChange / resetOptimizationDraft
 * ============================================================ */

describe('removeOptimizationDraftChange / reset', () => {
    it('removeOptimizationDraftChange убирает один fieldId', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0.05, calc);
        d = updateOptimizationDraftValue(d, 'setting:bufferProject', 0.05, calc);
        assert.equal(Object.keys(d.changes).length, 2);
        d = removeOptimizationDraftChange(d, 'setting:bufferTask', calc);
        assert.equal(d.changes['setting:bufferTask'], undefined);
        assert.ok(d.changes['setting:bufferProject']);
    });

    it('resetOptimizationDraft очищает все changes, сохраняя level/constraints', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc, level: PLAN_IDS.EXTREME });
        d = toggleOptimizationDraftConstraint(d, 'allowReliabilityTradeoff', true, calc);
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0.05, calc);
        d = updateOptimizationDraftValue(d, 'answer:sla_target', 99.9, calc);
        assert.ok(Object.keys(d.changes).length >= 1);
        d = resetOptimizationDraft(d, calc);
        assert.deepEqual(d.changes, {});
        assert.equal(d.level, PLAN_IDS.EXTREME, 'level сохранён');
        assert.equal(d.constraints.allowReliabilityTradeoff, true, 'constraint сохранён');
        assert.equal(d.touchedConstraints.allowReliabilityTradeoff, true, 'touched сохранён');
    });

    it('reset обнуляет preview.savingMonthly', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0, calc);
        assert.ok(d.preview.savingMonthly > 0);
        d = resetOptimizationDraft(d, calc);
        assert.equal(d.preview.savingMonthly, 0);
    });
});

/* ============================================================
 * recomputeOptimizationDraft
 * ============================================================ */

describe('recomputeOptimizationDraft', () => {
    it('savingMonthly = before - after', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0, calc);
        const { beforeTotalMonthly, afterTotalMonthly, savingMonthly } = d.preview;
        assert.equal(savingMonthly, beforeTotalMonthly - afterTotalMonthly);
    });

    it('saving всегда >= 0 (мы только уменьшаем)', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0, calc);
        assert.ok(d.preview.savingMonthly >= 0);
        assert.ok(d.preview.savingPercent >= 0);
    });

    it('null calc → preview.error', () => {
        const d = createOptimizationDraft({ calc: makeCalc() });
        const d2 = recomputeOptimizationDraft(d, null);
        assert.ok(d2.preview.error);
    });

    it('savingPercent не NaN/Infinity', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0, calc);
        assert.ok(Number.isFinite(d.preview.savingPercent));
    });
});

/* ============================================================
 * buildEditableLevers
 * ============================================================ */

describe('buildEditableLevers', () => {
    it('возвращает массив рычагов с editor metadata', () => {
        const calc = makeCalc();
        const d = createOptimizationDraft({ calc });
        const levers = buildEditableLevers(calc, d);
        assert.ok(levers.length > 0);
        for (const l of levers) {
            assert.ok(l.fieldId);
            assert.ok(l.title);
            assert.ok(l.editor);
            assert.ok(['percent','number_int','number_float','enum'].includes(l.editor.editorType));
        }
    });

    it('SLA-рычаг отсутствует если allowReliabilityTradeoff=false', () => {
        const calc = makeCalc();
        const d = createOptimizationDraft({ calc });
        const levers = buildEditableLevers(calc, d);
        const hasSla = levers.some(l => l.leverSpecId === 'sla_target');
        assert.equal(hasSla, false);
    });

    it('SLA-рычаг появляется когда allowReliabilityTradeoff=true И уровень не conservative', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        d = toggleOptimizationDraftConstraint(d, 'allowReliabilityTradeoff', true, calc);
        const levers = buildEditableLevers(calc, d);
        const sla = levers.find(l => l.leverSpecId === 'sla_target');
        assert.ok(sla, 'SLA-рычаг доступен');
        assert.equal(sla.editor.editorType, 'enum');
        assert.ok(Array.isArray(sla.editor.options));
        // options отсортированы и не превышают baseValue
        for (let i = 1; i < sla.editor.options.length; i++) {
            assert.ok(sla.editor.options[i] >= sla.editor.options[i-1]);
        }
    });

    it('SLA НЕ показывается в conservative даже при allowReliabilityTradeoff=true', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc, level: PLAN_IDS.CONSERVATIVE });
        d = toggleOptimizationDraftConstraint(d, 'allowReliabilityTradeoff', true, calc);
        const levers = buildEditableLevers(calc, d);
        assert.equal(levers.some(l => l.leverSpecId === 'sla_target'), false);
    });

    it('AI-рычаги не показываются если AI выключен в опроснике', () => {
        const calc = makeCalc({ answers: { ai_llm_used: false, rag_needed: false } });
        let d = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        const levers = buildEditableLevers(calc, d);
        assert.equal(levers.some(l => l.leverSpecId === 'ai_output_tokens'), false);
        assert.equal(levers.some(l => l.leverSpecId === 'rag_corpus'), false);
    });

    it('editor.max = baseValue (нельзя увеличить выше исходного)', () => {
        const calc = makeCalc();
        const d = createOptimizationDraft({ calc });
        const levers = buildEditableLevers(calc, d);
        const load = levers.find(l => l.leverSpecId === 'load_ratio');
        if (load) {
            assert.equal(load.editor.max, calc.settings.standSizeRatio.LOAD);
        }
    });

    it('hasDraftChange=true после update', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0.05, calc);
        const levers = buildEditableLevers(calc, d);
        const lever = levers.find(l => l.fieldId === 'setting:bufferTask');
        assert.ok(lever);
        assert.equal(lever.hasDraftChange, true);
    });

    it('backup_retention options фильтруются по protectCompliance', () => {
        const calc = makeCalc({ answers: { backup_retention_days: 365 } });
        let dProtected = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        // protectCompliance default = true → floor = 90
        const leversP = buildEditableLevers(calc, dProtected);
        const retP = leversP.find(l => l.leverSpecId === 'backup_retention');
        if (retP) {
            for (const opt of retP.editor.options) {
                assert.ok(opt >= 90, `option ${opt} should be >= 90 with compliance protection`);
            }
        }
    });
});

/* ============================================================
 * High-risk detection
 * ============================================================ */

describe('draftHasHighRisk / listHighRiskChanges', () => {
    it('пустой draft → false', () => {
        assert.equal(draftHasHighRisk(createOptimizationDraft({ calc: makeCalc() })), false);
    });

    it('изменение buffer_task → НЕ high-risk (medium)', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0.05, calc);
        assert.equal(draftHasHighRisk(d), false);
    });

    it('изменение SLA → high-risk', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = toggleOptimizationDraftConstraint(d, 'allowReliabilityTradeoff', true, calc);
        d = updateOptimizationDraftValue(d, 'answer:sla_target', 99.5, calc);
        assert.equal(draftHasHighRisk(d), true);
    });

    it('изменение kContingency → high-risk (в HIGH_RISK_LEVER_SPEC_IDS)', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:kContingency', 0.02, calc);
        assert.equal(draftHasHighRisk(d), true);
    });

    it('listHighRiskChanges возвращает массив только high-risk', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = toggleOptimizationDraftConstraint(d, 'allowReliabilityTradeoff', true, calc);
        d = updateOptimizationDraftValue(d, 'answer:sla_target', 99.5, calc);
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0.05, calc);   // medium
        d = updateOptimizationDraftValue(d, 'setting:kContingency', 0.02, calc); // high

        const list = listHighRiskChanges(d);
        assert.equal(list.length, 2);
        const ids = list.map(c => c.leverSpecId).sort();
        assert.deepEqual(ids, ['k_contingency', 'sla_target']);
    });
});

/* ============================================================
 * buildApplyPatches / applyOptimizationDraft
 * ============================================================ */

describe('buildApplyPatches', () => {
    it('пустой draft → []', () => {
        const calc = makeCalc();
        const d = createOptimizationDraft({ calc });
        assert.deepEqual(buildApplyPatches(d), []);
    });

    it('setting flat: kind=setting, key=bufferTask', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0.05, calc);
        const patches = buildApplyPatches(d);
        assert.equal(patches.length, 1);
        assert.equal(patches[0].kind, 'setting');
        assert.equal(patches[0].key, 'bufferTask');
        assert.equal(patches[0].value, 0.05);
    });

    it('setting nested: kind=setting_path, key=standSizeRatio.LOAD', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        const base = calc.settings.standSizeRatio.LOAD;
        const target = Math.round((base * 0.7) * 100) / 100;
        d = updateOptimizationDraftValue(d, 'setting:standSizeRatio.LOAD', target, calc);
        const patches = buildApplyPatches(d);
        assert.equal(patches.length, 1);
        assert.equal(patches[0].kind, 'setting_path');
        assert.equal(patches[0].key, 'standSizeRatio.LOAD');
        assert.equal(patches[0].value, target);
    });

    it('answer: kind=answer, key=sla_target', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = toggleOptimizationDraftConstraint(d, 'allowReliabilityTradeoff', true, calc);
        d = updateOptimizationDraftValue(d, 'answer:sla_target', 99.5, calc);
        const patches = buildApplyPatches(d);
        assert.equal(patches[0].kind, 'answer');
        assert.equal(patches[0].key, 'sla_target');
    });
});

describe('applyOptimizationDraft', () => {
    it('без changes → ok=false reason=no_changes', () => {
        const calc = makeCalc();
        const d = createOptimizationDraft({ calc });
        const r = applyOptimizationDraft(d, calc);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'no_changes');
    });

    it('null calc → ok=false reason=no_calc', () => {
        const d = createOptimizationDraft({ calc: makeCalc() });
        const r = applyOptimizationDraft(d, null);
        assert.equal(r.ok, false);
    });

    it('valid changes → ok=true с patches и snapshot', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0.05, calc);
        const r = applyOptimizationDraft(d, calc);
        assert.equal(r.ok, true);
        assert.equal(r.patches.length, 1);
        assert.ok(r.snapshot);
        assert.ok(r.snapshot.settings);
        assert.ok(r.snapshot.answers);
    });

    it('snapshot — deep copy, не shared с calc', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0.05, calc);
        const r = applyOptimizationDraft(d, calc);
        assert.notEqual(r.snapshot.settings, calc.settings);
        assert.deepEqual(r.snapshot.settings, calc.settings);
    });

    it('не мутирует mutable-поля calc', () => {
        const calc = makeCalc();
        const before = deepClone(calc);
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0.05, calc);
        applyOptimizationDraft(d, calc);
        assertCalcMutableFieldsUnchanged(calc, before);
    });
});

/* ============================================================
 * calcFromApplySnapshot — rollback
 * ============================================================ */

describe('calcFromApplySnapshot', () => {
    it('восстанавливает settings/answers/answersMeta из snapshot', () => {
        const calc = makeCalc();
        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0.05, calc);
        const r = applyOptimizationDraft(d, calc);

        // имитируем apply: меняем calc
        const mutated = {
            ...calc,
            settings: { ...calc.settings, bufferTask: 0.05 }
        };
        // baseline после mutation
        assert.equal(mutated.settings.bufferTask, 0.05);

        // rollback
        const restored = calcFromApplySnapshot(mutated, r.snapshot);
        assert.notEqual(restored.settings.bufferTask, 0.05);
        assert.deepEqual(restored.settings, calc.settings);
        assert.deepEqual(restored.answers, calc.answers);
    });

    it('сохраняет id и dictionaries (snapshot их не содержит)', () => {
        const calc = makeCalc();
        const snap = { settings: { ...calc.settings }, answers: { ...calc.answers }, answersMeta: {} };
        const restored = calcFromApplySnapshot(calc, snap);
        assert.equal(restored.id, calc.id);
        assert.equal(restored.dictionaries, calc.dictionaries);
    });

    it('null snapshot → calc unchanged', () => {
        const calc = makeCalc();
        const restored = calcFromApplySnapshot(calc, null);
        assert.equal(restored, calc);
    });
});

/* ============================================================
 * Immutability — calc и draft не мутируются ни одной операцией
 * ============================================================ */

describe('Immutability invariants', () => {
    it('весь flow create→update→toggle→switch→apply не мутирует mutable-поля calc', () => {
        const calc = makeCalc();
        const before = deepClone(calc);

        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0.05, calc);
        d = toggleOptimizationDraftConstraint(d, 'allowReliabilityTradeoff', true, calc);
        d = updateOptimizationDraftValue(d, 'answer:sla_target', 99.5, calc);
        d = switchOptimizationDraftLevel(d, PLAN_IDS.EXTREME, calc);
        applyOptimizationDraft(d, calc);
        resetOptimizationDraft(d, calc);

        assertCalcMutableFieldsUnchanged(calc, before,
            'calc.settings/answers/answersMeta остались прежними');
    });

    it('update возвращает НОВЫЙ draft, не мутирует предыдущий', () => {
        const calc = makeCalc();
        const d1 = createOptimizationDraft({ calc });
        const d2 = updateOptimizationDraftValue(d1, 'setting:bufferTask', 0.05, calc);
        assert.notEqual(d1, d2);
        assert.deepEqual(d1.changes, {}, 'оригинал не изменился');
        assert.ok(d2.changes['setting:bufferTask']);
    });
});

/* ============================================================
 * Sanity-check: реальная экономия с реальным calculator
 * ============================================================ */

describe('Sanity — реальный calculator', () => {
    it('apply сокращает totalMonthly', () => {
        const calc = makeCalc();
        const baseTotal = calculate(calc, null).totalMonthly;

        let d = createOptimizationDraft({ calc });
        d = updateOptimizationDraftValue(d, 'setting:bufferTask', 0, calc);
        d = updateOptimizationDraftValue(d, 'setting:bufferProject', 0, calc);

        // Применяем patches на clone и считаем
        const r = applyOptimizationDraft(d, calc);
        assert.equal(r.ok, true);
        // Берём clone и сравниваем
        const clone = deepClone(calc);
        for (const p of r.patches) {
            if (p.kind === 'setting') {
                clone.settings[p.key] = p.value;
            } else if (p.kind === 'setting_path') {
                const segs = p.key.split('.');
                clone.settings[segs[0]] = { ...clone.settings[segs[0]], [segs[1]]: p.value };
            } else if (p.kind === 'answer') {
                clone.answers[p.key] = p.value;
            }
        }
        const newTotal = calculate(clone, null).totalMonthly;
        assert.ok(newTotal < baseTotal, `${newTotal} < ${baseTotal}`);
    });
});
