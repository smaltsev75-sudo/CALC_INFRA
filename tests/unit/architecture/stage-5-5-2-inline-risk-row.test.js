/**
 * Stage 5.5.2 — Inline risk-row layout.
 *
 * `.field-percent` теперь использует grid horizontal layout вместо
 * стандартного `.field` flex-column. Эффект: 8 риск-полей + ставка НДС
 * рендерятся одной строкой [label | number+% | slider], сокращая
 * vertical-scroll settings-panel в 1.5–2×.
 *
 * Узкие экраны (≤580px) — fallback в стек через @media.
 *
 * Совместимость с Stage 5.3.A: field-description (короткий tooltipShort)
 * spans grid-column 1/-1 — занимает всю ширину под inline-row.
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

describe('Stage 5.5.2 / forms.css — .field-percent grid layout', () => {
    it('.field-percent использует display: grid', () => {
        const body = ruleBody(read('css/forms.css'), '.field-percent');
        assert.match(body, /display:\s*grid\b/,
            '.field-percent должен использовать display: grid (Stage 5.5.2 inline layout)');
    });

    it('.field-percent имеет 3 grid-колонки: label | input | slider', () => {
        const body = ruleBody(read('css/forms.css'), '.field-percent');
        // Две minmax() колонки + одна auto = 3 колонки
        assert.match(body, /grid-template-columns:\s*minmax\([^)]+\)\s+auto\s+minmax\([^)]+\)/,
            '.field-percent должен иметь grid-template-columns: minmax() auto minmax() (3 колонки)');
    });

    it('.field-percent > .percent-input-row становится прозрачным (display: contents)', () => {
        const css = stripCssComments(read('css/forms.css'));
        const m = css.match(/\.field-percent\s*>\s*\.percent-input-row\s*\{([^}]+)\}/);
        assert.ok(m, '.field-percent > .percent-input-row должно быть определено');
        assert.match(m[1], /display:\s*contents\b/,
            'Wrapper становится display: contents — children участвуют в parent grid');
    });

    it('.field-percent > .field-description spans grid-column 1 / -1', () => {
        const css = stripCssComments(read('css/forms.css'));
        const m = css.match(/\.field-percent\s*>\s*\.field-description\s*\{([^}]+)\}/);
        assert.ok(m, '.field-percent > .field-description должно быть определено');
        assert.match(m[1], /grid-column:\s*1\s*\/\s*-1/,
            'field-description занимает всю ширину под grid-row через 1 / -1');
    });

    it('Узкоэкранный fallback @media (max-width: 580px): grid-template-columns: 1fr', () => {
        const css = stripCssComments(read('css/forms.css'));
        // Ищем @media (max-width: 580px) с правилом для .field-percent
        const re = /@media\s*\(max-width:\s*580px\)\s*\{[\s\S]*?\.field-percent\s*\{([^}]+)\}/;
        const m = css.match(re);
        assert.ok(m, '@media (max-width: 580px) должен переопределять .field-percent');
        assert.match(m[1], /grid-template-columns:\s*1fr\b/,
            'на ≤580px field-percent должен схлопываться в 1 колонку');
    });

    it('Узкоэкранный fallback восстанавливает flex для .percent-input-row', () => {
        const css = stripCssComments(read('css/forms.css'));
        const re = /@media\s*\(max-width:\s*580px\)\s*\{[\s\S]*?\.field-percent\s*>\s*\.percent-input-row\s*\{([^}]+)\}/;
        const m = css.match(re);
        assert.ok(m, '@media должен восстановить flex на .percent-input-row');
        assert.match(m[1], /display:\s*flex\b/,
            'на ≤580px wrapper становится flex обратно — number+slider в одну строку под label');
    });
});

describe('Stage 5.5.2 / совместимость с Stage 5.3.A', () => {
    it('базовая структура .percent-input-row (display: flex) сохранена для НЕ-grid контекстов', () => {
        const body = ruleBody(read('css/forms.css'), '.percent-input-row');
        assert.match(body, /display:\s*flex\b/,
            'базовый .percent-input-row остаётся flex (применяется ВНЕ .field-percent grid');
        assert.match(body, /gap:\s*12px/,
            'базовый gap: 12px сохранён');
    });

    it('Stage 5.3.A field-description rule остаётся в components.css', () => {
        const body = ruleBody(read('css/components.css'), '.field-description');
        assert.match(body, /font-size:\s*0\.78rem/,
            '.field-description базовый стиль не изменён Stage 5.5.2');
    });
});

describe('Stage 5.5.2 / Stage 4.15 совместимость (opacity 0.4 для disabled)', () => {
    /* Регрессия: .field-disabled .input уже opacity 0.4 (Stage 4.15). Stage 5.5.2
       не должен сломать это для percent-полей. .field-disabled остаётся применимым
       к .field-percent, потому что оба класса висят на одном <label>. */
    it('.field-disabled .input opacity = 0.4 не нарушено Stage 5.5.2', () => {
        const css = stripCssComments(read('css/forms.css'));
        const m = css.match(/\.field-disabled\s+\.input,?[\s\S]*?\{([^}]+)\}/);
        assert.ok(m);
        assert.match(m[1], /opacity:\s*0\.4\b/,
            'Stage 4.15 инвариант сохранён: .field-disabled .input opacity 0.4');
    });
});
