/**
 * Sprint 3.0 Stage 1+2: pure-helper'ы для multi-profile сценариев.
 *
 * Расположение в domain/: модуль состоит ТОЛЬКО из чистых функций над calc-
 * объектом (shape вычисления + immutable transforms), нет зависимости от store.
 * UI и controllers равноправно его импортируют. Layer-линтер (tests/unit/
 * architecture/layer-imports.test.js) разрешает domain ← любые слои.
 *
 * Архитектура (см. DECISIONS.md «Sprint 3.0 / Stage 1»):
 *
 *   calc.scenarios: Scenario[]            — массив профилей одного расчёта
 *   calc.activeScenarioId: string         — id активного scenario
 *   Mirror на root:                        — read-зеркало для существующих consumer'ов
 *     calc.wizard       = scenarios[active].wizard
 *     calc.answers      = scenarios[active].answers
 *     calc.answersMeta  = scenarios[active].answersMeta
 *
 *   type Scenario = {
 *     id:          string;                  // uuid, уникальный в пределах calc
 *     label:       string;                  // пользовательская метка (для tab-switcher)
 *     wizard:      WizardProfile | null;
 *     answers:     { [questionId]: any };
 *     answersMeta: { [questionId]: { source } };
 *   };
 *
 *   Глобально на calc (НЕ переезжает в scenario): id, name, settings (provider/
 *   vat/risks), view (disabledStands), dictionaries, schemaVersion.
 *
 * Mirror-инвариант:
 *
 *   После любого писательского действия (setAnswer, resetAnswers, reapply, ...)
 *   commit() в calcController.js вызывает syncActiveScenarioFromRoot — root
 *   снимок переливается в scenarios[active]. После switchScenario вызывается
 *   syncRootFromActiveScenario — обратное направление.
 *
 *   Calculator (domain/calculator.js) и UI читают ТОЛЬКО root, scenarios для
 *   них прозрачен. Mirror гарантирует, что персист содержит обе версии — даже
 *   если calc.scenarios отсутствует (legacy расчёт без миграции в эту сессию),
 *   код продолжает работать через root.
 */

import { uuid } from '../utils/uuid.js';

/**
 * Лейбл по умолчанию для первого scenario при миграции legacy-расчёта.
 * Используется в migration v14→v15 и в makeNewCalculation для нового calc.
 */
export const DEFAULT_SCENARIO_LABEL = 'Базовый';

/**
 * Создать scenario-объект из текущего root-состояния calc.
 * Используется при создании нового calc и при добавлении/дублировании сценария.
 *
 * @param {object} calc          расчёт (с root.wizard / answers / answersMeta)
 * @param {object} [opts]
 * @param {string} [opts.id]     явный id (если undefined — uuid())
 * @param {string} [opts.label]  лейбл (если undefined — DEFAULT_SCENARIO_LABEL)
 */
export function buildScenarioFromRoot(calc, { id, label } = {}) {
    return {
        id: id || uuid(),
        label: label || DEFAULT_SCENARIO_LABEL,
        wizard: calc?.wizard !== undefined ? calc.wizard : null,
        answers: { ...(calc?.answers || {}) },
        answersMeta: { ...(calc?.answersMeta || {}) }
    };
}

/**
 * Лейбл для виртуального scenario, который мы синтезируем для legacy-calc'ов
 * (без scenarios[]). UI отображает его как единственную вкладку tab-switcher'а.
 */
const LEGACY_VIRTUAL_LABEL = 'Базовый';

/**
 * Найти активный scenario.
 *
 * Поведение:
 *   - Calc с scenarios + activeScenarioId — возвращает соответствующий объект.
 *   - Calc с scenarios но без / с невалидным activeScenarioId — fallback на
 *     scenarios[0].
 *   - Calc БЕЗ scenarios (legacy, до миграции v14→v15 в активном store) —
 *     возвращает ВИРТУАЛЬНЫЙ scenario из root-полей. Это позволяет UI Stage 2
 *     (tab-switcher, banner и пр.) безопасно вызывать getActiveScenario без
 *     guard-checks. Виртуальный scenario имеет id='legacy-virtual' (не uuid —
 *     namespace отделяет от настоящих, чтобы CRUD не пытался по нему ничего).
 *   - calc=null/undefined — null.
 *
 * Виртуальный scenario НЕ персистится — это селекторная утилита. Когда calc
 * следующий раз пройдёт миграцию (на boot из localStorage или при импорте) —
 * scenarios[0] появится естественно через migrateCalculation.
 */
