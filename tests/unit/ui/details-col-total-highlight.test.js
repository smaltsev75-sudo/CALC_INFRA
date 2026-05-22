/**
 * Regression-тест: в Детализации колонка ИТОГО (.col-total —
 * «ИТОГО / мес», «ИТОГО / год» в Бюджете и «ИТОГО qty» в Объёме) выделена
 * визуально ТОЛЬКО в item-rows:
 *   - bg-elevated (subtle светлая подложка),
 *   - border-left (разделитель «итогового блока» от блока стендов),
 *   - font-weight ≥ 600 (итог жирнее обычных чисел).
 *
 * Шапка (th) и строки-итоги (.totals-row-grand/capex/opex) НЕ получают
 * свой фон/border на col-total — иначе либо «разорванная колонка» (светлый
 * островок только в item-rows на фоне тёмной шапки и тёмных итогов), либо
 * «вырезанный островок» в полосе итога. Обе крайности уже были.
 *
 * .totals-row-grand td.col-total остаётся accent (не трогаем — это было
 * до Этапа 13.U10 и сохраняется).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, ruleBody } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tablesCss = stripCssComments(readFileSync(
    join(__dirname, '..', '..', '..', 'css', 'tables.css'),
    'utf8'
));

describe('Details: колонка ИТОГО выделена ТОЛЬКО в item-rows', () => {
    it('item-row td.col-total: bg-elevated + border-left + font-weight ≥ 600', () => {
        const body = ruleBody(tablesCss, '.details-table tr.item-row td.col-total');
        assert.ok(/background\s*:\s*var\(--bg-elevated\)/.test(body),
            'item-row td.col-total должен иметь background: var(--bg-elevated) — ' +
            'это и есть выделение колонки в области элементов');
        assert.ok(/border-left\s*:\s*1px\s+solid\s+var\(--border-light\)/.test(body),
            'item-row td.col-total должен иметь border-left — разделитель ' +
            'между блоком стендов и итоговым блоком');
        const fw = body.match(/font-weight\s*:\s*(\d+)/);
        assert.ok(fw && parseInt(fw[1], 10) >= 600,
            'item-row td.col-total должен задавать font-weight ≥ 600 (сейчас ' +
            (fw ? fw[1] : 'не задан') + ')');
    });

    it('НЕТ общего правила .details-table th.col-total / td.col-total с background', () => {
        // Раньше было: th.col-total + td.col-total { background: bg-elevated; border-left },
        // что вызывало «разорванную колонку» (шапка светлая, строки итогов тёмные,
        // item-rows светлые) + «вырезанный островок» в строках итогов. Теперь
        // правила нет — выделение даётся только узким селектором tr.item-row.
        const broadRule =
            /\.details-table\s+th\.col-total\s*,\s*\.details-table\s+td\.col-total\s*\{[^}]*background\s*:/
                .test(tablesCss);
        assert.equal(broadRule, false,
            'не должно быть общего правила th.col-total + td.col-total с background — ' +
            'оно создаёт визуальные «островки» в строках итогов и шапке');
    });

    it('НЕТ override-правила для .totals-row-grand/capex/opex td.col-total', () => {
        // Поскольку нет общего правила col-total с background, и нет необходимости
        // его «снимать» в строках итогов через override. Если оставить override
        // с background: var(--bg-card) — это лишний шум в CSS.
        const overrideRule =
            /\.totals-row-grand\s+td\.col-total\s*,[\s\S]{0,200}?\.totals-row-(capex|opex)\s+td\.col-total\s*\{/
                .test(tablesCss);
        assert.equal(overrideRule, false,
            'не должно быть override .totals-row-* td.col-total — ' +
            'после удаления общего правила он не нужен (Этап 13.U10).');
    });

    it('totals-row-grand td.col-total остаётся accent (не сломали существующее)', () => {
        const body = ruleBody(tablesCss, '.details-table .totals-row-grand td.col-total');
        assert.ok(/color\s*:\s*var\(--accent\)/.test(body),
            '.totals-row-grand td.col-total должен сохранить color: var(--accent)');
    });
});
