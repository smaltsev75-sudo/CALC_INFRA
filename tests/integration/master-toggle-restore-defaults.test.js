/**
 * Regression-тест к 13.U10: при включении boolean master-toggle
 * (`ai_agent_mode`, `ai_llm_used`, `rag_needed`, …) зависимые поля,
 * которые сейчас null/undefined (после прежнего каскадного сброса),
 * восстанавливаются из seed-defaultValue.
 *
 * Реальный кейс пользователя: ai_agent_mode = true в Опроснике, но
 * `agent_tool_use_share` и `agent_tool_avg_seconds` остались null
 * (сбросились когда master выключали). В формуле AGENT_CPU
 * `agentToolFactor = 0` → AGENT_CPU = 0 на всех стендах. Пользователь
 * видит «—» в дашборде, хотя «всё включено» в Опроснике.
 *
 * После 13.U10 fix включение master автовосстанавливает defaults для
 * пустых дочерних. Введённые пользователем значения не трогаются.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();
const { store } = await import('../../js/state/store.js');
const calcList = await import('../../js/controllers/calcListController.js');
const calcCtl  = await import('../../js/controllers/calcController.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
});

describe('Master-toggle: включение восстанавливает дефолты у пустых дочерних (13.U10)', () => {
    it('ai_agent_mode true → agent_tool_use_share / agent_tool_avg_seconds получают seed-defaults', () => {
        const c = calcList.createCalc('Test');
        // Включаем LLM (это master верхнего уровня для агентов).
        calcCtl.setAnswer('ai_llm_used', true);
        // Имитируем кейс пользователя: agent_* поля null (после прежнего сброса).
        store.updateActiveCalc({
            answers: {
                ...store.getState().activeCalc.answers,
                ai_agent_mode: false,
                agent_tool_use_share: null,
                agent_tool_avg_seconds: null
            }
        });
        // Включаем master агентов.
        calcCtl.setAnswer('ai_agent_mode', true);
        const a = store.getState().activeCalc.answers;
        // Зависимые поля должны автоматически получить seed-defaults
        // (50% и 3 секунды по seed.js на 2026-05-07).
        assert.ok(a.agent_tool_use_share != null,
            `agent_tool_use_share должен восстановиться, получено ${a.agent_tool_use_share}`);
        assert.equal(a.agent_tool_use_share, 50);
        assert.equal(a.agent_tool_avg_seconds, 3);
    });

    it('включение master НЕ перезаписывает уже введённые пользователем значения', () => {
        const c = calcList.createCalc('Test');
        calcCtl.setAnswer('ai_llm_used', true);
        store.updateActiveCalc({
            answers: {
                ...store.getState().activeCalc.answers,
                ai_agent_mode: false,
                agent_tool_use_share: 75,        // пользователь ввёл вручную
                agent_tool_avg_seconds: null     // это пусто — должно восстановиться
            }
        });
        calcCtl.setAnswer('ai_agent_mode', true);
        const a = store.getState().activeCalc.answers;
        assert.equal(a.agent_tool_use_share, 75,
            'введённое пользователем значение НЕ должно перезаписываться seed-default\'ом');
        assert.equal(a.agent_tool_avg_seconds, 3,
            'пустое поле должно восстановиться из seed');
    });

    it('каскадный сброс при ВЫКЛЮЧЕНИИ продолжает работать (12.U8)', () => {
        const c = calcList.createCalc('Test');
        calcCtl.setAnswer('ai_llm_used', true);
        calcCtl.setAnswer('ai_agent_mode', true);
        const before = store.getState().activeCalc.answers;
        assert.ok(before.agent_tool_use_share != null,
            'после включения master дефолт должен быть');
        // Выключаем — дочерние сбрасываются.
        calcCtl.setAnswer('ai_agent_mode', false);
        const after = store.getState().activeCalc.answers;
        assert.equal(after.agent_tool_use_share, null,
            'после выключения master дочерние должны быть null');
    });
});
