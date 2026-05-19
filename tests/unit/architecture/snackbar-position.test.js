/**
 * Stage 18.1.2 — Snackbar / Modal Footer Overlap Fix.
 *
 * Проблема: snackbar был fixed bottom-center и физически касался footer'а
 * открытых модалок (например, кнопки «Применить изменения» в Cost Optimization
 * Planner). Фикс системный — на desktop сдвигаем в bottom-right, на mobile
 * (≤720px) возвращаем bottom-center.
 *
 * Эти тесты — линтер для CSS-правила `.snackbar-stack` в `css/modals.css`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ruleBody, stripCssComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, '../../../css/modals.css');
const css = readFileSync(CSS_PATH, 'utf8');

const defaultBody = ruleBody(css, '.snackbar-stack');

/* В modals.css может быть несколько `@media (max-width: 720px) { ... }` блоков
   с разным содержимым. Нам нужен ЛЮБОЙ блок, который содержит правило для
   .snackbar-stack — поэтому собираем все matching media-блоки и склеиваем их.
   extractAtMediaBody вернул бы только первый, что зависит от порядка в файле. */
function collectAllMobileBlocks(src) {
    const stripped = stripCssComments(src);
    const headerRe = /@media\s*\([^)]*max-width\s*:\s*720px[^)]*\)\s*\{/g;
    const parts = [];
    let m;
    while ((m = headerRe.exec(stripped)) !== null) {
        let i = m.index + m[0].length;
        let depth = 1;
        const start = i;
        while (i < stripped.length && depth > 0) {
            const ch = stripped[i];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            if (depth === 0) { parts.push(stripped.slice(start, i)); break; }
            i++;
        }
    }
    return parts.join('\n');
}
const mobileBlock = collectAllMobileBlocks(css);

test('snackbar default: содержит right: 24px', () => {
    assert.match(defaultBody, /right\s*:\s*24px/, '.snackbar-stack должен быть привязан к правому краю в default');
});

test('snackbar default: НЕ содержит left: 50%', () => {
    assert.doesNotMatch(defaultBody, /\bleft\s*:\s*50%/, '.snackbar-stack не должен использовать left: 50% в default (это было причиной перекрытия footer\'а модалок)');
});

test('snackbar default: НЕ содержит transform: translateX(-50%)', () => {
    assert.doesNotMatch(defaultBody, /transform\s*:\s*translateX\s*\(\s*-50%\s*\)/, '.snackbar-stack не должен центрироваться через transform в default');
});

test('snackbar default: содержит align-items: flex-end', () => {
    assert.match(defaultBody, /align-items\s*:\s*flex-end/, '.snackbar-stack должен выравнивать стек вправо (align-items: flex-end) в default');
});

test('snackbar @media max-width 720px: возвращает left: 50%', () => {
    assert.ok(mobileBlock, '@media (max-width: 720px) блок должен существовать в modals.css');
    assert.match(mobileBlock, /\.snackbar-stack[\s\S]*?\{[^}]*left\s*:\s*50%/, 'На mobile (≤720px) snackbar возвращается к bottom-center через left: 50%');
});

test('snackbar @media max-width 720px: содержит transform: translateX(-50%)', () => {
    assert.ok(mobileBlock, '@media (max-width: 720px) блок должен существовать в modals.css');
    assert.match(mobileBlock, /\.snackbar-stack[\s\S]*?\{[^}]*transform\s*:\s*translateX\s*\(\s*-50%\s*\)/, 'На mobile snackbar центрируется через transform: translateX(-50%)');
});
