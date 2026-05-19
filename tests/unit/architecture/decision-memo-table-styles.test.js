/**
 * Stage 18.1.10 — CSS-правила для `.decision-memo-preview table`.
 *
 * Без CSS browser-default рендерит markdown-таблицу без border'ов и padding'а —
 * колонки слипаются (`₽/мес` и `Доля` без визуального разделителя). Этот линтер
 * гарантирует, что в `dashboard.css` определены минимальные правила стилизации
 * таблиц внутри preview Decision Memo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { stripCssComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS = stripCssComments(readFileSync(
    resolve(__dirname, '../../../css/dashboard.css'), 'utf8'
));

test('`.decision-memo-preview table` определён с border-collapse', () => {
    const re = /\.decision-memo-preview\s+table\s*\{[^}]*border-collapse\s*:\s*collapse/i;
    assert.match(CSS, re,
        '`.decision-memo-preview table` должен иметь `border-collapse: collapse` — иначе double-borders при наличии cell-border\'ов');
});

test('`.decision-memo-preview th/td` имеет padding (колонки не слипаются)', () => {
    const re = /\.decision-memo-preview\s+(th|td)[\s\S]{0,200}padding\s*:/i;
    assert.match(CSS, re,
        'th/td должны иметь явный padding — иначе ₽/мес и Доля слипаются в HTML-рендере');
});

test('`.decision-memo-preview td[align="right"]` — right-alignment для числовых колонок', () => {
    /* Markdown-renderer ставит `align="right"` на cells из колонок с separator `--:`.
       Без CSS-правила браузер не уважает HTML5 `align`-атрибут на table cells. */
    const re = /\.decision-memo-preview\s+t[dh]\[align="right"\][\s\S]{0,100}text-align\s*:\s*right/i;
    assert.match(CSS, re,
        'td[align="right"] / th[align="right"] должны явно text-align: right');
});

test('`.decision-memo-preview` числовые колонки имеют tabular-nums', () => {
    /* Для money-колонок цифры должны быть выровнены по разрядам (моноширинно). */
    assert.match(CSS, /\.decision-memo-preview\s+t[dh]\[align="right"\][\s\S]{0,150}tabular-nums/i,
        'денежные колонки в memo-таблице должны использовать tabular-nums');
});
