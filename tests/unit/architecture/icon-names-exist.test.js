/**
 * Архитектурный линтер: каждый `icon('name')` в `js/ui/` должен ссылаться на
 * имя, реально существующее в `ICONS` мапе [icons.js](js/ui/icons.js).
 *
 * Без этого теста опечатка типа `icon('file-input')` (где правильное имя —
 * `'upload'` или `'file-text'`) проходит mute в console.warn, а пользователь
 * видит `?`-плейсхолдер на месте иконки. Это было поведение, выявленное в
 * VAT-1 Phase 7.1 bugfix browser-smoke.
 *
 * Линтер проверяет только статические литералы — `icon('home')`. Динамические
 * вызовы (`icon(name)` / `icon(iconName)`) пропускаются.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const JS_ROOT = join(REPO_ROOT, 'js');
const ICONS_PATH = join(JS_ROOT, 'ui', 'icons.js');

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
    return out;
}

/* Извлечь имена иконок из объекта ICONS = { 'name': '<svg>', other: '<svg>' }.
 * Поддерживаем оба варианта ключей: 'kebab-case' (кавычки) и identifier
 * (без кавычек) — например `save:` или `download:` в icons.js. */
function loadIconNames(src) {
    /* Регекс по строкам `^    name:` (4-пробельный отступ — структура icons.js).
     * Захват имени — quoted или identifier. */
    const re = /^\s+(?:'([\w-]+)'|"([\w-]+)"|([a-zA-Z_]\w*))\s*:/gm;
    const names = new Set();
    let m;
    while ((m = re.exec(src)) !== null) {
        const name = m[1] || m[2] || m[3];
        names.add(name);
    }
    return names;
}

describe('icon names: каждый icon() ссылается на существующее имя в ICONS', () => {
    const iconsSrc = readFileSync(ICONS_PATH, 'utf8');
    const ICON_NAMES = loadIconNames(iconsSrc);

    it('sanity: загружено разумное число иконок (>40)', () => {
        assert.ok(ICON_NAMES.size > 40,
            `ожидали >40 иконок в ICONS, нашли ${ICON_NAMES.size}`);
    });

    it('каждый статический icon(\'...\') в js/ui/ — известное имя', () => {
        const files = walkJs(join(JS_ROOT, 'ui'));
        const offenders = [];
        for (const file of files) {
            /* icons.js сам определяет ICONS — пропускаем. */
            if (file === ICONS_PATH) continue;
            const src = stripJsComments(readFileSync(file, 'utf8'));
            /* Захват только статических литералов icon('name') / icon("name").
             * Динамические `icon(varname)` пропускаются — мы не можем их
             * проверить статически. */
            const re = /\bicon\(\s*['"]([a-z][a-z0-9-]*)['"]\s*(?:,|\))/g;
            let m;
            while ((m = re.exec(src)) !== null) {
                const name = m[1];
                if (!ICON_NAMES.has(name)) {
                    const line = src.slice(0, m.index).split('\n').length;
                    const rel = file.replace(REPO_ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
                    offenders.push(`${rel}:${line} → icon('${name}')`);
                }
            }
        }
        assert.deepEqual(
            offenders, [],
            'найдены вызовы icon(...) с неизвестным именем — пользователь увидит ' +
            '«?»-плейсхолдер вместо иконки + warning в console:\n' +
            offenders.join('\n')
        );
    });
});
