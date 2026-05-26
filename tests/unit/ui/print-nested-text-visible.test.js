/**
 * Print PDF: проверяет, что вложенные узлы внутри th/td получают явный
 * `color: black` в @media print. Без этого `<div class="col-stand-name">DEV</div>`
 * остаётся со своим `color: var(--text)` (#f1f5f9 — slate-100), потому что
 * print-правило `color: black !important` стоит на родительском th/td и не
 * каскадируется на дочерний элемент со своим color (CSS !important работает
 * на element-level, не наследуется на детей с собственными правилами).
 *
 * Жертвы: вложенное имя стенда (col-stand-name) и category-rows
 * (category-name/count/chevron, items-cat-*, cmp-cat-*) — на скрине печати
 * стенды и названия категорий не видны (slate-100 на белой бумаге).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRINT_CSS = join(__dirname, '..', '..', '..', 'css', 'print.css');

/**
 * Извлечь body `@media print { ... }` блока из CSS-исходника, балансируя
 * фигурные скобки. Стандартный helper extractAtMediaBody требует `@media (...)`
 * со скобками вокруг условия — не подходит для bare `@media print`.
 */
function extractMediaPrintBody(src) {
    const stripped = stripCssComments(src);
    const m = stripped.match(/@media\s+print\s*\{/);
    if (!m) return null;
    let i = m.index + m[0].length;
    const start = i;
    let depth = 1;
    while (i < stripped.length && depth > 0) {
        const ch = stripped[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return stripped.slice(start, i);
        }
        i++;
    }
    return null;
}

const NESTED_NODES_THAT_NEED_BLACK = [
    /* Stand headers (Детализация qty + cost) — на скрине печати
       названия стендов DEV/ИФТ/ПСИ/ПРОМ/Нагрузка не видны. */
    '.col-stand-name',
    /* Category-rows в Детализации (qty + cost). На скрине рядом с цветной
       точкой видно только «· N», название категории невидно. */
    '.category-name',
    '.category-count',
    '.category-chevron',
    /* Category-rows во вкладке Элементы конфигурации. */
    '.items-cat-name',
    '.items-cat-count',
    '.items-cat-chevron',
    /* Category-rows в Сравнении. */
    '.cmp-cat-name',
    '.cmp-cat-count'
];

describe('print: вложенные узлы внутри th/td получают color: black', () => {
    const css = readFileSync(PRINT_CSS, 'utf8');
    const printBlock = extractMediaPrintBody(css);
    assert.ok(printBlock, '@media print block не найден в print.css');

    for (const selector of NESTED_NODES_THAT_NEED_BLACK) {
        it(`${selector} в @media print имеет color: black`, () => {
            // Селектор может появляться в правиле один или в группе через запятую.
            // Проверяем, что НА ОДНОЙ ИЗ декларации этого селектора в @media print
            // есть `color: black`. Минимальный надёжный паттерн: правило содержит
            // selector и в его теле есть `color: black`.
            const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Селектор может быть в группе (через запятую). Найдём ВСЕ rule-block'и,
            // где встречается selector, и убедимся что хотя бы один ставит color:black.
            const ruleRe = new RegExp(
                '(^|[\\s,{}])' + escaped + '[^{]*\\{([^}]*)\\}',
                'g'
            );
            let foundBlackRule = false;
            let m;
            while ((m = ruleRe.exec(printBlock)) !== null) {
                const body = m[2];
                if (/color\s*:\s*(?:black|#000\b|#000000\b)\s*!?\s*\w*\s*;/i.test(body)) {
                    foundBlackRule = true;
                    break;
                }
            }
            assert.ok(
                foundBlackRule,
                `${selector} не получает явный color: black в @media print — ` +
                `на белой бумаге остаётся slate-100/-muted, текст невидим`
            );
        });
    }

    it('.category-pill НЕ ставит color: white (белое на белой бумаге невидимо)', () => {
        // Анти-фикс из print.css: `.category-pill { color: white !important; }` —
        // унаследован от старой реализации с цветной плашкой. Сейчас сама плашка
        // в print лишается background-цвета, и белый текст невидим. Безопасное
        // правило — color: black или просто отсутствие правила.
        const m = printBlock.match(/\.category-pill\s*\{([^}]*)\}/);
        if (!m) return; // правило вообще удалено — ОК.
        const body = m[1];
        assert.ok(
            !/color\s*:\s*white\b/i.test(body),
            '.category-pill { color: white !important } делает текст плашки ' +
            'невидимым на белой бумаге — заменить на color: black или удалить.'
        );
    });
});
