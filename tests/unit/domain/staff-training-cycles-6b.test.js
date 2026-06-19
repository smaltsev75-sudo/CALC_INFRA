/**
 * Package 6B-light — staff_training_cycles (opt-in, вариант B, zero-drift).
 *
 * one-staff-training был flag-fixed qty=1 для non-internal. Теперь qty управляется
 * числом циклов обучения: if(Q.product_type != "internal", Q.staff_training_cycles, 0).
 * default staff_training_cycles=1 → qty 1 (прежнее, golden drift 0); 0 → нет обучения;
 * N → N циклов; internal → 0. ekClass → count-driven (qty теперь по count).
 * Цена/unit/billing не меняются. L2 (seasonal floor) НЕ трогаем.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    SEED_ITEMS, defaultAnswersFrom, buildSeedDictionaries,
    enrichLegacyDictionaryWithAgentSeed
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const DICT = buildSeedDictionaries();
const BASE = defaultAnswersFrom(DICT.questions);
const seedSrc = fs.readFileSync(path.join(ROOT, 'js/domain/seed.js'), 'utf8');
const q = id => DICT.questions.find(x => x.id === id);
const item = id => SEED_ITEMS.find(x => x.id === id);

function calcWith(answers = {}) {
    return {
        id: 'p6bl', name: 'p6bl', schemaVersion: 22,
        answers: { ...BASE, ...answers },
        settings: { ...DICT.settings },
        dictionaries: { questions: DICT.questions, items: DICT.items }, view: {}
    };
}
const stQty = a => calculate(calcWith(a)).items?.['one-staff-training']?.stands?.PROD?.qty ?? 0;

describe('6B-light / вопрос staff_training_cycles', () => {
    it('существует, number, default 1, секция budget', () => {
        const d = q('staff_training_cycles');
        assert.ok(d, 'вопрос должен быть в seed');
        assert.equal(d.type, 'number');
        assert.equal(d.defaultValue, 1);
        assert.equal(d.section, 'budget');
    });
});

describe('6B-light / one-staff-training — вариант B', () => {
    it('ekClass=count-driven', () => {
        assert.equal(item('one-staff-training').ekClass, 'count-driven');
    });
    it('default (cycles не задан) + non-internal → qty 1 (drift 0)', () => {
        assert.equal(stQty({ product_type: 'b2b' }), 1);
        assert.equal(stQty({ product_type: 'b2c', staff_training_cycles: 1 }), 1);
    });
    it('internal → qty 0 (независимо от cycles)', () => {
        assert.equal(stQty({ product_type: 'internal' }), 0);
        assert.equal(stQty({ product_type: 'internal', staff_training_cycles: 5 }), 0);
    });
    it('non-internal + cycles=3 → qty 3', () => {
        assert.equal(stQty({ product_type: 'b2b', staff_training_cycles: 3 }), 3);
    });
    it('non-internal + cycles=0 → qty 0 (обучение не требуется)', () => {
        assert.equal(stQty({ product_type: 'b2b', staff_training_cycles: 0 }), 0);
    });
    it('источник: формула ссылается на Q.staff_training_cycles; ЭК в _AGENT_FORMULA_REFRESH_IDS', () => {
        assert.match(item('one-staff-training').qtyFormulas.PROD, /Q\.staff_training_cycles/);
        const m = seedSrc.match(/_AGENT_FORMULA_REFRESH_IDS\s*=\s*\[([\s\S]*?)\]/);
        assert.ok(m && /'one-staff-training'/.test(m[1]), 'one-staff-training в formula-refresh');
    });
    it('unit/price/billing не изменены', () => {
        const it = item('one-staff-training');
        assert.equal(it.unit, 'цикл');
        assert.equal(it.pricePerUnit, 120000);
        assert.equal(it.billingInterval, 'oneTime');
    });
});

describe('6B-light / legacy enrichment без вопроса → qty 1', () => {
    it('legacy (старая формула, нет staff_training_cycles) → enrich → qty 1', () => {
        const dict = buildSeedDictionaries();
        dict.questions = dict.questions.filter(x => x.id !== 'staff_training_cycles');
        const st = dict.items.find(i => i.id === 'one-staff-training');
        st.qtyFormulas = { PROD: 'if(Q.product_type != "internal", 1, 0)' };
        st.ekClass = 'flag-fixed';
        const base = defaultAnswersFrom(dict.questions);
        const calc = {
            id: 'L', name: 'L', schemaVersion: 22,
            answers: { ...base, product_type: 'b2b' },
            settings: { ...dict.settings }, dictionaries: dict, view: {}
        };
        enrichLegacyDictionaryWithAgentSeed(calc);
        const r = calculate(calc);
        assert.equal(r.items?.['one-staff-training']?.stands?.PROD?.qty ?? 0, 1,
            'после enrichment legacy non-internal даёт qty 1 (вопрос до-внесён, default 1)');
    });
});
