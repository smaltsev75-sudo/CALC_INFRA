/**
 * Внешний аудит #14 (2026-05-19, четырнадцатый за серию).
 *
 *   P1#1 makeNewCalculation ставит schemaVersion=LATEST → миграция v2→v3
 *        (resourceRatio) пропускается. SEED_SETTINGS не содержит resourceRatio
 *        → новый calc создан без поля. UI таблица показывает fallback
 *        DEFAULT_RESOURCE_RATIO, calculator падает на общий standSizeRatio.
 *        Расхождение UI ↔ движок при правке LOAD-ratio в Опроснике.
 *
 *   P1#2 migration v11→v12 clamp только `v > max`, не `v < min`. Legacy bundle
 *        с LOAD=0.10 экспортируется, validateBundle (через migrate + validate)
 *        отвергает на основе STAND_RATIO_RANGES.LOAD.min=0.20. Round-trip
 *        export→import должен быть идемпотентным.
 *
 *   P2#3 validateQuestion не проверяет coherence для number: min<=max,
 *        step>0, defaultValue/defaultIfUnknown в [min,max]. Раньше можно было
 *        saveQuestion({min:10, max:5, step:0, defaultValue:7}) → answer
 *        попадал в calc, validateCalculation отвергал, calc становился невалидным.
 *
 *   P2#4 validateQuestion не проверяет тип option.value (только наличие).
 *        Можно сохранить {options:[{value:{nested:1}, label:'x'}]}, но
 *        validateCalculation для select-answer ограничивает string|number →
 *        вопрос «неотвечаем». Audit-13 P2#5 добавил check для defaultValue,
 *        но options-сами остались.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const calcListCtl = await import('../../js/controllers/calcListController.js');
const { store } = await import('../../js/state/store.js');
const { validateQuestion, validateCalculation } = await import('../../js/domain/validation.js');
const { buildStateBundle, applyStateBundle, validateBundle } = await import('../../js/services/bundleExport.js');
const { migrateCalculation, LATEST_SCHEMA_VERSION } = await import('../../js/state/migrations.js');
const { SEED_SETTINGS, buildSeedDictionaries } = await import('../../js/domain/seed.js');
const { STAND_IDS, DASHBOARD_RESOURCE_LABELS, STAND_RATIO_RANGES, DEFAULT_RESOURCE_RATIO } =
    await import('../../js/utils/constants.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setPersistStatus('idle');
    store.setDefaultDictionary({ items: [], questions: [] });
});

describe('Audit #14 P1#1 — SEED_SETTINGS содержит resourceRatio', () => {
    it('SEED_SETTINGS.resourceRatio определён для всех STAND_IDS и DASHBOARD_RESOURCE_LABELS', () => {
        assert.ok(SEED_SETTINGS.resourceRatio, 'resourceRatio должен присутствовать');
        assert.equal(typeof SEED_SETTINGS.resourceRatio, 'object');
        for (const stand of STAND_IDS) {
            const row = SEED_SETTINGS.resourceRatio[stand];
            assert.ok(row, `resourceRatio.${stand} должен быть определён`);
            for (const r of DASHBOARD_RESOURCE_LABELS) {
                assert.equal(typeof row[r], 'number',
                    `resourceRatio.${stand}.${r} должен быть числом`);
            }
        }
        // PROD = эталон.
        for (const r of DASHBOARD_RESOURCE_LABELS) {
            assert.equal(SEED_SETTINGS.resourceRatio.PROD[r], 1.00,
                `resourceRatio.PROD.${r} должен быть 1.00 (эталон)`);
        }
    });

    it('новый calc через createCalc сразу имеет settings.resourceRatio (P1#1 regression)', () => {
        const calc = calcListCtl.createCalc('Test P1#1');
        assert.ok(calc, 'createCalc вернул calc');
        assert.equal(calc.schemaVersion, LATEST_SCHEMA_VERSION,
            'новый calc на LATEST schemaVersion');
        assert.ok(calc.settings.resourceRatio,
            'новый calc обязан иметь resourceRatio (раньше отсутствовал — миграция v2→v3 пропускалась)');
        for (const stand of STAND_IDS) {
            assert.ok(calc.settings.resourceRatio[stand],
                `resourceRatio.${stand} обязан быть в новом calc`);
        }
    });

    it('setResourceRatio не падает после createCalc (immutable setter работает на seed)', async () => {
        const calcCtl = await import('../../js/controllers/calcController.js');
        calcListCtl.createCalc('Calc setResourceRatio test');
        // Не должно бросить.
        calcCtl.setResourceRatio('DEV', 'CPU', 0.5);
        const updated = store.getState().activeCalc;
        assert.equal(updated.settings.resourceRatio.DEV.CPU, 0.5,
            'setResourceRatio должен обновить значение');
    });

    it('SEED_SETTINGS.resourceRatio согласован с DEFAULT_STAND_SIZE_RATIO (12.U17 единый источник)', () => {
        // LOAD = 1.20 после Stage 19; DEV = 0.20; PROD = 1.00.
        assert.equal(SEED_SETTINGS.resourceRatio.LOAD.CPU, 1.20,
            'resourceRatio.LOAD.CPU должен наследовать standSizeRatio.LOAD (Stage 19 = 1.20)');
        assert.equal(SEED_SETTINGS.resourceRatio.DEV.RAM, 0.20,
            'resourceRatio.DEV.RAM должен наследовать standSizeRatio.DEV (Stage 19 = 0.20)');
    });
});

describe('Audit #14 P1#2 — migration v11→v12 двусторонний clamp', () => {
    it('legacy calc с LOAD=0.10 (< min 0.20) после миграции = LOAD.min', () => {
        const legacy = {
            id: 'legacy-low-load', name: 'Low LOAD', version: '1.0',
            schemaVersion: 11,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            settings: {
                period: 'monthly', daysPerMonth: 30, planningHorizonYears: 1,
                phaseDurationMonths: 3,
                standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 0.10, PROD: 1.00 },
                resourceRatio: {
                    DEV: { CPU: 0.16, GPU: 0.16, RAM: 0.16, SSD: 0.16, HDD: 0.16, S3: 0.16 },
                    IFT: { CPU: 0.40, GPU: 0.40, RAM: 0.40, SSD: 0.40, HDD: 0.40, S3: 0.40 },
                    PSI: { CPU: 0.50, GPU: 0.50, RAM: 0.50, SSD: 0.50, HDD: 0.50, S3: 0.50 },
                    LOAD: { CPU: 0.10, GPU: 0.10, RAM: 0.10, SSD: 0.10, HDD: 0.10, S3: 0.10 },
                    PROD: { CPU: 1.00, GPU: 1.00, RAM: 1.00, SSD: 1.00, HDD: 1.00, S3: 1.00 }
                },
                vatRateMode: 'frozen', vatEffectiveDate: null, vatRate: 0.20, vatEnabled: true
            },
            answers: {},
            view: { disabledStands: [] },
            dictionaries: buildSeedDictionaries()
        };
        const migrated = migrateCalculation(legacy);
        assert.equal(migrated.settings.standSizeRatio.LOAD, STAND_RATIO_RANGES.LOAD.min,
            `LOAD должен подняться до min=${STAND_RATIO_RANGES.LOAD.min} (раньше оставался 0.10)`);
        for (const r of DASHBOARD_RESOURCE_LABELS) {
            assert.equal(migrated.settings.resourceRatio.LOAD[r], STAND_RATIO_RANGES.LOAD.min,
                `resourceRatio.LOAD.${r} должен подняться до min=${STAND_RATIO_RANGES.LOAD.min}`);
        }
    });

    it('roundtrip: legacy calc с LOAD=0.10 export→import без validateBundle ошибок', () => {
        const legacy = {
            id: 'roundtrip-low-load', name: 'Roundtrip', version: '1.0',
            schemaVersion: 11,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            settings: {
                period: 'monthly', daysPerMonth: 30, planningHorizonYears: 1,
                phaseDurationMonths: 3,
                standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 0.10, PROD: 1.00 },
                resourceRatio: {
                    DEV: { CPU: 0.16, GPU: 0.16, RAM: 0.16, SSD: 0.16, HDD: 0.16, S3: 0.16 },
                    IFT: { CPU: 0.40, GPU: 0.40, RAM: 0.40, SSD: 0.40, HDD: 0.40, S3: 0.40 },
                    PSI: { CPU: 0.50, GPU: 0.50, RAM: 0.50, SSD: 0.50, HDD: 0.50, S3: 0.50 },
                    LOAD: { CPU: 0.10, GPU: 0.10, RAM: 0.10, SSD: 0.10, HDD: 0.10, S3: 0.10 },
                    PROD: { CPU: 1.00, GPU: 1.00, RAM: 1.00, SSD: 1.00, HDD: 1.00, S3: 1.00 }
                },
                vatRateMode: 'frozen', vatEffectiveDate: null, vatRate: 0.20, vatEnabled: true
            },
            answers: {},
            view: { disabledStands: [] },
            dictionaries: buildSeedDictionaries()
        };
        localStorage.setItem(`calc.${legacy.id}`, JSON.stringify(legacy));
        localStorage.setItem('calc.list', JSON.stringify([{
            id: legacy.id, name: legacy.name, updatedAt: legacy.updatedAt
        }]));

        const bundle = buildStateBundle();
        assert.ok(bundle.calculations && bundle.calculations.length === 1,
            'bundle экспортировал 1 calc');

        // Сериализация/десериализация имитирует реальный round-trip.
        const serialized = JSON.stringify(bundle);
        const parsed = JSON.parse(serialized);
        const validationResult = validateBundle(parsed);
        assert.ok(validationResult.valid,
            `validateBundle не должен падать на двусторонний clamp: ${JSON.stringify(validationResult.errors)}`);
    });

    it('PROD-stand с invalid value clamp в 1.00 (min=max=1.00)', () => {
        const legacy = {
            id: 'prod-anchor', name: 'PROD anchor', version: '1.0',
            schemaVersion: 11,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            settings: {
                period: 'monthly', daysPerMonth: 30, planningHorizonYears: 1,
                phaseDurationMonths: 3,
                /* PROD умышленно 0.5 — миграция должна вернуть 1.00 (эталон). */
                standSizeRatio: { DEV: 0.20, IFT: 0.40, PSI: 0.50, LOAD: 1.00, PROD: 0.5 },
                vatRateMode: 'frozen', vatEffectiveDate: null, vatRate: 0.20, vatEnabled: true
            },
            answers: {},
            view: { disabledStands: [] },
            dictionaries: buildSeedDictionaries()
        };
        const migrated = migrateCalculation(legacy);
        assert.equal(migrated.settings.standSizeRatio.PROD, 1.00,
            'PROD после двустороннего clamp = 1.00 (min=max)');
    });
});

