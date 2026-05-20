/**
 * Архитектурный инвариант (PATCH 2.20.5): числовые UI-поля должны принимать
 * дробные значения с точкой и с русской запятой, но не более 2 знаков
 * после десятичного разделителя.
 *
 * Корень бага: `<input type="number">` плохо переживает ru-RU ввод (`1,5`) и
 * промежуточные состояния (`1,` / `1.`) при перерисовке. Поэтому UI-слой для
 * числового ввода использует text-input + `inputmode="decimal"` и общий строгий
 * парсер `parseNumberInput`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';
import { NUMBER_INPUT_FRACTION_DIGITS, parseNumberInput } from '../../../js/services/format.js';
import {
    formatDecimalInputValue,
    limitDecimalInputPrecision
} from '../../../js/ui/decimalInput.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..', '..', '..');

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (st.isFile() && entry.endsWith('.js')) out.push(full);
    }
    return out;
}

describe('decimal numeric input invariant — дробные числа вводятся везде', () => {
    /* Внешний аудит «Жёсткая проверка» (2026-05-20, P3#7): расширили проверку.
     * Старый regex ловил только prop-style `type: 'number'`, но в `el(...)`
     * `type` можно положить и внутрь `attrs: { type: 'number' }` — там тот же
     * эффект (вешается как HTML-атрибут), а старый тест пропускал.
     * Теперь два паттерна: inline-prop и attrs-обёртка. */
    it('в js/ui/ нет DOM `<input type="number">` для числовых редакторов', () => {
        const uiFiles = walk(join(ROOT, 'js', 'ui'));
        const violations = [];

        const patterns = [
            { name: 'inline type: "number"', regex: /type\s*:\s*['"]number['"]/g },
            { name: 'attrs.type: "number"', regex: /attrs\s*:\s*\{[^{}]*type\s*:\s*['"]number['"][^{}]*\}/g },
            { name: 'setAttribute("type", "number")', regex: /setAttribute\(\s*['"]type['"]\s*,\s*['"]number['"]\s*\)/g }
        ];

        for (const file of uiFiles) {
            const code = stripJsComments(readFileSync(file, 'utf8'));
            for (const { name, regex } of patterns) {
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(code)) !== null) {
                    const lineStart = code.lastIndexOf('\n', match.index) + 1;
                    const lineEnd = code.indexOf('\n', match.index);
                    violations.push({
                        file: file.replace(ROOT, '').replace(/\\/g, '/'),
                        pattern: name,
                        line: code.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim()
                    });
                }
            }
        }

        assert.equal(violations.length, 0,
            'Найдены HTML number-input в UI. Для дробного ru-RU ввода используйте ' +
            '`DECIMAL_INPUT_TYPE` + `decimalInputAttrs()`:\n' +
            violations.map(v => `  [${v.pattern}] ${v.file}: ${v.line}`).join('\n'));
    });

    it('decimalInputAttrs включает inputmode="decimal"', () => {
        const src = readFileSync(join(ROOT, 'js', 'ui', 'decimalInput.js'), 'utf8');
        const code = stripJsComments(src);
        assert.match(code, /inputmode\s*:\s*['"]decimal['"]/,
            'decimalInputAttrs должен просить у браузера десятичную клавиатуру');
    });

    it('parseNumberInput принимает дроби с точкой, запятой и без ведущего нуля', () => {
        assert.equal(NUMBER_INPUT_FRACTION_DIGITS, 2);
        assert.equal(parseNumberInput('1.5'), 1.5);
        assert.equal(parseNumberInput('1,5'), 1.5);
        assert.equal(parseNumberInput('1.23'), 1.23);
        assert.equal(parseNumberInput('1,23'), 1.23);
        assert.equal(parseNumberInput(',5'), 0.5);
        assert.equal(parseNumberInput('.5'), 0.5);
        assert.equal(Number.isNaN(parseNumberInput('1,')), true);
        assert.equal(Number.isNaN(parseNumberInput('1.')), true);
        assert.equal(Number.isNaN(parseNumberInput('1.234')), true);
        assert.equal(Number.isNaN(parseNumberInput('1,234')), true);
        assert.equal(Number.isNaN(parseNumberInput(',555')), true);
    });

    it('formatDecimalInputValue по умолчанию показывает не более 2 знаков после запятой', () => {
        assert.equal(formatDecimalInputValue(1.234), '1,23');
        assert.equal(formatDecimalInputValue(1.235), '1,24');
        assert.equal(formatDecimalInputValue(0.004), '0');
        assert.equal(formatDecimalInputValue('1.234'), '1,23');
        assert.equal(formatDecimalInputValue('1.'), '1,',
            'незавершённый строковый draft сохраняет десятичный разделитель');
    });

    it('limitDecimalInputPrecision отрезает третий знак прямо в текстовом вводе', () => {
        assert.equal(limitDecimalInputPrecision('1.234'), '1,23');
        assert.equal(limitDecimalInputPrecision('1,234'), '1,23');
        assert.equal(limitDecimalInputPrecision(',555'), ',55');
        assert.equal(limitDecimalInputPrecision('1,'), '1,');
    });
});
