/**
 * Regression-тесты к 12.U31 (Code Review Followup, Subagent A/B/D консолидация):
 * hardening валидации bundle-импорта по 6 пунктам:
 *
 * 1. **resourceRatio** не валидировался (введён в schema v3, 12.U12).
 *    Битый resourceRatio (строка вместо числа, выход из диапазона, PROD ≠ 1)
 *    раньше проходил validateSettings и попадал в state.
 * 2. **null vs undefined** в settings: undefined → дефолт через `?? DEFAULT_*`
 *    в calculator.js. null → `Number(null) = 0` → молчаливое обнуление НДС
 *    или коэффициентов. Reject `null` явно.
 * 3. **size-limit на строки в answers**: 10MB строка в answers[id] раньше
 *    проходила и ломала localStorage пользователя на следующем save.
 * 4. **per-question type-check**: answers[id]={nested:1} вместо number
 *    проходил, превращаясь в `[object Object]` в PDF и в `0` в формулах.
 * 5. **KNOWN_SETTINGS** не содержал `applyRiskFactors`/`resourceRatio` —
 *    `lintFormulas` ложно ругался на любую формулу с этими ссылками.
 * 6. **bufferTask/bufferProject** в calculator.js: `Number(x) || 0`
 *    маскировал NaN→0 и не использовал DEFAULT_* — асимметрия с другими
 *    коэффициентами (kInflation/kSeasonal/... через `?? DEFAULT`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    validate, validateSettings, validateCalculation, lintFormulas
} from '../../../js/domain/validation.js';
import { riskFactor, calculate } from '../../../js/domain/calculator.js';
import { DEFAULT_BUFFER_TASK, DEFAULT_BUFFER_PROJECT } from '../../../js/utils/constants.js';

/* ---------- Фикстуры ---------- */

function validSettings() {
    return {
        period: 'monthly',
        bufferTask: 0.30, bufferProject: 0.15,
        kInflation: 0.10, kSeasonal: 0.20, kScheduleShift: 0.30, kContingency: 0.10,
        vatEnabled: true, vatRate: 0.20,
        planningHorizonYears: 3, daysPerMonth: 30, phaseDurationMonths: 12,
        standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 0.80, PROD: 1.00 }
    };
}

function validCalc() {
    return {
        id: 'c1', name: 'Test', version: '1.0', schemaVersion: 7,
        settings: validSettings(),
        answers: { user_count: 100 },
        dictionaries: {
            items: [{
                id: 'i1', name: 'Test item', unit: 'шт.', pricePerUnit: 100,
                category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
                applicableStands: ['PROD'],
                qtyFormulas: { PROD: '1' }
            }],
            questions: [{ id: 'user_count', section: 'business', title: 'Users', type: 'number', order: 1 }]
        }
    };
}

/* ============================================================
 * 1. resourceRatio валидация (B-P1-1)
 * ============================================================ */

describe('validateSettings: resourceRatio (12.U12 schema v3)', () => {
    it('resourceRatio = "abc" (не объект) → ошибка', () => {
        const s = { ...validSettings(), resourceRatio: 'abc' };
        const errors = [];
        validateSettings(s, errors);
        assert.ok(errors.some(e => e.path.includes('resourceRatio')),
            'resourceRatio должен быть объектом — ошибка обязательна');
    });

    it('resourceRatio.DEV.CPU = "abc" (строка вместо числа) → ошибка', () => {
        const s = { ...validSettings(), resourceRatio: { DEV: { CPU: 'abc' } } };
        const errors = [];
        validateSettings(s, errors);
        assert.ok(errors.some(e => e.path.includes('resourceRatio.DEV.CPU')),
            'строковое значение resource-ratio должно отвергаться');
    });

    it('resourceRatio.DEV.CPU = -5 (вне диапазона 0..5) → ошибка', () => {
        const s = { ...validSettings(), resourceRatio: { DEV: { CPU: -5 } } };
        const errors = [];
        validateSettings(s, errors);
        assert.ok(errors.some(e => e.path.includes('resourceRatio.DEV.CPU') && /диапазон/.test(e.message)),
            'значение вне диапазона должно отвергаться');
    });

    it('resourceRatio.PROD.CPU = 0.5 (нарушение инварианта PROD=1) → ошибка', () => {
        const s = { ...validSettings(), resourceRatio: { PROD: { CPU: 0.5 } } };
        const errors = [];
        validateSettings(s, errors);
        assert.ok(errors.some(e => e.path.includes('resourceRatio.PROD')),
            'PROD-ratio для любого ресурса должно быть 1.00 (инвариант)');
    });

    it('resourceRatio с валидными значениями → нет ошибок', () => {
        const s = { ...validSettings(), resourceRatio: {
            DEV: { CPU: 0.16, RAM: 0.20 }, PROD: { CPU: 1.00, RAM: 1.00 }
        }};
        const errors = [];
        validateSettings(s, errors);
        assert.equal(errors.length, 0, `unexpected errors: ${JSON.stringify(errors)}`);
    });

    it('resourceRatio undefined → нет ошибок (поле опциональное для legacy v0..v2)', () => {
        const s = { ...validSettings() };
        delete s.resourceRatio;
        const errors = [];
        validateSettings(s, errors);
        assert.equal(errors.length, 0);
    });
});

