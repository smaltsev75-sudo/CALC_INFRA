/**
 * A11y CSS-линтер: outline:none без замены = WCAG 2.4.7 violation.
 *
 * Любое CSS-правило, обнуляющее системный focus indicator через
 * `outline: none` (или `outline: 0`), обязано предоставить
 * замену — иначе keyboard-пользователь теряет визуальный focus.
 *
 * Допустимые сценарии:
 *   1. Селектор содержит `:focus-visible` И в декларации есть
 *      одна из замен: box-shadow / border / outline (с !=none значением).
 *   2. Селектор не содержит `:focus*` вообще (например, обнуление
 *      нативного outline на `summary`/`button` для UI-сброса —
 *      не валидно по WCAG, но вне области ответственности этого линтера).
 *
 * НЕдопустимые (этот линтер падает):
 *   - `.x:focus { outline: none; }` без замены — keyboard-фокус полностью съеден.
 *   - `.x:focus-visible { outline: none; }` без замены — то же самое.
 *
 * Паттерн ловится построчно — парсер CSS-блоков примитивный,
 * считаем фигурные скобки. Этого достаточно для нашего CSS-стиля.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CSS_ROOT  = join(REPO_ROOT, 'css');

/* ---------- Обход *.css ---------- */

function walkCss(rootDir) {
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
            if (s.isDirectory()) {
                stack.push(full);
            } else if (s.isFile() && full.endsWith('.css')) {
                out.push(full);
            }
        }
    }
    out.sort();
    return out;
}

/* ---------- Парсер CSS-блоков ---------- */

/**
 * Возвращает массив { selector, body, line } по всем top-level
 * CSS-правилам в файле. Игнорирует комментарии и @media-блоки
 * (заходит внутрь @media и собирает вложенные правила).
 */
function extractRules(css) {
    // Удаляем CSS-комментарии (без вложенности).
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length));

    const rules = [];
    let depth = 0;
    let selectorStart = 0;
    let bodyStart = -1;
    let inSelector = true;

    for (let i = 0; i < noComments.length; i++) {
        const ch = noComments[i];
        if (ch === '{') {
            if (depth === 0) {
                bodyStart = i + 1;
                inSelector = false;
            }
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0 && bodyStart >= 0) {
                const selector = noComments.slice(selectorStart, bodyStart - 1).trim();
                const body     = noComments.slice(bodyStart, i);
                // @media/@supports — заходим внутрь рекурсивно.
                if (selector.startsWith('@media') || selector.startsWith('@supports')) {
                    rules.push(...extractRules(body));
                } else if (selector && !selector.startsWith('@')) {
                    const line = noComments.slice(0, bodyStart).split('\n').length;
                    rules.push({ selector, body, line });
                }
                selectorStart = i + 1;
                inSelector = true;
            }
        }
    }
    return rules;
}

/* ---------- Проверка одного правила ---------- */

const OUTLINE_NONE_RE = /outline\s*:\s*(?:none|0)\s*;/i;

function hasReplacement(body) {
    // Любая из замен в той же декларации спасает focus indicator.
    if (/box-shadow\s*:/i.test(body)) return true;
    // border / border-color / border-style / border-width / border-<side>(-color|-style|-width)
    if (/border(?:-(?:top|right|bottom|left))?(?:-(?:color|style|width))?\s*:/i.test(body)) return true;
    // outline: <не none> в той же декларации (например, outline: 2px solid).
    const outlines = body.match(/outline(?:-color|-style|-width)?\s*:\s*([^;]+);/gi) || [];
    for (const decl of outlines) {
        const value = decl.replace(/.*:\s*/i, '').replace(/;$/, '').trim();
        if (value !== 'none' && value !== '0') return true;
    }
    return false;
}

function findViolations(css, fileLabel) {
    const rules = extractRules(css);
    const violations = [];
    for (const { selector, body, line } of rules) {
        if (!OUTLINE_NONE_RE.test(body)) continue;
        // Проверяем только селекторы, которые касаются focus-состояния.
        if (!/:focus(-visible|-within)?/i.test(selector)) continue;
        if (!hasReplacement(body)) {
            violations.push({ fileLabel, selector, line });
        }
    }
    return violations;
}

/* ---------- Тесты ---------- */

const cssFiles = walkCss(CSS_ROOT);

describe('A11y CSS-линтер: outline:none на :focus* требует замену (WCAG 2.4.7)', () => {
    it('обход css/ нашёл хотя бы один .css файл', () => {
        assert.ok(cssFiles.length > 0,
            'Не найден ни один .css в ' + CSS_ROOT);
    });

    for (const file of cssFiles) {
        const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
        it(`${rel}: на :focus* нет outline:none без замены (box-shadow/border/outline)`, () => {
            const content = readFileSync(file, 'utf8');
            const violations = findViolations(content, rel);
            if (violations.length > 0) {
                const lines = violations.map(v =>
                    `  ${v.fileLabel}:${v.line}  селектор «${v.selector}» сбрасывает outline без замены`).join('\n');
                assert.fail(
                    `Найдены нарушения WCAG 2.4.7 (focus indicator):\n${lines}\n` +
                    `Решение: добавь box-shadow / border / outline c видимым значением в ту же декларацию.`);
            }
        });
    }
});
