/**
 * PATCH 2.14.16 — formatResourceQty: все значения «Объёмы ресурсов»
 * округляются до ближайшего целого числа.
 *
 * Раньше:
 *   - ТБ → 2 знака после запятой (например, «100,64 ТБ», «9 068,76 ТБ»)
 *   - vCPU/ГБ/шт. → Math.ceil → целое
 * Стало: все единицы → Math.round → целое + разделитель тысяч.
 *
 * Жалоба пользователя: дробные хвосты в дашборде отвлекают от порядка
 * величины; цифры должны быть «чистыми» целыми.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatResourceQty } from '../../../js/ui/dashboard.js';

test('formatResourceQty: ТБ округляется до целого (раньше — 2 знака)', () => {
    //   — NBSP (Intl.NumberFormat ru-RU использует именно его как разделитель тысяч).
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

test('formatResourceQty: source — нет хардкод max:2 для ТБ (защита от регрессии)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
        resolve(here, '..', '..', '..', 'js', 'ui', 'dashboardAggregates.js'), 'utf8'
    );
    // Тело function formatResourceQty не должно содержать "max: 2" — это была
    // прежняя дробная-точность форматирования для ТБ. PATCH 2.14.16 — max: 0.
    const fnMatch = src.match(/export function formatResourceQty[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'функция formatResourceQty не найдена');
    assert.equal(
        /max:\s*2/.test(fnMatch[0]), false,
        'formatResourceQty не должна содержать max: 2 (регрессия PATCH 2.14.16 — дробные хвосты вернутся)'
    );
    assert.match(fnMatch[0], /Math\.round/, 'formatResourceQty должна использовать Math.round (округление к ближайшему)');
});
