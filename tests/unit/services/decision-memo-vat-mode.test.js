/**
 * Stage VAT-1 Phase 5: Decision Memo — строка о ставке НДС.
 *
 * Проверяет, что summary-section memo содержит расширенную VAT-строку
 * с режимом и датой (auto/manual/frozen), а не только процент.
 *
 * Функциональный тест (а не regex по исходнику) — через прямой вызов
 * buildDecisionMemoMarkdown с разными calc-формами.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildDecisionMemoMarkdown } from '../../../js/services/decisionMemoExport.js';

function baseCalc(extra = {}) {
    return {
        name: 'Test',
        createdAt: '2026-05-12T10:00:00Z',
        updatedAt: '2026-05-12T10:00:00Z',
        settings: {
            provider: 'sbercloud',
            applyRiskFactors: true,
            planningHorizonYears: 1,
            phaseDurationMonths: 6,
            ...extra
        },
        dictionaries: { items: [], questions: [], categories: [] },
        answers: {}
    };
}

function memoFor(calcExtra, ctx = {}) {
    /* Сигнатура: buildDecisionMemoMarkdown(calc, context). */
    return buildDecisionMemoMarkdown(baseCalc(calcExtra), ctx);
}

describe('Decision Memo: VAT line — режим auto-by-date', () => {
    it('mode=auto-by-date + rate=0.22 + effectiveDate → строка содержит mode + date в RU-формате', () => {
        const memo = memoFor({
            vatEnabled: true,
            vatRate: 0.22,
            vatRateMode: 'auto-by-date',
            vatEffectiveDate: '2026-05-12'
        });
        /* VAT-1 Phase 7: дата выводится через formatDate → 12.05.2026 (RU). */
        assert.match(memo, /Ставка НДС.*22%.*авто.*дата ставки.*12\.05\.2026/);
    });

    it('mode=auto-by-date без даты → строка только с «авто»', () => {
        const memo = memoFor({
            vatEnabled: true,
            vatRate: 0.22,
            vatRateMode: 'auto-by-date',
            vatEffectiveDate: null
        });
        assert.match(memo, /Ставка НДС.*22%.*\(авто\)/);
    });
});

describe('Decision Memo: VAT line — режим manual', () => {
    it('mode=manual → «вручную»', () => {
        const memo = memoFor({
            vatEnabled: true,
            vatRate: 0.18,
            vatRateMode: 'manual',
            vatEffectiveDate: null
        });
        assert.match(memo, /Ставка НДС.*18%.*вручную/);
        /* manual не показывает дату даже если effectiveDate выставлен. */
        assert.doesNotMatch(memo, /Ставка НДС.*вручную.*дата/);
    });
});

describe('Decision Memo: VAT line — режим frozen', () => {
    it('mode=frozen + date → «заморожено, дата фиксации …» (RU-формат)', () => {
        const memo = memoFor({
            vatEnabled: true,
            vatRate: 0.20,
            vatRateMode: 'frozen',
            vatEffectiveDate: '2024-06-01'
        });
        assert.match(memo, /Ставка НДС.*20%.*заморожено.*дата фиксации.*01\.06\.2024/);
    });

    it('mode=frozen без даты → только «заморожено»', () => {
        const memo = memoFor({
            vatEnabled: true,
            vatRate: 0.20,
            vatRateMode: 'frozen',
            vatEffectiveDate: null
        });
        assert.match(memo, /Ставка НДС.*20%.*\(заморожено\)/);
        assert.doesNotMatch(memo, /Ставка НДС.*заморожено.*дата/);
    });
});

describe('Decision Memo: vatEnabled=false → «не учитывается»', () => {
    it('vatEnabled=false → строка «НДС: не учитывается»', () => {
        const memo = memoFor({
            vatEnabled: false,
            vatRate: 0.22,
            vatRateMode: 'auto-by-date'
        });
        assert.match(memo, /НДС.*не учитывается/);
        /* Когда НДС не учитывается — режим / дата не должны выводиться. */
        assert.doesNotMatch(memo, /Ставка НДС/);
    });
});

describe('Decision Memo: VAT line не называет НДС риском', () => {
    it('Нет фразы «риск НДС» / «НДС-риск» / «VAT risk» в memo', () => {
        const memo = memoFor({
            vatEnabled: true,
            vatRate: 0.22,
            vatRateMode: 'auto-by-date',
            vatEffectiveDate: '2026-05-12'
        });
        assert.doesNotMatch(memo, /риск\s+НДС|НДС[-\s]риск|VAT\s+risk/i);
    });
});
