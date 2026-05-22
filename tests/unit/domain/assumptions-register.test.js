/**
 * Unit-тесты Stage 15.2 — Assumptions Register.
 *
 * Покрывает: buildAssumptionsRegister (источник + доверие + label/value),
 * getRiskyAssumptions, groupAssumptionsBySource, getManualOverrideSummary,
 * edge-cases (null calc, нет dictionaries, смешанный calc, immutability).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildAssumptionsRegister,
    groupAssumptionsBySource,
    getRiskyAssumptions,
    getManualOverrideSummary
} from '../../../js/domain/assumptionsRegister.js';
import { CRITICAL_FIELDS } from '../../../js/utils/constants.js';

/* ---------- Test fixture helpers ---------- */

function makeCalc(answers = {}, overrides = {}) {
    return {
        id: 't1',
        name: 'Test calc',
        schemaVersion: 12,
        answers: { ...answers },
        answersMeta: overrides.answersMeta || {},
        settings: { applyRiskFactors: true, ...(overrides.settings || {}) },
        wizard: overrides.wizard !== undefined ? overrides.wizard : null,
        dictionaries: overrides.dictionaries || {
            questions: overrides.questions || [
                { id: 'peak_rps',     type: 'number', title: 'Пиковый RPS',   defaultValue: 100, defaultIfUnknown: 100 },
                { id: 'sla_target',   type: 'select', title: 'Целевой SLA',   defaultValue: '99.9' },
                { id: 'product_type', type: 'select', title: 'Тип продукта',  defaultValue: 'b2c' },
                { id: 'users_total',  type: 'number', title: 'Всего юзеров',  defaultValue: 0 }
            ],
            items: [],
            settings: {}
        },
        view: overrides.view || {}
    };
}

/* ============================================================
 * buildAssumptionsRegister — контракт результата
 * ============================================================ */

describe('buildAssumptionsRegister: структура элемента', () => {
    it('возвращает массив Assumption для каждого вопроса', () => {
        const reg = buildAssumptionsRegister(makeCalc());
        assert.ok(Array.isArray(reg));
        assert.ok(reg.length > 0);
        const first = reg[0];
        assert.ok('fieldId'    in first, 'fieldId missing');
        assert.ok('label'      in first, 'label missing');
        assert.ok('value'      in first, 'value missing');
        assert.ok('source'     in first, 'source missing');
        assert.ok('confidence' in first, 'confidence missing');
        assert.ok('reason'     in first, 'reason missing');
        assert.ok('scenarioId' in first, 'scenarioId missing');
    });

    it('label совпадает с q.title (не с id)', () => {
        const reg = buildAssumptionsRegister(makeCalc());
        const item = reg.find(a => a.fieldId === 'peak_rps');
        assert.ok(item, 'peak_rps должен быть в регистре');
        assert.equal(item.label, 'Пиковый RPS');
    });

    it('scenarioId всегда null (активный сценарий)', () => {
        const reg = buildAssumptionsRegister(makeCalc());
        assert.ok(reg.every(a => a.scenarioId === null));
    });
});

/* ============================================================
 * Источник: 'default'
 * ============================================================ */

describe('buildAssumptionsRegister: source=default', () => {
    it('пустые ответы (null) → source=default', () => {
        const reg = buildAssumptionsRegister(makeCalc({ peak_rps: null }));
        const item = reg.find(a => a.fieldId === 'peak_rps');
        assert.equal(item.source, 'default');
    });

    it('ответ совпадает с defaultValue → source=default', () => {
        // peak_rps.defaultValue = 100
        const reg = buildAssumptionsRegister(makeCalc({ peak_rps: 100 }));
        const item = reg.find(a => a.fieldId === 'peak_rps');
        assert.equal(item.source, 'default');
    });

    it('нет записи об ответе (undefined) → source=default', () => {
        const reg = buildAssumptionsRegister(makeCalc());
        const item = reg.find(a => a.fieldId === 'sla_target');
        assert.equal(item.source, 'default');
    });
});

/* ============================================================
 * Источник: 'manual'
 * ============================================================ */

describe('buildAssumptionsRegister: source=manual', () => {
    it('явный ответ ≠ default, нет answersMeta → source=manual, confidence=high', () => {
        const reg = buildAssumptionsRegister(makeCalc({ peak_rps: 999 }));
        const item = reg.find(a => a.fieldId === 'peak_rps');
        assert.equal(item.source, 'manual');
        assert.equal(item.confidence, 'high');
    });

    it('manual не зависит от наличия answersMeta для других полей', () => {
        const reg = buildAssumptionsRegister(makeCalc(
            { peak_rps: 500 },
            { answersMeta: { sla_target: { source: 'profile' } } }
        ));
        const item = reg.find(a => a.fieldId === 'peak_rps');
        assert.equal(item.source, 'manual');
    });
});

/* ============================================================
 * Источник: 'quick_start'
 * ============================================================ */

describe('buildAssumptionsRegister: source=quick_start', () => {
    it('поле есть в answersMeta → source=quick_start, confidence=medium', () => {
        const reg = buildAssumptionsRegister(makeCalc(
            { peak_rps: 200 },
            { answersMeta: { peak_rps: { source: 'scale' } } }
        ));
        const item = reg.find(a => a.fieldId === 'peak_rps');
        assert.equal(item.source, 'quick_start');
        assert.equal(item.confidence, 'medium');
    });
});

/* ============================================================
 * Confidence: CRITICAL_FIELDS
 * ============================================================ */

