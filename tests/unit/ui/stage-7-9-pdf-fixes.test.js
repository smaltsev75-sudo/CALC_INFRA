/**
 * PATCH 2.4.37 — PDF print fixes (Dashboard + Details).
 *
 *   1. Dashboard: hardware и AI-метрики (qty + unit + label) не имели
 *      print-color override — на dark-теме color: var(--text) = светлый,
 *      print background = белый → значения «267 015 млн токенов / мес»,
 *      «1 016 шт.» становились невидимы на бумаге.
 *
 *   2. Details: крайний правый столбец «ИТОГО / ГОД» обрезался на A4
 *      landscape — таблица с 17 колонками превышала ширину page area
 *      (~1062px) при font-size: 8pt. Снижено до 7pt + tighter padding.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* Кастомный extractor для @media print (см. ловушку extractAtMediaBody — он
   ищет @media с круглыми скобками; @media print без скобок не подхватывается). */
function extractMediaPrintBody(src) {
    const i = src.search(/@media\s+print\s*\{/);
    assert.ok(i >= 0, '@media print block должен быть в print.css');
    let depth = 0, start = -1;
    for (let j = i; j < src.length; j++) {
        if (src[j] === '{') {
            if (depth === 0) start = j + 1;
            depth++;
        } else if (src[j] === '}') {
            depth--;
            if (depth === 0) return src.slice(start, j);
        }
    }
    throw new Error('Unbalanced @media print braces');
}

describe('PATCH 2.4.37 / PDF Dashboard — hardware/AI-метрики color override', () => {
    const cssRaw = stripCssComments(read('css/print.css'));
    const printBody = extractMediaPrintBody(cssRaw);

    it('.dash-resource-row-qty в print-overrides (color: black)', () => {
        // Эти селекторы должны быть в групповом правиле с color: black !important
        assert.match(printBody,
            /\.dash-resource-row-qty[\s\S]{0,1500}?color:\s*black\s*!important/,
            '.dash-resource-row-qty должен иметь color: black !important на print');
    });

    it('.dash-ai-metric-row-qty в print-overrides (color: black)', () => {
        assert.match(printBody,
            /\.dash-ai-metric-row-qty[\s\S]{0,1500}?color:\s*black\s*!important/,
            '.dash-ai-metric-row-qty должен иметь color: black !important на print');
    });

    it('.dash-resource-row-value, .dash-resource-row-unit, .dash-resource-row-label покрыты', () => {
        assert.match(printBody, /\.dash-resource-row-value\b/,
            '.dash-resource-row-value в print-overrides');
        assert.match(printBody, /\.dash-resource-row-unit\b/,
            '.dash-resource-row-unit в print-overrides');
        assert.match(printBody, /\.dash-resource-row-label\b/,
            '.dash-resource-row-label в print-overrides');
    });

    it('.dash-ai-metric-row-value, .dash-ai-metric-row-unit, .dash-ai-metric-row-label покрыты', () => {
        assert.match(printBody, /\.dash-ai-metric-row-value\b/,
            '.dash-ai-metric-row-value в print-overrides');
        assert.match(printBody, /\.dash-ai-metric-row-unit\b/,
            '.dash-ai-metric-row-unit в print-overrides');
        assert.match(printBody, /\.dash-ai-metric-row-label\b/,
            '.dash-ai-metric-row-label в print-overrides');
    });
});

describe('PATCH 2.4.37 / PDF Details — font-size reduced to fit A4 landscape', () => {
    const cssRaw = stripCssComments(read('css/print.css'));
    const printBody = extractMediaPrintBody(cssRaw);

    it('.details-table font-size ≤ 7pt на печати (12.5% компактнее предыдущих 8pt)', () => {
        // Берём блок .details-table { ... } внутри @media print
        const m = printBody.match(/\.details-table\s*\{([^}]*)\}/);
        assert.ok(m, '.details-table {} block должен быть в print');
        const body = m[1];
        const fsMatch = body.match(/font-size:\s*(\d+(?:\.\d+)?)pt/);
        assert.ok(fsMatch, 'font-size в pt должен быть задан');
        const pt = parseFloat(fsMatch[1]);
        assert.ok(pt <= 7,
            `font-size ${pt}pt должен быть ≤ 7pt — иначе крайний правый столбец «ИТОГО / ГОД» вылезает за A4 landscape`);
    });

    it('.details-table th/td padding ≤ 3px на печати', () => {
        const m = printBody.match(/\.details-table\s+th\s*,\s*\.details-table\s+td\s*\{([^}]*)\}/);
        assert.ok(m, '.details-table th/td block должен быть');
        const body = m[1];
        // padding: Apx Bpx — берём оба числа
        const padMatch = body.match(/padding:\s*(\d+)px\s+(\d+)px/);
        assert.ok(padMatch, 'padding в px должен быть задан');
        const [, top, side] = [padMatch[0], padMatch[1], padMatch[2]];
        assert.ok(parseInt(side) <= 3,
            `padding side ${side}px должен быть ≤ 3px — для компактного fitting`);
    });
});
