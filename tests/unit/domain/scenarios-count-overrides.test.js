/**
 * Sprint 4 Stage 4.5: helper countManualOverridesInScenario(scenario) —
 * считает поля, помеченные source='manual' в answersMeta. Используется
 * scenario-tab indicator'ом (точка + tooltip).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countManualOverridesInScenario } from '../../../js/domain/scenarios.js';

describe('countManualOverridesInScenario (Sprint 4 Stage 4.5)', () => {
    it('null/undefined scenario → 0', () => {
        assert.equal(countManualOverridesInScenario(null), 0);
        assert.equal(countManualOverridesInScenario(undefined), 0);
    });

    it('Scenario без answersMeta → 0', () => {
        assert.equal(countManualOverridesInScenario({ id: 's1', label: 'X' }), 0);
        assert.equal(countManualOverridesInScenario({ answersMeta: null }), 0);
    });

    it('Scenario с пустым answersMeta → 0', () => {
        assert.equal(countManualOverridesInScenario({ answersMeta: {} }), 0);
    });

    it('Считает только source=manual, игнорирует ai_default/profile/scale', () => {
        const meta = {
            q1: { source: 'manual' },
            q2: { source: 'ai_default' },
            q3: { source: 'profile' },
            q4: { source: 'scale' },
            q5: { source: 'manual' },
            q6: { source: 'derived' }
        };
        assert.equal(countManualOverridesInScenario({ answersMeta: meta }), 2);
    });

    it('Игнорирует ключи без source-поля или с пустым source', () => {
        const meta = {
            q1: { source: 'manual' },
            q2: {},
            q3: null,
            q4: { source: '' },
            q5: { source: 'manual' }
        };
        assert.equal(countManualOverridesInScenario({ answersMeta: meta }), 2);
    });

    it('Все manual — count = N', () => {
        const meta = {};
        for (let i = 0; i < 10; i++) meta[`q${i}`] = { source: 'manual' };
        assert.equal(countManualOverridesInScenario({ answersMeta: meta }), 10);
    });

    it('Работает с legacy-virtual scenario (виртуальный объект из getActiveScenario)', () => {
        const virtual = {
            id: 'legacy-virtual',
            label: 'Базовый',
            answers: { q1: 5 },
            answersMeta: { q1: { source: 'manual' } }
        };
        assert.equal(countManualOverridesInScenario(virtual), 1);
    });
});
