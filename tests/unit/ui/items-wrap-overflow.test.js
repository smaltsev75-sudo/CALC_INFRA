/**
 * Regression-тест: .items-table-wrap НЕ должен создавать scroll-context.
 *
 * Та же ловушка, что для .app-main (см. sticky-thead-positioning.test.js):
 * по CSS-spec любое значение overflow-x ≠ visible автоматически делает
 * overflow-y = auto → scroll-context → sticky thead привязывается к wrap,
 * а не к viewport, и не работает ожидаемо.
 *
 * Дополнительно: .items-table thead th не должно дублироваться двумя
 * правилами (старое правило line 530-534 имело z-index: 2, новое — 5).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tablesCss = readFileSync(
    join(__dirname, '..', '..', '..', 'css', 'tables.css'),
    'utf8'
);

function ruleBody(src, selector) {
    const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]+)\\}');
    const m = src.match(re);
    if (!m) throw new Error(`CSS-правило ${selector} не найдено`);
    return m[1];
}

describe('items-table-wrap: НЕ scroll-context (sticky-thead зависит от viewport)', () => {
    it('.items-table-wrap НЕ имеет overflow-x/overflow/overflow-y ≠ visible', () => {
        const body = ruleBody(tablesCss, '.items-table-wrap');
        assert.doesNotMatch(body, /overflow(-x|-y)?\s*:\s*(auto|scroll|hidden)/,
            'overflow на .items-table-wrap создаёт scroll-context → sticky-thead привязывается ' +
            'к wrap, а не к viewport, и под app-topbar не подъезжает. ' +
            'Та же ловушка, что было с .app-main (CLAUDE.md → 12.U30 1.4c).');
    });

    it('правило .items-table thead th с position: sticky присутствует ровно один раз', () => {
        // Должно остаться одно правило: line 47-54 (с z-index 5 + sticky).
        // Старое дублирующее правило line 530-534 (z-index 2) — удалить.
        const matches = tablesCss.match(/\.items-table thead th\s*[,{]/g) || [];
        // Селектор может быть либо `.items-table thead th,` (комбинированный) либо `.items-table thead th {`.
        // Допустимо до 2 включений (sticky-rule + опциональный override для отдельного столбца),
        // но НЕ допустимо чтобы существовало правило с z-index < 5 без sticky.
        // Проще: ищем правило где после `.items-table thead th {` есть `z-index: 2`.
        const conflictRe = /\.items-table thead th\s*\{[^}]*z-index:\s*2[^}]*\}/;
        assert.doesNotMatch(tablesCss, conflictRe,
            'дублирующее правило с z-index: 2 затирает правильное z-index: 5 — удалить');
    });
});
