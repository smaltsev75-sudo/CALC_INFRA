/**
 * Stage 5B-Sec / DDoS tier-select (2026-06-18, Вариант A).
 *
 * Масштабируем network-ddos-protection тиром защиты, БЕЗ golden-дрейфа:
 *  - ddos_tier: basic_l3_l4 (×1 = 30к) / l7 (×4 ≈ 120к) / premium (×16 ≈ 480к).
 *  - unit/pricePerUnit НЕ меняются — масштабируем qty.
 *  - tier влияет только при ddos_protection_required=true; default basic_l3_l4 = текущая сумма.
 *  - Множители — инженерная оценка, уточняются по КП.
 * Health-info: ddos on + basic + критичный/регулируемый профиль (fstec/siem/dlp/b2g; НЕ pdn).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSeedDictionaries, defaultAnswersFrom, SEED_ITEMS, enrichLegacyDictionaryWithAgentSeed
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { evaluateCalculationHealth } from '../../../js/domain/calculationHealth.js';

const ID = 'network-ddos-protection';

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
    // PROD-only ЭК — читаем PROD напрямую (итерация по стендам перезаписала бы 0 с LOAD).
    const c = r.stands.PROD.items.find(x => x.itemId === ID);
    return c ? c.qty : 0;
}

describe('5B DDoS tier: qty по классу защиты', () => {
    it('fallback basic_l3_l4 → qty=1 (текущее, без дрейфа)', () => {
        assert.equal(qty({ ddos_protection_required: true, ddos_tier: 'basic_l3_l4' }), 1);
    });
    it('default (tier не задан) → qty=1 (basic)', () => {
        assert.equal(qty({ ddos_protection_required: true }), 1);
    });
    it('l7 → qty=4', () => {
        assert.equal(qty({ ddos_protection_required: true, ddos_tier: 'l7' }), 4);
    });
    it('premium → qty=16', () => {
        assert.equal(qty({ ddos_protection_required: true, ddos_tier: 'premium' }), 16);
    });
    it('ddos=false → qty=0 при любом tier', () => {
        assert.equal(qty({ ddos_protection_required: false, ddos_tier: 'premium' }), 0);
        assert.equal(qty({ ddos_protection_required: false, ddos_tier: 'l7' }), 0);
    });
});

describe('5B DDoS tier: legacy-enrichment рефрешит формулу', () => {
    it('старый calc с flat-формулой получает новую qtyFormula (через _AGENT_FORMULA_REFRESH_IDS)', () => {
        const D = buildSeedDictionaries();
        const dict = JSON.parse(JSON.stringify(D));
        const legacy = dict.items.find(i => i.id === ID);
        legacy.qtyFormulas = { PROD: 'if(Q.ddos_protection_required, 1, 0)' };
        legacy.formulaHelp = 'qty = 1 при Q.ddos_protection_required.';
        const calc = {
            id: 'leg', name: 'legacy', schemaVersion: 12, answers: {}, answersMeta: {},
            settings: { ...D.settings }, dictionaries: dict, view: { disabledStands: [] }, providerVersion: null
        };
        enrichLegacyDictionaryWithAgentSeed(calc);
        const refreshed = calc.dictionaries.items.find(i => i.id === ID);
        assert.match(refreshed.qtyFormulas.PROD, /ddos_tier/, 'формула должна стать тир-масштабируемой');
    });
});

describe('5B DDoS tier: health-check basic + критичный профиль', () => {
    function makeCalc(answers) {
        return {
            id: 't', name: 't', schemaVersion: 12, answers: { ...answers },
            settings: { applyRiskFactors: true }, answersMeta: {},
            dictionaries: { questions: [], items: [], settings: {} }, view: {}
        };
    }
    const find = (c) => evaluateCalculationHealth(c).findings.find(f => f.id === 'security-ddos-basic-tier-critical');

    it('ddos on + basic + dlp_required → info', () => {
        const f = find(makeCalc({ ddos_protection_required: true, ddos_tier: 'basic_l3_l4', dlp_required: true }));
        assert.ok(f, 'finding должен существовать');
        assert.equal(f.severity, 'info');
        assert.equal(f.category, 'security');
    });
    it('ddos on + basic + product_type=b2g → info', () => {
        assert.ok(find(makeCalc({ ddos_protection_required: true, ddos_tier: 'basic_l3_l4', product_type: 'b2g' })));
    });
    it('ddos on + basic + siem_integration_required → info', () => {
        assert.ok(find(makeCalc({ ddos_protection_required: true, ddos_tier: 'basic_l3_l4', siem_integration_required: true })));
    });
    it('ddos on + basic + non-critical → нет finding', () => {
        assert.equal(find(makeCalc({ ddos_protection_required: true, ddos_tier: 'basic_l3_l4' })), undefined);
    });
    it('ddos on + l7 + critical → нет finding (тир выбран явно)', () => {
        assert.equal(find(makeCalc({ ddos_protection_required: true, ddos_tier: 'l7', dlp_required: true })), undefined);
    });
    it('ddos off + critical → нет finding', () => {
        assert.equal(find(makeCalc({ ddos_protection_required: false, dlp_required: true })), undefined);
    });
    it('pdn_152fz НЕ триггерит (слишком шумно)', () => {
        assert.equal(find(makeCalc({ ddos_protection_required: true, ddos_tier: 'basic_l3_l4', pdn_152fz: true })), undefined);
    });
});

describe('5B DDoS tier: arch-guard', () => {
    const item = SEED_ITEMS.find(i => i.id === ID);
    it('unit/price не изменились', () => {
        assert.equal(item.unit, 'контур');
        assert.equal(item.pricePerUnit, 30000);
    });
    it('формула содержит ddos_tier + множители 16/4, formulaHelp непустой', () => {
        assert.match(item.qtyFormulas.PROD, /ddos_tier/);
        assert.match(item.qtyFormulas.PROD, /16/);
        assert.match(item.qtyFormulas.PROD, /\b4\b/);
        assert.ok(item.formulaHelp.length > 0);
    });
});
