/**
 * PATCH 2.4.34 — Provider price summary: rows внутри категории по убыванию value.
 *
 * Bug: пользователь screenshot'ом показал «Тарифы провайдера» где внутри
 * категории «Процессоры» порядок vCPU shared 840 → vCPU dedicated 550 →
 * vCPU GPU 14 400. Дорогая позиция (GPU) внизу, дешёвые сверху — пользователь
 * не может быстро сосчитать «сколько максимум», взгляд скачет.
 *
 * Тот же эффект в «Услуги связи»: Email 100 → SMS 6 000.
 *
 * Root cause: rows = cat.items.map(...).filter(...) — сохраняется порядок,
 * заданный в PROVIDER_PRICE_CATEGORIES (который алфавитно-семантический,
 * не value-driven). Сортировка по убыванию value не применялась.
 *
 * Fix: добавить .sort(...) после .filter() в renderProviderPriceSummary.
 * Числовые строки идут по убыванию, строки без публичной цены остаются ниже.
 * Применимо к КАЖДОЙ категории; категории с 1 числовым элементом не затрагиваются
 * (no-op). maxValue/isTopExpensive сохраняют корректность.
 *
 * Принцип: feedback_sort_descending — числа в столбце/списке внутри
 * категории по убыванию значений. Применяется глобально к dashboard,
 * details, items; теперь и к provider price.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function extractRenderProviderBody(src) {
    const fnStart = src.indexOf('function renderProviderPriceSummary');
    assert.ok(fnStart > 0, 'renderProviderPriceSummary должна существовать');
    const fnEnd = src.indexOf('\nfunction ', fnStart + 30);
    return src.slice(fnStart, fnEnd > 0 ? fnEnd : src.length);
}

describe('PATCH 2.4.34 / provider price rows sorted by value desc', () => {
    const js = stripJsComments(read('js/ui/providerPriceSummary.js'));

    it('renderProviderPriceSummary применяет .sort с descending-сигнатурой и non-finite guard', () => {
        // Backref-проверка: signature (p1, p2), тело возвращает второй
        // нормализованный value минус первый = descending. Non-finite строки
        // ("по запросу") сортируются ниже числовых.
        const body = extractRenderProviderBody(js);
        const sortMatch = body.match(
            /\.sort\s*\(\s*\(([a-z]+),\s*([a-z]+)\)\s*=>\s*\{[\s\S]{0,220}?const\s+av\s*=\s*Number\.isFinite\(\1\.value\)\s*\?\s*\1\.value\s*:\s*-Infinity;[\s\S]{0,220}?const\s+bv\s*=\s*Number\.isFinite\(\2\.value\)\s*\?\s*\2\.value\s*:\s*-Infinity;[\s\S]{0,120}?return\s+bv\s*-\s*av;[\s\S]{0,80}?\}\)/
        );
        assert.ok(sortMatch, '.sort должен считать av/bv с Number.isFinite guard и возвращать bv - av');
    });

    it('сортировка применяется ДО maxValue и rows.map', () => {
        // Sort должен быть в той же цепочке что filter — до того, как rows
        // используется для maxValue и для генерации <li>.
        const body = extractRenderProviderBody(js);
        const sortIdx = body.search(/\.sort\s*\(/);
        const maxValueIdx = body.indexOf('const maxValue');
        const liMapIdx = body.indexOf('rows.map');
        assert.ok(sortIdx > 0, 'sort должен присутствовать');
        assert.ok(maxValueIdx > sortIdx,
            'sort должен идти ДО вычисления maxValue (rows уже отсортирован)');
        assert.ok(liMapIdx > sortIdx,
            'sort должен идти ДО rows.map для <li> (UI получает уже отсортированный массив)');
    });

    it('sort идёт сразу после .filter в одной chain', () => {
        // Структурная проверка: между filter() и sort() — только whitespace.
        // Используем [\s\S]*? non-greedy в случае многострочного chain'а.
        const body = extractRenderProviderBody(js);
        assert.match(body,
            /\.filter\([\s\S]*?\)\s*\.sort\s*\(/,
            '.sort должен быть chain-нут сразу после .filter (не отдельным statement)'
        );
    });
});
