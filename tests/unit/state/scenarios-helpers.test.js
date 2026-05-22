/**
 * Sprint 3.0 Stage 1: тесты helper-ов в js/state/scenarios.js.
 *
 * Покрывают:
 *   - buildScenarioFromRoot: клонирует root-поля, выдаёт уникальный id
 *   - getActiveScenario: находит по id, fallback на scenarios[0], null для legacy
 *   - syncActiveScenarioFromRoot: пишет root → scenarios[active]
 *   - syncRootFromActiveScenario: пишет scenarios[active] → root
 *   - addScenario: добавляет с пустым answers, не активирует автоматически
 *   - duplicateScenario: клонирует source, новый id, label с «(копия)»
 *   - deleteScenario: блокирует удаление последнего; переключает активный при удалении активного
 *   - renameScenario: правит label
 *   - switchScenario: меняет activeScenarioId + зеркалит root
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildScenarioFromRoot,
    getActiveScenario,
    syncActiveScenarioFromRoot,
    syncRootFromActiveScenario,
    addScenario,
    duplicateScenario,
    deleteScenario,
    renameScenario,
    switchScenario,
    DEFAULT_SCENARIO_LABEL
} from '../../../js/domain/scenarios.js';

function makeCalc(scenarios, activeId, root = {}) {
    return {
        id: 'c1',
        name: 'Test',
        scenarios,
        activeScenarioId: activeId,
        wizard: root.wizard ?? null,
        answers: root.answers ?? {},
        answersMeta: root.answersMeta ?? {},
        settings: { provider: 'sbercloud' },
        view: { disabledStands: [] }
    };
}

describe('buildScenarioFromRoot', () => {
    it('клонирует wizard/answers/answersMeta из root', () => {
        const calc = { wizard: { product_type: 'B2B' }, answers: { x: 1 }, answersMeta: { x: { source: 'manual' } } };
        const s = buildScenarioFromRoot(calc);
        assert.deepEqual(s.wizard, { product_type: 'B2B' });
        assert.deepEqual(s.answers, { x: 1 });
        assert.deepEqual(s.answersMeta, { x: { source: 'manual' } });
        assert.notEqual(s.answers, calc.answers, 'клон, не та же ссылка');
    });

    it('генерирует уникальный uuid для id', () => {
        const a = buildScenarioFromRoot({});
        const b = buildScenarioFromRoot({});
        assert.notEqual(a.id, b.id);
        assert.ok(typeof a.id === 'string' && a.id.length > 0);
    });

    it('label по умолчанию — DEFAULT_SCENARIO_LABEL', () => {
        const s = buildScenarioFromRoot({});
        assert.equal(s.label, DEFAULT_SCENARIO_LABEL);
    });

    it('явные id и label принимаются', () => {
        const s = buildScenarioFromRoot({}, { id: 'fixed', label: 'My' });
        assert.equal(s.id, 'fixed');
        assert.equal(s.label, 'My');
    });
});

describe('getActiveScenario', () => {
    it('находит scenario по activeScenarioId', () => {
        const calc = makeCalc([{ id: 'a' }, { id: 'b' }], 'b');
        assert.equal(getActiveScenario(calc).id, 'b');
    });

    it('fallback на scenarios[0] если activeScenarioId не найден', () => {
        const calc = makeCalc([{ id: 'a' }, { id: 'b' }], 'no-such');
        assert.equal(getActiveScenario(calc).id, 'a');
    });

    it('null для calc=null/undefined', () => {
        assert.equal(getActiveScenario(null), null);
        assert.equal(getActiveScenario(undefined), null);
    });

    it('Stage 2 legacy fallback: calc БЕЗ scenarios → виртуальный scenario из root', () => {
        const legacy = {
            id: 'x',
            wizard: { product_type: 'B2B', industry: 'IT' },
            answers: { peak_rps: 100 },
            answersMeta: { peak_rps: { source: 'manual' } }
        };
        const v = getActiveScenario(legacy);
        assert.ok(v, 'legacy calc → возвращается виртуальный, не null');
        assert.equal(v.id, 'legacy-virtual');
        assert.deepEqual(v.wizard, legacy.wizard);
        assert.deepEqual(v.answers, legacy.answers);
        assert.deepEqual(v.answersMeta, legacy.answersMeta);
        assert.equal(v.label, 'Базовый');
    });

    it('Stage 2 legacy fallback: calc с пустыми scenarios → тоже виртуальный', () => {
        const calc = { scenarios: [], wizard: null, answers: {}, answersMeta: {} };
        const v = getActiveScenario(calc);
        assert.equal(v.id, 'legacy-virtual');
    });
});

describe('syncActiveScenarioFromRoot', () => {
    it('пишет root.answers → scenarios[active].answers', () => {
        const calc = makeCalc(
            [{ id: 'a', answers: { x: 0 } }, { id: 'b', answers: { x: 99 } }],
            'a',
            { answers: { x: 1, y: 2 } }
        );
        const next = syncActiveScenarioFromRoot(calc);
        const aScenario = next.scenarios.find(s => s.id === 'a');
        assert.deepEqual(aScenario.answers, { x: 1, y: 2 });
        // Неактивный scenario не трогается
        const bScenario = next.scenarios.find(s => s.id === 'b');
        assert.deepEqual(bScenario.answers, { x: 99 });
    });

    it('пишет root.wizard → scenarios[active].wizard', () => {
        const calc = makeCalc(
            [{ id: 'a', wizard: null, answers: {}, answersMeta: {} }],
            'a',
            { wizard: { industry: 'IT' } }
        );
        const next = syncActiveScenarioFromRoot(calc);
        assert.deepEqual(next.scenarios[0].wizard, { industry: 'IT' });
    });

    it('no-op если scenarios отсутствует', () => {
        const calc = { id: 'x', wizard: { y: 1 }, answers: { z: 2 } };
        const next = syncActiveScenarioFromRoot(calc);
        assert.equal(next, calc, 'тот же объект-ссылка');
    });

    it('no-op если activeScenarioId отсутствует', () => {
        const calc = { scenarios: [{ id: 'a' }], wizard: null, answers: {} };
        const next = syncActiveScenarioFromRoot(calc);
        assert.equal(next, calc);
    });
});

describe('syncRootFromActiveScenario', () => {
    it('пишет scenarios[active].answers → root.answers', () => {
        const calc = makeCalc(
            [{ id: 'a', answers: { fromScenario: true }, wizard: { ind: 'X' }, answersMeta: { z: { source: 'profile' } } }],
            'a',
            { answers: { stale: true }, wizard: null, answersMeta: {} }
        );
        const next = syncRootFromActiveScenario(calc);
        assert.deepEqual(next.answers, { fromScenario: true });
        assert.deepEqual(next.wizard, { ind: 'X' });
        assert.deepEqual(next.answersMeta, { z: { source: 'profile' } });
    });

    it('no-op если scenarios отсутствует', () => {
        const calc = { id: 'x', answers: { y: 1 } };
        const next = syncRootFromActiveScenario(calc);
        assert.equal(next, calc);
    });
});

describe('addScenario', () => {
    it('добавляет scenario с пустым answers, не меняет активный', () => {
        const calc = makeCalc([{ id: 'a', answers: { x: 1 }, label: 'First' }], 'a');
        const { calc: next, scenario } = addScenario(calc, 'New');
        assert.equal(next.scenarios.length, 2);
        assert.equal(next.activeScenarioId, 'a', 'активный не меняется в helper-е');
        assert.equal(scenario.label, 'New');
        assert.deepEqual(scenario.answers, {});
        assert.equal(scenario.wizard, null,
            'calc.wizard null → новый scenario.wizard null (legacy parity)');
    });

    it('label по умолчанию — «Сценарий N+1»', () => {
        const calc = makeCalc([{ id: 'a' }], 'a');
        const { scenario } = addScenario(calc);
        assert.equal(scenario.label, 'Сценарий 2');
    });

    /* Stage 18.2 (v2.13.1): новый сценарий через `+ Сценарий` наследует
       wizard от активного. Раньше всегда null — это ломало UX (исчезала
       кнопка «Изменить параметры» на дашборде при switch). */
    it('Stage 18.2: наследует wizard от активного calc, если он есть', () => {
        const calc = makeCalc(
            [{ id: 'a', label: 'Base' }],
            'a',
            { wizard: { product_type: 'b2c', industry: 'fintech', scale: 'mvp' } }
        );
        const { scenario } = addScenario(calc, 'New');
        assert.deepEqual(scenario.wizard,
            { product_type: 'b2c', industry: 'fintech', scale: 'mvp' });
    });

    it('Stage 18.2: наследует ответы НЕ копирует (только wizard)', () => {
        const calc = makeCalc(
            [{ id: 'a', answers: { x: 1 } }],
            'a',
            { wizard: { product_type: 'b2b' }, answers: { x: 1 }, answersMeta: { x: { source: 'manual' } } }
        );
        const { scenario } = addScenario(calc, 'New');
        assert.deepEqual(scenario.answers, {}, 'answers пусты');
        assert.deepEqual(scenario.answersMeta, {}, 'answersMeta пусты');
        assert.ok(scenario.wizard, 'wizard унаследован');
    });

    it('Stage 18.2: wizard клонируется deep (не shared reference)', () => {
        const wizard = { product_type: 'b2c', industry: 'saas', nested: { ai: true } };
        const calc = makeCalc([{ id: 'a' }], 'a', { wizard });
        const { scenario } = addScenario(calc, 'New');
        assert.notEqual(scenario.wizard, wizard, 'не same reference');
        assert.notEqual(scenario.wizard.nested, wizard.nested, 'nested тоже клонирован');
        /* Мутация нового scenario.wizard не должна задеть исходный. */
        scenario.wizard.industry = 'changed';
        scenario.wizard.nested.ai = false;
        assert.equal(wizard.industry, 'saas');
        assert.equal(wizard.nested.ai, true);
    });

    it('Stage 18.2: calc без wizard → новый scenario.wizard остаётся null', () => {
        const calc = makeCalc([{ id: 'a' }], 'a', { wizard: null });
        const { scenario } = addScenario(calc, 'New');
        assert.equal(scenario.wizard, null);
    });
});

