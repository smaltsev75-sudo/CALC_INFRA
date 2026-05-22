/**
 * Этап 13.U10-fix: миграция v10 → v11 — автовосстановление seed-defaults
 * для дочерних полей master-toggle ai_agent_mode, если master = true,
 * а дочерние null/undefined.
 *
 * Реальный кейс пользователя: ai_agent_mode когда-то был выключен → каскад
 * сбросил agent_tool_use_share, agent_tool_avg_seconds в null. Затем мастер
 * включили обратно — поля остались null. Формула AGENT_CPU давала 0 на
 * ВСЕХ стендах, в Сводке AI-метрик показывались «—».
 *
 * Миграция запускается автоматически при openCalc и приводит legacy-данные
 * к рабочему состоянию.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS } from '../../../js/state/migrations.js';

const v10to11 = MIGRATIONS.find(m => m.from === 10 && m.to === 11);

describe('Migration v10 → v11: restore seed-defaults у agent-полей при ai_agent_mode=true', () => {
    it('миграция v10→v11 зарегистрирована', () => {
        assert.ok(v10to11, 'миграция from:10 to:11 должна существовать');
    });

    it('null дочерних полей при ai_agent_mode=true → восстанавливаются дефолты', () => {
        const calc = {
            answers: {
                ai_agent_mode: true,
                agent_tool_use_share: null,
                agent_tool_avg_seconds: null,
                agent_complexity: null,
                ai_agent_type: null,
                agent_parallel_specialists: null
            }
        };
        v10to11.run(calc);
        assert.equal(calc.answers.agent_tool_use_share, 50);
        assert.equal(calc.answers.agent_tool_avg_seconds, 3);
        assert.equal(calc.answers.agent_complexity, 'medium');
        assert.equal(calc.answers.ai_agent_type, 'tool_use');
        assert.equal(calc.answers.agent_parallel_specialists, 3);
    });

    it('undefined дочерних полей → восстанавливаются дефолты', () => {
        const calc = { answers: { ai_agent_mode: true } };
        v10to11.run(calc);
        assert.equal(calc.answers.agent_tool_use_share, 50);
        assert.equal(calc.answers.agent_tool_avg_seconds, 3);
    });

    it('явно введённые пользователем значения (≠ null) НЕ перезаписываются', () => {
        const calc = {
            answers: {
                ai_agent_mode: true,
                agent_tool_use_share: 75,           // пользовательское значение
                agent_tool_avg_seconds: 5,          // пользовательское
                agent_complexity: 'complex'         // пользовательское
            }
        };
        v10to11.run(calc);
        assert.equal(calc.answers.agent_tool_use_share, 75);
        assert.equal(calc.answers.agent_tool_avg_seconds, 5);
        assert.equal(calc.answers.agent_complexity, 'complex');
    });

    it('ai_agent_mode=false → не трогает дочерние поля (no-op)', () => {
        const calc = {
            answers: {
                ai_agent_mode: false,
                agent_tool_use_share: null,
                agent_tool_avg_seconds: null
            }
        };
        v10to11.run(calc);
        assert.equal(calc.answers.agent_tool_use_share, null,
            'при выключенном master дочерние не восстанавливаются — это намеренно');
        assert.equal(calc.answers.agent_tool_avg_seconds, null);
    });

    it('идемпотентность: повторный прогон не меняет результат', () => {
        const calc = { answers: { ai_agent_mode: true } };
        v10to11.run(calc);
        const after1 = JSON.stringify(calc);
        v10to11.run(calc);
        const after2 = JSON.stringify(calc);
        assert.equal(after1, after2, 'миграция должна быть идемпотентной');
    });
});
