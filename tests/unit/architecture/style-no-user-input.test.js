/**
 * 12.U32 #3: архитектурный линтер на CSP-защиту inline-style.
 *
 * Контракт: `style:` в `el(...)` должен принимать ТОЛЬКО доверенные значения:
 *   - литеральные объекты со статическими значениями (`{ marginTop: '14px' }`).
 *     [Реально таких уже почти нет — переведены в CSS-классы в 12.U32 #3.]
 *   - производные от внутреннего state: `CATEGORY_COLORS[cat]`,
 *     `${pct.toFixed(2)}%`, `repeat(${cols}, ...)` и т.п.
 *
 * Запрещено: значения из user-input — `Q.<id>` ответы, `answers.*`, `search` строки,
 * `e.target.value`, `q.title`, `item.name`, и любые поля, в которые пользователь
 * мог ввести произвольный текст. CSP `style-src 'self' 'unsafe-inline'` оставлен
 * как осознанный компромисс ТОЛЬКО потому, что доказано: ни одно `style:`
 * не принимает user-input. Если этот тест упадёт — нужно либо удалить нарушение,
 * либо архитектурно перейти на CSP nonce / strict-dynamic.
 *
 * Тест анализирует ВСЕ файлы js/ui/ и для каждого `style: { ... }` или
 * `style: <expr>` проверяет, не содержит ли значение опасных паттернов.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const UI_ROOT   = join(REPO_ROOT, 'js', 'ui');

function walkJs(rootDir) {
    const out = [];
    const stack = [rootDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try { entries = readdirSync(dir); }
        catch { continue; }
        for (const name of entries) {
            const full = join(dir, name);
            let s;
            try { s = statSync(full); }
            catch { continue; }
            if (s.isDirectory()) stack.push(full);
            else if (s.isFile() && full.endsWith('.js')) out.push(full);
        }
    }
    out.sort();
    return out;
}

function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Найти все `style: { ... }` или `style: <expr>` блоки в исходнике.
 * Возвращает массив { line, snippet } — снимок выражения после `style:`.
 *
 * Простая heuristic: ловим символы между `style:` и ближайшим `,` верхнего
 * уровня или закрывающей `}`. Балансируем `{}` и `()` для вложенных объектов.
 */
function findStyleExpressions(src) {
    const out = [];
    const stripped = stripComments(src);
    const lines = stripped.split('\n');
    const re = /\bstyle\s*:\s*/g;
    let m;
    while ((m = re.exec(stripped)) !== null) {
        const start = m.index + m[0].length;
        // Балансируем скобки до конца выражения (запятая верхнего уровня).
        let i = start;
        let depthCurly = 0;
        let depthParen = 0;
        let depthBracket = 0;
        while (i < stripped.length) {
            const ch = stripped[i];
            if (ch === '{') depthCurly++;
            else if (ch === '}') {
                if (depthCurly === 0) break;
                depthCurly--;
            }
            else if (ch === '(') depthParen++;
            else if (ch === ')') {
                if (depthParen === 0) break;
                depthParen--;
            }
            else if (ch === '[') depthBracket++;
            else if (ch === ']') depthBracket--;
            else if (ch === ',' && depthCurly === 0 && depthParen === 0 && depthBracket === 0) break;
            i++;
        }
        const snippet = stripped.slice(start, i).trim();
        // Линию вычисляем по позиции `style:` в orig stripped.
        const lineNo = stripped.slice(0, m.index).split('\n').length;
        out.push({ line: lineNo, snippet });
    }
    return out;
}

/* Опасные паттерны — значения, происходящие от user-input. */
const FORBIDDEN_PATTERNS = [
    { re: /\bQ\.[a-z_][a-z_0-9]*/i,           reason: 'Q.<id> — ответ пользователя' },
    { re: /\banswers\.[a-z_]/i,               reason: 'answers.<id> — ответ пользователя' },
    { re: /\bcalc\.answers\b/,                reason: 'calc.answers — пользовательский ввод' },
    { re: /\bsearch\w*/i,                     reason: 'search — пользовательский ввод' },
    { re: /\be\.target\.value\b/,             reason: 'e.target.value — сырой ввод формы' },
    { re: /\bdraft\.\w+/,                     reason: 'draft.* — пользовательский ввод модалки' },
    { re: /\bitem\.name\b/,                   reason: 'item.name — может быть переименован пользователем' },
    { re: /\bitem\.vendor\b/,                 reason: 'item.vendor — пользовательский ввод' },
    { re: /\bitem\.description\b/,            reason: 'item.description — пользовательский ввод' },
    { re: /\bq\.title\b/,                     reason: 'q.title — пользовательский ввод' },
    { re: /\bcalc\.name\b/,                   reason: 'calc.name — переименование пользователем' }
];

const uiFiles = walkJs(UI_ROOT);

describe('CSP hardening: props.style не принимает user-input (12.U32 #3)', () => {
    it('обход js/ui/ нашёл хотя бы один .js файл', () => {
        assert.ok(uiFiles.length > 0);
    });

    for (const file of uiFiles) {
        const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
        it(`${rel}: style: не содержит user-input выражений`, () => {
            const content = readFileSync(file, 'utf8');
            const exprs = findStyleExpressions(content);
            const violations = [];
            for (const { line, snippet } of exprs) {
                for (const { re, reason } of FORBIDDEN_PATTERNS) {
                    if (re.test(snippet)) {
                        violations.push(
                            `  ${rel}:${line}: style содержит ${reason}\n` +
                            `    snippet: ${snippet.slice(0, 120)}`
                        );
                    }
                }
            }
            assert.equal(violations.length, 0,
                `Inline-style принимает user-input → CSS-injection вектор:\n` +
                violations.join('\n') + '\n' +
                'Перенеси значение в CSS-класс ИЛИ используй CSS custom property с whitelisted-значением.');
        });
    }
});
