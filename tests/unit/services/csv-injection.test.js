/**
 * Регрессионные тесты CSV-injection (CWE-1236).
 *
 * Проверяют, что `csvSafeQuote` префиксует значения с триггер-символами
 * одинарной кавычкой `'` ВНУТРИ кавычек, а высокоуровневые билдеры
 * `buildDetailsCsv` / `buildPricesCsv` / `buildComparisonCsv`
 * (последний — через тот же helper в app.js) используют ту же защиту.
 *
 * Триггер-символы: `=`, `+`, `-`, `@`, `\t`, `\r`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    csvSafeQuote,
    buildDetailsCsv,
    buildPricesCsv
} from '../../../js/services/csvExport.js';
import { parseCsv } from '../../../js/services/csvImport.js';
import { calculate } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';

const DELIM = ';';

const makeCalc = () => {
    const dict = buildSeedDictionaries();
    return {
        version: '1.0', id: 't', name: 'Test', schemaVersion: 1,
        createdAt: '2026', updatedAt: '2026',
        settings: { ...SEED_SETTINGS, phaseDurationMonths: 4 },
        answers: defaultAnswersFrom(dict.questions),
        dictionaries: dict
    };
};

describe('csvSafeQuote: CSV-injection triggers', () => {
    it('prefixes "=" formula with single quote', () => {
        const out = csvSafeQuote("=cmd|'/c calc'!A1", DELIM);
        // Должна быть обёрнута в кавычки и начинаться с "'=
        assert.equal(out.startsWith(`"'=`), true, `got: ${out}`);
        // И заканчиваться закрывающей кавычкой
        assert.equal(out.endsWith(`"`), true);
    });

    it('doubles embedded double quotes in injection branch', () => {
        // Кейс: =HYPERLINK("http://x") — двойные кавычки внутри формулы
        // должны быть удвоены по правилу CSV.
        const out = csvSafeQuote('=HYPERLINK("a")', DELIM);
        assert.equal(out, `"'=HYPERLINK(""a"")"`);
    });

    it('prefixes "+" with single quote', () => {
        const out = csvSafeQuote('+1+2', DELIM);
        assert.equal(out, `"'+1+2"`);
    });

    it('prefixes "-" with single quote', () => {
        const out = csvSafeQuote('-1', DELIM);
        assert.equal(out, `"'-1"`);
    });

    it('prefixes "@" with single quote', () => {
        const out = csvSafeQuote('@foo', DELIM);
        assert.equal(out, `"'@foo"`);
    });

    it('prefixes "\\t" (tab) with single quote', () => {
        const out = csvSafeQuote('\tfoo', DELIM);
        assert.equal(out, `"'\tfoo"`);
        // Первый символ внутри кавычек — обязательно `'`
        assert.equal(out.charAt(1), `'`);
    });

    it('prefixes "\\r" (CR) with single quote', () => {
        const out = csvSafeQuote('\rfoo', DELIM);
        assert.equal(out, `"'\rfoo"`);
        assert.equal(out.charAt(1), `'`);
    });
});

describe('csvSafeQuote: edge cases', () => {
    it('handles leading whitespace before trigger character', () => {
        // ' =foo' — после trim начинается с `=`, должен сработать инъекционный путь.
        const out = csvSafeQuote(' =foo', DELIM);
        assert.ok(out.startsWith('"'), 'must be wrapped in quotes');
        assert.ok(out.includes(`'=foo`), `expected '=foo inside, got: ${out}`);
    });

    it('does NOT modify safe text values (HW)', () => {
        // Без триггеров и без CSV-конфликтных символов — выводится «как есть».
        assert.equal(csvSafeQuote('HW', DELIM), 'HW');
        assert.equal(csvSafeQuote('Cloud.ru', DELIM), 'Cloud.ru');
    });

    it('quotes values with delimiter but does NOT add injection prefix', () => {
        // 123,45 — содержит запятую, но при ; разделителе она не конфликт.
        // 123;45 — конфликт с разделителем, обернётся, но без `'`-префикса.
        assert.equal(csvSafeQuote('123,45', DELIM), '123,45');
        const withSemi = csvSafeQuote('123;45', DELIM);
        assert.equal(withSemi, '"123;45"');
        // Префикс `'` НЕ добавлен — значение начинается на цифру, не на триггер.
        assert.equal(withSemi.includes(`"'`), false);
    });

    it('returns empty string for null/undefined/empty', () => {
        assert.equal(csvSafeQuote(null, DELIM), '');
        assert.equal(csvSafeQuote(undefined, DELIM), '');
        assert.equal(csvSafeQuote('', DELIM), '');
    });

    it('preserves classic CSV escaping for embedded quotes', () => {
        // Триггера нет → классическая ветка: обёрнут в кавычки + удвоение.
        assert.equal(csvSafeQuote('say "hi"', DELIM), '"say ""hi"""');
    });
});

describe('csvSafeQuote: round-trip via parseCsv (compromise)', () => {
    it('preserves single-quote prefix in parsed cell (documented compromise)', () => {
        // Префикс `'` остаётся в данных после парсинга — это документированное
        // поведение (см. JSDoc у csvSafeQuote): пользователь увидит его при
        // правке и может удалить вручную, если уверен в безопасности значения.
        const cell = csvSafeQuote('=SUM(A1:A10)', DELIM);
        const csv = `header\r\n${cell}\r\n`;
        const { rows, headers } = parseCsv(csv);
        assert.deepEqual(headers, ['header']);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].header, `'=SUM(A1:A10)`);
        // Главное: первый символ — `'`, формула неактивна.
        assert.equal(rows[0].header.charAt(0), `'`);
    });
});

describe('buildDetailsCsv: CSV-injection в item.name', () => {
    it('does not emit unescaped formula in item.name', () => {
        const calc = makeCalc();
        // Подменяем имя одного ЭК на формулу.
        const items = calc.dictionaries.items.map((it, i) =>
            i === 0 ? { ...it, name: '=cmd|exec' } : it
        );
        const malicious = {
            ...calc,
            dictionaries: { ...calc.dictionaries, items }
        };
        const csv = buildDetailsCsv(malicious, calculate(malicious));

        // Ни одна ячейка не должна начинаться с `=cmd` (без `'`-префикса).
        // Проверяем по разбору ячеек — каждая ячейка либо не содержит `=cmd`,
        // либо содержит `'=cmd` (внутри кавычек после `'`).
        const lines = csv.split('\r\n');
        for (const line of lines) {
            const cells = line.split(DELIM);
            for (const cell of cells) {
                if (cell.includes('=cmd')) {
                    // Должна быть обёрнута в кавычки и содержать `'=cmd`
                    assert.ok(
                        cell.startsWith('"') && cell.includes(`'=cmd`),
                        `unsafe cell: ${cell}`
                    );
                }
            }
        }
    });
});

describe('buildPricesCsv: CSV-injection в vendor', () => {
    it('does not emit unescaped formula in vendor', () => {
        const items = [
            { id: 'x1', name: 'Item', vendor: '@SUM(1+1)', unit: 'шт',
              category: 'HW', resourceClass: 'CPU', billingInterval: 'monthly',
              pricePerUnit: 100, priceUpdatedAt: '', priceSource: 'seed', costType: '' }
        ];
        const csv = buildPricesCsv(items, { delimiter: DELIM });

        const lines = csv.split('\r\n');
        // Находим строку с vendor-ячейкой.
        let foundUnsafe = false;
        let foundSafe = false;
        for (const line of lines) {
            const cells = line.split(DELIM);
            for (const cell of cells) {
                if (cell === '@SUM(1+1)') foundUnsafe = true;
                if (cell.startsWith('"') && cell.includes(`'@SUM(1+1)`)) foundSafe = true;
            }
        }
        assert.equal(foundUnsafe, false, 'unescaped formula must not appear');
        assert.equal(foundSafe, true, 'expected escaped variant present');
    });
});
