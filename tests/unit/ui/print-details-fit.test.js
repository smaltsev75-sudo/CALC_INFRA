/**
 * PDF Детализации — таблица не должна обрезаться справа.
 *
 * Главная причина переполнения 12 колонок при A4 landscape — дубль единицы
 * измерения в каждой ячейке qty/cost. Колонка «Ед.изм.» уже показывает
 * единицу один раз; повторение «ТБ» / «млн токенов» в каждой из 6 stand-ячеек
 * раздувает таблицу в 1.5–2 раза по ширине.
 *
 * Этот тест следит за тем, что:
 *   1) JS-render обёртывает число и единицу в РАЗНЫЕ узлы (.qty-num + .qty-unit),
 *      чтобы CSS мог скрыть единицу в print-режиме без правки JS.
 *   2) В @media print есть правило `.qty-unit { display: none }` —
 *      на печати в qty-ячейках остаётся только число.
 *   3) В @media print с col-name снят ellipsis / max-width, иначе длинные имена
 *      ЭК (например «Объектное хранилище (S3-совместимое)») обрезаются.
 *   4) `@page landscape` margin ужат до ≤ 10мм для максимальной usable-ширины.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const DETAILS_JS = join(ROOT, 'js', 'ui', 'detailsSections.js');
const PRINT_CSS  = join(ROOT, 'css', 'print.css');

function extractMediaPrintBody(src) {
    const stripped = stripCssComments(src);
    const m = stripped.match(/@media\s+print\s*\{/);
    if (!m) return null;
    let i = m.index + m[0].length;
    const start = i;
    let depth = 1;
    while (i < stripped.length && depth > 0) {
        const ch = stripped[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return stripped.slice(start, i);
        }
        i++;
    }
    return null;
}

describe('PDF Details: qty cells split number/unit, print hides unit', () => {
    it('renderQtyItemRow обёртывает число и единицу в .qty-num / .qty-unit', () => {
        const src = stripJsComments(readFileSync(DETAILS_JS, 'utf8'));
        // Должны существовать оба класса в JS-рендере qty-ячеек.
        assert.ok(/class:\s*['"]qty-num['"]/.test(src),
            'нет span.qty-num — qty-ячейки рендерятся плоским текстом, и CSS не сможет ' +
            'скрыть единицу в @media print → таблица переполняется на A4 landscape.');
        assert.ok(/class:\s*['"]qty-unit['"]/.test(src),
            'нет span.qty-unit — единица не отделена от числа.');
    });

    it('@media print скрывает .qty-unit (display: none)', () => {
        const css = readFileSync(PRINT_CSS, 'utf8');
        const printBlock = extractMediaPrintBody(css);
        assert.ok(printBlock, '@media print block не найден в print.css');
        // ищем правило вида: ".qty-unit { display: none }" внутри @media print.
        const ruleRe = /\.qty-unit\s*\{[^}]*display\s*:\s*none/i;
        assert.ok(ruleRe.test(printBlock),
            '.qty-unit не скрыт в @media print — единица будет дублироваться в каждой qty-ячейке ' +
            'и колонки переполнят A4 landscape.');
    });

    it('@media print снимает ellipsis с col-name (имена ЭК не обрезаются)', () => {
        const css = readFileSync(PRINT_CSS, 'utf8');
        const printBlock = extractMediaPrintBody(css);
        // В print должно быть правило, перебивающее ellipsis на col-name.
        // Принимаем любой из паттернов: text-overflow: clip / overflow: visible / white-space: normal.
        const colNameSafeInPrint =
            /\.details-table\s+\.col-name\s*\{[^}]*(?:text-overflow\s*:\s*clip|overflow\s*:\s*visible|white-space\s*:\s*normal|max-width\s*:\s*none)/i.test(printBlock);
        assert.ok(colNameSafeInPrint,
            'col-name в @media print должен снять ellipsis / max-width, иначе длинные имена ЭК ' +
            'обрезаются в PDF (например «Объектное хранилище (S3-совмес...»).');
    });

    it('@page landscape ужат: margin ≤ 10мм для максимальной usable-ширины', () => {
        const css = stripCssComments(readFileSync(PRINT_CSS, 'utf8'));
        const m = css.match(/@page\s+landscape\s*\{([^}]+)\}/);
        assert.ok(m, '@page landscape блок отсутствует — детализация не переключается на landscape.');
        const body = m[1];
        const marginMatch = body.match(/margin\s*:\s*(\d+(?:\.\d+)?)\s*mm/i);
        assert.ok(marginMatch, '@page landscape должен задавать margin в мм');
        const mm = parseFloat(marginMatch[1]);
        assert.ok(mm <= 10,
            `@page landscape margin = ${mm}мм слишком велик; для 12 колонок details на A4 нужно ≤ 10мм. ` +
            `Текущая usable-ширина ${297 - 2 * mm}мм, надо ≥ 277мм.`);
    });
});
