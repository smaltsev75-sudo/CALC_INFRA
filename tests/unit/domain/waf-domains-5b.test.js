/**
 * Stage 5B-Sec / WAF domains scaling (2026-06-18, Вариант A).
 *
 * network-waf масштабируется по числу защищаемых доменов (главный драйвер цены WAF;
 * запросы/правила в текущем тарифе ~0.3%, не моделируем отдельно). Без golden-дрейфа:
 * default waf_domains_count=0 → max(1,0)=1 → текущая сумма (1 домен на ПСИ и ПРОМ).
 * Каждый домен = baseline 17 964.62 ₽/мес. unit/pricePerUnit НЕ меняются.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSeedDictionaries, defaultAnswersFrom, SEED_ITEMS, enrichLegacyDictionaryWithAgentSeed
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { evaluateCalculationHealth } from '../../../js/domain/calculationHealth.js';

const ID = 'network-waf';

function wafQty(answers) {
    const D = buildSeedDictionaries();
    const A = defaultAnswersFrom(D.questions);
    const calc = {
        id: 't', name: 't', schemaVersion: 12,
        answers: { ...A, ...answers },
        answersMeta: {}, settings: { ...D.settings },
        dictionaries: D, view: { disabledStands: [] }, providerVersion: null
    };
    const r = calculate(calc, null);
    const out = { PSI: 0, PROD: 0 };
    for (const sid of ['PSI', 'PROD']) {
        const c = r.stands[sid].items.find(x => x.itemId === ID);
        if (c) out[sid] = c.qty;
    }
    return out;
}

describe('5B WAF domains: qty по числу доменов', () => {
    it('fallback domains=0 → ПСИ 1, ПРОМ 1 (текущее, без дрейфа)', () => {
        assert.deepEqual(wafQty({ waf_required: true, waf_domains_count: 0 }), { PSI: 1, PROD: 1 });
    });
    it('default (domains не задан) → ПСИ 1, ПРОМ 1', () => {
        assert.deepEqual(wafQty({ waf_required: true }), { PSI: 1, PROD: 1 });
    });
    it('domains=5 → ПСИ 5, ПРОМ 5', () => {
        assert.deepEqual(wafQty({ waf_required: true, waf_domains_count: 5 }), { PSI: 5, PROD: 5 });
    });
    it('waf_required=false → ПСИ 0, ПРОМ 0 при любом числе доменов', () => {
        assert.deepEqual(wafQty({ waf_required: false, waf_domains_count: 10 }), { PSI: 0, PROD: 0 });
    });
});

describe('5B WAF domains: legacy-enrichment рефрешит формулу', () => {
    it('старый calc с flat-формулой получает qtyFormula по доменам', () => {
        const D = buildSeedDictionaries();
        const dict = JSON.parse(JSON.stringify(D));
        const legacy = dict.items.find(i => i.id === ID);
        legacy.qtyFormulas = { PSI: 'if(Q.waf_required, 1, 0)', PROD: 'if(Q.waf_required, 1, 0)' };
        legacy.formulaHelp = 'qty = 1 при Q.waf_required, иначе 0.';
        const calc = {
            id: 'leg', name: 'legacy', schemaVersion: 12, answers: {}, answersMeta: {},
            settings: { ...D.settings }, dictionaries: dict, view: { disabledStands: [] }, providerVersion: null
        };
        enrichLegacyDictionaryWithAgentSeed(calc);
        const refreshed = calc.dictionaries.items.find(i => i.id === ID);
        assert.match(refreshed.qtyFormulas.PROD, /waf_domains_count/);
        assert.match(refreshed.qtyFormulas.PSI, /waf_domains_count/);
    });
});

describe('5B WAF domains: health-check одного домена', () => {
    function makeCalc(answers) {
        return {
            id: 't', name: 't', schemaVersion: 12, answers: { ...answers },
            settings: { applyRiskFactors: true }, answersMeta: {},
            dictionaries: { questions: [], items: [], settings: {} }, view: {}
        };
    }
    const find = (c) => evaluateCalculationHealth(c).findings.find(f => f.id === 'security-waf-single-domain');

    it('waf on + domains=0 → info', () => {
        const f = find(makeCalc({ waf_required: true, waf_domains_count: 0 }));
        assert.ok(f, 'finding должен существовать');
        assert.equal(f.severity, 'info');
        assert.equal(f.category, 'security');
    });
    it('waf on + domains=3 → нет finding', () => {
        assert.equal(find(makeCalc({ waf_required: true, waf_domains_count: 3 })), undefined);
    });
    it('waf off → нет finding', () => {
        assert.equal(find(makeCalc({ waf_required: false, waf_domains_count: 0 })), undefined);
    });
});

describe('5B WAF domains: arch-guard', () => {
    const item = SEED_ITEMS.find(i => i.id === ID);
    it('unit/price не изменились', () => {
        assert.equal(item.unit, 'шт.');
        assert.equal(item.pricePerUnit, 17964.62);
    });
    it('формулы ПСИ/ПРОМ содержат waf_domains_count, formulaHelp непустой', () => {
        assert.match(item.qtyFormulas.PROD, /waf_domains_count/);
        assert.match(item.qtyFormulas.PSI, /waf_domains_count/);
        assert.ok(item.formulaHelp.length > 0);
    });
});
