/**
 * PATCH 2.7.2 hotfix: запрет `display: flex/grid/block` на селекторах,
 * которые применяются к `<th>` или `<td>`.
 *
 * Эти display-режимы вырывают элемент из контекста table-row → ломают
 * горизонтальную раскладку шапки/тела таблицы. Симптом — thead рендерится
 * вертикальным стеком (RAM/STORAGE/NETWORK/... в одной колонке вместо ряда).
 *
 * Жертвы (Stage 14.1 .analytics-th-cat / .analytics-th-total) — закрыта
 * в css/forms.css PATCH 2.7.2 hotfix'ом: `display: flex` снят с <th>,
 * inline-flex применён к дочернему `<span>`.
 *
 * Эвристика линтера: регулярка ищет селекторы, содержащие `-th-` или
 * `-td-` (имена .analytics-th-*, .details-td-*, .items-th-* и т.п.),
 * и проверяет, что в их теле нет `display: flex`/`grid`/`block`.
 * Чёрный список псевдо-классов (`:focus-visible`, `:hover`) не нужен —
 * проблема ровно в самой default-декларации.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CSS_ROOT  = join(REPO_ROOT, 'css');

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
            if (s.isDirectory()) stack.push(full);
            else if (s.isFile() && full.endsWith('.css')) out.push(full);
        }
    }
    return out;
}

/* Балансированный матчер CSS-rule'а. Возвращает [{ selector, body }]. */
function parseRules(src) {
    const rules = [];
    const re = /([^{}@]+?)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        rules.push({ selector: m[1].trim(), body: m[2].trim() });
    }
    return rules;
}

describe('table-cell display: запрет display:flex/grid/block на <th>/<td>-классах', () => {
    it('ни один селектор `-th-*`/`-td-*` не использует display:flex/grid/block', () => {
        const offenders = [];
        for (const file of walkCss(CSS_ROOT)) {
            const src = stripCssComments(readFileSync(file, 'utf8'));
            for (const { selector, body } of parseRules(src)) {
                /* Только селекторы с явно table-cell-классом. Эвристика —
                   `-th-` или `-td-` в любом из selectors группы. */
                if (!/(^|[\s.,>+~])\.[a-z][a-z0-9-]*-(th|td)-/.test(selector)) continue;
                /* Точная проверка декларации `display: flex/grid/block` без
                   `inline-flex`/`inline-grid` (которые НЕ ломают table-cell). */
                const m = body.match(/display\s*:\s*(flex|grid|block)\b/);
                if (m && !body.includes('inline-flex') && !body.includes('inline-grid')) {
                    offenders.push({
                        file: file.replace(REPO_ROOT, '').replace(/\\/g, '/'),
                        selector,
                        violation: m[0]
                    });
                }
            }
        }
        assert.deepEqual(offenders, [],
            'Селекторы с `-th-*`/`-td-*` НЕ должны использовать ' +
            'display:flex/grid/block — это вырывает <th>/<td> из table-row ' +
            'и ломает горизонтальную раскладку. Используйте `display:inline-flex` ' +
            'на дочернем <span> внутри <th>:\n' +
            offenders.map(o =>
                `  ${o.file}: ${o.selector} { ${o.violation} }`).join('\n')
        );
    });
});
