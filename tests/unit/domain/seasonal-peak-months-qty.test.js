/**
 * 5B-S: регресс-замок поведения qty позиции one-seasonal-load-readiness.
 *
 * НЕ баг (репро 2026-06-18): формула `if(Q.seasonal_activity, max(1, Q.peak_months), 0)`
 * корректно считает peak_months (multiselect) как длину массива, потому что
 * evaluator.toNum(array) = array.length (evaluator.js:33). Изначальный «peak_months-as-number
 * bug» был предположением, которое не воспроизвелось.
 *
 * Этот тест ФИКСИРУЕТ контракт qty = число выбранных месяцев (минимум 1 при включённой
 * сезонности; 0 при выключенной), чтобы будущий «фикс» формулы (например замена на мнимый
 * count()) не сломал рабочую логику.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeedDictionaries, defaultAnswersFrom } from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';

function qtyOf(peakMonths, seasonal = true) {
    const D = buildSeedDictionaries();
    const A = defaultAnswersFrom(D.questions);
    const calc = {
        id: 't', name: 't', schemaVersion: 12,
        answers: { ...A, seasonal_activity: seasonal, peak_months: peakMonths },
        answersMeta: {}, settings: { ...D.settings },
        dictionaries: D, view: { disabledStands: [] }, providerVersion: null
    };
    const r = calculate(calc, null);
    let q = 0;
    for (const x of r.stands.PROD.items) if (x.itemId === 'one-seasonal-load-readiness') q = x.qty;
    return q;
}

describe('5B-S: one-seasonal-load-readiness qty = число выбранных peak_months', () => {
    it('2 месяца → qty 2', () => assert.equal(qtyOf(['nov', 'dec']), 2));
    it('пустой выбор при включённой сезонности → минимум 1', () => assert.equal(qtyOf([]), 1));
    it('6 месяцев → qty 6', () => assert.equal(qtyOf(['jan', 'feb', 'mar', 'apr', 'may', 'jun']), 6));
    it('12 месяцев → qty 12', () =>
        assert.equal(qtyOf(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']), 12));
    it('сезонность выключена → qty 0 (даже если месяцы выбраны)', () => assert.equal(qtyOf(['nov', 'dec'], false), 0));
});