export function getActiveScenario(calc) {
    if (!calc) return null;
    if (Array.isArray(calc.scenarios) && calc.scenarios.length > 0) {
        if (calc.activeScenarioId) {
            const found = calc.scenarios.find(s => s && s.id === calc.activeScenarioId);
            if (found) return found;
        }
        return calc.scenarios[0] || null;
    }
    /* Legacy fallback: виртуальный scenario из root-полей. UI безопасно
       читает label/wizard/answers через getActiveScenario, не зная что
       calc на самом деле ещё не мигрирован. */
    return {
        id: 'legacy-virtual',
        label: LEGACY_VIRTUAL_LABEL,
        wizard: calc.wizard !== undefined ? calc.wizard : null,
        answers: calc.answers || {},
        answersMeta: calc.answersMeta || {}
    };
}

/**
 * Получить scenarios массив для UI. Для legacy-calc'ов возвращает один
 * виртуальный scenario, чтобы tab-switcher безопасно мапился по нему как
 * по одной вкладке.
 */
export function getScenariosForUI(calc) {
    if (!calc) return [];
    if (Array.isArray(calc.scenarios) && calc.scenarios.length > 0) {
        return calc.scenarios;
    }
    const virtual = getActiveScenario(calc);
    return virtual ? [virtual] : [];
}

/** id виртуального scenario для legacy-calc'ов. UI должен распознавать его и
    блокировать CRUD-действия (Add/Duplicate/Delete/Rename) до первой миграции. */
export const LEGACY_VIRTUAL_SCENARIO_ID = 'legacy-virtual';

/**
 * Зеркалить root → active scenario. Используется ПОСЛЕ любой writes в calcController:
 *   setAnswer, resetAnswers, reapplyProfile, ...
 *
 * Возвращает новый calc-объект (immutable). Если scenarios отсутствует или
 * activeScenarioId невалиден — возвращает исходный calc без изменений (no-op).
 *
 * НЕ зеркалит settings / view / dictionaries — они глобальны на calc.
 */
export function syncActiveScenarioFromRoot(calc) {
    if (!calc || !Array.isArray(calc.scenarios) || calc.scenarios.length === 0) return calc;
    const activeId = calc.activeScenarioId;
    if (!activeId) return calc;

    let touched = false;
    const nextScenarios = calc.scenarios.map(s => {
        if (!s || s.id !== activeId) return s;
        touched = true;
        return {
            ...s,
            wizard: calc.wizard !== undefined ? calc.wizard : s.wizard,
            answers: { ...(calc.answers || {}) },
            answersMeta: { ...(calc.answersMeta || {}) }
        };
    });
    if (!touched) return calc;
    return { ...calc, scenarios: nextScenarios };
}

/**
 * Зеркалить active scenario → root. Используется после switchScenario(newId)
 * — переключаем активный, потом подтягиваем root к нему, чтобы calculator
 * считал по новым ответам. Возвращает новый calc-объект.
 *
 * Legacy: для calc без scenarios — no-op (возвращает тот же объект).
 * Виртуальный scenario из getActiveScenario(legacy) семантически = root,
 * копировать root → root бессмысленно и сломало бы reference-equality для
 * подписчиков store, которые проверяют «изменился ли activeCalc?».
 */
export function syncRootFromActiveScenario(calc) {
    if (!calc) return calc;
    if (!Array.isArray(calc.scenarios) || calc.scenarios.length === 0) return calc;
    const active = getActiveScenario(calc);
    if (!active) return calc;
    return {
        ...calc,
        wizard: active.wizard !== undefined ? active.wizard : null,
        answers: { ...(active.answers || {}) },
        answersMeta: { ...(active.answersMeta || {}) }
    };
}

/**
 * Создать новый scenario (CRUD: Add). Возвращает { calc, scenario }.
 *
 * Stage 18.2 (v2.13.1): новый сценарий **наследует wizard** от активного
 * сценария — это вариант того же продукта, не новый продукт. Если пользователь
 * хочет другой продукт, он создаёт новый расчёт.
 *
 * Семантика «Add vs Duplicate»:
 *   + Сценарий        — копирует профиль продукта, ответы пустые.
 *   Дублировать       — копирует профиль продукта И ответы.
 *
 * Wizard клонируется deep (через JSON round-trip) — изменение wizard'а в одном
 * сценарии не должно протекать в другой через shared reference.
 *
 * @param {object} calc
 * @param {string} [label] лейбл нового scenario
 */
export function addScenario(calc, label) {
    const inheritedWizard = (calc?.wizard && typeof calc.wizard === 'object')
        ? JSON.parse(JSON.stringify(calc.wizard))
        : null;
    const scenario = {
        id: uuid(),
        label: (label && String(label).trim()) || `Сценарий ${(calc.scenarios?.length || 0) + 1}`,
        wizard: inheritedWizard,
        answers: {},
        answersMeta: {}
    };
    const scenarios = [...(calc.scenarios || []), scenario];
    return { calc: { ...calc, scenarios }, scenario };
}

