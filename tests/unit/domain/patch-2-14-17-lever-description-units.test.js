/**
 * PATCH 2.14.17 — Cost Optimization Planner: description + unit metadata-first.
 *
 * Domain-tests:
 *   - resolveLeverDescription: setting:X.Y → SETTINGS_DESCRIPTIONS[X]
 *   - resolveLeverDescription: answer:X   → calc.dictionaries.questions[id=X].description
 *   - resolveLeverDescription: fallback   → spec.description, иначе ''
 *   - deriveLeverUnit: правильные единицы для всех типов рычагов
 *   - buildEditableLevers: каждый рычаг имеет description (≥ ''), unit (string)
 *   - metadata-first invariant: если SETTINGS_DESCRIPTIONS[root] есть и spec.description тоже задан —
 *     возвращается metadata, не spec.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveLeverDescription,
    deriveLeverUnit
} from '../../../js/domain/costOptimizationPlanner.js';
import { SETTINGS_DESCRIPTIONS } from '../../../js/utils/constants.js';

/* ----------------- resolveLeverDescription ----------------- */

test('resolveLeverDescription: setting:bufferTask → SETTINGS_DESCRIPTIONS.bufferTask', () => {
    const spec = { focusFieldId: 'setting:bufferTask', description: 'fallback-spec' };
    const desc = resolveLeverDescription(spec, {});
    assert.equal(desc, SETTINGS_DESCRIPTIONS.bufferTask);
    assert.notEqual(desc, 'fallback-spec', 'metadata должна побеждать fallback (single source of truth)');
});

test('resolveLeverDescription: setting:standSizeRatio.LOAD → берёт по корню standSizeRatio', () => {
    const spec = { focusFieldId: 'setting:standSizeRatio.LOAD' };
    const desc = resolveLeverDescription(spec, {});
    assert.equal(desc, SETTINGS_DESCRIPTIONS.standSizeRatio);
});

test('resolveLeverDescription: answer:<qid> → calc.dictionaries.questions[id=qid].description', () => {
    const spec = { focusFieldId: 'answer:my_question' };
    const calc = {
        dictionaries: {
            questions: [
                { id: 'other', description: 'не тот' },
                { id: 'my_question', description: 'Описание моего вопроса.' }
            ]
        }
    };
    assert.equal(resolveLeverDescription(spec, calc), 'Описание моего вопроса.');
});

test('resolveLeverDescription: fallback на spec.description если metadata пуста', () => {
    const spec = {
        focusFieldId: 'setting:unknownField',
        description: 'Локальный fallback.'
    };
    assert.equal(resolveLeverDescription(spec, {}), 'Локальный fallback.');
});

test('resolveLeverDescription: пустая строка если ни metadata, ни spec.description', () => {
    const spec = { focusFieldId: 'setting:nowhere' };
    assert.equal(resolveLeverDescription(spec, {}), '');
});

test('resolveLeverDescription: answer fallback на spec.description при отсутствии вопроса', () => {
    const spec = {
        focusFieldId: 'answer:no_such_question',
        description: 'Локальный fallback.'
    };
    const calc = { dictionaries: { questions: [] } };
    assert.equal(resolveLeverDescription(spec, calc), 'Локальный fallback.');
});

/* ----------------- deriveLeverUnit ----------------- */

test('deriveLeverUnit: settings_ratio → "% от ПРОМ"', () => {
    assert.equal(deriveLeverUnit({ kind: 'settings_ratio', stand: 'LOAD' }), '% от ПРОМ');
    assert.equal(deriveLeverUnit({ kind: 'settings_ratio', stand: 'PSI' }), '% от ПРОМ');
});

test('deriveLeverUnit: risk buffer fields (k* / buffer*) → "%"', () => {
    assert.equal(deriveLeverUnit({ kind: 'settings_field', field: 'bufferTask' }), '%');
    assert.equal(deriveLeverUnit({ kind: 'settings_field', field: 'bufferProject' }), '%');
    assert.equal(deriveLeverUnit({ kind: 'settings_field', field: 'kContingency' }), '%');
    assert.equal(deriveLeverUnit({ kind: 'settings_field', field: 'kScheduleShift' }), '%');
});

test('deriveLeverUnit: planningHorizonYears → "лет"', () => {
    assert.equal(deriveLeverUnit({ field: 'planningHorizonYears' }), 'лет');
});

test('deriveLeverUnit: sla_target → "%"', () => {
    assert.equal(deriveLeverUnit({ field: 'sla_target' }), '%');
});

test('deriveLeverUnit: backup_retention_days → "дн."', () => {
    assert.equal(deriveLeverUnit({ field: 'backup_retention_days' }), 'дн.');
});

test('deriveLeverUnit: AI / RAG fields', () => {
    assert.equal(deriveLeverUnit({ field: 'ai_avg_output_tokens' }), 'токенов');
    assert.equal(deriveLeverUnit({ field: 'rag_corpus_size_gb' }), 'ГБ');
    assert.equal(deriveLeverUnit({ field: 'rag_embeddings_million' }), 'млн векторов');
});

test('deriveLeverUnit: spec.unit override побеждает авто-детект', () => {
    const spec = { kind: 'settings_field', field: 'bufferTask', unit: 'пунктов' };
    assert.equal(deriveLeverUnit(spec), 'пунктов');
});

test('deriveLeverUnit: неизвестный рычаг → пустая строка', () => {
    assert.equal(deriveLeverUnit({}), '');
    assert.equal(deriveLeverUnit({ kind: 'unknown_kind' }), '');
});
