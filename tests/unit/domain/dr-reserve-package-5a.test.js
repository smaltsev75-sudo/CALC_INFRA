/**
 * Package 5A — DR / RESERVE-ЭК: F1-A + F2 + F3-A.
 *
 * F1-A: res-georedundancy (30% warm) подавляется, когда активен active-gate
 *       res-dr-active (sla_target>=99.95 || rto_hours<=1 || rpo_minutes<=5):
 *       active-active (100% hot) уже является георезервом → 30% warm = double-count.
 *       Warm-only георезерв (флаг гео без active-gate) сохраняется.
 * F2:   one-dr-drill учитывается при ЛЮБОМ DR: georedundancy_required || active-gate
 *       (active-active без флага гео тоже требует учений).
 * F3-A: текст blue-green (вопрос maintenance_window_hours_month) перестаёт обещать
 *       «+100% HW / удвоение ПРОМ» — модель fixed 250k ₽/мес; гейт описан как «≤1 ч».
 *       Только текст, формула/цена не меняются, golden drift = 0.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const DICT = buildSeedDictionaries();
const BASE = defaultAnswersFrom(DICT.questions);

/* MED-профиль с ненулевым prodCompute (≈47 vCPU): geo warm ≈15, dr-active ≈47. */
const MED = {
    registered_users_total: 500000, dau_share_of_registered_percent: 20, pcu_target: 5000,
    peak_rps: 500, avg_rps: 120, microservices_count: 10, async_workers_count: 4,
    db_count: 3, db_replicas_count: 1, db_size_initial_gb: 200, db_growth_gb_month: 20
};
function calcWith(answers = {}) {
    return {
        id: 'p5a', name: 'p5a', schemaVersion: 21,
        answers: { ...BASE, ...MED, ...answers },
        settings: { ...DICT.settings, applyRiskFactors: false, vatEnabled: false },
        dictionaries: { questions: DICT.questions, items: DICT.items }, view: {}
    };
}
function qty(answers, itemId, stand = 'PROD') {
    const r = calculate(calcWith(answers));
    return r.items?.[itemId]?.stands?.[stand]?.qty ?? 0;
}
const q = id => DICT.questions.find(x => x.id === id);
const item = id => SEED_ITEMS.find(x => x.id === id);
const seedSrc = fs.readFileSync(path.join(ROOT, 'js/domain/seed.js'), 'utf8');

/* warm-only георезерв: флаг гео есть, active-gate НЕ срабатывает */
const GEO_WARM = { georedundancy_required: true, sla_target: 99.9, rto_hours: 4, rpo_minutes: 60 };

describe('5A / F1-A — res-georedundancy подавляется при active-gate', () => {
    it('geo + active(sla>=99.95) → res-georedundancy = 0', () => {
        assert.equal(qty({ ...GEO_WARM, sla_target: 99.95 }, 'res-georedundancy'), 0);
    });
    it('geo + active(rto<=1) → res-georedundancy = 0', () => {
        assert.equal(qty({ ...GEO_WARM, rto_hours: 1 }, 'res-georedundancy'), 0);
    });
    it('geo + active(rpo<=5) → res-georedundancy = 0', () => {
        assert.equal(qty({ ...GEO_WARM, rpo_minutes: 5 }, 'res-georedundancy'), 0);
    });
    it('geo БЕЗ active (warm-only) → res-georedundancy > 0 (сохраняется)', () => {
        assert.ok(qty(GEO_WARM, 'res-georedundancy') > 0, 'warm-only георезерв должен сохраняться');
    });
    it('res-dr-active НЕ затронут: при active по-прежнему > 0', () => {
        assert.ok(qty({ ...GEO_WARM, sla_target: 99.95 }, 'res-dr-active') > 0);
    });
    it('источник: формула res-georedundancy содержит подавление по active-gate', () => {
        const f = item('res-georedundancy').qtyFormulas.PROD;
        assert.match(f, /sla_target\s*>=\s*99\.95/);
        assert.match(f, /rto_hours\s*<=\s*1/);
        assert.match(f, /rpo_minutes\s*<=\s*5/);
        assert.match(f, /!\s*\(/, 'должно быть отрицание active-gate (подавление)');
    });
});

describe('5A / F2 — one-dr-drill при любом DR', () => {
    it('active БЕЗ гео → one-dr-drill = dr_drills_per_year (> 0)', () => {
        const drills = Number(BASE.dr_drills_per_year) || 2;
        assert.equal(qty({ georedundancy_required: false, sla_target: 99.95, dr_drills_per_year: drills },
            'one-dr-drill'), drills);
    });
    it('geo без active → one-dr-drill > 0 (сохраняется)', () => {
        assert.ok(qty(GEO_WARM, 'one-dr-drill') > 0);
    });
    it('ни гео, ни active → one-dr-drill = 0', () => {
        assert.equal(qty({ georedundancy_required: false, sla_target: 99.9, rto_hours: 4, rpo_minutes: 60 },
            'one-dr-drill'), 0);
    });
    it('источник: формула one-dr-drill = georedundancy_required || active-gate', () => {
        const f = item('one-dr-drill').qtyFormulas.PROD;
        assert.match(f, /Q\.georedundancy_required\s*\|\|/);
        assert.match(f, /sla_target\s*>=\s*99\.95/);
    });
    it('one-dr-drill добавлен в _AGENT_FORMULA_REFRESH_IDS (legacy F2)', () => {
        const m = seedSrc.match(/_AGENT_FORMULA_REFRESH_IDS\s*=\s*\[([\s\S]*?)\]/);
        assert.ok(m && /'one-dr-drill'/.test(m[1]), 'one-dr-drill должен быть в refresh-list');
    });
});

describe('5A / F3-A — честный текст blue-green (без +100% HW)', () => {
    const mw = () => q('maintenance_window_hours_month');
    it('impact НЕ обещает «+100%» / «удвоение»', () => {
        const imp = mw().impact || '';
        assert.doesNotMatch(imp, /\+\s*100\s*%/);
        assert.doesNotMatch(imp, /удвое|удваива/i);
    });
    it('impact честно описывает операционный резерв и гейт ≤1 ч', () => {
        const imp = mw().impact || '';
        assert.match(imp, /операционн|резерв|фиксир/i, 'impact должен описывать fixed operational reserve');
        assert.match(imp, /≤\s*1|0[\s–-]1\s*ч|1\s*ч/, 'impact должен ссылаться на гейт ≤1 ч, не «0 часов»');
    });
    it('description НЕ говорит «удвоение стоимости ПРОМ»', () => {
        assert.doesNotMatch(mw().description || '', /удвое|удваива/i);
    });
    it('recommendation НЕ говорит «blue-green удваивает стоимость»', () => {
        assert.doesNotMatch(mw().recommendation || '', /удваива/i);
    });
    it('формула/цена res-blue-green-deployment НЕ изменены (F3=A, no-drift)', () => {
        const bg = item('res-blue-green-deployment');
        assert.equal(bg.pricePerUnit, 250000);
        assert.equal(bg.qtyFormulas.PROD, 'if(Q.maintenance_window_hours_month <= 1, 1, 0)');
    });
});
