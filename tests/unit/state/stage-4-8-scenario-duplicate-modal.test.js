/**
 * Sprint 4 Stage 4.8: модалка «Дублировать сценарий» с пользовательским label.
 *
 * Покрытие:
 *   1. domain duplicateScenario(calc, sourceId, customLabel) — корректно
 *      использует customLabel или fallback на default «X (копия)».
 *   2. UI-side wiring (source-grep): scenarioDuplicateModal.js существует,
 *      зарегистрирован в MODAL_ORDER + MODAL_RENDERERS, ctx.openScenarioDuplicate
 *      добавлен в app.js, scenarioMenuModal вызывает openScenarioDuplicate
 *      вместо прямого duplicateScenario.
 *   3. store.modals.scenarioDuplicate slot — { open: false, scenarioId: null,
 *      draft: '' }.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { duplicateScenario } from '../../../js/domain/scenarios.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MENU_SRC      = read('js/ui/modals/scenarioMenuModal.js');
const DUPLICATE_SRC = read('js/ui/modals/scenarioDuplicateModal.js');
const APP_SRC       = read('js/app.js');
const INDEX_SRC     = read('js/ui/index.js');
const STORE_SRC     = read('js/state/store.js');

function makeCalcWithOneScenario(label) {
    return {
        id: 'c1',
        scenarios: [{
            id: 's1',
            label,
            wizard: { industry: 'edtech', scale: 'small' },
            answers: { dau: 1000 },
            answersMeta: { dau: { source: 'manual' } }
        }],
        activeScenarioId: 's1'
    };
}

describe('Stage 4.8 / domain duplicateScenario(customLabel)', () => {
    it('customLabel = непустая строка → копия получает это имя', () => {
        const calc = makeCalcWithOneScenario('Базовый');
        const { scenario } = duplicateScenario(calc, 's1', 'С GPU');
        assert.equal(scenario.label, 'С GPU');
    });

    it('customLabel = null → fallback на «X (копия)»', () => {
        const calc = makeCalcWithOneScenario('Базовый');
        const { scenario } = duplicateScenario(calc, 's1', null);
        assert.equal(scenario.label, 'Базовый (копия)');
    });

    it('customLabel = пустая строка → fallback на default', () => {
        const calc = makeCalcWithOneScenario('Базовый');
        const { scenario } = duplicateScenario(calc, 's1', '');
        assert.equal(scenario.label, 'Базовый (копия)');
    });

    it('customLabel = строка из пробелов → trim → fallback на default', () => {
        // Защита от пустого submit'а в UI: пользователь стёр имя или ввёл
        // только пробелы; должны fallback'нуться на безопасный default,
        // не создать сценарий с label из пробелов.
        const calc = makeCalcWithOneScenario('Базовый');
        const { scenario } = duplicateScenario(calc, 's1', '   ');
        assert.equal(scenario.label, 'Базовый (копия)');
    });

    it('customLabel обрезается по краям (внутренние пробелы сохраняются)', () => {
        const calc = makeCalcWithOneScenario('Базовый');
        const { scenario } = duplicateScenario(calc, 's1', '  Сценарий заказчика  ');
        assert.equal(scenario.label, 'Сценарий заказчика');
    });

    it('answers и answersMeta копируются при custom label', () => {
        const calc = makeCalcWithOneScenario('Базовый');
        const { scenario } = duplicateScenario(calc, 's1', 'С GPU');
        assert.deepEqual(scenario.answers, { dau: 1000 });
        assert.deepEqual(scenario.answersMeta, { dau: { source: 'manual' } });
    });

    it('id новой копии отличается от исходного (uuid)', () => {
        const calc = makeCalcWithOneScenario('Базовый');
        const { scenario } = duplicateScenario(calc, 's1', 'С GPU');
        assert.notEqual(scenario.id, 's1');
        assert.ok(typeof scenario.id === 'string' && scenario.id.length > 0);
    });
});

describe('Stage 4.8 / store.modals.scenarioDuplicate', () => {
    it('store содержит slot scenarioDuplicate с правильной структурой', () => {
        assert.match(STORE_SRC, /scenarioDuplicate:\s*\{\s*open:\s*false,\s*scenarioId:\s*null,\s*draft:\s*''\s*\}/,
            'state.modals.scenarioDuplicate должен быть зарегистрирован с дефолтами');
    });
});

describe('Stage 4.8 / scenarioDuplicateModal.js wiring', () => {
    it('scenarioDuplicateModal экспортирует render-функцию', () => {
        assert.match(DUPLICATE_SRC, /export\s+function\s+renderScenarioDuplicateModal\s*\(/);
    });

    it('модалка читает state.modals.scenarioDuplicate', () => {
        assert.match(DUPLICATE_SRC, /state\.modals\.scenarioDuplicate/);
    });

    it('модалка вызывает ctx.duplicateScenario(sourceId, customLabel)', () => {
        // Проверяем именно 2-аргументный вызов — без второго параметра модалка
        // не сможет передать пользовательское имя.
        assert.match(DUPLICATE_SRC, /ctx\.duplicateScenario\s*\(\s*[a-zA-Z.]+(?:\.id)?\s*,/,
            'модалка должна передавать customLabel вторым аргументом');
    });

    it('модалка прелоадит default «<label> (копия)» при пустом draft', () => {
        assert.match(DUPLICATE_SRC, /\$\{[a-zA-Z.]+\.label\}\s*\(копия\)/,
            'при первом открытии input должен содержать «<source.label> (копия)»');
    });

    it('Submit-кнопка имеет понятный label «Создать копию»', () => {
        assert.match(DUPLICATE_SRC, /Создать копию/);
    });

    it('hint объясняет, что копия унаследует ручные правки', () => {
        assert.match(DUPLICATE_SRC, /ручные правки|ваши правки/i);
    });
});

describe('Stage 4.8 / scenarioMenuModal: Duplicate открывает modal', () => {
    it('onDuplicate вызывает ctx.openScenarioDuplicate (не прямой duplicateScenario)', () => {
        assert.match(MENU_SRC, /openScenarioDuplicate\s*\(\s*scenario\.id\s*\)/,
            'Duplicate в меню должен открывать модалку, а не сразу копировать');
    });
});

describe('Stage 4.8 / app.js ctx + index.js MODAL_RENDERERS', () => {
    it('ctx.openScenarioDuplicate определён в app.js', () => {
        assert.match(APP_SRC, /openScenarioDuplicate\s*\(\s*scenarioId\s*\)\s*\{/);
    });

    it('ctx.duplicateScenario принимает customLabel вторым аргументом', () => {
        assert.match(APP_SRC, /duplicateScenario\s*\(\s*scenarioId\s*,\s*customLabel/);
    });

    it('MODAL_ORDER содержит scenarioDuplicate', () => {
        const orderMatch = INDEX_SRC.match(/const\s+MODAL_ORDER\s*=\s*\[([^\]]+)\]/);
        assert.ok(orderMatch, 'MODAL_ORDER должен быть найден');
        assert.match(orderMatch[1], /'scenarioDuplicate'/);
    });

    it('MODAL_RENDERERS включает renderScenarioDuplicateModal', () => {
        assert.match(INDEX_SRC, /\['scenarioDuplicate'\s*,\s*renderScenarioDuplicateModal\]/);
    });

    it('renderScenarioDuplicateModal импортируется в index.js', () => {
        assert.match(INDEX_SRC, /import\s*\{\s*renderScenarioDuplicateModal\s*\}\s*from\s*['"]\.\/modals\/scenarioDuplicateModal\.js['"]/);
    });
});
