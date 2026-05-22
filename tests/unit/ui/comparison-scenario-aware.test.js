/**
 * Sprint 3.0 / Stage 3: scenario-aware Comparison.
 *
 * Comparison из cross-calc стал scenario-aware: для calc'ов с ≥2 сценариями
 * под именем calc'а в шапке колонки и в title AI-блока появляется подстрока
 * «сценарий: <label>». Для legacy-calc'ов и calc'ов с одним сценарием —
 * подстрока не показывается (label «Базовый» = шум в сравнении).
 *
 * Тесты проверяют:
 *   1. Что comparison.js импортирует getActiveScenario и делает helper
 *      activeScenarioLabelForCompare с гард-условием scenarios.length < 2 → null.
 *   2. Что render-функции (renderUnifiedTable Row 1 + AI-block) добавляют
 *      scenario.label подстрокой («сценарий: ${scenarioLabel}» / `сценарий: `).
 *   3. Что CSS-классы .cmp-calc-scenario и .comparison-ai-block-scenario
 *      определены (а не только используются в html без стилей).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, stripCssComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const comparisonSource = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'comparison.js'),
    'utf8'
);
const cssSource = readFileSync(
    join(__dirname, '..', '..', '..', 'css', 'comparison.css'),
    'utf8'
);

describe('comparison.js — scenario-aware impart + helper', () => {
    const noComments = stripJsComments(comparisonSource);

    it('импортирует getActiveScenario из domain/scenarios.js', () => {
        assert.ok(
            /import\s*\{\s*getActiveScenario\s*\}\s*from\s*['"]\.\.\/domain\/scenarios\.js['"]/.test(noComments),
            'Ожидался импорт getActiveScenario из ../domain/scenarios.js'
        );
    });

    it('helper activeScenarioLabelForCompare существует и имеет guard на scenarios.length < 2', () => {
        assert.ok(
            /function\s+activeScenarioLabelForCompare\s*\(/.test(noComments),
            'Helper activeScenarioLabelForCompare не найден'
        );
        // Guard: должен возвращать null для calc без scenarios или с одним scenario.
        assert.ok(
            /scenarios\.length\s*<\s*2/.test(noComments),
            'Guard `scenarios.length < 2` не найден — для legacy/single-scenario calc должна возвращаться null'
        );
    });
});

describe('comparison.js — scenario.label в шапке колонки', () => {
    const noComments = stripJsComments(comparisonSource);

    it('Row 1 шапки таблицы рендерит подстроку «сценарий: ${scenarioLabel}»', () => {
        // Структурный matcher: cmp-calc-scenario с text «сценарий: ${scenarioLabel}».
        assert.ok(
            /cmp-calc-scenario/.test(noComments),
            'CSS-класс cmp-calc-scenario не используется в comparison.js'
        );
        assert.ok(
            /сценарий:\s*\$\{scenarioLabel\}/.test(noComments),
            'Подстрока «сценарий: ${scenarioLabel}» не найдена в Row 1 шапки'
        );
    });

    it('AI-блок рендерит подстроку «сценарий: ${scenarioLabel}»', () => {
        assert.ok(
            /comparison-ai-block-scenario/.test(noComments),
            'CSS-класс comparison-ai-block-scenario не используется в comparison.js'
        );
        // Несколько вхождений «сценарий: ${scenarioLabel}» — Row 1 + AI-block.
        const matches = noComments.match(/сценарий:\s*\$\{scenarioLabel\}/g);
        assert.ok(
            matches && matches.length >= 2,
            `Ожидались минимум 2 вхождения «сценарий: ${'$'}{scenarioLabel}» (Row 1 + AI-block), нашлось: ${matches?.length || 0}`
        );
    });

    it('строка статуса сортировки добавляет «· сценарий: ${sortedScenario}» к имени отсортированного calc', () => {
        // sortedScenario — переменная, через которую label прокидывается в title.
        assert.ok(
            /sortedScenario/.test(noComments),
            'Переменная sortedScenario не найдена в строке статуса сортировки'
        );
        assert.ok(
            /·\s*сценарий:\s*\$\{sortedScenario\}/.test(noComments),
            'Префикс «· сценарий: ${sortedScenario}» не найден в строке статуса сортировки'
        );
    });
});

describe('comparison.css — стили scenario-подстрок определены', () => {
    const noCssComments = stripCssComments(cssSource);

    it('.cmp-calc-scenario определён в comparison.css', () => {
        assert.ok(
            /\.cmp-calc-scenario\s*\{/.test(noCssComments)
            || /\.comparison-table-unified\s+\.cmp-calc-scenario\s*\{/.test(noCssComments),
            'Селектор .cmp-calc-scenario не определён в comparison.css'
        );
    });

    it('.comparison-ai-block-scenario определён в comparison.css', () => {
        assert.ok(
            /\.comparison-ai-block-scenario\s*\{/.test(noCssComments),
            'Селектор .comparison-ai-block-scenario не определён в comparison.css'
        );
    });

    it('.comparison-ai-block-titles контейнер определён', () => {
        assert.ok(
            /\.comparison-ai-block-titles\s*\{/.test(noCssComments),
            'Селектор .comparison-ai-block-titles не определён — заголовок AI-блока не получит column-flex'
        );
    });

    it('cursor:help установлен на .cmp-calc-scenario для visual hint', () => {
        // Финализация Stage 3: кликабельность через title-tooltip обозначается визуально cursor:help.
        const m = noCssComments.match(/\.cmp-calc-scenario\s*\{([^}]+)\}/)
              || noCssComments.match(/\.comparison-table-unified\s+\.cmp-calc-scenario\s*\{([^}]+)\}/);
        assert.ok(m, '.cmp-calc-scenario блок не найден');
        assert.ok(
            /cursor\s*:\s*help/.test(m[1]),
            'cursor:help не установлен на .cmp-calc-scenario — visual hint про tooltip отсутствует'
        );
    });
});

describe('comparison.js — picker chip с scenario.label (lazy-load)', () => {
    const noComments = stripJsComments(comparisonSource);

    it('renderPicker строит Map(id → calc) из selectedCalcs (lazy-load для уже выбранных)', () => {
        // Optimization: вместо loadCalcById(meta.id) × N в picker'е используем
        // selectedById = new Map(selectedCalcs.map(c => [c.id, c])).
        assert.ok(
            /selectedById\s*=\s*new\s+Map/.test(noComments),
            'renderPicker не использует selectedById Map для lazy-доступа к full calc'
        );
        // Должен искать активный сценарий через тот же helper, что и в шапке.
        assert.ok(
            /selectedById\.get\s*\(\s*meta\.id\s*\)/.test(noComments),
            'renderPicker не использует selectedById.get(meta.id) — оптимизация не подключена'
        );
    });

    it('chip получает класс chip-with-scenario когда scenario.label есть', () => {
        assert.ok(
            /chip-with-scenario/.test(noComments),
            'CSS-класс chip-with-scenario не используется в renderPicker'
        );
    });

    it('chip-content + chip-name + chip-scenario — двухстрочная структура chip', () => {
        assert.ok(
            /chip-content/.test(noComments) && /chip-name/.test(noComments) && /chip-scenario/.test(noComments),
            'Двухстрочная структура chip не используется (chip-content + chip-name + chip-scenario)'
        );
    });
});

describe('comparison.css — picker chip scenario стили', () => {
    const noCssComments = stripCssComments(cssSource);

    it('.comparison-chips .chip-content определён как column flex', () => {
        const m = noCssComments.match(/\.comparison-chips\s+\.chip-content\s*\{([^}]+)\}/);
        assert.ok(m, 'Селектор .comparison-chips .chip-content не найден');
        assert.ok(
            /flex-direction\s*:\s*column/.test(m[1]),
            'chip-content должен быть flex-direction:column для двухстрочного chip'
        );
    });

    it('.comparison-chips .chip-scenario определён', () => {
        assert.ok(
            /\.comparison-chips\s+\.chip-scenario\s*\{/.test(noCssComments),
            'Селектор .comparison-chips .chip-scenario не определён'
        );
    });
});
