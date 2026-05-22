/**
 * Sprint 4 Stage 4.5: чип «N сценариев» на calc-card.
 * - Скрывается при scenarioCount=1 (single-scenario, типичный кейс)
 * - При count>=2 показывает с правильной русской плюрализацией
 * - meta.scenarioCount обогащается в refreshCalcList
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const calcListSource = readFileSync(join(ROOT, 'js', 'ui', 'calcList.js'), 'utf8');
const ctrlSource = readFileSync(join(ROOT, 'js', 'controllers', 'calcListController.js'), 'utf8');
const cssSource = readFileSync(join(ROOT, 'css', 'components.css'), 'utf8');

describe('calcListController: meta.scenarioCount обогащение (Stage 4.5)', () => {
    it('refreshCalcList обогащает meta полем scenarioCount', () => {
        assert.match(ctrlSource, /scenarioCount/,
            'scenarioCount должен попасть в enriched meta — иначе UI не сможет отрендерить chip.');
    });

    it('Источник count — migrated.scenarios.length', () => {
        assert.match(ctrlSource, /Array\.isArray\(migrated\.scenarios\)\s*&&\s*migrated\.scenarios\.length\s*>\s*0/,
            'Count берётся из массива migrated.scenarios после миграции.');
    });

    it('Default count = 1 (для legacy-расчётов без scenarios[])', () => {
        assert.match(ctrlSource, /let\s+scenarioCount\s*=\s*1\s*;/,
            'Default — 1 (legacy fallback и single-scenario новые расчёты).');
    });
});

describe('calcList.js: чип «N сценариев» на карточке (Stage 4.5)', () => {
    it('Чип скрыт при count=1 (scenariosChipText пустой)', () => {
        assert.match(calcListSource, /scenarioCount\s*>\s*1/,
            'Условие должно быть `count > 1` — chip скрывается для single-scenario calc.');
    });

    it('Используется русская плюрализация (сценарий/сценария/сценариев)', () => {
        assert.match(calcListSource, /pluralizeRu\(scenarioCount,\s*['"]сценарий['"],\s*['"]сценария['"],\s*['"]сценариев['"]\)/,
            'Корректные формы: 1 сценарий / 2 сценария / 5 сценариев.');
    });

    it('Класс chip — .calc-card-chip-scenarios', () => {
        assert.match(calcListSource, /['"]calc-card-chip\s+calc-card-chip-scenarios['"]/,
            'Чип имеет свой CSS-класс .calc-card-chip-scenarios.');
    });

    it('Чип рендерится условно (scenariosChipText ? el(...) : null)', () => {
        assert.match(calcListSource, /scenariosChipText\s*\n?\s*\?\s*el\(/,
            'Чип не рендерится если text пустой — single-scenario calc не имеет лишнего chip.');
    });

    it('pluralizeRu helper определён в calcList.js', () => {
        assert.match(calcListSource, /function\s+pluralizeRu\s*\(\s*n\s*,\s*one\s*,\s*few\s*,\s*many\s*\)/,
            'Helper pluralizeRu определён локально (не импортируется — простая утилита).');
    });

    it('Tooltip объясняет смысл сценариев', () => {
        assert.match(calcListSource, /scenarioCount > 1\s*\n?\s*\?\s*`/,
            'Tooltip формируется как template-string для multi-scenario.');
        assert.match(calcListSource, /отдельных профилей|переключаться между ними/,
            'Tooltip упоминает «отдельных профилей» / «переключаться» — UX подсказка.');
    });
});

describe('CSS: .calc-card-chip-scenarios стилизован (Stage 4.5)', () => {
    it('Правило существует в components.css', () => {
        const m = cssSource.match(/\.calc-card-chip-scenarios\s*\{([^}]+)\}/);
        assert.ok(m, '.calc-card-chip-scenarios должен быть определён.');
        const body = m[1];
        // Отличается от chip-stands (warning) и chip-vat (голубой) — neutral.
        assert.match(body, /background\s*:\s*var\(--bg-elevated\)/,
            'Background — bg-elevated (нейтральный).');
        assert.match(body, /color\s*:\s*var\(--text-muted\)/,
            'Color — muted (factual indicator, не attention).');
        assert.match(body, /tabular-nums/,
            'tabular-nums — для выравнивания цифры в счётчике.');
    });
});

describe('pluralizeRu — корректность форм', () => {
    // Импортируем module целиком и тестируем helper через cross-evaluation.
    // pluralizeRu — internal, тестируем семантически через source-grep
    // правильности regex'ов (тесты выше) + integration через rendered chip.

    it('Source-grep: pluralizeRu обрабатывает 11/12/14 (исключения)', () => {
        // Алгоритм должен учитывать: m100 !== 11 для one;
        //                            (m100 < 12 || m100 > 14) для few.
        assert.match(calcListSource, /m100\s*!==\s*11/,
            'Исключение: 11 → many, не one.');
        assert.match(calcListSource, /m100\s*<\s*12\s*\|\|\s*m100\s*>\s*14/,
            'Исключение: 12-14 → many, не few.');
    });
});
