/**
 * Regression-тест: на дашборде в карточке «Распределение по категориям»
 * лейбл каждой категории (.dash-category-row-label) имеет title= с описанием
 * того, какие элементы и расходы входят в категорию. Иначе пользователь видит
 * только короткий ярлык («Услуги», «Резервы») и не понимает, что туда попадает.
 *
 * Источник описаний — `CATEGORY_DESCRIPTIONS` в js/utils/constants.js. Должен
 * покрывать все 7 категорий (CATEGORY_IDS).
 *
 * Принципы:
 *   - title= НЕ дублирует видимый CATEGORY_LABEL (анти-паттерн «Tooltip ≠
 *     повторение visible label», CLAUDE.md). Описание — про СОДЕРЖАНИЕ
 *     категории, не про её имя.
 *   - title= навешивается на сам label (не на всю строку) — hover-цель
 *     совпадает с тем, на что пользователь смотрит, читая название.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';
import { CATEGORY_IDS, CATEGORY_LABELS } from '../../../js/utils/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSrc = stripJsComments(readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'dashboard.js'),
    'utf8'
));

describe('Dashboard: hover-tooltip на категориях в «Распределение по категориям»', () => {
    it('CATEGORY_DESCRIPTIONS экспортируется и покрывает все 7 категорий', async () => {
        const mod = await import('../../../js/utils/constants.js');
        assert.ok(mod.CATEGORY_DESCRIPTIONS, 'CATEGORY_DESCRIPTIONS должен быть экспортирован');
        for (const id of CATEGORY_IDS) {
            const desc = mod.CATEGORY_DESCRIPTIONS[id];
            assert.ok(typeof desc === 'string' && desc.length > 0,
                `CATEGORY_DESCRIPTIONS[${id}] должен быть непустой строкой`);
            assert.notEqual(desc.trim(), CATEGORY_LABELS[id],
                `CATEGORY_DESCRIPTIONS[${id}] не должен дублировать CATEGORY_LABELS[${id}] ` +
                '(tooltip ≠ повторение visible label)');
            assert.ok(desc.length >= 30,
                `CATEGORY_DESCRIPTIONS[${id}] слишком короткое (${desc.length} симв.) — ` +
                'tooltip оправдан только при ДОПОЛНИТЕЛЬНОЙ инфе, не «X — это X»');
        }
    });

    it('renderCategoriesCard: dash-category-row-label получает title из CATEGORY_DESCRIPTIONS', () => {
        // Раньше было `el('span', { class: 'dash-category-row-label', text: CATEGORY_LABELS[cat] })`
        // — голый text, без title. Теперь должен быть и title.
        const labelWithTitle =
            /class:\s*['"]dash-category-row-label['"][\s\S]{0,200}?title:\s*CATEGORY_DESCRIPTIONS\[/
                .test(dashboardSrc);
        assert.ok(labelWithTitle,
            '.dash-category-row-label должен иметь title: CATEGORY_DESCRIPTIONS[cat] — ' +
            'иначе hover не показывает контекст категории');
    });

    it('CATEGORY_DESCRIPTIONS импортируется в dashboard.js', () => {
        const importLine =
            /import\s*\{[^}]*CATEGORY_DESCRIPTIONS[^}]*\}\s*from\s*['"][^'"]*constants\.js['"]/
                .test(dashboardSrc);
        assert.ok(importLine,
            'dashboard.js должен импортировать CATEGORY_DESCRIPTIONS из constants.js');
    });
});
