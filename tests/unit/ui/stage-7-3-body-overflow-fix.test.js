/**
 * PATCH 2.4.31 — Fix Details table right-column clipping.
 *
 * Bug: пользователь screenshot'ом «Детализация» показал, что правые колонки
 * (РИСК ₽/мес, ИТОГО/ГОД) обрезаются и не видны на экране при широкой
 * таблице (16-17 колонок при 5 видимых стендах + 5 aggregate-колонок).
 *
 * Root cause: дизайн-намерение по 12.U31 (см. tables.css:42 — `.details-table`
 * без table-layout: fixed, ellipsis на name/vendor через max-width) — таблица
 * расширяется и горизонтальный scroll уходит на <body>. `.details-table-wrap`
 * сохраняет `overflow-x: visible` (per 12.U30 чтобы не сломать sticky-thead).
 * НО body имел `overflow-x: hidden` (base.css:453) — клипал тот самый
 * горизонтальный scroll, который должен был скрыть проблему. Правые колонки
 * становились недоступны.
 *
 * Fix: убрать `overflow-x: hidden` с body. Sticky-thead продолжает работать —
 * анкорится к viewport (initial containing block).
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

describe('PATCH 2.4.31 / body overflow-x fix — Details table right-column clipping', () => {
    const baseCss = read('css/base.css');

    it('body НЕ содержит overflow-x: hidden (regression-guard)', () => {
        const body = ruleBody(baseCss, 'body');
        assert.doesNotMatch(body, /overflow-x:\s*hidden\b/,
            'overflow-x: hidden удалён — он клипал горизонтальный scroll, ' +
            'необходимый для широких таблиц вроде Детализации');
    });

    it('body НЕ содержит overflow-x: clip (clip = такой же клип, тот же bug)', () => {
        const body = ruleBody(baseCss, 'body');
        assert.doesNotMatch(body, /overflow-x:\s*clip\b/,
            'overflow-x: clip визуально эквивалентен hidden — тот же bug');
    });

    it('regression: details-table-wrap сохраняет overflow-x: visible (12.U27/12.U30)', () => {
        const tablesCss = stripCssComments(read('css/tables.css'));
        // .details-table-wrap должен иметь overflow-x: visible
        // (или вообще не иметь overflow ≠ visible — sticky-thead защита).
        assert.match(tablesCss,
            /\.details-table-wrap\s*\{[^}]*overflow-x:\s*visible/,
            '.details-table-wrap должна оставаться overflow-x: visible — ' +
            'wrap не должна стать scroll-container (12.U30 ловушка)');
    });

    it('regression: items-table-wrap НЕ имеет overflow ≠ visible (12.U30 защита)', () => {
        const tablesCss = stripCssComments(read('css/tables.css'));
        const wrapMatch = tablesCss.match(/\.items-table-wrap\s*\{([^}]+)\}/);
        if (wrapMatch) {
            const body = wrapMatch[1];
            assert.doesNotMatch(body, /overflow-x:\s*(auto|scroll|hidden|clip)/,
                '.items-table-wrap не должна иметь overflow-x ≠ visible (12.U30 sticky-thead ловушка)');
        }
    });
});
