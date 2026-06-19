/**
 * Package 8B-light — doc-guard: документация provider-overlay по DB-лицензии не должна врать.
 *
 * Было (устарело): WIZARD §13.6 — «sbercloud 14 ЭК», строка «license-db-per-vcpu | 167 000 ₽/мес».
 * Факты runtime (verified node-repro на v2.22.31):
 *   - Cloud.ru/sbercloud = 16 SKU, license-db-per-vcpu НЕТ → seed Tantor SE fallback;
 *   - Yandex = 15 SKU, license-db-per-vcpu НЕТ → seed fallback;
 *   - VK = 10 SKU, license-db-per-vcpu = MS SQL Enterprise 598 214.75 ₽/vCPU/год net.
 * Единица DB-лицензии — ₽/vCPU/год (annual), не ₽/мес.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_ITEMS } from '../../../js/domain/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const wizard = fs.readFileSync(path.join(ROOT, 'docs/assistant/WIZARD_PROFILES.md'), 'utf8');
const dbItem = SEED_ITEMS.find(i => i.id === 'license-db-per-vcpu');

describe('8B-light / WIZARD doc-guard: DB-лицензия не показана как ₽/мес и не приписана sbercloud', () => {
    it('нет строки «license-db-per-vcpu … 167 000 ₽/мес»', () => {
        assert.ok(!/license-db-per-vcpu[^\n]*167[\s_ ]*000[^\n]*₽\s*\/\s*мес/i.test(wizard),
            'WIZARD всё ещё содержит DB-лицензию по 167 000 ₽/мес');
    });
    it('DB-лицензия нигде в WIZARD не показана в единице ₽/мес (она annual)', () => {
        assert.ok(!/license-db-per-vcpu[^\n]*₽\s*\/\s*мес/i.test(wizard),
            'license-db-per-vcpu где-то показан как ₽/мес');
    });
    it('отражены актуальные SKU-счётчики провайдеров (16 / 15 / 10)', () => {
        assert.match(wizard, /16\s*SKU/i, 'нет «16 SKU» (Cloud.ru/sbercloud)');
        assert.match(wizard, /15\s*SKU/i, 'нет «15 SKU» (Yandex)');
        assert.match(wizard, /10\s*SKU/i, 'нет «10 SKU» (VK)');
    });
    it('VK DB-лицензия указана как MS SQL Enterprise 598 214.75 ₽/vCPU/год net', () => {
        assert.match(wizard, /598[\s_ ]*214[.,]75/, 'нет цены VK 598 214.75');
        assert.match(wizard, /vCPU\s*\/\s*год|vCPU\/год|₽\/vCPU\/год/i, 'нет единицы ₽/vCPU/год');
    });
    it('зафиксирован seed-fallback для Cloud.ru/Yandex (DB-лицензии нет)', () => {
        assert.match(wizard, /seed[\s-]*fallback|→\s*seed|fallback.{0,40}seed/i, 'нет упоминания seed-fallback');
    });
});

describe('8B-light / seed description license-db-per-vcpu: baseline Tantor SE + прочие edition через overlay/import/КП', () => {
    it('описание называет seed baseline Tantor SE', () => {
        assert.match(dbItem.description, /Tantor\s*SE/i, 'нет «Tantor SE» как baseline');
    });
    it('описание указывает, что Postgres Pro / Oracle / MS SQL дороже и требуют overlay/import/КП', () => {
        const d = dbItem.description;
        assert.match(d, /Postgres\s*Pro/i);
        assert.match(d, /Oracle/i);
        assert.match(d, /MS\s*SQL/i);
        assert.match(d, /overlay|импорт|КП/i, 'нет указания на overlay/import/КП для дорогих edition');
    });
    it('формула/цена/unit/billing license-db-per-vcpu НЕ изменены (drift 0)', () => {
        assert.equal(dbItem.pricePerUnit, 167000);
        assert.equal(dbItem.unit, 'vCPU');
        assert.equal(dbItem.billingInterval, 'annual');
        assert.match(dbItem.qtyFormulas.PROD, /Q\.db_license_vcpu_per_node/);
    });
});
