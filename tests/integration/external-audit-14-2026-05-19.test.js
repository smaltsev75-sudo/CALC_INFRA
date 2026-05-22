/**
 * Внешний аудит #16 (2026-05-19, шестнадцатый за серию).
 *
 *   P1 — validateAnswersConsistency не покрывал scenarios[*].answers.
 *        saveQuestion/importQuestions доверяли частичной проверке: вопрос с
 *        min=5 редактировался, scenarios[1] имел answer=0 → ok:true, но
 *        validateCalculation отвергал. Реальная атомарная дыра.
 *
 *   P2 — buildStateBundle отдавал bundle с calc, который сам validateBundle
 *        тут же отвергал. errors:[] был ложно-пустой.
 *
 *   P3 — NaN/Infinity в option.value, select-default, select-answer.
 *        JSON.stringify(NaN)='null' → тихая порча persisted state.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const calcListCtl = await import('../../js/controllers/calcListController.js');
const questionCtl = await import('../../js/controllers/questionController.js');
const { store } = await import('../../js/state/store.js');
const { validateQuestion, validateCalculation, validateAnswersConsistency } =
    await import('../../js/domain/validation.js');
const { buildStateBundle, validateBundle } = await import('../../js/services/bundleExport.js');
const { LATEST_SCHEMA_VERSION } = await import('../../js/state/migrations.js');
const { buildSeedDictionaries } = await import('../../js/domain/seed.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setPersistStatus('idle');
    store.setDefaultDictionary({ items: [], questions: [] });
});

describe('Audit #16 P1 — validateAnswersConsistency покрывает scenarios', () => {
    it('answer=0 в неактивном scenario при q.min=5 — отвергается', () => {
        const calc = {
            id: 'sc-test', name: 'Sc', version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION,
            createdAt: '2026-05-19T00:00:00.000Z',
            updatedAt: '2026-05-19T00:00:00.000Z',
            settings: {},
            answers: { sc_q: 10 },
            scenarios: [
                { id: 's1', label: 'Active', answers: { sc_q: 10 } },
                { id: 's2', label: 'Inactive', answers: { sc_q: 0 } }  // <— violation
            ],
            activeScenarioId: 's1',
            dictionaries: {
                items: [],
                questions: [{
                    id: 'sc_q', section: 'business', subgroup: '',
                    title: 'Q', description: '', recommendation: '', impact: '',
                    type: 'number', defaultValue: 10,
                    allowUnknown: true, assumptionRisk: 'low',
                    order: 1, min: 5, max: 100, step: 1
                }]
            }
        };
        const errors = [];
        validateAnswersConsistency(calc, errors);
        assert.ok(
            errors.some(e => /scenarios\[1\]\.answers\.sc_q/.test(e.path) && /меньше min/.test(e.message)),
            `неактивный scenario с invalid answer должен быть отвергнут: ${JSON.stringify(errors)}`
        );
    });

    it('valid: все scenarios имеют answer в [min, max]', () => {
        const calc = {
            id: 'sc-ok', name: 'OK', version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION,
            createdAt: '2026-05-19T00:00:00.000Z',
            updatedAt: '2026-05-19T00:00:00.000Z',
            settings: {},
            answers: { sc_q: 10 },
            scenarios: [
                { id: 's1', label: 'A', answers: { sc_q: 10 } },
                { id: 's2', label: 'B', answers: { sc_q: 50 } }
            ],
            activeScenarioId: 's1',
            dictionaries: {
                items: [],
                questions: [{
                    id: 'sc_q', section: 'business', subgroup: '',
                    title: 'Q', description: '', recommendation: '', impact: '',
                    type: 'number', defaultValue: 10,
                    allowUnknown: true, assumptionRisk: 'low',
                    order: 1, min: 5, max: 100, step: 1
                }]
            }
        };
        const errors = [];
        validateAnswersConsistency(calc, errors);
        assert.equal(errors.length, 0, `valid scenarios должны проходить: ${JSON.stringify(errors)}`);
    });
});

describe('Audit #16 P2 — buildStateBundle отвергает invalid calc', () => {
    it('schema 19 calc с answer вне диапазона → bundle.errors содержит validation, calc НЕ в calculations', () => {
        const calc = {
            id: 'bad-calc', name: 'Bad', version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION,
            createdAt: '2026-05-19T00:00:00.000Z',
            updatedAt: '2026-05-19T00:00:00.000Z',
            settings: {
                period: 'monthly', daysPerMonth: 30, planningHorizonYears: 1,
                phaseDurationMonths: 3,
                standSizeRatio: { DEV: 0.20, IFT: 0.40, PSI: 0.50, LOAD: 1.00, PROD: 1.00 },
                resourceRatio: {
                    DEV: { CPU: 0.20, GPU: 0.20, RAM: 0.20, SSD: 0.20, HDD: 0.20, S3: 0.20 },
                    IFT: { CPU: 0.40, GPU: 0.40, RAM: 0.40, SSD: 0.40, HDD: 0.40, S3: 0.40 },
                    PSI: { CPU: 0.50, GPU: 0.50, RAM: 0.50, SSD: 0.50, HDD: 0.50, S3: 0.50 },
                    LOAD: { CPU: 1.00, GPU: 1.00, RAM: 1.00, SSD: 1.00, HDD: 1.00, S3: 1.00 },
                    PROD: { CPU: 1.00, GPU: 1.00, RAM: 1.00, SSD: 1.00, HDD: 1.00, S3: 1.00 }
                },
                vatRateMode: 'frozen', vatEffectiveDate: null, vatRate: 0.22, vatEnabled: true
            },
            answers: { bad_q: -50 },  // вне [0, 100]
            view: { disabledStands: [] },
            dictionaries: {
                items: [],
                questions: [{
                    id: 'bad_q', section: 'business', subgroup: '',
                    title: 'Bad Q', description: '', recommendation: '', impact: '',
                    type: 'number', defaultValue: 50,
                    allowUnknown: true, assumptionRisk: 'low',
                    order: 1, min: 0, max: 100, step: 1
                }]
            }
        };
        localStorage.setItem(`calc.${calc.id}`, JSON.stringify(calc));
        localStorage.setItem('calc.list', JSON.stringify([{
            id: calc.id, name: calc.name, updatedAt: calc.updatedAt
        }]));
        const bundle = buildStateBundle();
        assert.equal(bundle.calculations.length, 0,
            'invalid calc НЕ должен попасть в bundle.calculations');
        assert.ok(bundle.errors.length > 0,
            'bundle.errors должен содержать запись о потерянном calc');
        assert.equal(bundle.errors[0].reason, 'validation',
            `reason=validation; получено: ${JSON.stringify(bundle.errors[0])}`);
        assert.equal(bundle.errors[0].calcId, calc.id);
    });

    it('valid calc проходит buildStateBundle без errors', () => {
        const calc = calcListCtl.createCalc('Valid for bundle');
        assert.ok(calc);
        const bundle = buildStateBundle();
        assert.ok(bundle.calculations.length >= 1, 'valid calc должен быть в bundle');
        assert.equal(bundle.errors.length, 0, 'errors пустой для valid');
        // Roundtrip: bundle → validateBundle = valid.
        const v = validateBundle(JSON.parse(JSON.stringify(bundle)));
        assert.ok(v.valid, `roundtrip должен пройти: ${JSON.stringify(v.errors)}`);
    });
});

describe('Audit #16 P3 — NaN reject в option.value + select default/answer', () => {
    function _baseSelect(extra = {}) {
        return {
            id: 'sel_q', section: 'business', subgroup: '',
            title: 'Sel', description: '', recommendation: '', impact: '',
            type: 'select', allowUnknown: true, assumptionRisk: 'low',
            order: 1,
            options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
            ...extra
        };
    }

    it('option.value = NaN отвергается', () => {
        const q = _baseSelect({
            options: [{ value: NaN, label: 'Bad' }, { value: 'ok', label: 'OK' }]
        });
        const errors = [];
        validateQuestion(q, errors);
        assert.ok(errors.some(e => /options\[0\]\.value/.test(e.path) && /конечн/.test(e.message)),
            `NaN-option должен быть отвергнут: ${JSON.stringify(errors)}`);
    });

    it('option.value = Infinity отвергается', () => {
        const q = _baseSelect({
            options: [{ value: Infinity, label: 'Inf' }, { value: 'ok', label: 'OK' }]
        });
        const errors = [];
        validateQuestion(q, errors);
        assert.ok(errors.some(e => /options\[0\]\.value/.test(e.path) && /конечн/.test(e.message)),
            'Infinity-option должен быть отвергнут');
    });

    it('defaultValue = NaN для select-вопроса отвергается', () => {
        const q = _baseSelect({
            options: [{ value: 1, label: 'one' }, { value: 2, label: 'two' }],
            defaultValue: NaN
        });
        const errors = [];
        validateQuestion(q, errors);
        assert.ok(errors.some(e => /defaultValue/.test(e.path) && /конечн/.test(e.message)),
            `NaN-default для select должен быть отвергнут: ${JSON.stringify(errors)}`);
    });

    it('answer = NaN для select-вопроса отвергается через _validateAnswersAgainstQuestions', () => {
        const calc = {
            id: 'nan-sel', name: 'NaN sel', version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION,
            createdAt: '2026-05-19T00:00:00.000Z',
            updatedAt: '2026-05-19T00:00:00.000Z',
            settings: {
                period: 'monthly', daysPerMonth: 30, planningHorizonYears: 1,
                phaseDurationMonths: 3,
                standSizeRatio: { DEV: 0.20, IFT: 0.40, PSI: 0.50, LOAD: 1.00, PROD: 1.00 },
                resourceRatio: {
                    DEV: { CPU: 0.20, GPU: 0.20, RAM: 0.20, SSD: 0.20, HDD: 0.20, S3: 0.20 },
                    IFT: { CPU: 0.40, GPU: 0.40, RAM: 0.40, SSD: 0.40, HDD: 0.40, S3: 0.40 },
                    PSI: { CPU: 0.50, GPU: 0.50, RAM: 0.50, SSD: 0.50, HDD: 0.50, S3: 0.50 },
                    LOAD: { CPU: 1.00, GPU: 1.00, RAM: 1.00, SSD: 1.00, HDD: 1.00, S3: 1.00 },
                    PROD: { CPU: 1.00, GPU: 1.00, RAM: 1.00, SSD: 1.00, HDD: 1.00, S3: 1.00 }
                },
                vatRateMode: 'frozen', vatEffectiveDate: null, vatRate: 0.22, vatEnabled: true
            },
            answers: { sel_q: NaN },
            view: { disabledStands: [] },
            dictionaries: {
                items: [],
                questions: [{
                    id: 'sel_q', section: 'business', subgroup: '',
                    title: 'Sel Q', description: '', recommendation: '', impact: '',
                    type: 'select', defaultValue: 1, allowUnknown: true, assumptionRisk: 'low',
                    order: 1,
                    options: [{ value: 1, label: 'one' }, { value: 2, label: 'two' }]
                }]
            }
        };
        const errors = [];
        validateCalculation(calc, errors);
        assert.ok(errors.some(e => /sel_q/.test(e.path) && /конечн/.test(e.message)),
            `NaN-answer для select должен быть отвергнут: ${JSON.stringify(errors)}`);
    });
});

describe('Audit #16 saveQuestion+scenarios — атомарная дыра закрыта', () => {
    it('редактирование q.min=5 при scenarios[1].answers.q=0 → saveQuestion отвергает', () => {
        // Создаём calc с двумя scenarios.
        const calc = calcListCtl.createCalc('Scenarios audit-16');
        assert.ok(calc);
        // Добавляем вопрос с min=0.
        const r1 = questionCtl.saveQuestion({
            id: 'sc_audit_q', section: 'business', subgroup: '',
            title: 'Sc audit', description: '', recommendation: '', impact: '',
            type: 'number', defaultValue: 0,
            allowUnknown: true, assumptionRisk: 'low',
            order: 100, min: 0, max: 100, step: 1
        });
        assert.equal(r1.ok, true);
        // Симулируем второй scenario с answer=0.
        const state = store.getState().activeCalc;
        const calcWithSc = {
            ...state,
            scenarios: [
                ...(state.scenarios || [{ id: 's1', label: 'Base', answers: { ...state.answers } }]),
                { id: 's2-bad', label: 'Bad', answers: { sc_audit_q: 0 } }
            ]
        };
        store.setActiveCalc(calcWithSc);
        // Теперь редактируем вопрос: min=5. scenarios[1].answers.sc_audit_q=0 вне диапазона.
        const r2 = questionCtl.saveQuestion({
            id: 'sc_audit_q', section: 'business', subgroup: '',
            title: 'Sc audit', description: '', recommendation: '', impact: '',
            type: 'number', defaultValue: 5,
            allowUnknown: true, assumptionRisk: 'low',
            order: 100, min: 5, max: 100, step: 1
        });
        assert.equal(r2.ok, false,
            `saveQuestion должен отвергнуть из-за scenarios[1].answers: ${JSON.stringify(r2)}`);
    });
});