/* Stage 18.2 — regression: duplicateScenario продолжает копировать ВСЁ
   (wizard + answers + answersMeta), чтобы различие «Add vs Duplicate» оставалось
   осмысленным: Add копирует только wizard, Duplicate копирует и состояние. */
describe('duplicateScenario — regression Stage 18.2', () => {
    it('копирует wizard + answers + answersMeta source-сценария', () => {
        const calc = makeCalc(
            [{
                id: 'src',
                label: 'Source',
                wizard: { product_type: 'b2c', industry: 'fintech' },
                answers: { peak_rps: 500, ai_llm_used: true },
                answersMeta: { peak_rps: { source: 'manual' } }
            }],
            'src'
        );
        const { scenario } = duplicateScenario(calc, 'src');
        assert.deepEqual(scenario.wizard, { product_type: 'b2c', industry: 'fintech' });
        assert.deepEqual(scenario.answers, { peak_rps: 500, ai_llm_used: true });
        assert.deepEqual(scenario.answersMeta, { peak_rps: { source: 'manual' } });
    });
});

describe('duplicateScenario', () => {
    it('клонирует source с новым id и label «(копия)»', () => {
        const calc = makeCalc(
            [{ id: 'a', label: 'Base', wizard: { y: 1 }, answers: { x: 5 }, answersMeta: { x: { source: 'manual' } } }],
            'a'
        );
        const { calc: next, scenario } = duplicateScenario(calc, 'a');
        assert.equal(next.scenarios.length, 2);
        assert.equal(scenario.label, 'Base (копия)');
        assert.deepEqual(scenario.answers, { x: 5 });
        assert.deepEqual(scenario.wizard, { y: 1 });
        assert.notEqual(scenario.id, 'a');
    });

    it('если sourceId не найден — клонирует активный', () => {
        const calc = makeCalc(
            [{ id: 'a', label: 'A', answers: { x: 1 } }, { id: 'b', label: 'B', answers: { y: 2 } }],
            'b'
        );
        const { scenario } = duplicateScenario(calc, 'no-such');
        assert.deepEqual(scenario.answers, { y: 2 }, 'клонирован активный (b)');
    });

    it('если scenarios пуст — null', () => {
        const calc = { scenarios: [], activeScenarioId: null };
        const { scenario } = duplicateScenario(calc, 'a');
        assert.equal(scenario, null);
    });
});

