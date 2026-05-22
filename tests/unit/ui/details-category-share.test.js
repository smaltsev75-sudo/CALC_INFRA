/**
 * Детализация: строка группы ЭК показывает не только суммы, но и долю группы
 * в текущей выборке. Это помогает на desktop быстро прочитать вклад категории
 * без раскрытия десятков строк.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ruleBody, stripCssComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..', '..');
const detailsSectionsSource = readFileSync(join(root, 'js', 'ui', 'detailsSections.js'), 'utf8');
const tablesCss = stripCssComments(readFileSync(join(root, 'css', 'tables.css'), 'utf8'));

describe('Details: доля группы ЭК в category-row', () => {
    it('renderCostSection передаёт totalMonthly выборки в renderCostCategoryRow', () => {
        assert.match(
            detailsSectionsSource,
            /renderCostCategoryRow\(cat,\s*list,\s*result,\s*disabled,\s*collapsed,\s*ctx,\s*presentCats,\s*totals\.totalMonthly\)/,
            'category-row должна знать общий totalMonthly текущей выборки для расчёта доли'
        );
    });

    it('renderCostCategoryRow рендерит category share через renderCategoryShareCell', () => {
        assert.match(
            detailsSectionsSource,
            /renderCategoryShareCell\(totalMonthly,\s*denomMonthly\)/,
            'строка группы должна выводить долю категории в колонке «Доля, %»'
        );
    });

    it('category-row total/share визуально сильнее обычных muted ячеек', () => {
        const totalMatch = tablesCss.match(
            /\.details-table\s+\.category-row\s+td\.col-total\s*,\s*\.details-table\s+\.category-row\s+td\.category-share\s*\{([^}]+)\}/
        );
        assert.ok(totalMatch, 'CSS-правило для category-row total/share должно существовать');
        const totalBody = totalMatch[1];
        assert.match(totalBody, /color\s*:\s*var\(--text\)/);
        assert.match(totalBody, /font-weight\s*:\s*800/);

        const annualBody = ruleBody(tablesCss, '.details-table .category-row td.col-total + td.col-total');
        assert.match(annualBody, /color\s*:\s*var\(--accent\)/,
            'годовой итог категории — ключ сортировки, поэтому он должен быть визуально заметнее');
    });
});
