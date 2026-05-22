/**
 * Regression-тест к 12.U30 (1.5d): items-table th vertical-align.
 *
 * Корень: на скрине пользователя видно, что заголовки столбцов «висят»
 * выше, чем содержимое td в первой строке (где аккордеон-row маленький,
 * а далее — item-row с двухстрочным item-name + item-description).
 *
 * Причина: thead-th по дефолту в Chrome — vertical-align: middle, но
 * ширина колонок auto + 2-line wrap у header'а («ПОСТА ВЩИК», 2 строки)
 * растягивает row-высоту → короткие th прижаты к верху.
 *
 * Контракт: items-table/questions-table th — явно `vertical-align: middle`.
 * (vertical-align на th действует относительно row, не относительно td-сиблингов.)
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

describe('items-table / questions-table th — vertical-align: middle', () => {
    it('CSS правило для items-table/questions-table th содержит vertical-align: middle', () => {
        // Ищем правило, в селекторе которого есть `.items-table thead th` или
        // `.items-table th` (с/без `.questions-table` через запятую), и в теле
        // которого есть `vertical-align: middle`.
        const re = /\.items-table[^{]*\sth[^{]*\{[^}]*vertical-align:\s*middle/;
        assert.match(tablesCss, re,
            'нужно явное правило `.items-table th { vertical-align: middle }` — ' +
            'иначе при wrap-заголовке («ПОСТА ВЩИК») короткие th прижимаются к верху row');
    });
});
