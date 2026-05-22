/**
 * Regression-тест к 12.U30 (1.4a): в Детализации имя ЭК (.col-name) обрезается
 * через text-overflow: ellipsis (max-width 220px). Полное имя + description
 * пользователь видит при hover как title-tooltip — иначе обрезанное название
 * становится загадкой.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const detailsSource = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'detailsSections.js'),
    'utf8'
);

describe('Details: title для длинного имени ЭК (12.U30 1.4a)', () => {
    it('renderQtyItemRow / renderCostItemRow: <td class=col-name> имеет title с item.name', () => {
        // Должно быть как минимум 2 вхождения (qty + cost rows). Каждое — с title.
        const colNameCells = detailsSource.match(/class:\s*['"]col-name['"][^,)]*[\s\S]{0,200}?title:/g) || [];
        assert.ok(colNameCells.length >= 2,
            `найдено ${colNameCells.length} <td class="col-name"> с title=, должно быть ≥ 2 ` +
            '(в renderQtyItemRow и в renderCostItemRow)');
    });

    it('title включает item.name и опционально item.description', () => {
        // Ищем pattern: title: item.description ? `${item.name}\n\n${item.description}` : item.name
        const re = /title:\s*item\.description\s*\?\s*`\$\{item\.name\}[\s\S]{0,30}?\$\{item\.description\}`\s*:\s*item\.name/;
        const matches = detailsSource.match(new RegExp(re.source, 'g')) || [];
        assert.ok(matches.length >= 2,
            `title должен использовать item.name + опционально item.description (найдено ${matches.length} вхождений)`);
    });
});
