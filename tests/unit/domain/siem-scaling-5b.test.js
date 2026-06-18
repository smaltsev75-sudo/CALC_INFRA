/**
 * Stage 5B-Sec / SIEM scaling (2026-06-18, Вариант A).
 *
 * Масштабируем 2 SIEM-ЭК opt-in драйверами, БЕЗ golden-дрейфа для legacy:
 *  - security-siem-monitoring ← siem_log_gb_per_day (контур до N ГБ/день; тир задаёт N: basic50/standard25/enterprise10);
 *  - one-siem-integration     ← siem_sources_count (проект до 10 источников).
 * При драйверах=0 → текущая flat qty=1 (стоимость не меняется). siem_tier влияет
 * только при siem_log_gb_per_day>0. Коэффициенты — инженерная оценка, уточняются по КП.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSeedDictionaries, defaultAnswersFrom, SEED_ITEMS, enrichLegacyDictionaryWithAgentSeed
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { evaluateCalculationHealth } from '../../../js/domain/calculationHealth.js';

const MON = 'security-siem-monitoring';
const INT = 'one-siem-integration';

function qty(answers) {
    const D = buildSeedDictionaries();
    const A = defaultAnswersFrom(D.questions);
    const calc = {
        id: 't', name: 't', schemaVersion: 12,
        answers: { ...A, ...answers },
        answersMeta: {}, settings: { ...D.settings },
        dictionaries: D, view: { disabledStands: [] }, providerVersion: null
    };
    const r = calculate(calc, null);
    // MON/INT — PROD-only ЭК; читаем именно PROD (итерация по всем стендам
    // перезаписала бы PROD-значение нулём с неприменимого стенда LOAD).
    const prod = r.stands.PROD.items;
    const pick = (id) => { const c = prod.find(x => x.itemId === id); return c ? c.qty : 0; };
    return { [MON]: pick(MON), [INT]: pick(INT) };
}

describe('5B SIEM scaling: fallback без дрейфа', () => {
    it('оба драйвера 0 → monitoring qty=1, integration qty=1 (текущее поведение)', () => {
        const q = qty({ siem_integration_required: true, siem_log_gb_per_day: 0, siem_sources_count: 0 });
        assert.equal(q[MON], 1);
        assert.equal(q[INT], 1);
    });
    it('siem_integration_required=false → оба qty=0 даже при заданных драйверах', () => {
        const q = qty({ siem_integration_required: false, siem_log_gb_per_day: 1000, siem_sources_count: 100, siem_tier: 'enterprise' });
        assert.equal(q[MON], 0);
        assert.equal(q[INT], 0);
    });
});

describe('5B SIEM scaling: monitoring ← siem_log_gb_per_day', () => {
    it('log=100, tier=basic (50 ГБ/контур) → monitoring qty=2, integration НЕ меняется (=1)', () => {
        const q = qty({ siem_integration_required: true, siem_log_gb_per_day: 100, siem_tier: 'basic' });
        assert.equal(q[MON], 2);
        assert.equal(q[INT], 1);
    });
});

describe('5B SIEM scaling: integration ← siem_sources_count', () => {
    it('sources=25 (10/проект) → integration qty=3, monitoring НЕ меняется (=1)', () => {
        const q = qty({ siem_integration_required: true, siem_sources_count: 25 });
        assert.equal(q[INT], 3);
        assert.equal(q[MON], 1);
    });
});

describe('5B SIEM scaling: siem_tier влияет только при log_gb>0', () => {
    it('tier=enterprise, log=0 → qty=1 (тир игнорируется на fallback)', () => {
        assert.equal(qty({ siem_integration_required: true, siem_log_gb_per_day: 0, siem_tier: 'enterprise' })[MON], 1);
    });
    it('log=50: basic→1, standard→2, enterprise→5', () => {
        assert.equal(qty({ siem_integration_required: true, siem_log_gb_per_day: 50, siem_tier: 'basic' })[MON], 1);
        assert.equal(qty({ siem_integration_required: true, siem_log_gb_per_day: 50, siem_tier: 'standard' })[MON], 2);
        assert.equal(qty({ siem_integration_required: true, siem_log_gb_per_day: 50, siem_tier: 'enterprise' })[MON], 5);
    });
});

describe('5B SIEM scaling: health-check flat-оценки', () => {
    function makeCalc(answers) {
        return {
            id: 't', name: 't', schemaVersion: 12, answers: { ...answers },
            settings: { applyRiskFactors: true }, answersMeta: {},
            dictionaries: { questions: [], items: [], settings: {} }, view: {}
        };
    }
    const find = (calc) => evaluateCalculationHealth(calc).findings.find(f => f.id === 'security-siem-flat-estimate');

    it('siem on + оба драйвера 0 → info', () => {
        const f = find(makeCalc({ siem_integration_required: true, siem_log_gb_per_day: 0, siem_sources_count: 0 }));
        assert.ok(f, 'finding должен существовать');
        assert.equal(f.severity, 'info');
        assert.equal(f.category, 'security');
    });
    it('siem on + log>0 → нет finding', () => {
        assert.equal(find(makeCalc({ siem_integration_required: true, siem_log_gb_per_day: 10, siem_sources_count: 0 })), undefined);
    });
    it('siem on + sources>0 → нет finding', () => {
        assert.equal(find(makeCalc({ siem_integration_required: true, siem_log_gb_per_day: 0, siem_sources_count: 5 })), undefined);
    });
    it('siem off → нет finding', () => {
        assert.equal(find(makeCalc({ siem_integration_required: false, siem_log_gb_per_day: 0, siem_sources_count: 0 })), undefined);
    });
});

describe('5B SIEM scaling: legacy-enrichment рефрешит формулы', () => {
    it('старый calc со flat-формулами SIEM-ЭК получает новые qtyFormulas', () => {
        const D = buildSeedDictionaries();
        const dict = JSON.parse(JSON.stringify(D));
        for (const it of dict.items) {
            if (it.id === MON || it.id === INT) {
                it.qtyFormulas = { PROD: 'if(Q.siem_integration_required, 1, 0)' }; // старая flat
                it.formulaHelp = 'qty = 1 при Q.siem_integration_required.';
            }
        }
        const calc = {
            id: 'leg', name: 'legacy', schemaVersion: 12,
            answers: {}, answersMeta: {}, settings: { ...D.settings },
            dictionaries: dict, view: { disabledStands: [] }, providerVersion: null
        };
        enrichLegacyDictionaryWithAgentSeed(calc);
        const mon = calc.dictionaries.items.find(i => i.id === MON);
        const int = calc.dictionaries.items.find(i => i.id === INT);
        assert.match(mon.qtyFormulas.PROD, /siem_log_gb_per_day/, 'monitoring-формула должна стать масштабируемой');
        assert.match(int.qtyFormulas.PROD, /siem_sources_count/, 'integration-формула должна стать масштабируемой');
    });
});

describe('5B SIEM scaling: arch-guard', () => {
    const mon = SEED_ITEMS.find(i => i.id === MON);
    const int = SEED_ITEMS.find(i => i.id === INT);
    it('unit/price не изменились', () => {
        assert.equal(mon.unit, 'контур');
        assert.equal(mon.pricePerUnit, 50000);
        assert.equal(int.unit, 'проект');
        assert.equal(int.pricePerUnit, 350000);
    });
    it('формулы ссылаются на новые драйверы + tier, formulaHelp непустой', () => {
        assert.match(mon.qtyFormulas.PROD, /siem_log_gb_per_day/);
        assert.match(mon.qtyFormulas.PROD, /siem_tier/);
        assert.match(int.qtyFormulas.PROD, /siem_sources_count/);
        assert.ok(mon.formulaHelp.length > 0 && int.formulaHelp.length > 0);
    });
});
