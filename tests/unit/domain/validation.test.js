import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    validate, validateItem, validateQuestion, validateSettings, validateCalculation,
    lintFormulas, findQuestionUsages
} from '../../../js/domain/validation.js';

const goodItem = () => ({
    id: 'x', name: 'X', unit: 'шт', pricePerUnit: 100,
    category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
    vendor: '', description: '',
    applicableStands: ['PROD'],
    qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '5', LOAD: '' }
});

const goodQuestion = () => ({
    id: 'q_x', section: 'business', title: 'X', type: 'number',
    defaultValue: 0, order: 10, min: 0, max: 100, step: 1
});

describe('validateItem', () => {
    it('accepts well-formed item', () => {
        const errors = [];
        validateItem(goodItem(), errors);
        assert.equal(errors.length, 0);
    });
    it('rejects missing id', () => {
        const errors = [];
        validateItem({ ...goodItem(), id: '' }, errors);
        assert.ok(errors.length > 0);
    });
    it('rejects invalid category', () => {
        const errors = [];
        validateItem({ ...goodItem(), category: 'BAD' }, errors);
        assert.ok(errors.some(e => /Категория/.test(e.message)));
    });
    it('rejects invalid billingInterval', () => {
        const errors = [];
        validateItem({ ...goodItem(), billingInterval: 'weekly' }, errors);
        assert.ok(errors.length > 0);
    });
    it('rejects missing resourceClass', () => {
        const errors = [];
        const item = goodItem();
        delete item.resourceClass;
        validateItem(item, errors);
        assert.ok(errors.some(e => /resourceClass/.test(e.message)));
    });
    it('rejects unknown resourceClass', () => {
        const errors = [];
        validateItem({ ...goodItem(), resourceClass: 'UNKNOWN' }, errors);
        assert.ok(errors.some(e => /resourceClass|Класс/.test(e.message)));
    });
    it('rejects negative price', () => {
        const errors = [];
        validateItem({ ...goodItem(), pricePerUnit: -1 }, errors);
        assert.ok(errors.length > 0);
    });
    it('rejects too long name', () => {
        const errors = [];
        validateItem({ ...goodItem(), name: 'a'.repeat(200) }, errors);
        assert.ok(errors.length > 0);
    });
    it('rejects unknown stand in applicableStands', () => {
        const errors = [];
        validateItem({ ...goodItem(), applicableStands: ['XYZ'] }, errors);
        assert.ok(errors.length > 0);
    });
    it('rejects bad formula syntax', () => {
        const errors = [];
        validateItem({
            ...goodItem(),
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1 + +', LOAD: '' }
        }, errors);
        assert.ok(errors.some(e => /Ошибка формулы/.test(e.message)));
    });
});

describe('validateQuestion', () => {
    it('accepts well-formed question', () => {
        const errors = [];
        validateQuestion(goodQuestion(), errors);
        assert.equal(errors.length, 0);
    });
    it('rejects bad id format', () => {
        const errors = [];
        validateQuestion({ ...goodQuestion(), id: '1bad' }, errors);
        assert.ok(errors.length > 0);
    });
    it('rejects unknown section', () => {
        const errors = [];
        validateQuestion({ ...goodQuestion(), section: 'unknown' }, errors);
        assert.ok(errors.length > 0);
    });
    it('rejects unknown type', () => {
        const errors = [];
        validateQuestion({ ...goodQuestion(), type: 'date' }, errors);
        assert.ok(errors.length > 0);
    });
    it('rejects select without options', () => {
        const errors = [];
        validateQuestion({ ...goodQuestion(), type: 'select', options: [] }, errors);
        assert.ok(errors.length > 0);
    });
    it('accepts select with options', () => {
        const errors = [];
        /* Audit #13 (PATCH 2.18.6, P2#5): defaultValue теперь проверяется
         * по типу — для select должен быть из options. Раньше goodQuestion()
         * spread приносил `defaultValue: 0` (валид для number), но для
         * select с options [{value:'a'}] это invalid. Явно убираем поле
         * (= нет default, OK). */
        const { defaultValue, ...base } = goodQuestion();
        validateQuestion({
            ...base,
            type: 'select',
            options: [{ value: 'a', label: 'A' }]
        }, errors);
        assert.equal(errors.length, 0);
    });
});

describe('validateSettings', () => {
    it('accepts valid settings (schema v2)', () => {
        const errors = [];
        validateSettings({
            period: 'monthly', bufferTask: 0.3, bufferProject: 0.15,
            kInflation: 0.1, kSeasonal: 0, kScheduleShift: 0.15, kContingency: 0.05,
            vatEnabled: true, vatRate: 0.20, planningHorizonYears: 1,
            daysPerMonth: 30, phaseDurationMonths: 4
        }, errors);
        assert.equal(errors.length, 0, JSON.stringify(errors));
    });
    it('rejects bad period', () => {
        const errors = [];
        validateSettings({
            period: 'weekly', bufferTask: 0.3, bufferProject: 0.15
        }, errors);
        assert.ok(errors.length > 0);
    });
    it('rejects negative phaseDurationMonths', () => {
        const errors = [];
        validateSettings({
            period: 'monthly', bufferTask: 0.3, bufferProject: 0.15,
            phaseDurationMonths: -5
        }, errors);
        assert.ok(errors.length > 0);
    });
    it('rejects vatRate вне диапазона', () => {
        const errors = [];
        validateSettings({
            period: 'monthly', vatEnabled: true, vatRate: 5
        }, errors);
        assert.ok(errors.length > 0);
    });
    it('требует PROD = 1.00 в standSizeRatio', () => {
        const errors = [];
        validateSettings({
            period: 'monthly',
            standSizeRatio: { DEV: 0.3, IFT: 0.5, PSI: 0.7, PROD: 0.95, LOAD: 0.5 }
        }, errors);
        assert.ok(errors.some(e => /PROD/.test(e.message)));
    });
});

