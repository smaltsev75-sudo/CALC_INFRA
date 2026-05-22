/**
 * Внешний аудит #15 (2026-05-19, пятнадцатый за серию).
 *
 *   P1 — schema 19 calc с LOAD=0.10 обходит migration v11→v12. buildStateBundle
 *        проходит без errors, но validateBundle/applyStateBundle отвергают.
 *        Нужен post-migration normalizer для current-schema данных.
 *
 *   P1/P2 — schema 19 calc без resourceRatio. Создавался в 2.19.0 (до audit-14
 *        P1#1 fix SEED_SETTINGS). validateCalculation=[], bundle.errors=[],
 *        validateBundle.valid=true, но calculator падает на fallback общего
 *        standSizeRatio. UI таблица показывает дефолтную матрицу.
 *
 *   P2 saveQuestion — редактирование min не валидирует calc после построения.
 *        Repro: q.min=0, answer=0 → editing min=5, saveQuestion {ok:true},
 *        но validateCalculation отвергает answer<min.
 *
 *   P2 number без default + min>0 — defaultAnswerFor=0 при min=5 даёт invalid.
 *        Closed тем же фиксом P2 saveQuestion.
 *
 *   P3 NaN — typeof === 'number' пропускал NaN/Infinity в validateQuestion и
 *        _validateAnswersAgainstQuestions. JSON.stringify(NaN)='null' →
 *        тихая потеря данных.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const calcListCtl = await import('../../js/controllers/calcListController.js');
const questionCtl = await import('../../js/controllers/questionController.js');
const { store } = await import('../../js/state/store.js');
const { validateQuestion, validateCalculation } = await import('../../js/domain/validation.js');
const { buildStateBundle, validateBundle, applyStateBundle } = await import('../../js/services/bundleExport.js');
const { normalizeStandRatios, hasNonNormalizedStandRatios } =
    await import('../../js/domain/standRatioNormalizer.js');
const { prepareLoadedCalc } = await import('../../js/services/loadedCalc.js');
const { buildSeedDictionaries } = await import('../../js/domain/seed.js');
const { LATEST_SCHEMA_VERSION } = await import('../../js/state/migrations.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setPersistStatus('idle');
    store.setDefaultDictionary({ items: [], questions: [] });
});

describe('Audit #15 P1 — schema 19 calc с LOAD<min нормализуется через prepareLoadedCalc', () => {
    it('schema 19 calc с LOAD=0.10 → prepareLoadedCalc clamp до min=0.20', () => {
        const stored = {
            id: 'sch19-low-load', name: 'Schema 19 low LOAD', version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION,
            createdAt: '2026-05-19T00:00:00.000Z',
            updatedAt: '2026-05-19T00:00:00.000Z',
            settings: {
                period: 'monthly', daysPerMonth: 30, planningHorizonYears: 1,
                phaseDurationMonths: 3,
                standSizeRatio: { DEV: 0.20, IFT: 0.40, PSI: 0.50, LOAD: 0.10, PROD: 1.00 },
                resourceRatio: {
                    DEV: { CPU: 0.20, GPU: 0.20, RAM: 0.20, SSD: 0.20, HDD: 0.20, S3: 0.20 },
                    IFT: { CPU: 0.40, GPU: 0.40, RAM: 0.40, SSD: 0.40, HDD: 0.40, S3: 0.40 },
                    PSI: { CPU: 0.50, GPU: 0.50, RAM: 0.50, SSD: 0.50, HDD: 0.50, S3: 0.50 },
                    LOAD: { CPU: 0.10, GPU: 0.10, RAM: 0.10, SSD: 0.10, HDD: 0.10, S3: 0.10 },
                    PROD: { CPU: 1.00, GPU: 1.00, RAM: 1.00, SSD: 1.00, HDD: 1.00, S3: 1.00 }
                },
                vatRateMode: 'frozen', vatEffectiveDate: null, vatRate: 0.22, vatEnabled: true
            },
            answers: {},
            view: { disabledStands: [] },
            dictionaries: buildSeedDictionaries()
        };
        const result = prepareLoadedCalc(stored);
        assert.equal(result.error, null);
        assert.equal(result.calc.settings.standSizeRatio.LOAD, 0.20,
            'LOAD clamp до min=0.20 (раньше оставался 0.10)');
        assert.equal(result.calc.settings.resourceRatio.LOAD.CPU, 0.20,
            'resourceRatio.LOAD.CPU clamp до 0.20');
        assert.equal(result.needsPersist, true,
            'needsPersist=true так как normalize что-то изменил');
    });

    it('schema 19 calc БЕЗ resourceRatio инициализируется из standSizeRatio', () => {
        const stored = {
            id: 'sch19-no-rr', name: 'Schema 19 no resourceRatio (legacy 2.19.0)', version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION,
            createdAt: '2026-05-19T00:00:00.000Z',
            updatedAt: '2026-05-19T00:00:00.000Z',
            settings: {
                period: 'monthly', daysPerMonth: 30, planningHorizonYears: 1,
                phaseDurationMonths: 3,
                standSizeRatio: { DEV: 0.20, IFT: 0.40, PSI: 0.50, LOAD: 0.80, PROD: 1.00 },
                /* resourceRatio отсутствует — это реальный кейс 2.19.0 calc'а
                 * созданного ДО audit-14 P1#1 fix. */
                vatRateMode: 'frozen', vatEffectiveDate: null, vatRate: 0.22, vatEnabled: true
            },
            answers: {},
            view: { disabledStands: [] },
            dictionaries: buildSeedDictionaries()
        };
        const result = prepareLoadedCalc(stored);
        assert.equal(result.error, null);
        assert.ok(result.calc.settings.resourceRatio,
            'resourceRatio должен быть инициализирован');
        // DEV-ratio наследует из standSizeRatio.DEV.
        assert.equal(result.calc.settings.resourceRatio.DEV.CPU, 0.20,
            'DEV.CPU должен наследовать standSizeRatio.DEV=0.20');
        // PROD = эталон.
        assert.equal(result.calc.settings.resourceRatio.PROD.RAM, 1.00,
            'PROD.RAM = 1.00');
        assert.equal(result.needsPersist, true,
            'needsPersist=true для инициализации resourceRatio');
    });

    it('schema 19 clean calc — normalize idempotent (needsPersist=false)', () => {
        const calc = calcListCtl.createCalc('Clean schema 19');
        // Сериализация чтобы попасть через prepareLoadedCalc.
        const stored = JSON.parse(JSON.stringify(calc));
        const result = prepareLoadedCalc(stored);
        assert.equal(result.error, null);
        // schemaChanged=false (calc уже на LATEST), normalizeChanged=false
        // (createCalc уже корректен через SEED_SETTINGS).
        // enrichChanged — может быть true если у calc нет agent-данных в dict.
        // Проверяем что normalize-причина не сработала отдельно.
        assert.equal(hasNonNormalizedStandRatios(stored), false,
            'fresh seed calc не нуждается в normalize');
    });

    it('roundtrip: schema 19 calc с LOAD=0.10 → buildStateBundle → validateBundle = valid', () => {
        const stored = {
            id: 'roundtrip-sch19', name: 'Roundtrip', version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION,
            createdAt: '2026-05-19T00:00:00.000Z',
            updatedAt: '2026-05-19T00:00:00.000Z',
            settings: {
                period: 'monthly', daysPerMonth: 30, planningHorizonYears: 1,
                phaseDurationMonths: 3,
                standSizeRatio: { DEV: 0.20, IFT: 0.40, PSI: 0.50, LOAD: 0.10, PROD: 1.00 },
                resourceRatio: {
                    DEV: { CPU: 0.20, GPU: 0.20, RAM: 0.20, SSD: 0.20, HDD: 0.20, S3: 0.20 },
                    IFT: { CPU: 0.40, GPU: 0.40, RAM: 0.40, SSD: 0.40, HDD: 0.40, S3: 0.40 },
                    PSI: { CPU: 0.50, GPU: 0.50, RAM: 0.50, SSD: 0.50, HDD: 0.50, S3: 0.50 },
                    LOAD: { CPU: 0.10, GPU: 0.10, RAM: 0.10, SSD: 0.10, HDD: 0.10, S3: 0.10 },
                    PROD: { CPU: 1.00, GPU: 1.00, RAM: 1.00, SSD: 1.00, HDD: 1.00, S3: 1.00 }
                },
                vatRateMode: 'frozen', vatEffectiveDate: null, vatRate: 0.22, vatEnabled: true
            },
            answers: {},
            view: { disabledStands: [] },
            dictionaries: buildSeedDictionaries()
        };
        localStorage.setItem(`calc.${stored.id}`, JSON.stringify(stored));
        localStorage.setItem('calc.list', JSON.stringify([{
            id: stored.id, name: stored.name, updatedAt: stored.updatedAt
        }]));
        const bundle = buildStateBundle();
        const serialized = JSON.stringify(bundle);
        const parsed = JSON.parse(serialized);
        const v = validateBundle(parsed);
        assert.ok(v.valid,
            `roundtrip schema 19 LOAD=0.10 должен проходить (normalize в prepareLoadedCalc): ${JSON.stringify(v.errors)}`);
    });

    it('validateBundle нормализует schema 19 calc с LOAD=0.10 ДО validate', () => {
        /* Это тест против race: bundle может прийти из внешнего источника
         * (не через buildStateBundle). validateBundle должен сам нормализовать. */
        const externalBundle = {
            version: 'bundle-3.0',
            exportedAt: '2026-05-19T00:00:00.000Z',
            appVersion: '2.19.2',
            activeCalcId: null,
            defaultDictionary: { items: [], questions: [] },
            calculations: [{
                id: 'ext-bundle-low-load', name: 'External LOAD=0.10', version: '1.0',
                schemaVersion: LATEST_SCHEMA_VERSION,
                createdAt: '2026-05-19T00:00:00.000Z',
                updatedAt: '2026-05-19T00:00:00.000Z',
                settings: {
                    period: 'monthly', daysPerMonth: 30, planningHorizonYears: 1,
                    phaseDurationMonths: 3,
                    standSizeRatio: { DEV: 0.20, IFT: 0.40, PSI: 0.50, LOAD: 0.10, PROD: 1.00 },
                    resourceRatio: {
                        DEV: { CPU: 0.20, GPU: 0.20, RAM: 0.20, SSD: 0.20, HDD: 0.20, S3: 0.20 },
                        IFT: { CPU: 0.40, GPU: 0.40, RAM: 0.40, SSD: 0.40, HDD: 0.40, S3: 0.40 },
                        PSI: { CPU: 0.50, GPU: 0.50, RAM: 0.50, SSD: 0.50, HDD: 0.50, S3: 0.50 },
                        LOAD: { CPU: 0.10, GPU: 0.10, RAM: 0.10, SSD: 0.10, HDD: 0.10, S3: 0.10 },
                        PROD: { CPU: 1.00, GPU: 1.00, RAM: 1.00, SSD: 1.00, HDD: 1.00, S3: 1.00 }
                    },
                    vatRateMode: 'frozen', vatEffectiveDate: null, vatRate: 0.22, vatEnabled: true
                },
                answers: {},
                view: { disabledStands: [] },
                dictionaries: buildSeedDictionaries()
            }],
            errors: []
        };
        const v = validateBundle(externalBundle);
        assert.ok(v.valid,
            `external bundle с LOAD=0.10 должен пройти после normalize: ${JSON.stringify(v.errors)}`);
    });
});

