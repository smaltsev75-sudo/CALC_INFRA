/**
 * Sprint 4 Stage 4.5: точка-индикатор «есть ручные правки» на scenario-tab.
 * Source-grep тесты: точка рендерится только при count > 0, имеет правильный
 * tooltip с русской плюрализацией.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const tabsSource = readFileSync(join(ROOT, 'js', 'ui', 'scenarioTabs.js'), 'utf8');
const cssSource = readFileSync(join(ROOT, 'css', 'layout.css'), 'utf8');

describe('scenarioTabs.js: индикатор-точка (Stage 4.5)', () => {
    it('Импортирует countManualOverridesInScenario', () => {
        assert.match(tabsSource, /import\s*\{[^}]*countManualOverridesInScenario[^}]*\}\s*from\s*['"]\.\.\/domain\/scenarios\.js['"]/,
            'Helper должен импортироваться из domain/scenarios.js');
    });

    it('Точка рендерится условно: hasOverrides ? el(...) : null', () => {
        assert.match(tabsSource, /hasOverrides\s*\n?\s*\?\s*el\(/,
            'Точка обёрнута в условие — не рендерится при count=0.');
    });

    it('Класс точки .scenario-tab-override-dot', () => {
        assert.match(tabsSource, /['"]scenario-tab-override-dot['"]/,
            'Точка имеет класс .scenario-tab-override-dot.');
    });

    it('Tooltip точки содержит счётчик и слово «правка/правки/правок»', () => {
        assert.match(tabsSource, /\$\{overrideCount\}\s*\$\{pluralizeRu/,
            'Tooltip формируется как "${count} ${pluralized} вручную".');
        assert.match(tabsSource, /pluralizeRu\(overrideCount,\s*['"]правка['"],\s*['"]правки['"],\s*['"]правок['"]\)/,
            'Используется русская плюрализация: правка / правки / правок.');
    });

    it('aria-label на точке для screen-reader', () => {
        assert.match(tabsSource, /aria-label['"]?\s*:\s*`\$\{overrideCount\}\s*ручных правок/,
            'Точка имеет aria-label для скрин-ридеров.');
    });

    it('pluralizeRu helper определён', () => {
        assert.match(tabsSource, /function\s+pluralizeRu\s*\(\s*n\s*,\s*one\s*,\s*few\s*,\s*many\s*\)/,
            'Helper pluralizeRu определён локально в scenarioTabs.js.');
    });
});

describe('CSS: .scenario-tab-override-dot стилизована (Stage 4.5)', () => {
    it('.scenario-tab-override-dot существует', () => {
        const m = cssSource.match(/\.scenario-tab-override-dot\s*\{([^}]+)\}/);
        assert.ok(m, '.scenario-tab-override-dot должен быть определён в layout.css');
        const body = m[1];
        assert.match(body, /background\s*:\s*var\(--accent\)/,
            'Точка использует --accent цвет — заметна в обеих темах.');
        assert.match(body, /border-radius\s*:\s*50%/,
            'Точка круглая (border-radius: 50%).');
        assert.match(body, /cursor\s*:\s*help/,
            'cursor:help — намёк на tooltip при hover.');
    });

    it('.scenario-tab-body — flex для inline-расположения label + точки', () => {
        // Поскольку правил может быть несколько (у уже было одно с font-size),
        // проверяем что есть хотя бы одно с display: inline-flex
        assert.match(cssSource, /\.scenario-tab-body\s*\{[^}]*display\s*:\s*inline-flex/,
            'scenario-tab-body должен быть flex для размещения label рядом с точкой.');
    });
});
