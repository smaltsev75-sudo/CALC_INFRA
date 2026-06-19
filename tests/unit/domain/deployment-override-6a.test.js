/**
 * Package 6A — one-deployment override через понятную единицу «млн ₽».
 *
 * Проблема: one-deployment был constant qty=1 × 5 000 000 ₽ → flat-статья,
 * доминирующая в бюджете малого проекта (~37%) и ничтожная у крупного.
 *
 * Решение (F1-O, no-drift): ЭК переведён в единицу «млн ₽» (pricePerUnit=1 000 000),
 * qty = млн ₽ проекта: if(override>0, override, 5). default 0 → 5 млн ₽ (прежнее) →
 * golden drift 0. Пользователь видит понятное «5 млн ₽ / 2.5 млн ₽», а не «0.5 проекта».
 * ekClass → count-driven (qty теперь ссылается на Q.* → инвариант I4 запрещает constant).
 * Скейлинг по сложности (F1-M) НЕ делаем — нужны доменные коэффициенты.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    SEED_ITEMS, defaultAnswersFrom, buildSeedDictionaries
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { migrateCalculation } from '../../../js/state/migrations.js';
import { evaluateCalculationHealth } from '../../../js/domain/calculationHealth.js';
import { wizardToAnswers } from '../../../js/domain/wizardProfiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const DICT = buildSeedDictionaries();
const BASE = defaultAnswersFrom(DICT.questions);
const seedSrc = fs.readFileSync(path.join(ROOT, 'js/domain/seed.js'), 'utf8');
const q = id => DICT.questions.find(x => x.id === id);
const item = id => SEED_ITEMS.find(x => x.id === id);

function calcWith(answers = {}) {
    return {
        id: 'p6a', name: 'p6a', schemaVersion: 22,
        answers: { ...BASE, ...answers },
        settings: { ...DICT.settings },
        dictionaries: { questions: DICT.questions, items: DICT.items }, view: {}
    };
}
const depQty = a => calculate(calcWith(a)).items?.['one-deployment']?.stands?.PROD?.qty ?? 0;
const depMonthly = a => calculate(calcWith(a)).items?.['one-deployment']?.totalMonthly ?? 0;

describe('6A / вопрос deployment_cost_override_mrub', () => {
    it('существует, number, default 0, секция budget', () => {
        const d = q('deployment_cost_override_mrub');
        assert.ok(d, 'вопрос должен быть в seed');
        assert.equal(d.type, 'number');
        assert.equal(d.defaultValue, 0);
        assert.equal(d.section, 'budget');
    });
});

describe('6A / ЭК one-deployment — единица «млн ₽»', () => {
    it('unit=млн ₽, pricePerUnit=1 000 000, ekClass=count-driven', () => {
        const it = item('one-deployment');
        assert.equal(it.unit, 'млн ₽');
        assert.equal(it.pricePerUnit, 1_000_000);
        assert.equal(it.ekClass, 'count-driven');
    });
    it('default (override 0) → qty=5 (медиана 5 млн ₽)', () => {
        assert.equal(depQty({}), 5);
        assert.equal(depQty({ deployment_cost_override_mrub: 0 }), 5);
    });
    it('override=2.5 → qty=2.5', () => {
        assert.equal(depQty({ deployment_cost_override_mrub: 2.5 }), 2.5);
    });
    it('drift 0: cost при override=5 == cost при default', () => {
        assert.equal(depMonthly({ deployment_cost_override_mrub: 5 }), depMonthly({}));
    });
    it('override=2.5 → cost = половина default (линейно, те же risk/VAT/monthly)', () => {
        const half = depMonthly({ deployment_cost_override_mrub: 2.5 });
        const full = depMonthly({});
        assert.ok(full > 0 && Math.abs(half * 2 - full) < 1, `2.5×2 (${half}) должно ≈ 5 (${full})`);
    });
    it('источник: формула ссылается на Q.deployment_cost_override_mrub; ЭК в обоих refresh-list', () => {
        assert.match(item('one-deployment').qtyFormulas.PROD, /Q\.deployment_cost_override_mrub/);
        const fm = seedSrc.match(/_AGENT_FORMULA_REFRESH_IDS\s*=\s*\[([\s\S]*?)\]/);
        const up = seedSrc.match(/_AGENT_UNIT_PRICE_REFRESH_IDS\s*=\s*\[([\s\S]*?)\]/);
        assert.match(fm[1], /'one-deployment'/, 'one-deployment в formula-refresh');
        assert.match(up[1], /'one-deployment'/, 'one-deployment в unit/price-refresh');
    });
});

describe('6A / legacy миграция: сохранение кастомной цены внедрения', () => {
    const legacy = (depItem, answers = {}) => migrateCalculation({
        id: 'L', name: 'L', schemaVersion: 21, settings: {}, answers,
        dictionaries: { questions: [], items: [depItem] }
    });
    const dep = (price) => ({ id: 'one-deployment', unit: 'мероприятие', pricePerUnit: price, qtyFormulas: { PROD: '1' } });
    it('кастомная цена 3M (старая единица) → backfill override=3', () => {
        assert.equal(legacy(dep(3_000_000)).answers.deployment_cost_override_mrub, 3);
    });
    it('default цена 5M → override НЕ backfill (остаётся медиана)', () => {
        const a = legacy(dep(5_000_000)).answers;
        assert.ok(!(a.deployment_cost_override_mrub > 0), 'дефолтная цена не должна давать override');
    });
    it('явный override не перезаписывается миграцией', () => {
        assert.equal(legacy(dep(3_000_000), { deployment_cost_override_mrub: 7 }).answers.deployment_cost_override_mrub, 7);
    });
});

describe('6A / health: внедрение доминирует в бюджете', () => {
    const findingIds = a => evaluateCalculationHealth(calcWith(a)).findings.map(f => f.id);
    const small = wizardToAnswers({ product_type: 'b2c', industry: 'consumer', scale: 's', geography: 'ru', pdn: false, activity: 'low', ai_used: false }).answers;
    const ent = wizardToAnswers({ product_type: 'b2g', industry: 'fintech', scale: 'xl', geography: 'global', pdn: true, activity: 'high', ai_used: true }).answers;
    it('small (внедрение >25%, override=0) → info present', () => {
        assert.ok(findingIds(small).includes('deployment-cost-dominant'));
    });
    it('enterprise (доля мала) → info absent', () => {
        assert.ok(!findingIds(ent).includes('deployment-cost-dominant'));
    });
    it('override>0 → info absent (пользователь уже задал оценку)', () => {
        assert.ok(!findingIds({ ...small, deployment_cost_override_mrub: 3 }).includes('deployment-cost-dominant'));
    });
});
