/**
 * Regression-тест: в карточке «Распределение по категориям» под прогресс-баром
 * AI больше НЕ выводится strip-полоса с подметриками (TOKENS / RAG_VECTORS /
 * EMBEDDINGS / AGENT_CPU). Та же информация уже отображается в Hero-блоке
 * «Метрики AI / RAG / агентов · ИТОГО» через renderAiMetricsBlock — дубль
 * на одном экране визуально шумит и путает.
 *
 * Что должно быть удалено:
 *   - функция renderAiCategoryInlineStrip;
 *   - вызов её из renderCategoriesCard;
 *   - все CSS-классы .dash-ai-cat-strip / .dash-ai-cat-chip*.
 *
 * Что остаётся: одинарный hint на лейбле категории AI / LLM (через
 * CATEGORY_DESCRIPTIONS, см. dashboard-category-tooltips.test.js).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, stripCssComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardJs = stripJsComments(readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'dashboard.js'),
    'utf8'
));
const dashboardCss = stripCssComments(readFileSync(
    join(__dirname, '..', '..', '..', 'css', 'dashboard.css'),
    'utf8'
));

describe('Dashboard: AI-strip удалён из «Распределение по категориям» (дубль Hero)', () => {
    it('функция renderAiCategoryInlineStrip удалена из dashboard.js', () => {
        const decl = /function\s+renderAiCategoryInlineStrip\s*\(/.test(dashboardJs);
        assert.equal(decl, false,
            'функция renderAiCategoryInlineStrip должна быть удалена — strip больше не нужен');
    });

    it('renderAiCategoryInlineStrip нигде не вызывается', () => {
        const calls = dashboardJs.match(/renderAiCategoryInlineStrip\s*\(/g) || [];
        assert.equal(calls.length, 0,
            'renderAiCategoryInlineStrip не должна вызываться — найдено ' + calls.length + ' мест');
    });

    it('CSS-классы .dash-ai-cat-strip и .dash-ai-cat-chip* удалены', () => {
        const stripRule = /\.dash-ai-cat-strip\s*\{/.test(dashboardCss);
        const chipRule  = /\.dash-ai-cat-chip(?:[\w-]*)\s*[\{,:]/.test(dashboardCss);
        assert.equal(stripRule, false, 'правило .dash-ai-cat-strip должно быть удалено');
        assert.equal(chipRule,  false, 'правила .dash-ai-cat-chip* должны быть удалены');
    });

    it('renderCategoriesCard больше не имеет параметра totalAiMetrics', () => {
        const sig = dashboardJs.match(/function\s+renderCategoriesCard\s*\(([^)]*)\)/);
        assert.ok(sig, 'renderCategoriesCard должна быть определена');
        assert.equal(/\btotalAiMetrics\b/.test(sig[1]), false,
            'параметр totalAiMetrics должен быть удалён из сигнатуры renderCategoriesCard — ' +
            'он больше не нужен');
    });
});