/* ============================================================
 * 2. null vs undefined для критических settings полей (A-P1-1)
 * ============================================================ */

describe('validateSettings: null reject (защита от Number(null)=0 silent corruption)', () => {
    it('vatRate = null → ошибка (Number(null)=0 тихо обнуляет НДС)', () => {
        const s = { ...validSettings(), vatRate: null };
        const errors = [];
        validateSettings(s, errors);
        assert.ok(errors.some(e => e.path.endsWith('.vatRate')),
            'null vatRate должен отвергаться — иначе тихо равен 0');
    });

    it('kInflation = null → ошибка', () => {
        const s = { ...validSettings(), kInflation: null };
        const errors = [];
        validateSettings(s, errors);
        assert.ok(errors.some(e => e.path.endsWith('.kInflation')));
    });

    it('vatEnabled = null → ошибка (boolean ожидается)', () => {
        const s = { ...validSettings(), vatEnabled: null };
        const errors = [];
        validateSettings(s, errors);
        assert.ok(errors.some(e => e.path.endsWith('.vatEnabled')));
    });

    it('vatRate undefined → нет ошибки (миграция/calculator используют DEFAULT_*)', () => {
        const s = { ...validSettings() };
        delete s.vatRate;
        const errors = [];
        validateSettings(s, errors);
        assert.ok(!errors.some(e => e.path.endsWith('.vatRate')));
    });
});

/* ============================================================
 * 3. size-limit на строки в answers (A-P1-2)
 * ============================================================ */

describe('validateCalculation: answers strings size-limit', () => {
    it('answers[id] = строка > 4096 символов → ошибка', () => {
        const c = validCalc();
        c.answers.huge = 'A'.repeat(5000);
        const errors = [];
        validateCalculation(c, errors);
        assert.ok(errors.some(e => e.path.includes('answers.huge')),
            'строка >4KB в answer-значении должна отвергаться (защита от 10MB attack)');
    });

    it('answers[id] = строка ≤ 4096 → нет ошибки', () => {
        const c = validCalc();
        c.answers.normal = 'A'.repeat(100);
        const errors = [];
        validateCalculation(c, errors);
        assert.ok(!errors.some(e => e.path.includes('answers.normal')));
    });
});

/* ============================================================
 * 4. per-question type-check answers (A-P1-3)
 * ============================================================ */

describe('validateCalculation: answers per-question type check', () => {
    it('answers.user_count = {nested:1} (для number-вопроса) → ошибка', () => {
        const c = validCalc();
        c.answers.user_count = { nested: 1 };
        const errors = [];
        validateCalculation(c, errors);
        assert.ok(errors.some(e => e.path.includes('answers.user_count')),
            'Object вместо number должен отвергаться (иначе [object Object] в PDF)');
    });

    it('answers.bool_flag = "yes" (для boolean-вопроса) → ошибка', () => {
        const c = validCalc();
        c.dictionaries.questions.push({ id: 'bool_flag', section: 'business', title: 'B', type: 'boolean', order: 2 });
        c.answers.bool_flag = 'yes';
        const errors = [];
        validateCalculation(c, errors);
        assert.ok(errors.some(e => e.path.includes('answers.bool_flag')),
            'string вместо boolean должен отвергаться');
    });

    it('answers.multi = "x" (для multiselect-вопроса) → ошибка', () => {
        const c = validCalc();
        c.dictionaries.questions.push({ id: 'multi', section: 'business', title: 'M', type: 'multiselect', order: 2,
            options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] });
        c.answers.multi = 'x';
        const errors = [];
        validateCalculation(c, errors);
        assert.ok(errors.some(e => e.path.includes('answers.multi')));
    });

    it('answers.user_count = null (для number) → нет ошибки (null = «Не знаю»)', () => {
        const c = validCalc();
        c.answers.user_count = null;
        const errors = [];
        validateCalculation(c, errors);
        assert.ok(!errors.some(e => e.path.includes('answers.user_count')));
    });

    it('answers.user_count = 100 (валидное) → нет ошибки', () => {
        const c = validCalc();
        const errors = [];
        validateCalculation(c, errors);
        assert.ok(!errors.some(e => e.path.includes('answers.user_count')));
    });
});

