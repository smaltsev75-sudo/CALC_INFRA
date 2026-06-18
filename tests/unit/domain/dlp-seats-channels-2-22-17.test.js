/**
 * Stage 5B-Sec / DLP seats-channels (PATCH 2.22.17) — минимальная no-drift модель.
 *
 * security-dlp-license масштабируется по числу защищаемых рабочих мест
 * (dlp_protected_users_count, 500 мест на лицензионный контур);
 * security-dlp-implementation — по числу контролируемых каналов
 * (dlp_channels_count, 3 канала на проектный блок внедрения).
 * default обоих драйверов = 0 → max(1, ceil(0/N)) = 1 → текущая сумма (без дрейфа).
 * unit/pricePerUnit/billingInterval НЕ меняются (qty-множитель поверх «контур»/«проект»).
 * Драйверы НЕ выводятся из users_total/PCU — DLP защищает рабочие места, не аудиторию.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSeedDictionaries, defaultAnswersFrom, SEED_ITEMS, enrichLegacyDictionaryWithAgentSeed
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { evaluateCalculationHealth } from '../../../js/domain/calculationHealth.js';

const LIC = 'security-dlp-license';
const IMPL = 'security-dlp-implementation';
const OLD_FLAT = 'if(Q.dlp_required, 1, 0)';

function qty(answers) {
    const D = buildSeedDictionaries();
    const A = defaultAnswersFrom(D.questions);
    const calc = {
        id: 't', name: 't', schemaVersion: 12,
        answers: { ...A, ...answers }, answersMeta: {},
        settings: { ...D.settings }, dictionaries: D,
        view: { disabledStands: [] }, providerVersion: null
    };
    const r = calculate(calc, null);
    const get = (id) => { const it = r.stands.PROD.items.find(x => x.itemId === id); return it ? it.qty : null; };
    return { lic: get(LIC), impl: get(IMPL) };
}

function mkLegacy(D, mutate) {
    const dict = JSON.parse(JSON.stringify(D));
    mutate(dict);
    return {
        id: 'leg', name: 'l', schemaVersion: 12, answers: {}, answersMeta: {},
        settings: { ...D.settings }, dictionaries: dict, view: { disabledStands: [] }, providerVersion: null
    };
}

describe('5B DLP seats/channels: qty масштаб', () => {
    it('fallback оба драйвера 0 → lic 1, impl 1 (без дрейфа)', () => {
        assert.deepEqual(qty({ dlp_required: true, dlp_protected_users_count: 0, dlp_channels_count: 0 }), { lic: 1, impl: 1 });
    });
    it('драйверы не заданы (default) → lic 1, impl 1', () => {
        assert.deepEqual(qty({ dlp_required: true }), { lic: 1, impl: 1 });
    });
    it('dlp_protected_users_count=1200 → lic 3 (ceil(1200/500))', () => {
        assert.equal(qty({ dlp_required: true, dlp_protected_users_count: 1200 }).lic, 3);
    });
    it('dlp_channels_count=7 → impl 3 (ceil(7/3))', () => {
        assert.equal(qty({ dlp_required: true, dlp_channels_count: 7 }).impl, 3);
    });
    it('dlp off → оба 0 при любых драйверах', () => {
        assert.deepEqual(qty({ dlp_required: false, dlp_protected_users_count: 5000, dlp_channels_count: 20 }), { lic: 0, impl: 0 });
    });
});

describe('5B DLP: legacy-enrichment рефрешит обе формулы', () => {
    it('старые flat-формулы → масштабируемые', () => {
        const D = buildSeedDictionaries();
        const calc = mkLegacy(D, (dict) => {
            dict.items.find(i => i.id === LIC).qtyFormulas = { PROD: OLD_FLAT };
            dict.items.find(i => i.id === IMPL).qtyFormulas = { PROD: OLD_FLAT };
        });
        enrichLegacyDictionaryWithAgentSeed(calc);
        assert.match(calc.dictionaries.items.find(i => i.id === LIC).qtyFormulas.PROD, /dlp_protected_users_count/);
        assert.match(calc.dictionaries.items.find(i => i.id === IMPL).qtyFormulas.PROD, /dlp_channels_count/);
    });
    it('step-4 авто-добавляет оба новых вопроса в legacy-словарь', () => {
        const D = buildSeedDictionaries();
        const calc = mkLegacy(D, (dict) => {
            dict.questions = dict.questions.filter(q => q.id !== 'dlp_protected_users_count' && q.id !== 'dlp_channels_count');
            dict.items.find(i => i.id === LIC).qtyFormulas = { PROD: OLD_FLAT };
            dict.items.find(i => i.id === IMPL).qtyFormulas = { PROD: OLD_FLAT };
        });
        enrichLegacyDictionaryWithAgentSeed(calc);
        const qids = new Set(calc.dictionaries.questions.map(q => q.id));
        assert.ok(qids.has('dlp_protected_users_count'), 'dlp_protected_users_count должен быть до-внесён');
        assert.ok(qids.has('dlp_channels_count'), 'dlp_channels_count должен быть до-внесён');
    });
    it('unit/price не меняются после enrich', () => {
        const D = buildSeedDictionaries();
        const before = D.items.find(i => i.id === LIC);
        const calc = mkLegacy(D, (dict) => {
            dict.items.find(i => i.id === LIC).qtyFormulas = { PROD: OLD_FLAT };
        });
        enrichLegacyDictionaryWithAgentSeed(calc);
        const after = calc.dictionaries.items.find(i => i.id === LIC);
        assert.equal(after.unit, before.unit);
        assert.equal(after.pricePerUnit, before.pricePerUnit);
    });
});

describe('5B DLP: health-check flat-estimate', () => {
    function makeCalc(answers) {
        return {
            id: 't', name: 't', schemaVersion: 12, answers: { ...answers },
            settings: { applyRiskFactors: true }, answersMeta: {},
            dictionaries: { questions: [], items: [], settings: {} }, view: {}
        };
    }
    // Audit Пакет 1: нудж разделён на license (число рабочих мест) и implementation (каналы).
    const lic = (c) => evaluateCalculationHealth(c).findings.find(f => f.id === 'security-dlp-license-flat');
    const impl = (c) => evaluateCalculationHealth(c).findings.find(f => f.id === 'security-dlp-implementation-flat');

    it('dlp on + оба драйвера 0 → ОБА нуджа (license + implementation), severity info', () => {
        const c = makeCalc({ dlp_required: true, dlp_protected_users_count: 0, dlp_channels_count: 0 });
        const l = lic(c), i = impl(c);
        assert.ok(l && i, 'оба finding должны существовать');
        assert.equal(l.severity, 'info'); assert.equal(l.category, 'security');
        assert.equal(i.severity, 'info'); assert.equal(i.category, 'security');
    });
    it('dlp on + только users задан → license молчит, implementation ВСЁ ЕЩЁ нудж (channels=0)', () => {
        const c = makeCalc({ dlp_required: true, dlp_protected_users_count: 1200, dlp_channels_count: 0 });
        assert.equal(lic(c), undefined);
        assert.ok(impl(c));
    });
    it('dlp on + только channels задан → implementation молчит, license ВСЁ ЕЩЁ нудж (users=0)', () => {
        const c = makeCalc({ dlp_required: true, dlp_protected_users_count: 0, dlp_channels_count: 7 });
        assert.equal(impl(c), undefined);
        assert.ok(lic(c));
    });
    it('dlp on + оба заданы → нет нуджей', () => {
        const c = makeCalc({ dlp_required: true, dlp_protected_users_count: 1200, dlp_channels_count: 7 });
        assert.equal(lic(c), undefined);
        assert.equal(impl(c), undefined);
    });
    it('dlp off → нет нуджей', () => {
        const c = makeCalc({ dlp_required: false, dlp_protected_users_count: 0, dlp_channels_count: 0 });
        assert.equal(lic(c), undefined);
        assert.equal(impl(c), undefined);
    });
});

describe('5B DLP: arch-guard unit/price/формулы', () => {
    it('unit/price/billing обоих ЭК не изменились', () => {
        const lic = SEED_ITEMS.find(i => i.id === LIC);
        const impl = SEED_ITEMS.find(i => i.id === IMPL);
        assert.equal(lic.unit, 'контур/год'); assert.equal(lic.pricePerUnit, 1500000); assert.equal(lic.billingInterval, 'annual');
        assert.equal(impl.unit, 'проект'); assert.equal(impl.pricePerUnit, 1000000); assert.equal(impl.billingInterval, 'oneTime');
    });
    it('формулы ссылаются на свои драйверы, formulaHelp непустой', () => {
        const lic = SEED_ITEMS.find(i => i.id === LIC);
        const impl = SEED_ITEMS.find(i => i.id === IMPL);
        assert.match(lic.qtyFormulas.PROD, /dlp_protected_users_count/);
        assert.match(impl.qtyFormulas.PROD, /dlp_channels_count/);
        assert.ok(lic.formulaHelp.length > 0 && impl.formulaHelp.length > 0);
    });
});
