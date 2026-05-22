/**
 * PATCH 2.4.29 — Fix input misalignment в .questionnaire-grid.
 *
 * Bug: пользователь screenshot'ом «Объём запросов» показал, что input «400»
 * (Среднее RPS) расположен на 16-20px ниже соседних inputs «1000» (Пиковое RPS)
 * и «6» (Длительность пиковой нагрузки).
 *
 * Root cause:
 *   1. .questionnaire-grid имел `align-items: end` — каждая cell прижимается
 *      к нижнему краю row track.
 *   2. .questionnaire-grid .field имел `justify-content: flex-end` (12.U2)
 *      на flex-column — items внутри cell тоже прижаты к низу.
 *   3. Когда у соседних полей .field-description РАЗНОЙ высоты (1 vs 2 строки),
 *      cell с короткой desc становится короче по высоте; align-items: end
 *      сдвигает её к низу track'а, и её input оказывается ниже соседей.
 *
 * Fix:
 *   • align-items: end УДАЛЁН с .questionnaire-grid и .questionnaire-grid-explicit
 *     — default stretch делает все cells одинаковой высоты.
 *   • justify-content: flex-end УДАЛЁН с .questionnaire-grid .field — items
 *     теперь top-aligned (label → input → desc).
 *   • margin-top: auto на .questionnaire-grid .field > .field-description
 *     прижимает desc к низу stretched cell, сохраняя визуальный нижний baseline.
 *
 * Эффект: input у всех полей в одной row на одной y-позиции (label-bottom + 6).
 * Description'ы остаются bottom-aligned визуально (margin-top: auto). Регрессии
 * между полями с одинаковой структурой нет.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleBody, stripCssComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('PATCH 2.4.29 / questionnaire-grid alignment fix', () => {
    const cssRaw = read('css/forms.css');

    it('.questionnaire-grid НЕ содержит align-items: end (regression-guard)', () => {
        const body = ruleBody(cssRaw, '.questionnaire-grid');
        assert.doesNotMatch(body, /align-items:\s*end\b/,
            'align-items: end удалён — приводил к input misalignment при разной высоте desc');
    });

    it('.questionnaire-grid-explicit НЕ содержит align-items: end', () => {
        const body = ruleBody(cssRaw, '.questionnaire-grid-explicit');
        assert.doesNotMatch(body, /align-items:\s*end\b/,
            'тот же bug-паттерн что .questionnaire-grid — align-items: end должен быть удалён');
    });

    it('.questionnaire-grid .field НЕ содержит justify-content: flex-end', () => {
        const body = ruleBody(cssRaw, '.questionnaire-grid .field');
        assert.doesNotMatch(body, /justify-content:\s*flex-end\b/,
            'justify-content: flex-end удалён — items теперь top-aligned для консистентной позиции input');
    });

    it('.questionnaire-grid .field > .field-description top-aligned (PATCH 2.4.35)', () => {
        // PATCH 2.4.29: margin-top: auto (flex), bottom-aligned.
        // PATCH 2.4.33: align-self: end (grid), bottom-aligned.
        // PATCH 2.4.35: align-self: start (grid), top-aligned. Bottom-align
        // создавал визуальный разрыв между 1-line и 2-line descriptions
        // соседних полей — пользователь воспринимал «провисшую» desc как
        // отлетевшую от своего поля. Top-align консистентен.
        const body = ruleBody(cssRaw, '.questionnaire-grid .field > .field-description');
        assert.match(body, /align-self:\s*start\b/,
            'align-self: start (PATCH 2.4.35) — desc сразу под input, лишнее место уходит вниз cell');
        assert.doesNotMatch(body, /align-self:\s*end\b/,
            'align-self: end удалён в PATCH 2.4.35 — был причиной visual gap у 1-line desc');
    });

    it('.questionnaire-grid .field сохраняет min-height: 64px (стабильный вертикальный ритм)', () => {
        const body = ruleBody(cssRaw, '.questionnaire-grid .field');
        assert.match(body, /min-height:\s*64px/,
            'min-height: 64px не должен быть удалён — он держит вертикальный ритм между полями');
    });

    it('regression: 2.4.27 .field-percent правила (min-width: 0, overflow-wrap) на месте', () => {
        const css = stripCssComments(cssRaw);
        assert.match(css,
            /\.field-percent\s*\{[^}]*min-width:\s*0\b/,
            '2.4.27 min-width: 0 на .field-percent должен сохраниться');
        assert.match(css,
            /\.field-percent\s*>\s*\.field-label\s*\{[^}]*overflow-wrap:\s*anywhere/,
            '2.4.27 overflow-wrap на .field-percent label должен сохраниться');
    });

    it('regression: 2.4.27 .settings-grid minmax(380px, 1fr) на месте', () => {
        const body = ruleBody(cssRaw, '.settings-grid');
        assert.match(body,
            /grid-template-columns:\s*repeat\(\s*auto-fit\s*,\s*minmax\(\s*380px\s*,\s*1fr\s*\)\s*\)/,
            '2.4.27 settings-grid 380px должен сохраниться');
    });
});