describe('Audit #15 P2 — saveQuestion валидирует ПОЛНЫЙ calc', () => {
    it('редактирование min=0→5 с существующим answer=0 отвергается', () => {
        calcListCtl.createCalc('saveQuestion P2');
        const calc = store.getState().activeCalc;
        // Создаём вопрос с min=0, default=0.
        const q1 = {
            id: 'audit_q', section: 'business', subgroup: '',
            title: 'Audit Q', description: '', recommendation: '', impact: '',
            type: 'number', defaultValue: 0, allowUnknown: true, assumptionRisk: 'low',
            order: 100,
            min: 0, max: 100, step: 1
        };
        const r1 = questionCtl.saveQuestion(q1);
        assert.equal(r1.ok, true, 'первое сохранение ok');
        // Теперь редактируем min=5; answer=0 остался — это нарушение.
        const q2 = { ...q1, min: 5 };
        const r2 = questionCtl.saveQuestion(q2);
        assert.equal(r2.ok, false,
            `saveQuestion должен отвергнуть: answer=0 теперь меньше min=5; получено: ${JSON.stringify(r2)}`);
        assert.ok(r2.errors && r2.errors.length > 0,
            'errors должны быть заданы');
    });

    it('number вопрос с min=5 + default отсутствует → defaultAnswerFor=0 → отвергается', () => {
        calcListCtl.createCalc('saveQuestion P2 default');
        const q = {
            id: 'audit_q2', section: 'business', subgroup: '',
            title: 'Audit Q2', description: '', recommendation: '', impact: '',
            type: 'number',
            /* default не задан явно. defaultAnswerFor для number вернёт 0. */
            allowUnknown: true, assumptionRisk: 'low',
            order: 100,
            min: 5, max: 100, step: 1
        };
        const r = questionCtl.saveQuestion(q);
        assert.equal(r.ok, false,
            `min=5 + defaultAnswer=0 должно быть отвергнуто: ${JSON.stringify(r)}`);
    });

    it('valid: q.min=0, answer=10 — проходит', () => {
        calcListCtl.createCalc('saveQuestion valid');
        const q = {
            id: 'good_q', section: 'business', subgroup: '',
            title: 'Good Q', description: '', recommendation: '', impact: '',
            type: 'number', defaultValue: 10, allowUnknown: true, assumptionRisk: 'low',
            order: 100,
            min: 0, max: 100, step: 1
        };
        const r = questionCtl.saveQuestion(q);
        assert.equal(r.ok, true,
            `valid вопрос должен пройти; получено: ${JSON.stringify(r)}`);
    });
});