describe('buildAssumptionsRegister: confidence для CRITICAL_FIELDS', () => {
    it('CRITICAL_FIELD с дефолтным ответом → confidence=low', () => {
        // Используем поле из CRITICAL_FIELDS ('peak_rps' есть в нашем test-dict)
        assert.ok(CRITICAL_FIELDS.includes('peak_rps'), 'peak_rps должен быть в CRITICAL_FIELDS');
        const reg = buildAssumptionsRegister(makeCalc({ peak_rps: null }));
        const item = reg.find(a => a.fieldId === 'peak_rps');
        assert.equal(item.confidence, 'low');
    });

    it('CRITICAL_FIELD с явным manual-ответом → confidence=high (не low)', () => {
        const reg = buildAssumptionsRegister(makeCalc({ peak_rps: 5000 }));
        const item = reg.find(a => a.fieldId === 'peak_rps');
        assert.equal(item.source, 'manual');
        assert.equal(item.confidence, 'high');
    });

    it('не-CRITICAL поле с дефолтным ответом → confidence=medium (не low)', () => {
        // users_total не в CRITICAL_FIELDS (или может быть — проверим)
        // Используем поле, которого заведомо нет в CRITICAL_FIELDS
        const reg = buildAssumptionsRegister(makeCalc(
            {},
            { questions: [{ id: 'some_non_critical', type: 'number', title: 'Some', defaultValue: 0 }] }
        ));
        const item = reg.find(a => a.fieldId === 'some_non_critical');
        assert.equal(item.source, 'default');
        assert.equal(item.confidence, 'medium');
    });
});

/* ============================================================
 * getRiskyAssumptions
 * ============================================================ */

describe('getRiskyAssumptions', () => {
    it('возвращает только элементы с confidence=low', () => {
        const risky = getRiskyAssumptions([
            { fieldId: 'a', confidence: 'low',    source: 'default' },
            { fieldId: 'b', confidence: 'medium',  source: 'default' },
            { fieldId: 'c', confidence: 'high',    source: 'manual' },
            { fieldId: 'd', confidence: 'low',    source: 'default' }
        ]);
        assert.equal(risky.length, 2);
        assert.ok(risky.every(a => a.confidence === 'low'));
    });

    it('пустой регистр → пустой массив', () => {
        assert.deepEqual(getRiskyAssumptions([]), []);
    });
});

/* ============================================================
 * groupAssumptionsBySource
 * ============================================================ */

describe('groupAssumptionsBySource', () => {
    it('разбивает по source в объект {manual, quick_start, default}', () => {
        const reg = [
            { fieldId: 'a', source: 'manual' },
            { fieldId: 'b', source: 'quick_start' },
            { fieldId: 'c', source: 'default' },
            { fieldId: 'd', source: 'manual' }
        ];
        const g = groupAssumptionsBySource(reg);
        assert.equal(g.manual.length, 2);
        assert.equal(g.quick_start.length, 1);
        assert.equal(g.default.length, 1);
    });

    it('пустой регистр → все группы пусты', () => {
        const g = groupAssumptionsBySource([]);
        assert.deepEqual(g.manual, []);
        assert.deepEqual(g.quick_start, []);
        assert.deepEqual(g.default, []);
    });
});

/* ============================================================
 * getManualOverrideSummary
 * ============================================================ */

describe('getManualOverrideSummary', () => {
    it('возвращает counts по каждому source', () => {
        const calc = makeCalc(
            { peak_rps: 5000, sla_target: null },
            { answersMeta: { product_type: { source: 'profile' } } }
        );
        const summary = getManualOverrideSummary(calc);
        assert.ok('manual'      in summary, 'manual count missing');
        assert.ok('quick_start' in summary, 'quick_start count missing');
        assert.ok('default'     in summary, 'default count missing');
        // Сумма counts = длина регистра
        const reg = buildAssumptionsRegister(calc);
        const total = summary.manual + summary.quick_start + summary.default;
        assert.equal(total, reg.length);
    });
});

/* ============================================================
 * Edge-cases
 * ============================================================ */

describe('buildAssumptionsRegister: edge-cases', () => {
    it('null calc → пустой массив без падения', () => {
        const reg = buildAssumptionsRegister(null);
        assert.deepEqual(reg, []);
    });

    it('calc без dictionaries → использует SEED_QUESTIONS (не пусто)', () => {
        const calc = { id: 't', answers: {}, answersMeta: {}, settings: {} };
        const reg = buildAssumptionsRegister(calc);
        assert.ok(reg.length > 0, 'должны быть элементы из SEED_QUESTIONS');
    });

    it('не мутирует calc', () => {
        const calc = makeCalc({ peak_rps: 100 });
        const frozen = Object.freeze({ ...calc, answers: Object.freeze({ ...calc.answers }) });
        // Не должен бросать TypeError на чтение замороженного объекта
        assert.doesNotThrow(() => buildAssumptionsRegister(frozen));
    });

    it('смешанный calc (manual + quick_start + default) → все 3 источника присутствуют', () => {
        const calc = makeCalc(
            { peak_rps: 9999, sla_target: null },  // peak_rps=manual, sla_target=default
            { answersMeta: { product_type: { source: 'scale' } } }  // product_type=quick_start
        );
        const reg = buildAssumptionsRegister(calc);
        const sources = new Set(reg.map(a => a.source));
        assert.ok(sources.has('manual'),      'manual отсутствует');
        assert.ok(sources.has('default'),     'default отсутствует');
        assert.ok(sources.has('quick_start'), 'quick_start отсутствует');
    });
});
