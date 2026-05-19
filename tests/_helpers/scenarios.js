/**
 * Sprint 3.0 Stage 1: helper для тестов, которые создают calc-объект руками.
 *
 * Многие существующие тесты конструируют calc через спред root-полей
 * (`{ wizard, answers, answersMeta, settings, ... }`). Sprint 3.0 ввёл
 * `calc.scenarios[]` и `calc.activeScenarioId` — без них migration-pattern
 * checks и persist могут падать.
 *
 * `wrapInScenarios(calc)` принимает legacy-shape calc и добавляет:
 *   - scenarios[0] из текущих root.wizard/answers/answersMeta;
 *   - activeScenarioId = id первого scenario.
 *
 * Если scenarios уже есть — no-op (идемпотентно, как и сама миграция).
 *
 * Этот файл лежит в _helpers/, тестовый runner его не подбирает (runs.js
 * фильтрует по *.test.js).
 */

import { uuid } from '../../js/utils/uuid.js';

export function wrapInScenarios(calc, label = 'Базовый') {
    if (!calc || typeof calc !== 'object') return calc;
    if (Array.isArray(calc.scenarios) && calc.scenarios.length > 0) {
        if (!calc.activeScenarioId || !calc.scenarios.find(s => s.id === calc.activeScenarioId)) {
            return { ...calc, activeScenarioId: calc.scenarios[0].id };
        }
        return calc;
    }
    const scenarioId = uuid();
    return {
        ...calc,
        scenarios: [{
            id: scenarioId,
            label,
            wizard: calc.wizard !== undefined ? calc.wizard : null,
            answers: { ...(calc.answers || {}) },
            answersMeta: { ...(calc.answersMeta || {}) }
        }],
        activeScenarioId: scenarioId
    };
}
