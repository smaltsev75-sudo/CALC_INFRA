/**
 * PATCH 2.14.16 (часть 2) — distributeRoundingPreservingSum.
 *
 * Инвариант (требование пользователя): для каждого ресурса в блоке
 * «Объёмы ресурсов · ИТОГО» отображаемое значение === сумма
 * отображаемых значений того же ресурса на всех АКТИВНЫХ стендах
 * (стенды НЕ в disabledStands).
 *
 * Hare/Hamilton (largest-remainder) метод: floor каждой per-stand qty,
 * раздать (round(total) - sum(floors)) единиц стендам с наибольшими
 * дробными остатками.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distributeRoundingPreservingSum } from '../../../js/ui/dashboard.js';

function build(perStandValues, totalValue, label = 'CPU') {
    const perStand = {};
    for (const [sid, qty] of Object.entries(perStandValues)) {
        perStand[sid] = { [label]: { qty, unit: 'шт.', applicable: true } };
    }
    const total = { [label]: { qty: totalValue, unit: 'шт.', applicable: true } };
    return { perStand, total };
}

function sumPerStand(resources, label, stands) {
    return stands.reduce((s, sid) =>
        s + (resources.perStand[sid]?.[label]?.qty || 0), 0);
}

test('sum-invariant: 5 × 0.4 → target round = 2; топ-2 стенда получают +1', () => {
    const res = build({
        DEV: 0.4, IFT: 0.4, PSI: 0.4, PROD: 0.4, LOAD: 0.4
    }, 2.0);
    distributeRoundingPreservingSum(res, ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']);
    // ИТОГО = 2; сумма по 5 стендам тоже = 2.
    assert.equal(res.total.CPU.qty, 2);
    assert.equal(sumPerStand(res, 'CPU', ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']), 2);
    // Ровно 2 стенда имеют значение 1, остальные 0.
    const stands = ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']
        .map(s => res.perStand[s].CPU.qty);
    const ones = stands.filter(v => v === 1).length;
    const zeros = stands.filter(v => v === 0).length;
    assert.equal(ones, 2);
    assert.equal(zeros, 3);
});

test('sum-invariant: целочисленные qty не меняются', () => {
    const res = build({ DEV: 100, IFT: 200, PSI: 300, PROD: 500, LOAD: 50 }, 1150);
    distributeRoundingPreservingSum(res, ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']);
    assert.equal(res.perStand.DEV.CPU.qty, 100);
    assert.equal(res.perStand.IFT.CPU.qty, 200);
    assert.equal(res.perStand.PSI.CPU.qty, 300);
    assert.equal(res.perStand.PROD.CPU.qty, 500);
    assert.equal(res.perStand.LOAD.CPU.qty, 50);
    assert.equal(res.total.CPU.qty, 1150);
});

test('sum-invariant: реалистичный кейс ТБ с дробными хвостами', () => {
    // raw: DEV 0,2 + IFT 1,8 + PSI 25,4 + PROD 70,2 + LOAD 2,9 = 100,5
    // round(total) = 101 (или 100 при banker's). Проверяем инвариант.
    const res = build({
        DEV: 0.2, IFT: 1.8, PSI: 25.4, PROD: 70.2, LOAD: 2.9
    }, 100.5, 'SSD');
    const active = ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD'];
    distributeRoundingPreservingSum(res, active);
    const total = res.total.SSD.qty;
    const sum = sumPerStand(res, 'SSD', active);
    assert.equal(total, sum,
        `Инвариант: total (${total}) === sum активных (${sum})`);
});

test('disabled stands не входят в сумму; округляются независимо', () => {
    // LOAD выключен → total = sum(DEV+IFT+PSI+PROD raw) = 0,4+0,4+0,4+0,4 = 1,6 → round = 2
    // LOAD сырое = 99,4 → independent round = 99 (не влияет на инвариант)
    const res = build({
        DEV: 0.4, IFT: 0.4, PSI: 0.4, PROD: 0.4, LOAD: 99.4
    }, 1.6);  // total НЕ включает LOAD
    distributeRoundingPreservingSum(res, ['DEV', 'IFT', 'PSI', 'PROD']);
    assert.equal(res.total.CPU.qty, 2);
    assert.equal(
        sumPerStand(res, 'CPU', ['DEV', 'IFT', 'PSI', 'PROD']), 2,
        'сумма активных стендов === ИТОГО'
    );
    // LOAD: независимый round
    assert.equal(res.perStand.LOAD.CPU.qty, 99);
});

test('защита: нулевые qty остаются нулями, инвариант = 0', () => {
    const res = build({ DEV: 0, IFT: 0, PSI: 0, PROD: 0, LOAD: 0 }, 0);
    distributeRoundingPreservingSum(res, ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']);
    assert.equal(res.total.CPU.qty, 0);
    assert.equal(sumPerStand(res, 'CPU', ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']), 0);
});

test('защита: NaN qty не ломают вычисление', () => {
    const res = build({ DEV: NaN, IFT: 100, PSI: 0, PROD: 200, LOAD: 0 }, 300);
    distributeRoundingPreservingSum(res, ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']);
    assert.equal(res.total.CPU.qty, 300);
    // sum активных = 0 (DEV → 0) + 100 + 0 + 200 + 0 = 300
    assert.equal(sumPerStand(res, 'CPU', ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']), 300);
});

test('инвариант сохраняется на всех метках одновременно', () => {
    const perStand = {
        DEV: { CPU: { qty: 0.3, unit: 'шт.' }, RAM: { qty: 1.4, unit: 'ГБ' } },
        IFT: { CPU: { qty: 0.7, unit: 'шт.' }, RAM: { qty: 2.6, unit: 'ГБ' } },
        PSI: { CPU: { qty: 1.2, unit: 'шт.' }, RAM: { qty: 5.5, unit: 'ГБ' } },
        PROD: { CPU: { qty: 10.4, unit: 'шт.' }, RAM: { qty: 100.1, unit: 'ГБ' } },
        LOAD: { CPU: { qty: 2.8, unit: 'шт.' }, RAM: { qty: 8.4, unit: 'ГБ' } }
    };
    const total = {
        CPU: { qty: 15.4, unit: 'шт.' },
        RAM: { qty: 118.0, unit: 'ГБ' }
    };
    const res = { perStand, total };
    const active = ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD'];
    distributeRoundingPreservingSum(res, active);
    for (const label of ['CPU', 'RAM']) {
        const totalDisp = res.total[label].qty;
        const sum = sumPerStand(res, label, active);
        assert.equal(totalDisp, sum,
            `Инвариант для ${label}: total (${totalDisp}) === sum (${sum})`);
    }
});

test('источник: aggregateResources вызывается с distributeRoundingPreservingSum рядом', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
        resolve(here, '..', '..', '..', 'js', 'ui', 'dashboard.js'), 'utf8'
    );
    // Find aggregateResources CALL-site (не определение) — анкер на присваивании
    // `const resources = aggregateResources(`.
    const callIdx = src.indexOf('const resources = aggregateResources(');
    assert.ok(callIdx > 0, 'не нашёл call-site aggregateResources');
    const nearby = src.slice(callIdx, callIdx + 600);
    assert.match(
        nearby,
        /distributeRoundingPreservingSum\(/,
        'aggregateResources должен сопровождаться вызовом distributeRoundingPreservingSum в том же блоке'
    );
});
