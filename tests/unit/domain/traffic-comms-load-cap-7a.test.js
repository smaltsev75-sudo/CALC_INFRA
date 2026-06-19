/**
 * Package 7A — LOAD-cap для платных внешних коммуникаций (email/SMS/push) + text-only дисклеймеры.
 *
 * Дефект (Package 7 audit): email/SMS/push считались на LOAD по полному standSizeRatio.LOAD (1.2×),
 * т.е. при нагрузочном тесте «отправлялось» 120% прод-объёма реальных платных сообщений. external-api
 * уже имел защиту min(S.standSizeRatio.LOAD, 1); email/SMS/push — нет. 7A зеркалит этот cap ТОЛЬКО на LOAD.
 * IFT/PSI/PROD не трогаются, PROD-only не делается, цена SMS (3000) и external-api не меняются.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_ITEMS, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedSrc = fs.readFileSync(path.resolve(__dirname, '../../../js/domain/seed.js'), 'utf8');
const D = buildSeedDictionaries();
const BASE = defaultAnswersFrom(D.questions);
const RATIO = SEED_SETTINGS.standSizeRatio;
const item = id => SEED_ITEMS.find(x => x.id === id);

function stands(id, answers) {
    const r = calculate({ id: 't', name: 't', schemaVersion: 22, settings: { ...SEED_SETTINGS }, answers: { ...BASE, ...answers }, dictionaries: D });
    return r.items[id]?.stands || {};
}
const COMMS = [
    { id: 'service-email-per-1k', driver: 'email_per_month', val: 5_000_000, prodQty: 5000 },
    { id: 'service-sms-per-1k', driver: 'sms_per_month', val: 5_000_000, prodQty: 5000 },
    { id: 'service-push-per-1m', driver: 'push_per_month', val: 5_000_000, prodQty: 5 }
];

describe('7A / LOAD-cap email/SMS/push (LOAD ≤ PROD при standSizeRatio.LOAD > 1)', () => {
    it('default standSizeRatio.LOAD > 1 (предусловие теста)', () => {
        assert.ok(RATIO.LOAD > 1, `LOAD ratio = ${RATIO.LOAD}, ожидалось > 1`);
    });
    for (const c of COMMS) {
        it(`${c.id}: LOAD qty ≤ PROD qty (cap), PROD/IFT/PSI не изменены`, () => {
            const s = stands(c.id, { [c.driver]: c.val });
            const prod = s.PROD?.qty ?? 0, load = s.LOAD?.qty ?? 0;
            assert.equal(prod, c.prodQty, `${c.id} PROD qty изменился`);
            assert.ok(load <= prod, `${c.id} LOAD qty=${load} > PROD qty=${prod} — cap не сработал`);
            // IFT/PSI остаются по ratio (НЕ тронуты)
            assert.equal(s.IFT?.qty, Math.ceil(c.prodQty * RATIO.IFT), `${c.id} IFT не должен меняться`);
            assert.equal(s.PSI?.qty, Math.ceil(c.prodQty * RATIO.PSI), `${c.id} PSI не должен меняться`);
        });
    }
});

describe('7A / email/SMS/push добавлены в _AGENT_FORMULA_REFRESH_IDS', () => {
    const m = seedSrc.match(/_AGENT_FORMULA_REFRESH_IDS\s*=\s*\[([\s\S]*?)\]/);
    for (const id of COMMS.map(c => c.id)) {
        it(`${id} в formula-refresh`, () => assert.ok(m && new RegExp(`'${id}'`).test(m[1]), `${id} нет в _AGENT_FORMULA_REFRESH_IDS`));
    }
});

describe('7A / LOAD-формулы используют min(S.standSizeRatio.LOAD, 1)', () => {
    for (const id of COMMS.map(c => c.id)) {
        it(`${id} LOAD формула capped`, () => {
            assert.match(item(id).qtyFormulas.LOAD, /min\(\s*S\.standSizeRatio\.LOAD\s*,\s*1\s*\)/);
        });
    }
});

describe('7A / F3 SMS text-only дисклеймер (цена НЕ меняется)', () => {
    it('цена SMS = 3000 (не тронута)', () => assert.equal(item('service-sms-per-1k').pricePerUnit, 3000));
    it('описание SMS поясняет транзакционный ориентир 3 ₽ и 6 ₽ требует КП', () => {
        const d = item('service-sms-per-1k').description;
        assert.ok(/транзакцион/i.test(d), 'нет упоминания транзакционного ориентира');
        assert.ok(/3\s*₽/.test(d) && /6\s*₽/.test(d), 'нет сопоставления 3 ₽ / 6 ₽');
        assert.ok(/КП|подтвержд/i.test(d), 'нет указания на подтверждение КП');
    });
});

describe('7A / F2 external-api text-only дисклеймер (цена/формула НЕ меняются)', () => {
    it('цена external-api = 50000 и LOAD-cap сохранён', () => {
        const it = item('service-external-api-calls-1m');
        assert.equal(it.pricePerUnit, 50000);
        assert.match(it.qtyFormulas.LOAD, /min\(\s*S\.standSizeRatio\.LOAD\s*,\s*1\s*\)/);
    });
    it('описание external-api: сторонние API / операционная модель / вне облачной инфраструктуры', () => {
        const d = item('service-external-api-calls-1m').description;
        assert.ok(/сторонн/i.test(d), 'нет «сторонних API»');
        assert.ok(/операцион/i.test(d), 'нет «операционной модели»');
        assert.ok(/инфраструктур/i.test(d) && /периметр|вне\b/i.test(d), 'нет разграничения с облачной инфраструктурой / периметром');
    });
});