/**
 * Дублировать scenario (CRUD: Duplicate). Если sourceId не найден — duplicate
 * активный. Возвращает { calc, scenario }. Новый scenario получает свежий id
 * и лейбл «<source.label> (копия)».
 *
 * Legacy guard: если calc.scenarios пуст или отсутствует — возвращаем null.
 * Bootstrap для legacy происходит в controller'е (_withSyncedRoot перед вызовом
 * сюда), а pure-helper остаётся предсказуемым: «нет scenarios — нет источника
 * для копирования».
 */
export function duplicateScenario(calc, sourceId, customLabel = null) {
    const scenarios = calc.scenarios || [];
    if (scenarios.length === 0) return { calc, scenario: null };
    const source = scenarios.find(s => s.id === sourceId)
        || (calc.activeScenarioId && scenarios.find(s => s.id === calc.activeScenarioId))
        || scenarios[0];
    if (!source) return { calc, scenario: null };
    /* Stage 4.8: customLabel передаётся из UI-модалки «Дублировать сценарий».
       Trim + проверка на непустую строку — иначе fallback на default «X (копия)».
       Это защищает domain от пустых submit'ов в case'е, если UI забудет валидацию. */
    const trimmedCustom = typeof customLabel === 'string' ? customLabel.trim() : '';
    const finalLabel = trimmedCustom.length > 0
        ? trimmedCustom
        : `${source.label} (копия)`;
    const scenario = {
        id: uuid(),
        label: finalLabel,
        wizard: source.wizard !== undefined ? source.wizard : null,
        answers: { ...(source.answers || {}) },
        answersMeta: { ...(source.answersMeta || {}) }
    };
    return { calc: { ...calc, scenarios: [...scenarios, scenario] }, scenario };
}

/**
 * Удалить scenario (CRUD: Delete). Защита: не даёт удалить последний scenario
 * (UI блокирует, но controller — defensive). Если удаляется активный — активным
 * становится первый из оставшихся. Возвращает { calc, removed: boolean,
 * newActiveId }.
 */
export function deleteScenario(calc, scenarioId) {
    const scenarios = calc.scenarios || [];
    if (scenarios.length <= 1) return { calc, removed: false, newActiveId: calc.activeScenarioId };
    const idx = scenarios.findIndex(s => s.id === scenarioId);
    if (idx === -1) return { calc, removed: false, newActiveId: calc.activeScenarioId };
    const next = scenarios.filter((_, i) => i !== idx);
    let newActiveId = calc.activeScenarioId;
    if (calc.activeScenarioId === scenarioId) {
        newActiveId = next[0].id;
    }
    return { calc: { ...calc, scenarios: next, activeScenarioId: newActiveId }, removed: true, newActiveId };
}

/**
 * Переименовать scenario (CRUD: Rename). Возвращает новый calc (или исходный
 * если scenarioId не найден).
 */
export function renameScenario(calc, scenarioId, newLabel) {
    const scenarios = calc.scenarios || [];
    if (!scenarios.some(s => s.id === scenarioId)) return calc;
    const trimmed = String(newLabel || '').trim();
    if (!trimmed) return calc;
    const next = scenarios.map(s =>
        s.id === scenarioId ? { ...s, label: trimmed.slice(0, 60) } : s
    );
    return { ...calc, scenarios: next };
}

/**
 * Подсчитать количество полей в scenario, помеченных как ручная правка
 * (`answersMeta[id].source === 'manual'`). Используется для индикатора-точки
 * на scenario-tab (Stage 4.5) — пользователь сразу видит, есть ли в сценарии
 * ручные правки и сколько.
 *
 * Для legacy-virtual scenario (без миграции v14→v15) тоже работает — он
 * содержит answersMeta из root.
 *
 * @param {object} scenario
 * @returns {number} 0+
 */
export function countManualOverridesInScenario(scenario) {
    if (!scenario || !scenario.answersMeta) return 0;
    let count = 0;
    for (const key in scenario.answersMeta) {
        if (scenario.answersMeta[key] && scenario.answersMeta[key].source === 'manual') {
            count++;
        }
    }
    return count;
}

/**
 * Переключить активный scenario (CRUD: Switch). Возвращает новый calc с
 * обновлёнными activeScenarioId + root mirror. Если scenarioId не найден или
 * совпадает с активным — calc не меняется.
 */
export function switchScenario(calc, scenarioId) {
    const scenarios = calc.scenarios || [];
    if (!scenarios.some(s => s.id === scenarioId)) return calc;
    if (calc.activeScenarioId === scenarioId) return calc;
    const next = { ...calc, activeScenarioId: scenarioId };
    return syncRootFromActiveScenario(next);
}
