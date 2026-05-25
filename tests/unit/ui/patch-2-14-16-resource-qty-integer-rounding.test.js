/**
 * PATCH 2.20.62 — formatResourceQty: Dashboard не имеет права превращать
 * малые, но ненулевые ТБ-ёмкости в прочерк.
 *
 * Раньше:
 *   - ТБ → 2 знака после запятой (например, «100,64 ТБ», «9 068,76 ТБ»)
 *   - vCPU/ГБ/шт. → Math.ceil → целое
 * Теперь:
 *   - ТБ меньше 10 показываются с дробной частью, чтобы 0,12 ТБ SSD/HDD
 *     было видно на DEV/ИФТ/Нагрузке;
 *   - CPU/RAM/шт. остаются целыми.
 *
 * Жалоба пользователя: дробные хвосты в дашборде отвлекают от порядка
 * величины; цифры должны быть «чистыми» целыми.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatResourceQty } from '../../../js/ui/dashboard.js';

test('formatResourceQty: малые ТБ показывают дробную часть и не превращаются в 0', () => {
    //   — NBSP (Intl.NumberFormat ru-RU использует именно его как разделитель тысяч).
    assert.equal(formatResourceQty(0.1219375, 'ТБ'), '0,12');
    assert.equal(formatResourceQty(0.2578125, 'ТБ'), '0,26');
    assert.equal(formatResourceQty(1.2, 'ТБ'), '1,2');
});

test('formatResourceQty: крупные ТБ остаются компактными', () => {
    assert.equal(formatResourceQty(100.64, 'ТБ'), '101');
    assert.equal(formatResourceQty(1589.99, 'ТБ'), '1 590');
    assert.equal(formatResourceQty(9068.76, 'ТБ'), '9 069');
});

test('formatResourceQty: округление к ближайшему (Math.round), не вверх (Math.ceil)', () => {
    // 240.3 → 240 (не 241 как было раньше для шт./ГБ через Math.ceil).
    assert.equal(formatResourceQty(240.3, 'шт.'), '240');
    assert.equal(formatResourceQty(240.7, 'шт.'), '241');
    assert.equal(formatResourceQty(987.5, 'ГБ'), '988');  // half-to-even даёт 988
});

test('formatResourceQty: qty <= 0 → null (для рендера «—»)', () => {
    assert.equal(formatResourceQty(0, 'ТБ'), null);
    assert.equal(formatResourceQty(-1, 'шт.'), null);
    assert.equal(formatResourceQty(NaN, 'ТБ'), null);
    assert.equal(formatResourceQty(Infinity, 'ТБ'), null);
});

test('formatResourceQty: разделитель тысяч включён для крупных чисел', () => {
    const v = formatResourceQty(123456, 'ГБ');
    // Проверяем, что есть group-разделитель и нет дробной части.
    assert.equal(/^\d/.test(v), true);
    assert.equal(/[,.]/.test(v), false, 'не должно быть точки/запятой (дробной части)');
    assert.match(v, / |\s/, 'должен быть разделитель тысяч (NBSP или пробел)');
});

test('formatResourceQty: source — ТБ обрабатываются до целочисленного округления', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
        resolve(here, '..', '..', '..', 'js', 'ui', 'dashboardAggregates.js'), 'utf8'
    );
    const fnMatch = src.match(/export function formatResourceQty[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'функция formatResourceQty не найдена');
    assert.match(fnMatch[0], /isFractionalCapacityUnit\(unit\)/,
        'ТБ должны идти отдельной веткой до Math.round');
    assert.match(fnMatch[0], /formatNumber\(qty/,
        'ТБ должны форматироваться из исходного qty, а не из Math.round(qty)');
    assert.match(fnMatch[0], /Math\.round/,
        'для целочисленных ресурсов Math.round остаётся нужным');
});
