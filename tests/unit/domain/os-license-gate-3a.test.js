/**
 * Package 3A — OS license gate (license-os-per-node).
 *
 * Решение (C-proxy, явный флаг): license-os-per-node гейтится ТОЛЬКО через новый
 * вопрос Q.os_commercial_license_required. Регуляторика (pdn_152fz/fstec) — лишь
 * подсказка для Quick Start default и миграционного backfill, НЕ в формуле:
 * пользователь обязан мочь отключить платную ОС даже в регулируемом проекте,
 * иначе фантом просто переименуется.
 *
 * Контракты:
 *   1. Вопрос существует: boolean, defaultValue false.
 *   2. Формула: os=false → license-os-per-node qty=0 на всех стендах; os=true → старое qty.
 *   3. Гейт-источник: qtyFormula ссылается на Q.os_commercial_license_required + ЭК в refresh-list.
 *   4. DB-лицензия и СЗИ/EDR не задеты этим гейтом.
 *   5. Quick Start: fintech/b2g → true; corporate/consumer/edtech/internal → не true.
 *   6. Legacy миграция: explicit pdn_152fz===true ИЛИ fstec===true → backfill true;
 *      без них → НЕ true; explicit os=false при pdn=true → не флипать (уважать выбор).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    SEED_QUESTIONS, SEED_ITEMS, defaultAnswersFrom, buildSeedDictionaries
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { wizardToAnswers } from '../../../js/domain/wizardProfiles.js';
import { migrateCalculation } from '../../../js/state/migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const DICT = buildSeedDictionaries();
const BASE = defaultAnswersFrom(DICT.questions);

function calcWith(answers = {}) {
    return {
        id: 'os-3a', name: 'os 3a', schemaVersion: 20,
        answers: { ...BASE, ...answers },
        settings: { ...DICT.settings },
        dictionaries: { questions: DICT.questions, items: DICT.items }, view: {}
    };
}
function osQty(answers, stand = 'PROD') {
    const r = calculate(calcWith(answers));
    return r.items?.['license-os-per-node']?.stands?.[stand]?.qty ?? 0;
}
// PROD nodes = micro + workers + db*(1+replicas) = 3 + 1 + 1 = 5
const NODES = { microservices_count: 3, async_workers_count: 1, db_count: 1, db_replicas_count: 0 };

describe('3A / вопрос os_commercial_license_required', () => {
    it('существует, boolean, defaultValue false', () => {
        const q = SEED_QUESTIONS.find(x => x.id === 'os_commercial_license_required');
        assert.ok(q, 'вопрос должен быть в SEED_QUESTIONS');
        assert.equal(q.type, 'boolean');
        assert.equal(q.defaultValue, false);
    });
});

describe('3A / гейт формулы license-os-per-node', () => {
    it('os=false → qty=0 на всех стендах (даже при ненулевых драйверах)', () => {
        for (const s of ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']) {
            assert.equal(osQty({ ...NODES, os_commercial_license_required: false }, s), 0, `${s}: должен быть 0`);
        }
    });
    it('os=true → qty=5 на ПРОМ (nodes=5)', () => {
        assert.equal(osQty({ ...NODES, os_commercial_license_required: true }, 'PROD'), 5);
    });
    it('гейт-источник: каждая qtyFormula ссылается на Q.os_commercial_license_required', () => {
        const item = SEED_ITEMS.find(it => it.id === 'license-os-per-node');
        assert.ok(item, 'ЭК должен существовать');
        for (const s of ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']) {
            assert.match(item.qtyFormulas[s], /Q\.os_commercial_license_required/, `${s}: формула должна быть гейтнута`);
        }
    });
    it('license-os-per-node в _AGENT_FORMULA_REFRESH_IDS', () => {
        const src = fs.readFileSync(path.join(ROOT, 'js/domain/seed.js'), 'utf8');
        const m = src.match(/_AGENT_FORMULA_REFRESH_IDS\s*=\s*\[([\s\S]*?)\]/);
        assert.ok(m, 'список должен существовать');
        assert.match(m[1], /'license-os-per-node'/);
    });
});

describe('3A / DB-лицензия и СЗИ/EDR не задеты гейтом OS', () => {
    it('db_commercial=true, os=false → DB qty>0, OS qty=0', () => {
        const r = calculate(calcWith({ ...NODES, db_commercial_license_required: true, os_commercial_license_required: false }));
        assert.ok((r.items?.['license-db-per-vcpu']?.stands?.PROD?.qty ?? 0) > 0, 'DB-лицензия должна считаться');
        assert.equal(r.items?.['license-os-per-node']?.stands?.PROD?.qty ?? 0, 0, 'OS должна быть 0');
    });
    it('pdn_152fz=true, os=false → СЗИ/EDR qty>0, OS qty=0', () => {
        const r = calculate(calcWith({ ...NODES, pdn_152fz: true, os_commercial_license_required: false }));
        assert.ok((r.items?.['license-siem-edr-per-node']?.stands?.PROD?.qty ?? 0) > 0, 'СЗИ/EDR должна считаться');
        assert.equal(r.items?.['license-os-per-node']?.stands?.PROD?.qty ?? 0, 0, 'OS должна быть 0');
    });
});

describe('3A / Quick Start backfill os_commercial_license_required', () => {
    const run = (inp) => { const r = wizardToAnswers(inp); return r.answers || r; };
    const base = { scale: 'm', geography: 'ru', pdn: false, activity: 'medium', ai_used: false };
    it('fintech → true', () => {
        assert.equal(run({ ...base, product_type: 'b2c', industry: 'fintech' }).os_commercial_license_required, true);
    });
    it('b2g → true', () => {
        assert.equal(run({ ...base, product_type: 'b2g', industry: 'corporate' }).os_commercial_license_required, true);
    });
    for (const [pt, ind] of [['b2b', 'corporate'], ['b2c', 'consumer'], ['b2b', 'edtech'], ['internal', 'corporate']]) {
        it(`${pt}/${ind} → не true (обычный профиль)`, () => {
            assert.notEqual(run({ ...base, product_type: pt, industry: ind }).os_commercial_license_required, true);
        });
    }
});

describe('3A / legacy миграция backfill', () => {
    const legacy = (answers) => migrateCalculation({
        id: 'L', name: 'L', schemaVersion: 20, settings: {}, answers,
        dictionaries: { questions: [], items: [] }
    });
    it('explicit pdn_152fz=true, нет os → backfill true', () => {
        assert.equal(legacy({ pdn_152fz: true }).answers.os_commercial_license_required, true);
    });
    it('explicit fstec=true, нет os → backfill true', () => {
        assert.equal(legacy({ fstec_certification_required: true }).answers.os_commercial_license_required, true);
    });
    it('без explicit pdn/fstec → НЕ true (фантом убран)', () => {
        assert.notEqual(legacy({ pdn_152fz: false }).answers.os_commercial_license_required, true);
        assert.notEqual(legacy({}).answers.os_commercial_license_required, true);
    });
    it('explicit os=false при pdn=true → НЕ флипать (уважать явный выбор)', () => {
        assert.equal(legacy({ pdn_152fz: true, os_commercial_license_required: false }).answers.os_commercial_license_required, false);
    });
    it('идемпотентность: повторная миграция стабильна', () => {
        const twice = migrateCalculation(legacy({ pdn_152fz: true }));
        assert.equal(twice.answers.os_commercial_license_required, true);
    });
});
