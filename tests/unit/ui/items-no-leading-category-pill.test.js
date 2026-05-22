/**
 * Regression-тест к 12.U30 (1.5b): Элементы конфигурации.
 *
 * Корень бага: после удаления `<th>Категория</th>` из items-table.thead
 * (как дубль аккордеона `items-cat-row`) в `renderRow` ОСТАЛАСЬ ведущая
 * `<td>` с `.category-pill`. Результат — thead из 8 колонок, tbody-row
 * из 9 ячеек. Все колонки сдвинуты на 1 вправо: «Поставщик» оказался под
 * «Название», «Цена» под «Ед.изм.» и т.д.
 *
 * Контракт: первая `<td>` в `renderRow` — это ИМЯ ЭК (колонка «Название»),
 * не category-pill. Категория видна через cat-row-аккордеон.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const itemsTab = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'itemsTab.js'),
    'utf8'
);

describe('Элементы: thead и tbody-row синхронны (без ведущей category-pill)', () => {
    it('ITEMS_TABLE_COLSPAN = 8 — синхронно с числом <th> в thead', () => {
        const m = itemsTab.match(/ITEMS_TABLE_COLSPAN\s*=\s*(\d+)/);
        assert.ok(m, 'константа ITEMS_TABLE_COLSPAN должна быть');
        assert.equal(m[1], '8', 'после удаления колонки «Категория» colspan = 8');
    });

    it('thead имеет ровно 8 <th>: Название, Поставщик, Ед.изм., Цена/ед., Источник, Тариф, Стенды, Действия', () => {
        // thead закрывается `)),` — две скобки (tr + thead) и запятая перед tbody
        const headBlock = itemsTab.match(/el\('thead'[\s\S]*?\)\),\s*\n\s*el\('tbody'/);
        assert.ok(headBlock, 'не найден блок thead в renderItemsTab');
        const ths = headBlock[0].match(/el\('th'/g) || [];
        assert.equal(ths.length, 8, `ожидалось 8 <th>, найдено ${ths.length}`);
        // Дубль «Категория» в thead больше быть не должен:
        assert.doesNotMatch(headBlock[0], /text:\s*['"]Категория['"]/,
            'столбец «Категория» удалён — он дублирует cat-row-аккордеон');
    });

    it('renderRow НЕ начинается с <td>category-pill (был дублем cat-row)', () => {
        const fnBody = itemsTab.match(/function\s+renderRow\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        assert.ok(fnBody, 'функция renderRow должна существовать');
        // Первая td в renderRow должна содержать item-name, НЕ category-pill.
        // Берём всё до первого `el('td'` после return:
        const firstTdMatch = fnBody[1].match(/return\s+el\('tr'[\s\S]*?el\('td'[^,]*,([\s\S]*?)el\('td'/);
        assert.ok(firstTdMatch, 'не нашёл первую <td> в renderRow');
        assert.doesNotMatch(firstTdMatch[1], /category-pill/,
            'первая <td> tbody-row не должна содержать category-pill — это создаёт сдвиг колонок');
        assert.match(firstTdMatch[1], /item-name|it\.name/,
            'первая <td> должна быть колонкой «Название» (item-name)');
    });

    it('число <td> в renderRow = 8 (синхронно с thead)', () => {
        const fnBody = itemsTab.match(/function\s+renderRow\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        assert.ok(fnBody);
        // Считаем только верхнего уровня <td>; вложенные элементы внутри <td>
        // (button.btn-icon и т.п.) — не <td>, считаются корректно.
        const tds = fnBody[1].match(/el\('td'/g) || [];
        assert.equal(tds.length, 8, `ожидалось 8 <td>, найдено ${tds.length} — таблица сдвинута`);
    });
});
