/**
 * 12.U28: Объединённая таблица «Сравнение» = одна таблица вместо двух
 *   • Sticky 3-row thead (header + Стоимость/мес + Стоимость/год).
 *   • Группировка ЭК по категории (CATEGORY_IDS-порядок), accordion по умолчанию свёрнут.
 *   • Сортировка по индикаторам сохраняется и применяется ВНУТРИ категории.
 *
 * Тесты:
 *   1. groupItemsByCategory — порядок групп, сортировка items, отсев пустых.
 *   2. categoryColSum — корректное суммирование, обработка отсутствующих item-ов.
 *   3. Структурные регрессии исходника comparison.js — что секции sticky/accordion
 *      присутствуют, что старая модуль buildSummaryRows отсутствует.
 *   4. Структурные регрессии CSS — sticky-yarus с правильными top'ами.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { groupItemsByCategory, categoryColSum } from '../../../js/ui/comparison.js';
import { CATEGORY_IDS } from '../../../js/utils/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const comparisonSource = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'comparison.js'),
    'utf8'
);
const cssSource = readFileSync(
    join(__dirname, '..', '..', '..', 'css', 'comparison.css'),
    'utf8'
);

describe('groupItemsByCategory — группировка ЭК по категории', () => {
    it('возвращает группы в каноническом порядке CATEGORY_IDS', () => {
        const items = [
            { id: 'a', name: 'A', category: 'AI' },
            { id: 'b', name: 'B', category: 'HW' },
            { id: 'c', name: 'C', category: 'LICENSE' }
        ];
        const groups = groupItemsByCategory(items);
        const cats = groups.map(g => g.catId);
        // HW идёт раньше LICENSE, LICENSE — раньше AI в CATEGORY_IDS.
        const hwIdx = cats.indexOf('HW');
        const licIdx = cats.indexOf('LICENSE');
        const aiIdx = cats.indexOf('AI');
        assert.ok(hwIdx >= 0 && licIdx >= 0 && aiIdx >= 0);
        assert.ok(hwIdx < licIdx, 'HW должен идти раньше LICENSE');
        assert.ok(licIdx < aiIdx, 'LICENSE должен идти раньше AI');
    });

    it('пустые категории не попадают в результат', () => {
        const items = [{ id: 'a', name: 'A', category: 'HW' }];
        const groups = groupItemsByCategory(items);
        assert.equal(groups.length, 1);
        assert.equal(groups[0].catId, 'HW');
    });

    it('items внутри категории сортируются по имени (RU-locale)', () => {
        const items = [
            { id: '1', name: 'Я', category: 'HW' },
            { id: '2', name: 'А', category: 'HW' },
            { id: '3', name: 'М', category: 'HW' }
        ];
        const groups = groupItemsByCategory(items);
        assert.deepEqual(groups[0].items.map(x => x.name), ['А', 'М', 'Я']);
    });

    it('item без category дефолтится в HW', () => {
        const items = [{ id: 'a', name: 'A' }];
        const groups = groupItemsByCategory(items);
        assert.equal(groups.length, 1);
        assert.equal(groups[0].catId, 'HW');
    });

    it('пустой вход → пустой массив', () => {
        assert.deepEqual(groupItemsByCategory([]), []);
    });
});

describe('categoryColSum — суммирование item-ов в категории по столбцу', () => {
    const fakeResults = [
        { items: { a: { totalMonthly: 100 }, b: { totalMonthly: 50 } } },
        { items: { a: { totalMonthly: 200 } } }   // b отсутствует во 2-м расчёте
    ];

    it('суммирует все item.totalMonthly в указанном столбце', () => {
        assert.equal(categoryColSum([{ id: 'a' }, { id: 'b' }], fakeResults, 0), 150);
    });

    it('отсутствующий item рассматривается как 0', () => {
        assert.equal(categoryColSum([{ id: 'a' }, { id: 'b' }], fakeResults, 1), 200);
    });

    it('пустой items → 0', () => {
        assert.equal(categoryColSum([], fakeResults, 0), 0);
    });

    it('Number.isFinite-фильтр: NaN/Infinity не суммируются', () => {
        const broken = [
            { items: { a: { totalMonthly: NaN }, b: { totalMonthly: 100 } } }
        ];
        assert.equal(categoryColSum([{ id: 'a' }, { id: 'b' }], broken, 0), 100);
    });
});

describe('comparison.js — структурные регрессии (12.U28)', () => {
    it('старый buildSummaryRows и Сводка-секция полностью удалены', () => {
        assert.ok(!comparisonSource.includes('buildSummaryRows'),
            'buildSummaryRows не должен импортироваться в новой объединённой таблице');
        assert.ok(!comparisonSource.includes('comparisonSummaryRows'),
            'модуль comparisonSummaryRows.js не должен упоминаться');
        assert.ok(!comparisonSource.includes('renderSummaryTable'),
            'отдельной функции renderSummaryTable не должно остаться');
        assert.ok(!comparisonSource.includes('renderDetailTable'),
            'отдельной функции renderDetailTable не должно остаться');
    });

    it('содержит renderUnifiedTable как единственную функцию рендера таблицы', () => {
        assert.ok(comparisonSource.includes('function renderUnifiedTable'),
            'должна быть объединённая функция renderUnifiedTable');
    });

    it('thead содержит row 1 (header) + 2 totals-row (мес/год)', () => {
        assert.ok(comparisonSource.includes('cmp-header-row'),
            'header-row должен иметь класс cmp-header-row');
        assert.ok(comparisonSource.includes('cmp-totals-row-monthly'),
            'totals-row для Стоимость/мес должен быть с классом cmp-totals-row-monthly');
        assert.ok(comparisonSource.includes('cmp-totals-row-annual'),
            'totals-row для Стоимость/год должен быть с классом cmp-totals-row-annual');
    });

    it('категория-row имеет класс cmp-cat-row + клик на toggle', () => {
        assert.ok(comparisonSource.includes('cmp-cat-row'),
            'каждая категория-секция должна быть в cmp-cat-row');
        assert.ok(comparisonSource.includes('toggleComparisonCategory'),
            'клик на категорию должен звать ctx.toggleComparisonCategory');
        assert.ok(comparisonSource.includes("aria-expanded"),
            'aria-expanded должен присутствовать для accessibility');
    });

    it('item-row имеет класс cmp-item-row внутри раскрытой категории', () => {
        assert.ok(comparisonSource.includes('cmp-item-row'),
            'каждый item-row должен быть с классом cmp-item-row');
    });

    it('сортировка по индикаторам столбца сохраняется (clickable header + state.ui.comparisonSort)', () => {
        assert.ok(comparisonSource.includes('cmp-sortable-col'),
            'header-th должен быть кликабельным (cmp-sortable-col)');
        assert.ok(comparisonSource.includes('comparisonSort'),
            'state.ui.comparisonSort должен использоваться');
        assert.ok(comparisonSource.includes('sortRowsByIndicator'),
            'сортировка применяется через sortRowsByIndicator');
    });
});

describe('comparison.css — sticky-yarus 3-row (12.U28)', () => {
    it('задана CSS-переменная --cmp-row-h для расчёта sticky-top', () => {
        assert.ok(/--cmp-row-h\s*:/.test(cssSource),
            'должна быть CSS-переменная --cmp-row-h для высоты sticky-row');
    });

    it('thead th имеет position: sticky + базовый фон + z-index', () => {
        // Базовое правило — single source of truth для всех 3 ярусов.
        assert.ok(/\.comparison-table-unified thead th\s*\{[^}]*position:\s*sticky/.test(cssSource),
            'thead th должен иметь position: sticky');
        assert.ok(/\.comparison-table-unified thead th\s*\{[^}]*background:/.test(cssSource),
            'thead th должен иметь background — иначе будет просвечивать tbody');
    });

    it('ярус 1 (cmp-th-l1) имеет top: var(--topbar-height) (12.U30-fix: под app-topbar)', () => {
        assert.ok(/\.cmp-th-l1\s*\{[^}]*top:\s*var\(--topbar-height\)/.test(cssSource),
            'ярус 1 должен прилипать к --topbar-height (под sticky app-topbar z=40), не к top: 0');
    });

    it('ярус 2 (cmp-th-l2) имеет top: calc(--topbar-height + --cmp-row-h)', () => {
        assert.ok(/\.cmp-th-l2\s*\{[^}]*top:\s*calc\(var\(--topbar-height\)\s*\+\s*var\(--cmp-row-h\)\)/.test(cssSource),
            'ярус 2 (Стоимость/мес) должен иметь top = topbar-height + 1×ряд');
    });

    it('ярус 3 (cmp-th-l3) имеет top: calc(--topbar-height + --cmp-row-h * 2)', () => {
        assert.ok(/\.cmp-th-l3\s*\{[^}]*top:\s*calc\(var\(--topbar-height\)\s*\+\s*var\(--cmp-row-h\)\s*\*\s*2\)/.test(cssSource),
            'ярус 3 (Стоимость/год) должен иметь top = topbar-height + 2×ряд');
    });

    it('cmp-cat-row имеет cursor: pointer (категория кликабельна)', () => {
        assert.ok(/\.cmp-cat-row\s*\{[^}]*cursor:\s*pointer/.test(cssSource),
            'категория-row должна быть визуально интерактивной');
    });

    it('cmp-cat-toggle имеет fallback :focus-visible с заменой outline (a11y, WCAG 2.4.7)', () => {
        // Линтер a11y запрещает outline:none без замены — проверяем явно.
        assert.ok(/\.cmp-cat-toggle:focus-visible\s*\{[^}]*box-shadow/.test(cssSource),
            'фокус на toggle должен заменять системный outline на box-shadow');
    });
});

describe('CATEGORY_IDS sanity — порядок не должен случайно меняться', () => {
    it('включает HW, LICENSE, AI как известные точки группировки в этой версии', () => {
        // Просто sanity — если CATEGORY_IDS поменяется, тесты выше про порядок упадут предсказуемо.
        assert.ok(CATEGORY_IDS.includes('HW'));
        assert.ok(CATEGORY_IDS.includes('LICENSE'));
        assert.ok(CATEGORY_IDS.includes('AI'));
    });
});
