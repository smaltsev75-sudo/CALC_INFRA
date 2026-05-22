/**
 * PATCH 2.4.32 — Dashboard PDF dark-theme fix.
 *
 * Bug: пользователь screenshot'ом «Дэшборд PDF (тёмная тема)» показал, что
 * после выгрузки в PDF dashboard cards остаются с тёмным background'ом
 * (var(--bg-card)), а текст после print-сбросов становится #333 (см. print.css
 * line 121: .dash-category-row-label / .dash-risk-row-label / etc.). Текст
 * #333 на тёмном фоне = нечитаемо.
 *
 * Root cause: print.css имел background-сбросы для .stand-card / .calc-card
 * / .questionnaire-section / .settings-panel, но НЕ для .dash-* containers
 * дашборда. При [data-theme="dark"] dashboard cards остались dark в PDF.
 *
 * Fix: добавить @media print правила для всех dash-containers и sub-rows:
 *   • Containers (.dashboard-empty, .profile-banner, .dash-card,
 *     .dash-stand-card, .dash-resources, .dash-ai-metrics) → white bg + #ccc border
 *   • Sub-rows с rgba-backgrounds (.dash-resource-row, .dash-ai-metric-row,
 *     .dash-stand-card-numbers, .dash-risk-row, .dash-stand-card-link) → transparent
 *   • Titles → black text on transparent
 *   • Badges с rgba → white bg + #888 border
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

/**
 * Локальный helper: extractAtMediaBody из shared helpers требует @media (...)
 * с круглыми скобками; @media print — media TYPE без скобок (см. ловушку
 * в stage-7-1-settings-print-fix.test.js).
 */
function extractMediaPrintBody(src) {
    const stripped = stripCssComments(src);
    const headerRe = /@media\s+print\s*\{/;
    const m = stripped.match(headerRe);
    if (!m) return null;
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < stripped.length && depth > 0) {
        const ch = stripped[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        if (depth === 0) return stripped.slice(start, i);
        i++;
    }
    return null;
}

describe('PATCH 2.4.32 / Dashboard PDF dark-theme fix', () => {
    const cssRaw = read('css/print.css');
    const body = extractMediaPrintBody(cssRaw);

    it('@media print существует в print.css', () => {
        assert.ok(body, '@media print block должен существовать');
    });

    it('@media print → top-level dashboard containers имеют background: white', () => {
        // Все основные dashboard cards должны получать white bg в print.
        for (const sel of [
            '\\.dashboard-empty',
            '\\.profile-banner',
            '\\.dash-card\\b',
            '\\.dash-stand-card',
            '\\.dash-resources\\b',
            '\\.dash-ai-metrics\\b'
        ]) {
            const re = new RegExp(sel + '[\\s\\S]{0,500}?background:\\s*white');
            assert.match(body, re,
                `${sel} должен иметь background: white в @media print`);
        }
    });

    it('@media print → top-level dashboard containers имеют color: black', () => {
        // Группа containers содержит color: black !important.
        assert.match(body,
            /\.dashboard-empty[\s\S]{0,500}?color:\s*black/,
            'containers должны иметь color: black в @media print');
    });

    it('@media print → sub-rows с rgba background сбрасываются в transparent', () => {
        for (const sel of [
            '\\.dash-resource-row',
            '\\.dash-ai-metric-row',
            '\\.dash-stand-card-numbers',
            '\\.dash-risk-row'
        ]) {
            const re = new RegExp(sel + '[\\s\\S]{0,400}?background:\\s*transparent');
            assert.match(body, re,
                `${sel} должен иметь background: transparent в @media print`);
        }
    });

    it('@media print → section-titles имеют color: black + transparent bg', () => {
        for (const sel of [
            '\\.dash-section-title',
            '\\.dash-resources-title',
            '\\.dash-ai-metrics-title',
            '\\.dash-stand-card-title'
        ]) {
            const re = new RegExp(sel + '[\\s\\S]{0,400}?color:\\s*black');
            assert.match(body, re,
                `${sel} должен иметь color: black в @media print`);
        }
    });

    it('@media print → dashboard badges (risk/base/breakdown) — white bg + #888 border', () => {
        const re = /\.dash-resources-badge[\s\S]{0,500}?background:\s*white/;
        assert.match(body, re,
            'dash-resources-badge должны иметь white background');
        const reBorder = /\.dash-resources-badge[\s\S]{0,500}?border:\s*1px solid\s*#888/;
        assert.match(body, reBorder,
            'badges должны иметь #888 border (консистентно с .vat-badge / .pill в print)');
    });

    it('regression: pre-existing print rules (.stand-card / .questionnaire-section) на месте', () => {
        // Existing reset rules не были тронуты PATCH 2.4.32.
        assert.match(body,
            /\.stand-card\s*,[\s\S]{0,200}?\.questionnaire-section/,
            'pre-existing .stand-card / .questionnaire-section group остаётся');
    });
});