describe('Audit #15 P3 — NaN/Infinity reject в validateQuestion + answers', () => {
    function _baseNum(extra = {}) {
        return {
            id: 'nan_q', section: 'business', subgroup: '',
            title: 'NaN test', description: '', recommendation: '', impact: '',
            type: 'number', defaultValue: 0,
            allowUnknown: true, assumptionRisk: 'low',
            order: 100,
            min: 0, max: 100, step: 1,
            ...extra
        };
    }

    it('validateQuestion: defaultValue=NaN отвергается', () => {
        const q = _baseNum({ defaultValue: NaN });
        const errors = [];
        validateQuestion(q, errors);
        assert.ok(errors.some(e => /defaultValue/.test(e.path) && /конечн/.test(e.message)),
            `NaN должен быть отвергнут: ${JSON.stringify(errors)}`);
    });

    it('validateQuestion: defaultValue=Infinity отвергается', () => {
        const q = _baseNum({ defaultValue: Infinity });
        const errors = [];
        validateQuestion(q, errors);
        assert.ok(errors.some(e => /defaultValue/.test(e.path) && /конечн/.test(e.message)),
            'Infinity должен быть отвергнут');
    });

    it('validateCalculation: answer=NaN отвергается', () => {
        const calc = {
            id: 'nan-calc', name: 'NaN', version: '1.0',
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
            answers: { nan_q: NaN },
            view: { disabledStands: [] },
            dictionaries: {
                items: [],
                questions: [{
                    id: 'nan_q', section: 'business', subgroup: '',
                    title: 'NaN Q', description: '', recommendation: '', impact: '',
                    type: 'number', defaultValue: 0,
                    allowUnknown: true, assumptionRisk: 'low',
                    order: 100, min: 0, max: 100, step: 1
                }]
            }
        };
        const errors = [];
        validateCalculation(calc, errors);
        assert.ok(errors.some(e => /nan_q/.test(e.path) && /конечн/.test(e.message)),
            `NaN answer должен быть отвергнут: ${JSON.stringify(errors)}`);
    });
});

