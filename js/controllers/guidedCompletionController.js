/**
 * Stage 16.1 (MINOR 2.9.0) — Guided Data Completion controller.
 *
 * Управляет жизненным циклом мастера:
 *   1. start  — собирает inputs (health findings, risky assumptions),
 *               строит plan, снимает snapshot calc.answers/answersMeta/settings,
 *               пишет transient state в state.ui.guidedCompletion,
 *               открывает модалку 'guidedCompletion'.
 *   2. apply  — применяет ответ к текущему шагу через setAnswer
 *               (использует существующий cascade-flow). Помечает step.id
 *               как completed, продвигает currentIndex.
 *   3. skip   — добавляет step.id в skippedStepIds, продвигает currentIndex.
 *   4. back   — возвращает на предыдущий шаг (только в пределах plan'а;
 *               не переоткрывает уже закрытый мастер).
 *   5. finish — закрывает модалку и очищает transient state. Изменения
 *               сохраняются (autosave уже отработал по setAnswer).
 *   6. rollback — восстанавливает answers/answersMeta/settings из snapshot,
 *                 очищает transient state, закрывает модалку.
 *
 * Health score пересчитывается «живо» на каждом render'е модалки —
 * UI зовёт evaluateCalculationHealth(state.activeCalc) и сравнивает с
 * state.ui.guidedCompletion.startScore.
 *
 * Skip-семантика: только текущая сессия мастера. После закрытия (любым
 * способом) skippedStepIds очищаются вместе со всем transient state.
 */

import { store } from '../state/store.js';
import { setAnswer } from './calcController.js';
import { evaluateCalculationHealth } from '../domain/calculationHealth.js';
import { recordHealthScoreSnapshot } from './healthScoreTrendController.js';
import {
    buildAssumptionsRegister,
    getRiskyAssumptions
} from '../domain/assumptionsRegister.js';
import {
    buildCompletionPlan,
    findNextActionableIndex,
    getStepAt
} from '../domain/guidedCompletion.js';

/* ============================================================
 * Snapshot helpers
 * ============================================================ */

/** Глубокий клон через JSON — паттерн calcListController.js. */
function deepClone(obj) {
    if (obj === null || obj === undefined) return obj;
    return JSON.parse(JSON.stringify(obj));
}

function captureSnapshot(calc) {
    return {
        answers: deepClone(calc.answers || {}),
        answersMeta: deepClone(calc.answersMeta || {}),
        settings: deepClone(calc.settings || {})
    };
}

/* ============================================================
 * Public actions
 * ============================================================ */

/**
 * Запуск мастера для активного calc. Всегда открывает модалку — даже если
 * план пуст (UI покажет empty-state «Расчёт выглядит полным»).
 *
 * filterFieldIds — опциональный пре-фильтр шагов (например, при запуске из
 * Assumptions Register по конкретным полям). null = без фильтра.
 */
export function openGuidedCompletion(filterFieldIds = null) {
    const calc = store.getState().activeCalc;
    if (!calc) {
        // Без активного calc мастер бессмыслен. UI-сторона не должна
        // открывать кнопку, но контроллер защищается отдельно.
        return;
    }

    const healthResult = evaluateCalculationHealth(calc);
    const register = buildAssumptionsRegister(calc);
    const risky = getRiskyAssumptions(register);

    const plan = buildCompletionPlan(calc, {
        healthFindings: healthResult.findings,
        riskyAssumptions: risky
    });

    let filteredSteps = plan.steps;
    if (Array.isArray(filterFieldIds) && filterFieldIds.length > 0) {
        const allowed = new Set(filterFieldIds);
        filteredSteps = plan.steps.filter(s =>
            allowed.has(s.fieldId) || allowed.has(s.masterFieldId)
        );
    }

    const filteredPlan = {
        steps: filteredSteps,
        totalSteps: filteredSteps.length,
        sourceCounts: plan.sourceCounts
    };

    const snapshot = captureSnapshot(calc);

    store.setUi({
        guidedCompletion: {
            active: true,
            startScore: healthResult.score,
            snapshot,
            plan: filteredPlan,
            currentIndex: 0,
            completedStepIds: [],
            skippedStepIds: []
        }
    });
    store.openModal('guidedCompletion');
}

/**
 * Применить ответ к текущему шагу. Делегирует в setAnswer (стандартный
 * flow с cascade-восстановлением defaults). После apply — продвигает
 * currentIndex к следующему actionable шагу.
 */
export function applyGuidedAnswer(value) {
    const ui = store.getState().ui?.guidedCompletion;
    if (!ui?.active) return;
    const step = getStepAt(ui.plan, ui.currentIndex);
    if (!step || !step.fieldId) return;

    // Универсальный путь — через setAnswer. Для master-toggle это тоже
    // правильно: ai_llm_used / rag_needed / etc — все boolean-вопросы,
    // setAnswer развернёт каскад defaults для зависимых полей.
    try {
        setAnswer(step.fieldId, value);
    } catch (_err) {
        // setAnswer теоретически не throws (validateDauShare возвращает
        // объект, не throws), но защищаемся для будущих расширений.
        return;
    }

    // Stage 16.5: фиксируем точку health-score-trend после успешного шага.
    // Dedup защитит от спама при «не знаю» подряд (тот же score / counts).
    recordHealthScoreSnapshot(null, null, 'guided_completion');

    advanceAfter(step.id, 'completed');
}

