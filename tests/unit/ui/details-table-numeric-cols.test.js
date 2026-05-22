/**
 * Regression-тест к 12.U31 (Code Review Followup, Subagent C P1-002):
 * `.details-table` НЕ должна форсировать `table-layout: fixed` без явных
 * ширин колонок — это делит ширину контейнера равномерно (17 × ≈58px на
 * 1366px laptop), и большие денежные числа («46 465 240 ₽» = ~120px)
 * физически вылезают из ячеек и накладываются на соседние столбцы.
 *
 * Решение: переключить на auto-layout (контент сам определяет ширину).
 * Ellipsis на `.col-name`/`.col-vendor` продолжит работать благодаря
 * связке `max-width + overflow:hidden + text-overflow:ellipsis + white-space:nowrap`
 * (поддерживается всеми браузерами в auto-layout). Если суммарная ширина
 * колонок > viewport — таблица расширяется; так как `.details-table-wrap`
 * имеет `overflow-x: visible` (12.U27), горизонтальный скролл уйдёт на body.
 *
 * Дополнительно проверяем что ellipsis-инвариант на `.col-name` сохранён.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tablesCss = readFileSync(
    join(__dirname, '..', '..', '..', 'css', 'tables.css'),
    'utf8'
);

import { ruleBody } from '../../_helpers/source.js';

describe('details-table: числовые колонки не наезжают друг на друга', () => {
    it('.details-table НЕ имеет table-layout: fixed (17 колонок × 100%/17 = ~58px ломает числа)', () => {
        const body = ruleBody(tablesCss, '.details-table');
        assert.doesNotMatch(body, /table-layout\s*:\s*fixed/,
            '.details-table { table-layout: fixed } делит ширину контейнера равномерно ' +
            'между всеми колонками. На 1366px laptop это даёт ≈58px на колонку, чего ' +
            'недостаточно для денежных значений (12 знаков + ₽ ≈ 120px) → числа вылезают ' +
            'из ячеек и накладываются друг на друга. Auto-layout даёт каждой колонке ' +
            'ширину по контенту, а ellipsis на col-name работает через max-width.');
    });

    it('.details-table .col-name сохраняет связку max-width + overflow:hidden + ellipsis + nowrap', () => {
        const body = ruleBody(tablesCss, '.details-table .col-name');
        assert.match(body, /max-width\s*:/,        'col-name должна иметь max-width для ellipsis');
        assert.match(body, /overflow\s*:\s*hidden/, 'col-name должна иметь overflow: hidden');
        assert.match(body, /text-overflow\s*:\s*ellipsis/, 'col-name должна иметь text-overflow: ellipsis');
        assert.match(body, /white-space\s*:\s*nowrap/,    'col-name должна иметь white-space: nowrap');
    });
});
