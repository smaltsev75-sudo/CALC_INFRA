/**
 * 5B-S: две новые health-проверки сезонности.
 *
 *  1. risk-seasonal-too-many-peak-months (warning): seasonal_activity=true и выбрано >4
 *     пиковых месяцев. Мягкая валидация — расчёт НЕ обрезается (пользователь может реально
 *     иметь длинный сезон), но предупреждаем: это уже почти постоянная нагрузка.
 *
 *  2. risk-seasonal-surcharge-manual (info): зеркало checkSeasonalActivityNotApplied.
 *     В Опроснике сезонность НЕ включена, но сезонный коэффициент задан вручную (kSeasonal>0
 *     при дефолте 0) и риск-коэффициенты включены → надбавка применяется. Информируем.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCalculationHealth } from '../../../js/domain/calculationHealth.js';

function makeCalc(answers = {}, settings = {}) {
    return {
        id: 't', name: 't', schemaVersion: 12,
        answers: { ...answers },
        settings: { applyRiskFactors: true, kSeasonal: 0, ...settings },
        answersMeta: {},
        dictionaries: {
            questions: [
                { id: 'pcu_target', type: 'number', defaultValue: 500 },
                { id: 'sla_target', type: 'select', defaultValue: 99.9 }
            ],
            items: [],
            settings: {}
        },
        view: {}
    };
}

function find(calc, id) {
    return evaluateCalculationHealth(calc).findings.find(f => f.id === id);
}

describe('5B-S health: risk-seasonal-too-many-peak-months', () => {
    it('5 месяцев при включённой сезонности → warning', () => {
        const f = find(
            makeCalc({ seasonal_activity: true, peak_months: ['jan', 'feb', 'mar', 'apr', 'may'] }),
            'risk-seasonal-too-many-peak-months'
        );
        assert.ok(f, 'finding должен существовать');
        assert.equal(f.severity, 'warning');
        assert.equal(f.category, 'risk');
        assert.match(f.message, /5/);
    });

    it('4 месяца → нет finding (граница ≤4 не триггерит)', () => {
        const f = find(
            makeCalc({ seasonal_activity: true, peak_months: ['jan', 'feb', 'mar', 'apr'] }),
            'risk-seasonal-too-many-peak-months'
        );
        assert.equal(f, undefined);
    });

    it('сезонность выключена → нет finding даже при 6 месяцах', () => {
        const f = find(
            makeCalc({ seasonal_activity: false, peak_months: ['jan', 'feb', 'mar', 'apr', 'may', 'jun'] }),
            'risk-seasonal-too-many-peak-months'
        );
        assert.equal(f, undefined);
    });

    it('peak_months не массив (null) → не падает, нет finding', () => {
        const f = find(
            makeCalc({ seasonal_activity: true, peak_months: null }),
            'risk-seasonal-too-many-peak-months'
        );
        assert.equal(f, undefined);
    });
});

describe('5B-S health: risk-seasonal-surcharge-manual', () => {
    it('seasonal_activity=false + kSeasonal>0 → info с процентом', () => {
        const f = find(
            makeCalc({ seasonal_activity: false }, { kSeasonal: 0.2 }),
            'risk-seasonal-surcharge-manual'
        );
        assert.ok(f, 'finding должен существовать');
        assert.equal(f.severity, 'info');
        assert.equal(f.category, 'risk');
        assert.match(f.message, /20/);
    });

    it('seasonal_activity не указан + kSeasonal>0 → info (как и false)', () => {
        const f = find(
            makeCalc({}, { kSeasonal: 0.15 }),
            'risk-seasonal-surcharge-manual'
        );
        assert.ok(f, 'finding должен существовать при незаполненной сезонности');
    });

    it('seasonal_activity=true → нет finding (обратный случай покрыт другой проверкой)', () => {
        const f = find(
            makeCalc({ seasonal_activity: true }, { kSeasonal: 0.2 }),
            'risk-seasonal-surcharge-manual'
        );
        assert.equal(f, undefined);
    });

    it('kSeasonal=0 (дефолт) → нет finding (не шумит на типовых расчётах)', () => {
        const f = find(
            makeCalc({ seasonal_activity: false }, { kSeasonal: 0 }),
            'risk-seasonal-surcharge-manual'
        );
        assert.equal(f, undefined);
    });

    it('applyRiskFactors=false → нет finding (надбавка вообще не применяется)', () => {
        const f = find(
            makeCalc({ seasonal_activity: false }, { kSeasonal: 0.2, applyRiskFactors: false }),
            'risk-seasonal-surcharge-manual'
        );
        assert.equal(f, undefined);
    });
});
