/**
 * Архитектурный инвариант (PATCH 2.20.5): числовые UI-поля должны принимать
 * дробные значения с точкой и с русской запятой.
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
import { parseNumberInput } from '../../../js/services/format.js';

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
    it('в js/ui/ нет DOM `<input type="number">` для числовых редакторов', () => {
        const uiFiles = walk(join(ROOT, 'js', 'ui'));
        const violations = [];

        for (const file of uiFiles) {
            const code = stripJsComments(readFileSync(file, 'utf8'));
            const typeNumberRegex = /type\s*:\s*['"]number['"]/g;
            let match;
            while ((match = typeNumberRegex.exec(code)) !== null) {
                const lineStart = code.lastIndexOf('\n', match.index) + 1;
                const lineEnd = code.indexOf('\n', match.index);
                violations.push({
                    file: file.replace(ROOT, '').replace(/\\/g, '/'),
                    line: code.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim()
                });
            }
        }

        assert.equal(violations.length, 0,
            'Найдены HTML number-input в UI. Для дробного ru-RU ввода используйте ' +
            '`DECIMAL_INPUT_TYPE` + `decimalInputAttrs()`:\n' +
            violations.map(v => `  ${v.file}: ${v.line}`).join('\n'));
    });

    it('decimalInputAttrs включает inputmode="decimal"', () => {
        const src = readFileSync(join(ROOT, 'js', 'ui', 'decimalInput.js'), 'utf8');
        const code = stripJsComments(src);
        assert.match(code, /inputmode\s*:\s*['"]decimal['"]/,
            'decimalInputAttrs должен просить у браузера десятичную клавиатуру');
    });

    it('parseNumberInput принимает дроби с точкой, запятой и без ведущего нуля', () => {
        assert.equal(parseNumberInput('1.5'), 1.5);
        assert.equal(parseNumberInput('1,5'), 1.5);
        assert.equal(parseNumberInput(',5'), 0.5);
        assert.equal(parseNumberInput('.5'), 0.5);
        assert.equal(Number.isNaN(parseNumberInput('1,')), true);
        assert.equal(Number.isNaN(parseNumberInput('1.')), true);
    });
});