/* ============================================================
 * 5. KNOWN_SETTINGS дополнен applyRiskFactors/resourceRatio (B-P1-2)
 * ============================================================ */

describe('lintFormulas: KNOWN_SETTINGS включает applyRiskFactors и resourceRatio', () => {
    it('S.applyRiskFactors не вызывает unknownSetting warning', () => {
        const items = [{ id: 'i1', name: 'I', applicableStands: ['PROD'],
            qtyFormulas: { PROD: 'if(S.applyRiskFactors, 1, 0)' } }];
        const w = lintFormulas(items, []);
        assert.ok(!w.some(x => x.type === 'unknownSetting' && x.ref.startsWith('applyRiskFactors')),
            'applyRiskFactors — реальный параметр расчёта (calc.settings), не должен ругаться');
    });

    it('S.resourceRatio.DEV.CPU не вызывает unknownSetting warning', () => {
        const items = [{ id: 'i1', name: 'I', applicableStands: ['PROD'],
            qtyFormulas: { PROD: 'S.resourceRatio.DEV.CPU' } }];
        const w = lintFormulas(items, []);
        assert.ok(!w.some(x => x.type === 'unknownSetting' && x.ref.startsWith('resourceRatio')),
            'resourceRatio — параметр (12.U12), не должен ругаться');
    });

    it('S.unknownThing всё ещё вызывает warning (whitelist работает)', () => {
        const items = [{ id: 'i1', name: 'I', applicableStands: ['PROD'],
            qtyFormulas: { PROD: 'S.unknownThing' } }];
        const w = lintFormulas(items, []);
        assert.ok(w.some(x => x.type === 'unknownSetting' && x.ref === 'unknownThing'),
            'whitelist не должен пропускать неизвестные параметры');
    });
});

/* ============================================================
 * 7. Дополнительное покрытие validation.js (Subagent D coverage gaps)
 *    — standSizeRatio per-stand ветви, duplicate id, длины строковых полей.
 * ============================================================ */

describe('validateSettings: standSizeRatio per-stand ветви (lines 197-220)', () => {
    it('standSizeRatio = "abc" (не объект) → ошибка', () => {
        const s = { ...validSettings(), standSizeRatio: 'abc' };
        const errors = [];
        validateSettings(s, errors);
        assert.ok(errors.some(e => e.path.endsWith('.standSizeRatio')));
    });

    it('standSizeRatio.DEV = "abc" (не число) → ошибка', () => {
        const s = { ...validSettings(), standSizeRatio: { DEV: 'abc', IFT: 0.4, PSI: 0.5, LOAD: 0.8, PROD: 1.0 } };
        const errors = [];
        validateSettings(s, errors);
        assert.ok(errors.some(e => e.path.includes('standSizeRatio.DEV')));
    });

    it('standSizeRatio.DEV = 99 (выход из диапазона) → ошибка', () => {
        const s = { ...validSettings(), standSizeRatio: { DEV: 99, IFT: 0.4, PSI: 0.5, LOAD: 0.8, PROD: 1.0 } };
        const errors = [];
        validateSettings(s, errors);
        assert.ok(errors.some(e => e.path.includes('standSizeRatio.DEV') && /диапазон/.test(e.message)));
    });

    it('standSizeRatio.PROD = 0.5 (не 1.00) → ошибка (инвариант PROD = эталон)', () => {
        const s = { ...validSettings(), standSizeRatio: { DEV: 0.16, IFT: 0.4, PSI: 0.5, LOAD: 0.8, PROD: 0.5 } };
        const errors = [];
        validateSettings(s, errors);
        assert.ok(errors.some(e => e.path.includes('standSizeRatio.PROD')));
    });

    it('standSizeRatio без одного стенда → ошибка (требуется все 5)', () => {
        const s = { ...validSettings(), standSizeRatio: { DEV: 0.16, IFT: 0.4, PSI: 0.5, PROD: 1.0 } }; // нет LOAD
        const errors = [];
        validateSettings(s, errors);
        assert.ok(errors.some(e => e.path.includes('standSizeRatio.LOAD')));
    });
});

describe('validateCalculation: дубликаты id в items/questions (lines 257-274)', () => {
    it('два item с одинаковым id → ошибка', () => {
        const c = validCalc();
        c.dictionaries.items.push({ ...c.dictionaries.items[0] }); // дубль
        const errors = [];
        validateCalculation(c, errors);
        assert.ok(errors.some(e => e.path.includes('items[1].id') && /Дубликат/.test(e.message)));
    });

    it('два question с одинаковым id → ошибка', () => {
        const c = validCalc();
        c.dictionaries.questions.push({ ...c.dictionaries.questions[0] }); // дубль
        const errors = [];
        validateCalculation(c, errors);
        assert.ok(errors.some(e => e.path.includes('questions[1].id') && /Дубликат/.test(e.message)));
    });
});

