/**
 * 12.U35: defensive линтер на чистоту evaluator'а DSL-формул.
 *
 * `js/domain/formula/evaluator.js` — pure-функция: принимает AST и scope-объект,
 * возвращает число. Никаких side-effects. При случайной попытке оптимизировать
 * кэш через `globalThis.X = ...` или log в `console`/`localStorage` тест упадёт.
 *
 * Комментарии разрешены (могут содержать слова document/window для документации).
 * Math.* и Number.* — built-in, разрешены явно.
 *
 * Парный тест к layer-imports.test.js (он покрывает import-flow), но грамматику
 * тела самой evaluator-функции — проверяет именно этот тест.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALUATOR_PATH = join(__dirname, '..', '..', '..', 'js', 'domain', 'formula', 'evaluator.js');

/** Глобалы, обращение к которым ИЗ evaluator'а — нарушение «pure»-контракта. */
const FORBIDDEN_GLOBALS = [
    'globalThis',
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    'location',
    'navigator',
    'console',
    'fetch',
    'XMLHttpRequest'
];

test('evaluator.js: тело функции не обращается к опасным глобалам', () => {
    const raw = readFileSync(EVALUATOR_PATH, 'utf8');
    const stripped = stripJsComments(raw);

    const violations = [];
    for (const name of FORBIDDEN_GLOBALS) {
        // Ищем именно обращение `name.foo` или `name(` — не подстроки в идентификаторах
        // (типа `documentScope` — fictional, но защита от false-positive).
        const re = new RegExp(`\\b${name}\\b\\s*[.(\\[]`, 'g');
        const matches = stripped.match(re);
        if (matches) {
            violations.push(`${name}: ${matches.length} обращение(й)`);
        }
    }

    assert.deepEqual(
        violations,
        [],
        `evaluator.js должен оставаться pure (без side-effects). ` +
        `Обнаружены обращения к запрещённым глобалам: ${violations.join('; ')}`
    );
});

test('evaluator.js: не использует eval / new Function / setTimeout(string)', () => {
    const raw = readFileSync(EVALUATOR_PATH, 'utf8');
    const stripped = stripJsComments(raw);

    const dangerous = [
        { pattern: /\beval\s*\(/g,                  name: 'eval(...)' },
        { pattern: /\bnew\s+Function\s*\(/g,        name: 'new Function(...)' },
        { pattern: /setTimeout\s*\(\s*['"`]/g,      name: 'setTimeout(string, ...)' },
        { pattern: /setInterval\s*\(\s*['"`]/g,     name: 'setInterval(string, ...)' }
    ];

    const violations = [];
    for (const { pattern, name } of dangerous) {
        if (pattern.test(stripped)) violations.push(name);
    }

    assert.deepEqual(
        violations,
        [],
        `evaluator.js не должен использовать code-evaluation API: ${violations.join(', ')}`
    );
});