describe('Audit #14 P2#3 — validateQuestion coherence для number', () => {
    function _baseNum(extra = {}) {
        return {
            id: 'bad_num', section: 'business', subgroup: '',
            title: 'Test', description: '', recommendation: '', impact: '',
            type: 'number', defaultValue: 0,
            /* defaultIfUnknown НЕ задан — иначе при min=5/max=5 фикс P2#3
             * корректно отвергнет 0 (значение по умолчанию для extra={}). */
            allowUnknown: true, assumptionRisk: 'low',
            order: 100,
            min: 0, max: 100, step: 1,
            ...extra
        };
    }

    it('отвергает min > max', () => {
        const q = _baseNum({ min: 10, max: 5 });
        const errors = [];
        validateQuestion(q, errors);
        assert.ok(errors.some(e => /min/.test(e.path) && /max/.test(e.message)),
            `должна быть ошибка про min > max; получено: ${JSON.stringify(errors)}`);
    });

    it('отвергает step = 0', () => {
        const q = _baseNum({ step: 0 });
        const errors = [];
        validateQuestion(q, errors);
        assert.ok(errors.some(e => /step/.test(e.path) && /> 0/.test(e.message)),
            'должна быть ошибка про step > 0');
    });

    it('отвергает step < 0', () => {
        const q = _baseNum({ step: -1 });
        const errors = [];
        validateQuestion(q, errors);
        assert.ok(errors.some(e => /step/.test(e.path)),
            'должна быть ошибка про step');
    });

    it('отвергает defaultValue вне [min, max]', () => {
        const q = _baseNum({ min: 0, max: 10, defaultValue: 50 });
        const errors = [];
        validateQuestion(q, errors);
        assert.ok(errors.some(e => /defaultValue/.test(e.path) && /больше max/.test(e.message)),
            'должна быть ошибка про defaultValue > max');
    });

    it('отвергает defaultIfUnknown вне [min, max]', () => {
        const q = _baseNum({ min: 5, max: 10, defaultValue: 5, defaultIfUnknown: 1 });
        const errors = [];
        validateQuestion(q, errors);
        assert.ok(errors.some(e => /defaultIfUnknown/.test(e.path) && /меньше min/.test(e.message)),
            'должна быть ошибка про defaultIfUnknown < min');
    });

    it('valid: min=max=defaultValue (граница допустима)', () => {
        const q = _baseNum({ min: 5, max: 5, defaultValue: 5 });
        const errors = [];
        validateQuestion(q, errors);
        assert.equal(errors.length, 0,
            `min=max=5 + defaultValue=5 должно быть валидно; получено: ${JSON.stringify(errors)}`);
    });
});

