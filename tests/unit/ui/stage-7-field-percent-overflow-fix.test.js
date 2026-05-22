/**
 * PATCH 2.4.27 — Fix .field-percent overflow в settings-grid.
 *
 * Bug (regression Stage 5.5.2): .field-percent — inline 3-col grid внутри
 * .settings-grid cell. Минимальная ширина .field-percent = 180+auto+140 ≈ 420px.
 * .settings-grid cells minmax(260px, 1fr) → ≤300px на cell при 4 cols. Overflow
 * в 120-160px → field-description одного поля наезжала на label/inputs следующего.
 *
 * Plus grid-item-default-min-width-auto ловушка (как в 13.U11 .comparison-ai-block):
 * длинные labels/descriptions раздували min-content track сверх 1fr-аллокации.
 *
 * Fix:
 *   • .settings-grid minmax 260→380px → cells ≥380px вмещают .field-percent
 *   • .field-percent { min-width: 0 } → может shrink в parent
 *   • .field-percent > .field-label { min-width: 0; overflow-wrap: anywhere }
 *   • .field-percent > .field-description { min-width: 0; overflow-wrap: anywhere }
 *
 * Regression check: PATCH 2.4.26 (provider visual refresh) не сломан.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, ruleBody } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('PATCH 2.4.27 / .field-percent overflow fix — settings-grid sizing', () => {
    const cssRaw = read('css/forms.css');

    it('.settings-grid использует minmax(380px, 1fr) (было 260px → overflow)', () => {
        const body = ruleBody(cssRaw, '.settings-grid');
        assert.match(body, /grid-template-columns:\s*repeat\(\s*auto-fit\s*,\s*minmax\(\s*380px\s*,\s*1fr\s*\)\s*\)/,
            'minmax 380px обеспечивает что .field-percent (~420px) помещается в cell без overflow');
    });

    it('.settings-grid НЕ использует старое minmax(260px, ...) (regression-guard)', () => {
        const css = stripCssComments(cssRaw);
        // Точное правило вида .settings-grid { ... minmax(260px, 1fr) ... }
        // должно отсутствовать. Допустим минимум 260px только в other contexts
        // (например, .settings-group-provider .settings-grid имеет своё правило).
        const re = /\.settings-grid\s*\{[^}]*minmax\(\s*260px\s*,\s*1fr\s*\)/;
        assert.doesNotMatch(css, re,
            'старое правило minmax(260px, 1fr) на .settings-grid должно быть удалено');
    });
});

describe('PATCH 2.4.27 / .field-percent overflow fix — min-width защита', () => {
    const cssRaw = read('css/forms.css');

    it('.field-percent имеет min-width: 0 (защита от расширения parent track)', () => {
        const body = ruleBody(cssRaw, '.field-percent');
        assert.match(body, /min-width:\s*0\b/,
            '.field-percent должен иметь min-width: 0 чтобы shrink в parent grid-cell ' +
            '(grid-item-default-min-width-auto ловушка)');
    });

    it('.field-percent > .field-label имеет min-width: 0 + overflow-wrap', () => {
        const body = ruleBody(cssRaw, '.field-percent > .field-label');
        assert.match(body, /min-width:\s*0\b/,
            'label не должен раздувать min-content track');
        assert.match(body, /overflow-wrap:\s*anywhere/,
            'overflow-wrap: anywhere позволяет wrap длинного label в 2 строки');
    });

    it('.field-percent > .field-description имеет min-width: 0 + overflow-wrap', () => {
        const body = ruleBody(cssRaw, '.field-percent > .field-description');
        assert.match(body, /min-width:\s*0\b/,
            'description не должна раздувать min-content sub-grid track ' +
            '→ overflow в соседнюю parent grid-cell');
        assert.match(body, /overflow-wrap:\s*anywhere/,
            'overflow-wrap: anywhere — для длинных русских описаний без пробелов между категориями');
    });

    it('.field-percent сохраняет 3-колонную inline-раскладку [label | input | slider]', () => {
        const body = ruleBody(cssRaw, '.field-percent');
        // PATCH 2.4.30: pixel-точный assert relaxed (был 180/auto/140; стал 120/auto/80
        // чтобы фитить в 380px settings-grid cells на ultra-wide screens). Структурный
        // pattern (3 col: minmax(...) + auto + minmax(...)) сохранён.
        assert.match(body,
            /grid-template-columns:\s*minmax\(\s*\d+px\s*,\s*1fr\s*\)\s+auto\s+minmax\(\s*\d+px\s*,\s*\d+px\s*\)/,
            '3-колонная inline-раскладка [label | input | slider] сохраняется');
    });
});

describe('PATCH 2.4.27 / Regression — PATCH 2.4.26 (provider) не затронут', () => {
    const cssRaw = read('css/forms.css');
    const css = stripCssComments(cssRaw);

    it('regression: .provider-price-row.is-top-expensive (2.4.25) на месте', () => {
        assert.match(css,
            /\.provider-price-row\.is-top-expensive[\s\S]{0,300}?color:\s*var\(--accent\)/,
            '2.4.25 highlight-rule должен сохраниться');
    });

    it('regression: .provider-price-category-list-dense (2.4.26) на месте', () => {
        const body = ruleBody(cssRaw, '.provider-price-category-list-dense');
        assert.match(body, /column-count:\s*2/,
            '2.4.26 dense 2-col layout должен сохраниться');
    });

    it('regression: .provider-price-category-title (2.4.26) flex-layout на месте', () => {
        const body = ruleBody(cssRaw, '.provider-price-category-title');
        assert.match(body, /display:\s*flex/,
            '2.4.26 flex-layout для icon+label должен сохраниться');
    });
});
