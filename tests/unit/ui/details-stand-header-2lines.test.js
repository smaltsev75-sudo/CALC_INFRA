/**
 * Regression-тест к 12.U30 (1.4d) + 13.U10: заголовок столбца стенда в
 * Детализации.
 *
 * Корень исходного бага: было `text: '${STAND_LABELS[sid]} ₽/мес'` —
 * название стенда и единица сливались в одну строку. Пользователь попросил:
 * 1-я строка — название стенда, 2-я строка — «₽/мес» / «qty».
 *
 * 13.U10 update: text-align ИЗМЕНЁН с center на right, чтобы заголовок
 * стоял на одной вертикали со своими значениями (числа в td правые). При
 * центре пользователь видел «DEV qty» по центру колонки, а число «1,72 ТБ»
 * — у правого края → визуально не на одной линии.
 *
 * Контракт:
 *   - в `<th class="col-stand">` есть две вложенные `<div>` — название
 *     (`.col-stand-name`) и подпись (`.col-stand-unit`);
 *   - CSS-правило для `th.col-stand` использует text-align:right (под значения).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const detailsJs = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'detailsSections.js'),
    'utf8'
);
const tablesCss = readFileSync(
    join(__dirname, '..', '..', '..', 'css', 'tables.css'),
    'utf8'
);

describe('Детализация: заголовок стенд-столбца — 2 строки, центр', () => {
    it('detailsSections.js НЕ содержит склейки `${STAND_LABELS[sid]} ₽/мес` (одна строка)', () => {
        // Допускаем, что всё ещё может быть в строке-комментарии, но не в живом коде.
        const live = detailsJs.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        assert.doesNotMatch(live, /\$\{STAND_LABELS\[sid\]\}\s*₽\/мес/,
            'заголовок должен быть разбит на 2 div: название + ₽/мес');
    });

    it('в коде есть классы `.col-stand-name` и `.col-stand-unit` для двух строк', () => {
        assert.match(detailsJs, /col-stand-name/,
            'div названия стенда должен иметь класс col-stand-name');
        assert.match(detailsJs, /col-stand-unit/,
            'div подписи "₽/мес" должен иметь класс col-stand-unit');
    });

    it('CSS выравнивает th.col-stand по правому краю (под значения td)', () => {
        // 13.U10: смена с center на right. Заголовок «DEV qty» должен
        // стоять на той же вертикали, что число «1,72 ТБ» в td ниже.
        // Допускаем groupped-селектор (th.col-price, th.col-stand, …).
        const re = /th\.col-stand[\s\S]{0,300}?text-align:\s*right/;
        assert.match(tablesCss, re,
            'th.col-stand должен иметь text-align: right (числа в td правые)');
    });

    it('CSS даёт col-stand-unit меньший шрифт + muted (визуальная иерархия)', () => {
        const re = /\.col-stand-unit\s*\{[^}]+\}/;
        const m = tablesCss.match(re);
        assert.ok(m, 'правило .col-stand-unit обязано существовать');
        assert.match(m[0], /font-size:|color:/,
            'col-stand-unit должен отличаться от основного — font-size и/или цвет');
    });
});
