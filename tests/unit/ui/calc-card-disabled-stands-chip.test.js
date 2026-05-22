/**
 * Stage 4.2: чип «Исключено: STAND…» в карточке расчёта на вкладке «Расчёты».
 *
 * Контракт:
 *   1. controllers/calcListController.js обогащает meta полем `disabledStands`
 *      из `calc.view.disabledStands` — иначе UI-карточка нечем рендерить чип.
 *   2. ui/calcList.js рендерит чип `.calc-card-chip-stands` ТОЛЬКО когда есть
 *      хотя бы один отключённый стенд.
 *   3. Формат: 1 имя — «Исключено: <STAND>»; 2 имени — «Исключено: <S1>, <S2>»;
 *      3+ — «Исключено: <S1>, <S2> +<rest>».
 *   4. css/components.css содержит правило `.calc-card-chip-stands` со стилем
 *      outline-only amber (отличается от .calc-card-chip-warn = заливка amber).
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

describe('Карточка расчёта: чип «Исключено: STAND…» (Stage 4.2)', () => {
    it('controllers/calcListController.js обогащает meta полем disabledStands', () => {
        assert.match(ctrlSource, /disabledStands/,
            'refreshCalcList должен класть calc.view.disabledStands в meta — иначе ' +
            'UI не сможет показать чип «Исключено: …» без полной загрузки calc.');
        assert.match(ctrlSource, /migrated\.view\?\.disabledStands|migrated\.view\.disabledStands/,
            'Источник массива — calc.view.disabledStands у мигрированного calc.');
    });

    it('ui/calcList.js рендерит чип с классом calc-card-chip-stands', () => {
        assert.match(calcListSource, /['"]calc-card-chip\s+calc-card-chip-stands['"]/,
            'В renderCalcCard должен быть .calc-card-chip-stands — иначе CSS-правило ' +
            'некому применять.');
    });

    it('Формат текста чипа: префикс «Исключено: »', () => {
        assert.match(calcListSource, /Исключено:\s*\$\{/,
            'Чип должен начинаться с «Исключено: » + список имён стендов.');
    });

    it('Формат: при >2 стендах добавляется «+N»', () => {
        // Шаблон: `Исключено: ${head} +${rest}` — два literal'а: «Исключено: » и « +»
        assert.match(calcListSource, /\+\$\{rest\}/,
            'При 3+ отключённых стендах должен выводиться «+N» — короткий формат, ' +
            'не разрывает chip-row на маленьких viewport.');
    });

    it('Чип НЕ рендерится при пустом массиве disabledStands', () => {
        // Проверяем guard: chip должен быть условным — проверяем что в renderCalcCard
        // есть условный рендер с пустой строкой как «нет чипа».
        assert.match(calcListSource, /disabledChipText\s*\?\s*el\(/,
            'Чип должен идти через условный рендер: пустая строка → null/нет чипа.');
    });

    it('STAND_LABELS импортирован для перевода id → русские имена', () => {
        assert.match(calcListSource, /import\s*\{[^}]*STAND_LABELS[^}]*\}\s*from\s*['"]\.\.\/utils\/constants\.js['"]/,
            'Чип использует STAND_LABELS, чтобы PROD читался как «ПРОМ», IFT как «ИФТ» — ' +
            'правило проекта: UI на русском.');
    });

    it('CSS-правило .calc-card-chip-stands существует в components.css', () => {
        const m = cssSource.match(/\.calc-card-chip-stands\s*\{([^}]+)\}/);
        assert.ok(m, '.calc-card-chip-stands должен быть определён в css/components.css.');
        const body = m[1];
        assert.match(body, /color\s*:\s*var\(--warning\)/,
            '.calc-card-chip-stands использует --warning (amber) — семантически близок ' +
            'к chip-warn («Без рисков»).');
        // outline-only: bg = elevated (не --warning-faint), отличает от chip-warn.
        assert.match(body, /background\s*:\s*var\(--bg-elevated\)/,
            '.calc-card-chip-stands должен иметь --bg-elevated (а не --warning-faint), ' +
            'чтобы визуально отличаться от .calc-card-chip-warn.');
    });
});

describe('Stage 4.2: opacity disabled-стендов унифицирована до 0.4', () => {
    const detailsCss = readFileSync(join(ROOT, 'css', 'tables.css'), 'utf8');
    const componentsCss = readFileSync(join(ROOT, 'css', 'components.css'), 'utf8');
    const comparisonCss = readFileSync(join(ROOT, 'css', 'comparison.css'), 'utf8');

    it('.stand-disabled (Детали — колонка стенда) opacity = 0.4', () => {
        const m = componentsCss.match(/\.stand-disabled,\s*\n\s*td\.stand-disabled,\s*\n\s*th\.stand-disabled\s*\{([^}]+)\}/);
        assert.ok(m, '.stand-disabled / td.stand-disabled / th.stand-disabled должны быть определены');
        assert.match(m[1], /opacity\s*:\s*0\.4(?!\d)/,
            'opacity disabled-колонки должна быть 0.4 — унифицированно с дашбордом.');
    });

    it('.details-ai-cell-disabled opacity = 0.4', () => {
        const m = detailsCss.match(/\.details-ai-cell-disabled\s*\{([^}]+)\}/);
        assert.ok(m, '.details-ai-cell-disabled должна быть определена');
        assert.match(m[1], /opacity\s*:\s*0\.4(?!\d)/,
            'opacity AI-ячейки на disabled-стенде должна быть 0.4.');
    });

    it('.comparison-ai-cell-disabled opacity = 0.4', () => {
        const m = comparisonCss.match(/\.comparison-ai-cell-disabled\s*\{([^}]+)\}/);
        assert.ok(m, '.comparison-ai-cell-disabled должна быть определена');
        assert.match(m[1], /opacity\s*:\s*0\.4(?!\d)/,
            'opacity AI-ячейки в Сравнении на disabled-стенде должна быть 0.4.');
    });
});