describe('Audit #15 invariant — normalize idempotent', () => {
    it('normalizeStandRatios на нормализованных данных = no-op', () => {
        const calc = calcListCtl.createCalc('Idempotent test');
        const beforeJSON = JSON.stringify(calc.settings);
        const changed = normalizeStandRatios(calc);
        assert.equal(changed, false, 'idempotent на свежем seed');
        assert.equal(JSON.stringify(calc.settings), beforeJSON,
            'данные не изменились');
    });

    it('normalize дважды → второй раз no-op', () => {
        const stored = {
            id: 'idem-2x', name: 'Double', version: '1.0',
            schemaVersion: LATEST_SCHEMA_VERSION,
            createdAt: '2026-05-19T00:00:00.000Z',
            updatedAt: '2026-05-19T00:00:00.000Z',
            settings: {
                period: 'monthly',
                standSizeRatio: { DEV: 0.20, IFT: 0.40, PSI: 0.50, LOAD: 0.05, PROD: 1.00 }
            },
            answers: {},
            view: { disabledStands: [] },
            dictionaries: { items: [], questions: [] }
        };
        const calc1 = JSON.parse(JSON.stringify(stored));
        const changed1 = normalizeStandRatios(calc1);
        const changed2 = normalizeStandRatios(calc1);
        assert.equal(changed1, true, 'первый вызов changed=true');
        assert.equal(changed2, false, 'второй вызов changed=false (idempotent)');
        assert.equal(calc1.settings.standSizeRatio.LOAD, 0.20,
            'LOAD clamp до min');
    });
});