describe('validateItem: длины строковых полей (lines 50-60)', () => {
    function validItem() {
        return {
            id: 'i', name: 'N', unit: 'шт.', pricePerUnit: 100,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            applicableStands: ['PROD'], qtyFormulas: { PROD: '1' }
        };
    }

    it('vendor > VENDOR_MAX → ошибка', async () => {
        const { VALIDATION } = await import('../../../js/utils/constants.js');
        const r = validate({ ...validItem(), vendor: 'A'.repeat(VALIDATION.VENDOR_MAX + 1) }, 'item');
        assert.ok(r.errors.some(e => e.path.endsWith('.vendor')));
    });

    it('description > DESC_MAX → ошибка', async () => {
        const { VALIDATION } = await import('../../../js/utils/constants.js');
        const r = validate({ ...validItem(), description: 'A'.repeat(VALIDATION.DESC_MAX + 1) }, 'item');
        assert.ok(r.errors.some(e => e.path.endsWith('.description')));
    });

    it('formulaHelp > HELP_MAX → ошибка', async () => {
        const { VALIDATION } = await import('../../../js/utils/constants.js');
        const r = validate({ ...validItem(), formulaHelp: 'A'.repeat(VALIDATION.HELP_MAX + 1) }, 'item');
        assert.ok(r.errors.some(e => e.path.endsWith('.formulaHelp')));
    });

    it('vendor не строка → ошибка', () => {
        const r = validate({ ...validItem(), vendor: 123 }, 'item');
        assert.ok(r.errors.some(e => e.path.endsWith('.vendor')));
    });

    it('priceUpdatedAt не парсится Date.parse → ошибка', () => {
        const r = validate({ ...validItem(), priceUpdatedAt: 'not-a-date' }, 'item');
        assert.ok(r.errors.some(e => e.path.endsWith('.priceUpdatedAt')));
    });

    it('priceSource = "auto" (deprecated) → ошибка', () => {
        const r = validate({ ...validItem(), priceSource: 'auto' }, 'item');
        assert.ok(r.errors.some(e => e.path.endsWith('.priceSource')));
    });

    it('costType = "FOOBAR" → ошибка', () => {
        const r = validate({ ...validItem(), costType: 'FOOBAR' }, 'item');
        assert.ok(r.errors.some(e => e.path.endsWith('.costType')));
    });
});

/* ============================================================
 * 6. calculator.js — bufferTask/bufferProject через ?? DEFAULT_* (B-P1-3)
 * ============================================================ */

describe('calculator: bufferTask/bufferProject используют DEFAULT_* при отсутствии', () => {
    const item = { id: 'i', applicableStands: ['PROD'], category: 'HW',
        billingInterval: 'monthly', resourceClass: 'CPU' };

    it('settings без bufferTask → используется DEFAULT_BUFFER_TASK (0.30)', () => {
        const s = { ...validSettings() };
        delete s.bufferTask;
        const r = riskFactor(item, 'PROD', s);
        // bufferFactor = (1 + DEFAULT_BUFFER_TASK) * (1 + bufferProject)
        const expected = (1 + DEFAULT_BUFFER_TASK) * (1 + 0.15);
        assert.ok(Math.abs(r.bufferFactor - expected) < 1e-9,
            `bufferFactor=${r.bufferFactor}, ожидалось ${expected} (с DEFAULT_BUFFER_TASK=${DEFAULT_BUFFER_TASK})`);
    });

    it('settings без bufferProject → используется DEFAULT_BUFFER_PROJECT (0.15)', () => {
        const s = { ...validSettings() };
        delete s.bufferProject;
        const r = riskFactor(item, 'PROD', s);
        const expected = (1 + 0.30) * (1 + DEFAULT_BUFFER_PROJECT);
        assert.ok(Math.abs(r.bufferFactor - expected) < 1e-9,
            `bufferFactor=${r.bufferFactor}, ожидалось ${expected}`);
    });

    it('settings с bufferTask = NaN → fallback на DEFAULT (не молчаливый 0)', () => {
        const s = { ...validSettings(), bufferTask: NaN };
        const r = riskFactor(item, 'PROD', s);
        const expected = (1 + DEFAULT_BUFFER_TASK) * (1 + 0.15);
        assert.ok(Math.abs(r.bufferFactor - expected) < 1e-9,
            `NaN-bufferTask должен fallback'нуть на DEFAULT (текущая реализация даёт 0)`);
    });
});