describe('lintFormulas', () => {
    it('returns no warnings for valid formulas', () => {
        const items = [{
            ...goodItem(),
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: 'Q.x * 2', LOAD: '' }
        }];
        const questions = [{ id: 'x', section: 'business', title: 'X', type: 'number', order: 1 }];
        assert.equal(lintFormulas(items, questions).length, 0);
    });
    it('flags unknown question reference', () => {
        const items = [{
            ...goodItem(),
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: 'Q.unknown', LOAD: '' }
        }];
        const w = lintFormulas(items, []);
        assert.equal(w.length, 1);
        assert.equal(w[0].type, 'unknownQuestion');
    });
    it('flags unknown setting reference', () => {
        const items = [{
            ...goodItem(),
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: 'S.bogus', LOAD: '' }
        }];
        const w = lintFormulas(items, []);
        assert.ok(w.some(x => x.type === 'unknownSetting'));
    });
    it('flags parse errors', () => {
        const items = [{
            ...goodItem(),
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1 + +', LOAD: '' }
        }];
        const w = lintFormulas(items, []);
        assert.equal(w[0].type, 'parseError');
    });
    it('skips non-applicable stands', () => {
        const items = [{
            ...goodItem(),
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: 'Q.unknown', IFT: '', PSI: '', PROD: '5', LOAD: '' }
        }];
        assert.equal(lintFormulas(items, []).length, 0);
    });
});

describe('findQuestionUsages', () => {
    it('returns empty when no usages', () => {
        const items = [{ ...goodItem(), qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '5', LOAD: '' } }];
        assert.deepEqual(findQuestionUsages('any', items), []);
    });
    it('finds usage in single stand', () => {
        const items = [{
            ...goodItem(),
            id: 'a', name: 'A',
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: 'Q.pcu', LOAD: '' }
        }];
        const u = findQuestionUsages('pcu', items);
        assert.equal(u.length, 1);
        assert.equal(u[0].itemId, 'a');
        assert.equal(u[0].stand, 'PROD');
    });
    it('finds usages across multiple items and stands', () => {
        const items = [
            {
                ...goodItem(), id: 'a', name: 'A',
                applicableStands: ['PSI', 'PROD'],
                qtyFormulas: { DEV: '', IFT: '', PSI: 'Q.pcu', PROD: 'Q.pcu * 2', LOAD: '' }
            },
            {
                ...goodItem(), id: 'b', name: 'B',
                qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: 'Q.users / Q.pcu', LOAD: '' }
            }
        ];
        const u = findQuestionUsages('pcu', items);
        assert.equal(u.length, 3);
    });
});

describe('validate (top-level wrapper)', () => {
    it('returns valid:true for good data', () => {
        const r = validate(goodItem(), 'item');
        assert.equal(r.valid, true);
    });
    it('returns valid:false for bad data', () => {
        const r = validate({ ...goodItem(), category: 'BAD' }, 'item');
        assert.equal(r.valid, false);
        assert.ok(r.errors.length > 0);
    });
});

describe('validateCalculation: view.disabledStands (опциональный)', () => {
    const baseCalc = () => ({
        id: 'c1', name: 'Calc', version: '1.0',
        settings: {
            period: 'monthly', bufferTask: 0.3, bufferProject: 0.15,
            kInflation: 0.1, kSeasonal: 0, kScheduleShift: 0.15, kContingency: 0.05,
            vatEnabled: true, vatRate: 0.20, planningHorizonYears: 1,
            daysPerMonth: 30, phaseDurationMonths: 4
        },
        answers: {},
        dictionaries: { items: [], questions: [] }
    });

    it('valid: view с непустым disabledStands из STAND_IDS', () => {
        const errors = [];
        validateCalculation({ ...baseCalc(), view: { disabledStands: ['DEV', 'LOAD'] } }, errors);
        assert.equal(errors.length, 0, JSON.stringify(errors));
    });

    it('valid: view с пустым disabledStands', () => {
        const errors = [];
        validateCalculation({ ...baseCalc(), view: { disabledStands: [] } }, errors);
        assert.equal(errors.length, 0, JSON.stringify(errors));
    });

    it('valid: расчёт без view вообще', () => {
        const errors = [];
        validateCalculation(baseCalc(), errors);
        assert.equal(errors.length, 0, JSON.stringify(errors));
    });

    it('invalid: неизвестный стенд в view.disabledStands', () => {
        const errors = [];
        validateCalculation({ ...baseCalc(), view: { disabledStands: ['UNKNOWN'] } }, errors);
        assert.ok(errors.some(e => /Неизвестный стенд/.test(e.message)),
            JSON.stringify(errors));
    });

    it('invalid: view.disabledStands не массив', () => {
        const errors = [];
        validateCalculation({ ...baseCalc(), view: { disabledStands: 'not-array' } }, errors);
        assert.ok(errors.some(e => /должен быть массивом/.test(e.message)),
            JSON.stringify(errors));
    });

    it('invalid: view не объект', () => {
        const errors = [];
        validateCalculation({ ...baseCalc(), view: 'not-object' }, errors);
        assert.ok(errors.some(e => /view должен быть объектом/.test(e.message)),
            JSON.stringify(errors));
    });
});