describe('Audit #14 P2#4 — validateQuestion option.value скаляр', () => {
    function _baseSelect(options) {
        return {
            id: 'bad_select', section: 'business', subgroup: '',
            title: 'Test', description: '', recommendation: '', impact: '',
            type: 'select',
            allowUnknown: true, assumptionRisk: 'low',
            order: 100,
            options
        };
    }

    it('отвергает option.value = object', () => {
        const q = _baseSelect([
            { value: { nested: 1 }, label: 'Object' },
            { value: 'ok', label: 'OK' }
        ]);
        const errors = [];
        validateQuestion(q, errors);
        assert.ok(errors.some(e => /options\[0\]\.value/.test(e.path) && /строкой или числом/.test(e.message)),
            `должна быть ошибка про тип value; получено: ${JSON.stringify(errors)}`);
    });

    it('отвергает option.value = array', () => {
        const q = _baseSelect([
            { value: [1, 2], label: 'Array' }
        ]);
        const errors = [];
        validateQuestion(q, errors);
        assert.ok(errors.some(e => /options\[0\]\.value/.test(e.path)),
            'должна быть ошибка про тип value (array)');
    });

    it('отвергает option.value = boolean', () => {
        const q = _baseSelect([
            { value: true, label: 'Bool' }
        ]);
        const errors = [];
        validateQuestion(q, errors);
        assert.ok(errors.some(e => /options\[0\]\.value/.test(e.path)),
            'должна быть ошибка про тип value (boolean)');
    });

    it('valid: option.value = string или number', () => {
        const q = _baseSelect([
            { value: 'small', label: 'S' },
            { value: 100, label: '100 шт' }
        ]);
        const errors = [];
        validateQuestion(q, errors);
        assert.equal(errors.length, 0,
            `string и number value должны быть валидны; получено: ${JSON.stringify(errors)}`);
    });
});

describe('Audit #14 — invariant: roundtrip seed → bundle → validateBundle', () => {
    it('новый calc → buildStateBundle → validateBundle = valid', () => {
        const calc = calcListCtl.createCalc('Roundtrip seed');
        assert.ok(calc);
        const bundle = buildStateBundle();
        const serialized = JSON.stringify(bundle);
        const parsed = JSON.parse(serialized);
        const result = validateBundle(parsed);
        assert.ok(result.valid,
            `seed-calc bundle должен пройти validateBundle (resourceRatio gap closed): ${JSON.stringify(result.errors)}`);
    });
});
