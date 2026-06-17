/**
 * P6 (2.22.8): enrichLegacyDictionaryWithAgentSeed должен рефрешить unit+pricePerUnit
 * ВМЕСТЕ с qtyFormula для DR-ЭК, у которых в Stage 5A сменилась единица qty
 * (площадка → vCPU резерва).
 *
 * Латентный баг (с 2.22.0): res-dr-active попал в _AGENT_FORMULA_REFRESH_IDS, его
 * формула рефрешилась на vCPU-базу (qty 1 → N vCPU), а pricePerUnit оставался старым
 * (400 000 ₽/площадка) → N × 400 000 = взрыв в десятки раз. Воспроизведено: 842 642 →
 * 9 269 060 ₽/мес (×11).
 *
 * Фикс: при НЕсовпадении unit у legacy-ЭК с seed — атомарно обновить unit+price+ekClass
 * (старая цена несовместима с новой qty-семантикой). При СОВПАДЕНИИ unit — price НЕ
 * трогать (сохраняем пользовательский override). storage-object-tb: только формула
 * (unit 'ТБ' не менялся), цена сохраняется.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSeedDictionaries, defaultAnswersFrom, enrichLegacyDictionaryWithAgentSeed
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';

/* legacy-словарь: DR-ЭК в СТАРОМ виде (площадка, старая цена, площадка-формула). */
function legacyCalc(extraMutate = () => {}) {
    const D = buildSeedDictionaries();
    const A = defaultAnswersFrom(D.questions);
    const dict = JSON.parse(JSON.stringify(D));
    for (const it of dict.items) {
        if (it.id === 'res-dr-active') {
            it.unit = 'площадка'; it.pricePerUnit = 400000;
            it.qtyFormulas = { PROD: 'if(Q.sla_target >= 99.95, 1, 0)' };
            it.applicableStands = ['PROD']; it.ekClass = 'flag-fixed';
        }
        if (it.id === 'res-georedundancy') {
            it.unit = 'площадка'; it.pricePerUnit = 300000;
            it.qtyFormulas = { PROD: 'if(Q.georedundancy_required, 1, 0)' };
            it.applicableStands = ['PROD']; it.ekClass = 'flag-fixed';
        }
    }
    extraMutate(dict);
    return {
        id: 'leg', name: 'legacy', schemaVersion: 12,
        answers: { ...A, sla_target: 99.99, georedundancy_required: true },
        answersMeta: {}, settings: { ...D.settings }, dictionaries: dict,
        view: { disabledStands: [] }, providerVersion: null
    };
}

function findItem(calc, id) { return calc.dictionaries.items.find(i => i.id === id); }
function itemCost(calc, id) {
    const r = calculate(calc, null);
    let c = 0;
    for (const sid of Object.keys(r.stands)) for (const x of r.stands[sid].items) if (x.itemId === id) c += x.costFinal || 0;
    return c;
}

describe('P6: enrichment рефрешит unit+price для DR-ЭК со сменившейся единицей', () => {
    it('res-dr-active: unit→vCPU резерва, price→2300, без взрыва (был ×11)', () => {
        const calc = legacyCalc();
        const before = itemCost(calc, 'res-dr-active');
        enrichLegacyDictionaryWithAgentSeed(calc);
        const it = findItem(calc, 'res-dr-active');
        assert.equal(it.unit, 'vCPU резерва', 'unit должен обновиться');
        assert.equal(it.pricePerUnit, 2300, 'price должен обновиться на новый ₽/vCPU');
        // стоимость = qty(vCPU) × 2300, а НЕ × 400000 (взрыв)
        const after = itemCost(calc, 'res-dr-active');
        assert.ok(after < before * 0.5,
            `после фикса DR-стоимость не должна взрываться: было ${Math.round(before)}, стало ${Math.round(after)}`);
    });

    it('res-georedundancy: добавлен в рефреш, unit→vCPU резерва, price→1750', () => {
        const calc = legacyCalc();
        enrichLegacyDictionaryWithAgentSeed(calc);
        const it = findItem(calc, 'res-georedundancy');
        assert.equal(it.unit, 'vCPU резерва');
        assert.equal(it.pricePerUnit, 1750);
        assert.match(it.qtyFormulas.PROD, /prodComputeVcpu/, 'формула должна стать vCPU-базовой');
    });

    it('СОХРАНность пользовательской цены: при совпадении unit price НЕ трогаем', () => {
        // legacy уже в новой единице (vCPU резерва), но с кастомной ценой 9999
        const calc = legacyCalc(dict => {
            const it = dict.items.find(i => i.id === 'res-dr-active');
            it.unit = 'vCPU резерва'; it.pricePerUnit = 9999;
        });
        enrichLegacyDictionaryWithAgentSeed(calc);
        const it = findItem(calc, 'res-dr-active');
        assert.equal(it.pricePerUnit, 9999, 'пользовательскую цену в совпадающей единице НЕ клобберить');
    });

    it('storage-object-tb: формула рефрешится, unit/price сохраняются (ед. не менялась)', () => {
        const calc = legacyCalc(dict => {
            const it = dict.items.find(i => i.id === 'storage-object-tb');
            it.pricePerUnit = 1700; // кастомная цена пользователя
            it.qtyFormulas = { PROD: 'Q.file_storage_volume_tb' }; // старая формула без S3-overhead
        });
        enrichLegacyDictionaryWithAgentSeed(calc);
        const it = findItem(calc, 'storage-object-tb');
        assert.equal(it.unit, 'ТБ', 'unit не менялся');
        assert.equal(it.pricePerUnit, 1700, 'цена ТБ сохраняется (unit совпал)');
        assert.match(it.qtyFormulas.PROD, /s3_versioning/, 'формула должна обновиться (S3 versioning overhead)');
    });
});
