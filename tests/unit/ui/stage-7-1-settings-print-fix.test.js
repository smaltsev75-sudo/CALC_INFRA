/**
 * Stage 7.1 (PATCH 2.4.28) — Settings panel print fix.
 *
 * Контекст: после 2.4.27 (.settings-grid minmax 260→380px) settings-grid
 * на screen вмещает inline-row .field-percent (~444px) корректно при
 * panel ≥800px ширины. НО на A4 portrait usable ~793px auto-fit даёт
 * 2 cols по ~388px — overflow 56px вправо.
 *
 * Fix: в @media print принудительно 1 col → гарантированный fit любого
 * .field-percent на любой бумаге (A4 portrait/landscape).
 *
 * Что НЕ нужно проверять (уже глобально из 2.4.27, каскадируется в print):
 *   • min-width: 0 на .field-percent / label / description
 *   • overflow-wrap: anywhere на label / description
 * Эти свойства проверяются в stage-7-field-percent-overflow-fix.test.js
 * и не дублируются здесь.
 *
 * Что НЕ нужно проверять для dark-theme:
 *   • Темы работают через [data-theme="light"] каскад в base.css. Settings
 *     panel и .field-percent не имеют hardcoded цветов — наследуют var(--text),
 *     var(--bg-card), var(--accent) автоматически.
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
 * Локальный helper: extractAtMediaBody из shared helpers требует `@media (...)`
 * с круглыми скобками. `@media print` — это media TYPE без скобок, отдельный
 * синтаксис. Этот helper находит body первого `@media print { ... }` блока
 * через brace-balancing.
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

describe('Stage 7.1 / 2.4.28 / Settings panel print fix', () => {
    const cssRaw = read('css/print.css');

    it('@media print есть в print.css', () => {
        const body = extractMediaPrintBody(cssRaw);
        assert.ok(body, '@media print должен существовать в print.css');
    });

    it('@media print → .settings-grid принудительно 1 col на A4', () => {
        const body = extractMediaPrintBody(cssRaw);
        // Принудительный 1fr единственный способ гарантировать fit на A4 portrait
        // (793px usable < 2 cols × 444px минимум для .field-percent).
        assert.match(body,
            /\.settings-grid\s*\{[^}]*grid-template-columns:\s*1fr\s*!important/,
            'на печати .settings-grid должен иметь grid-template-columns: 1fr !important');
    });

    it('@media print → .field-percent имеет min-width: 0 !important (defensive)', () => {
        const body = extractMediaPrintBody(cssRaw);
        assert.match(body,
            /\.field-percent\s*\{[^}]*min-width:\s*0\s*!important/,
            '!important нужен на случай override инлайн-стилями плагинов');
    });

    it('@media print → label и description имеют overflow-wrap: anywhere', () => {
        const body = extractMediaPrintBody(cssRaw);
        assert.match(body,
            /\.field-percent\s*>\s*\.field-label\s*,\s*\n?\s*\.field-percent\s*>\s*\.field-description\s*\{[^}]*overflow-wrap:\s*anywhere\s*!important/,
            'wrap-anywhere защита для длинных русских label/description');
        assert.match(body,
            /\.field-percent\s*>\s*\.field-label\s*,\s*\n?\s*\.field-percent\s*>\s*\.field-description\s*\{[^}]*word-break:\s*break-word\s*!important/,
            'word-break: break-word — fallback для overflow-wrap в старых движках');
    });

    it('@media print → .percent-input .input и .percent-slider имеют max-width: 100%', () => {
        const body = extractMediaPrintBody(cssRaw);
        assert.match(body,
            /\.percent-input\s+\.input\s*,\s*\n?\s*\.percent-slider\s*\{[^}]*max-width:\s*100%\s*!important/,
            'input и slider не должны вылезать за parent cell на печати');
    });

    it('regression: 2.4.27 global rules для .settings-grid (380px) и .field-percent (min-width: 0) на месте в forms.css', () => {
        const formsCss = stripCssComments(read('css/forms.css'));
        assert.match(formsCss,
            /\.settings-grid\s*\{[^}]*grid-template-columns:\s*repeat\(\s*auto-fit\s*,\s*minmax\(\s*380px\s*,\s*1fr\s*\)\s*\)/,
            '2.4.27 .settings-grid 380px должен оставаться (на screen)');
        assert.match(formsCss,
            /\.field-percent\s*\{[^}]*min-width:\s*0\b/,
            '2.4.27 .field-percent min-width: 0 должен оставаться (на screen)');
    });
});