describe('deleteScenario', () => {
    it('блокирует удаление последнего scenario', () => {
        const calc = makeCalc([{ id: 'a' }], 'a');
        const { removed } = deleteScenario(calc, 'a');
        assert.equal(removed, false);
    });

    it('удаляет non-active scenario без переключения активного', () => {
        const calc = makeCalc([{ id: 'a' }, { id: 'b' }], 'a');
        const { calc: next, removed, newActiveId } = deleteScenario(calc, 'b');
        assert.equal(removed, true);
        assert.equal(next.scenarios.length, 1);
        assert.equal(newActiveId, 'a', 'активный не меняется');
    });

    it('удаление активного → активным становится первый из оставшихся', () => {
        const calc = makeCalc([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'b');
        const { newActiveId } = deleteScenario(calc, 'b');
        assert.equal(newActiveId, 'a', 'переключаемся на первый оставшийся');
    });

    it('removed=false если scenarioId не найден', () => {
        const calc = makeCalc([{ id: 'a' }, { id: 'b' }], 'a');
        const { removed } = deleteScenario(calc, 'no-such');
        assert.equal(removed, false);
    });
});

describe('renameScenario', () => {
    it('правит label существующего scenario', () => {
        const calc = makeCalc([{ id: 'a', label: 'Old' }, { id: 'b', label: 'B' }], 'a');
        const next = renameScenario(calc, 'a', 'New');
        assert.equal(next.scenarios.find(s => s.id === 'a').label, 'New');
        assert.equal(next.scenarios.find(s => s.id === 'b').label, 'B', 'другой не трогается');
    });

    it('пустой label → no-op', () => {
        const calc = makeCalc([{ id: 'a', label: 'Old' }], 'a');
        const next = renameScenario(calc, 'a', '   ');
        assert.equal(next, calc);
    });

    it('обрезает label до 60 символов', () => {
        const calc = makeCalc([{ id: 'a', label: 'Old' }], 'a');
        const long = 'x'.repeat(100);
        const next = renameScenario(calc, 'a', long);
        assert.equal(next.scenarios[0].label.length, 60);
    });

    it('scenarioId не найден → no-op', () => {
        const calc = makeCalc([{ id: 'a' }], 'a');
        const next = renameScenario(calc, 'no-such', 'Whatever');
        assert.equal(next, calc);
    });
});

describe('switchScenario', () => {
    it('меняет activeScenarioId + зеркалит root', () => {
        const calc = makeCalc(
            [
                { id: 'a', label: 'A', wizard: { x: 'A' }, answers: { ans: 1 }, answersMeta: {} },
                { id: 'b', label: 'B', wizard: { x: 'B' }, answers: { ans: 2 }, answersMeta: { ans: { source: 'manual' } } }
            ],
            'a',
            { wizard: { x: 'A' }, answers: { ans: 1 }, answersMeta: {} }
        );
        const next = switchScenario(calc, 'b');
        assert.equal(next.activeScenarioId, 'b');
        assert.deepEqual(next.answers, { ans: 2 }, 'root зеркалит scenarios[b]');
        assert.deepEqual(next.wizard, { x: 'B' });
        assert.deepEqual(next.answersMeta, { ans: { source: 'manual' } });
    });

    it('переключение на тот же activeScenarioId — no-op', () => {
        const calc = makeCalc([{ id: 'a' }], 'a');
        const next = switchScenario(calc, 'a');
        assert.equal(next, calc);
    });

    it('scenarioId не найден — no-op', () => {
        const calc = makeCalc([{ id: 'a' }, { id: 'b' }], 'a');
        const next = switchScenario(calc, 'no-such');
        assert.equal(next, calc);
    });
});