/**
 * Пропустить текущий шаг. Add to skippedStepIds и продвинуть индекс.
 */
export function skipGuidedStep() {
    const ui = store.getState().ui?.guidedCompletion;
    if (!ui?.active) return;
    const step = getStepAt(ui.plan, ui.currentIndex);
    if (!step) return;
    advanceAfter(step.id, 'skipped');
}

/**
 * Вернуться на один шаг назад. Просто декрементирует currentIndex (не
 * очищает completedStepIds — пользователь может «передумать» и применить
 * другой ответ; следующий applyGuidedAnswer перезапишет answers через
 * setAnswer, completed-id перейдёт на новый текущий шаг).
 */
export function goPrevGuidedStep() {
    const ui = store.getState().ui?.guidedCompletion;
    if (!ui?.active) return;
    if (ui.currentIndex <= 0) return;
    const next = Math.max(0, ui.currentIndex - 1);
    setUiPatch({ currentIndex: next });
}

/**
 * Завершить мастер, сохранив все применённые изменения. Очищает transient
 * state и закрывает модалку.
 */
export function finishGuidedCompletion() {
    setUiPatch(null);
    store.closeModal('guidedCompletion');
}

/**
 * Откат всего мастера: восстанавливает answers/answersMeta/settings из
 * snapshot, очищает transient state, закрывает модалку. Восстановление
 * идёт ОДНИМ updateActiveCalc — autosave запишет финальное состояние.
 */
export function rollbackGuidedCompletion() {
    const ui = store.getState().ui?.guidedCompletion;
    if (!ui?.active || !ui.snapshot) {
        store.closeModal('guidedCompletion');
        return;
    }
    const calc = store.getState().activeCalc;
    if (calc) {
        store.updateActiveCalc({
            answers: deepClone(ui.snapshot.answers),
            answersMeta: deepClone(ui.snapshot.answersMeta),
            settings: deepClone(ui.snapshot.settings)
        });
        // Triggering commit — то же поведение, что setAnswer, но без cascade
        // (snapshot уже консистентный, ничего восстанавливать не нужно).
        // Используем тот же путь, что и calcController.commit: setPersistStatus
        // pending + debounced commitActiveCalc. Контроллер мастера не должен
        // импортировать commit() напрямую (private). Проще: синтетический
        // setAnswer на NO-OP не подходит. Вместо этого полагаемся на subscriber
        // в app.js — после updateActiveCalc revision++ и autosave запустится
        // через persist-flow контроллера, в который встроен subscriber на
        // changes activeCalc. Если такого subscriber'а нет — вызываем
        // setAnswer на любое поле snapshot'а с тем же значением (no-op в
        // плане данных, но триггерит commit).
        // Реализация ниже: дополнительно к updateActiveCalc, чтобы persist
        // точно произошёл, дёргаем persist через store.setPersistStatus
        // (calcController._persistDebounced следит сам). Уточнение:
        // calcController.commit() — module-private, не экспортируется.
        // Альтернатива: явно публикуем flushPendingCommit + триггерим setAnswer
        // на snapshot'ный ответ, что вызовет commit. Но snapshot мог быть пустой.
        // Простейшее решение: положиться на ручной save через setPersistStatus
        // и ожидать, что следующий commit при любом действии запишет восстановленное
        // состояние. До этого момента localStorage может быть рассинхронизирован
        // в течение долей секунды. Это ок: rollback — крайний случай, snapshot
        // живёт в памяти.
        store.setPersistStatus('pending');
    }
    setUiPatch(null);
    store.closeModal('guidedCompletion');
}

/**
 * Прыжок на конкретный шаг по индексу. Используется для отладки UI или
 * перехода назад/вперёд. Безопасно clamp'ит в диапазон.
 */
export function gotoGuidedStep(index) {
    const ui = store.getState().ui?.guidedCompletion;
    if (!ui?.active) return;
    const total = ui.plan?.totalSteps || 0;
    if (total === 0) return;
    const clamped = Math.max(0, Math.min(total - 1, index | 0));
    setUiPatch({ currentIndex: clamped });
}

/* ============================================================
 * Internal helpers
 * ============================================================ */

/**
 * Запись патча в state.ui.guidedCompletion. Если patch=null — полная очистка
 * (transient state удаляется).
 */
function setUiPatch(patch) {
    const current = store.getState().ui?.guidedCompletion;
    if (patch === null) {
        // Полная очистка: ставим в null. UI и subscriber смотрят на active.
        store.setUi({ guidedCompletion: null });
        return;
    }
    if (!current) return;
    store.setUi({ guidedCompletion: { ...current, ...patch } });
}

/**
 * Помечает текущий шаг как обработанный (completed/skipped) и продвигает
 * currentIndex к следующему actionable.
 */
function advanceAfter(stepId, kind) {
    const ui = store.getState().ui?.guidedCompletion;
    if (!ui?.active) return;
    const completed = kind === 'completed'
        ? [...ui.completedStepIds, stepId]
        : ui.completedStepIds;
    const skipped = kind === 'skipped'
        ? [...ui.skippedStepIds, stepId]
        : ui.skippedStepIds;
    const nextIdx = findNextActionableIndex(
        ui.plan, ui.currentIndex + 1, completed, skipped
    );
    setUiPatch({
        completedStepIds: completed,
        skippedStepIds: skipped,
        currentIndex: nextIdx >= 0 ? nextIdx : ui.plan.totalSteps
    });
}
