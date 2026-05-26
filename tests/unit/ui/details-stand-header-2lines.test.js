/**
 * Regression-тест: заголовок столбца стенда в Детализации.
 *
 * Корень исходного бага: было `text: '${STAND_LABELS[sid]} ₽/мес'` —
 * название стенда и единица сливались в одну строку. Сейчас пользовательский
 * контракт строже: в stand-заголовке только название стенда, единицы живут в
 * отдельной колонке «Ед.изм.» / заголовке секции.
 *
 * 13.U10 update: text-align ИЗМЕНЁН с center на right, чтобы заголовок
 * стоял на одной вертикали со своими значениями (числа в td правые). При
 * центре пользователь видел «DEV qty» по центру колонки, а число «1,72 ТБ»
 * — у правого края → визуально не на одной линии.
 *
 * Контракт:
 *   - в `<th class="col-stand">` есть вложенный `.col-stand-name`;
 *   - `.col-stand-unit` не рендерится;
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

describe('Детализация: заголовок стенд-столбца — только название стенда', () => {
    it('detailsSections.js НЕ содержит склейки `${STAND_LABELS[sid]} ₽/мес` (одна строка)', () => {
        // Допускаем, что всё ещё может быть в строке-комментарии, но не в живом коде.
        const live = detailsJs.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        assert.doesNotMatch(live, /\$\{STAND_LABELS\[sid\]\}\s*₽\/мес/,
            'stand-заголовок не должен склеивать название стенда с единицей');
    });

    it('в коде есть `.col-stand-name`, но нет `.col-stand-unit`', () => {
        const live = detailsJs.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        assert.match(detailsJs, /col-stand-name/,
            'div названия стенда должен иметь класс col-stand-name');
        assert.doesNotMatch(live, /col-stand-unit/,
            'единицу нельзя выводить в stand-заголовке: она уже есть в «Ед.изм.»');
        assert.doesNotMatch(live, /text:\s*['"](?:qty|₽\/мес)['"]/,
            'stand-заголовок не должен выводить qty или ₽/мес отдельной строкой');
    });

    it('CSS выравнивает th.col-stand по правому краю (под значения td)', () => {
        // 13.U10: смена с center на right. Заголовок «DEV qty» должен
        // стоять на той же вертикали, что число «1,72 ТБ» в td ниже.
        // Допускаем groupped-селектор (th.col-price, th.col-stand, …).
        const re = /th\.col-stand[\s\S]{0,300}?text-align:\s*right/;
        assert.match(tablesCss, re,
            'th.col-stand должен иметь text-align: right (числа в td правые)');
    });

    it('CSS явно выравнивает заголовок «Ед.изм.» в основной таблице влево', () => {
        const re = /\.details-table\s+th\.col-unit\s*\{[^}]*text-align:\s*left/i;
        const m = tablesCss.match(re);
        assert.ok(m, 'th.col-unit должен иметь явный text-align: left');
    });
});
