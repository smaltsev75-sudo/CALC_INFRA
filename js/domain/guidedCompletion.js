/**
 * Stage 16.1 (MINOR 2.9.0) — Guided Data Completion.
 *
 * Pure-domain логика построения плана мастера дозаполнения. Без DOM, store,
 * services. Принимает уже вычисленные результаты Stage 15 (health findings,
 * assumptions register) и возвращает упорядоченный список шагов.
 *
 * Источники для MVP (lock-in от пользователя):
 *   1. Health findings severity 'error'         — приоритет 1
 *   2. Health findings severity 'warning'       — приоритет 2
 *   3. Risky assumptions (confidence='low')     — приоритет 3
 *   4. Incomplete / default-heavy key fields    — приоритет 4
 *      (CRITICAL_FIELDS со значением null/'' / undefined / equal to defaultValue)
 *
 * НЕ включаются в MVP: sensitivity N/A, budget recommendations, stale price
 * warning. Это отдельные workflow.
 *
 * Шаг (Step) — это один экран мастера. Пользователь либо принимает изменение
 * (Save and Next), либо пропускает (Skip), либо отменяет весь мастер
 * (откат к snapshot до старта). Snapshot и transient state живут в
 * state.ui.guidedCompletion (не в localStorage).
 *
 * Gated fields (поле под выключенным master-toggle): порождают дополнительный
 * предшествующий шаг kind='master_toggle' с пояснением «Сначала включим X».
 * Если master уже включён — gated-обёртка не добавляется. Если у поля цепочка
 * dependsOn длиннее 1 уровня — добавляется только ближайший выключенный master
 * (следующие master'ы откроются естественным образом после re-evaluate).
 */

import { CRITICAL_FIELDS } from '../utils/constants.js';

/* ============================================================
 * Helpers
 * ============================================================ */

/** «Есть ли явный ответ» — null/undefined/''/[] = нет. */
function hasAnswer(v) {
    if (v === null || v === undefined) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    if (v === '') return false;
    return true;
}

/** Совпадает ли ответ с дефолтом вопроса. */
function isDefaultValue(v, q) {
    if (!hasAnswer(v)) return true;
    if (q.defaultValue !== undefined && v === q.defaultValue) return true;
    if (q.defaultIfUnknown !== undefined && v === q.defaultIfUnknown) return true;
    return false;
}

/** Индекс вопросов из словаря по id. */
function buildQuestionIndex(calc) {
    const questions = calc?.dictionaries?.questions || [];
    const byId = new Map();
    questions.forEach((q, idx) => {
        if (q?.id) byId.set(q.id, { q, order: idx });
    });
    return byId;
}

/** Карта section → order для стабильной сортировки. */
function getQuestionOrder(qIndex, fieldId) {
    const entry = qIndex.get(fieldId);
    return entry ? entry.order : Number.MAX_SAFE_INTEGER;
}

/** Нормализация dependsOn: всегда массив. */
function getDependsOn(q) {
    if (!q) return [];
    const d = q.dependsOn;
    if (!d) return [];
    if (Array.isArray(d)) return d;
    return [d];
}

/* ============================================================
 * Step builders
 * ============================================================ */

function makeStep({ id, kind, priority, fieldId, masterFieldId = null,
        title, message, suggestedAction = '', question = null, source = {} }) {
    return Object.freeze({
        id,
        kind,
        priority,
        fieldId: fieldId || null,
        masterFieldId: masterFieldId || null,
        title,
        message,
        suggestedAction: suggestedAction || '',
        question,
        source: Object.freeze({ ...source })
    });
}

/** Из health-finding → шаг (берём первый fieldId как primary). */
function stepFromFinding(finding, qIndex) {
    const fieldId = (finding.fieldIds && finding.fieldIds[0]) || null;
    if (!fieldId) return null;
    const entry = qIndex.get(fieldId);
    return makeStep({
        id: `finding:${finding.id}`,
        kind: 'finding',
        priority: finding.severity === 'error' ? 1 : 2,
        fieldId,
        title: finding.title,
        message: finding.message,
        suggestedAction: finding.suggestedAction,
        question: entry ? entry.q : null,
        source: { findingId: finding.id, severity: finding.severity }
    });
}

/** Из risky assumption → шаг. */
function stepFromAssumption(assumption, qIndex) {
    const entry = qIndex.get(assumption.fieldId);
    return makeStep({
        id: `assumption:${assumption.fieldId}`,
        kind: 'assumption',
        priority: 3,
        fieldId: assumption.fieldId,
        title: `Уточните: ${assumption.label}`,
        message: 'Это поле сейчас использует значение по умолчанию, но входит в число ' +
            'критичных параметров. Уточнение существенно повышает точность расчёта.',
        suggestedAction: 'Задайте реальное значение или подтвердите, что дефолт подходит.',
        question: entry ? entry.q : null,
        source: { assumptionFieldId: assumption.fieldId, confidence: assumption.confidence }
    });
}

/** Из incomplete key field → шаг (CRITICAL_FIELDS со значением default или blank). */
function stepFromIncompleteField(fieldId, qIndex) {
    const entry = qIndex.get(fieldId);
    if (!entry) return null;
    return makeStep({
        id: `incomplete:${fieldId}`,
        kind: 'incomplete',
        priority: 4,
        fieldId,
        title: `Заполните: ${entry.q.title || fieldId}`,
        message: 'Ключевое поле не заполнено или содержит значение по умолчанию. ' +
            'Расчёт продолжит работу, но точность будет ограничена.',
        suggestedAction: 'Введите реальное значение, если оно доступно.',
        question: entry.q,
        source: { critical: true }
    });
}

/** Шаг-обёртка для master-toggle перед gated-полем. */
function makeMasterToggleStep(masterId, dependentStep, qIndex) {
    const masterEntry = qIndex.get(masterId);
    const masterTitle = masterEntry?.q?.title || masterId;
    const dependentTitle = dependentStep.question?.title || dependentStep.fieldId;
    return makeStep({
        id: `master_toggle:${masterId}:for:${dependentStep.fieldId}`,
        kind: 'master_toggle',
        priority: dependentStep.priority,
        fieldId: masterId,
        masterFieldId: masterId,
        title: `Сначала включите: ${masterTitle}`,
        message: `Поле «${dependentTitle}» зависит от «${masterTitle}». ` +
            'Сначала включите соответствующий переключатель, затем мастер вернёт ' +
            'вас к зависимому полю.',
        suggestedAction: '',
        question: masterEntry ? masterEntry.q : null,
        source: { gateFor: dependentStep.id }
    });
}

/* ============================================================
 * Gated handling
 * ============================================================ */

/**
 * Проверяет, заблокирован ли шаг невыключенным master-toggle. Если да —
 * возвращает masterId ближайшего выключенного. Только для шагов с question.
 */
export function findUnmetMaster(step, calc) {
    if (!step?.question) return null;
    const deps = getDependsOn(step.question);
    if (deps.length === 0) return null;
    const answers = calc?.answers || {};
    for (const masterId of deps) {
        const v = answers[masterId];
        // Master-toggle активен ТОЛЬКО если значение === true (boolean) или ненулевая строка.
        // Семантика опросника: выключенный master = false / null / undefined / '' / [].
        if (v === true) continue;
        if (typeof v === 'string' && v !== '' && v !== 'none' && v !== 'no') continue;
        if (typeof v === 'number' && v !== 0) continue;
        // Found unmet master
        return masterId;
    }
    return null;
}

/* ============================================================
 * Plan builder
 * ============================================================ */

/**
 * Возвращает collapsed-список «incomplete key fields»: CRITICAL_FIELDS, чьё
 * значение пустое (blank) или совпадает с defaultValue/defaultIfUnknown.
 * Поля, у которых нет вопроса в словаре, пропускаются. Поля, уже представленные
 * другими источниками (findings/assumptions), будут отброшены позже dedup-логикой.
 */
function findIncompleteKeyFields(calc, qIndex) {
    const answers = calc?.answers || {};
    const out = [];
    for (const fid of CRITICAL_FIELDS) {
        const entry = qIndex.get(fid);
        if (!entry) continue;
        const v = answers[fid];
        if (!hasAnswer(v) || isDefaultValue(v, entry.q)) {
            out.push(fid);
        }
    }
    return out;
}

/**
 * Строит план мастера дозаполнения.
 *
 * @param {object} calc — активный расчёт (как в state.activeCalc).
 * @param {object} inputs
 * @param {Array} inputs.healthFindings — массив findings от
 *   evaluateCalculationHealth (severity, fieldIds, message, ...).
 * @param {Array} inputs.riskyAssumptions — risky-фильтр от
 *   buildAssumptionsRegister + getRiskyAssumptions (confidence='low').
 *
 * @returns {{ steps: Step[], totalSteps: number,
 *             sourceCounts: { errors, warnings, risky, incomplete } }}
 *
 * Гарантии:
 *   - Шаги отсортированы по priority asc, затем по questionnaire-order.
 *   - Дедуп по fieldId: каждое поле порождает максимум один шаг (берётся
 *     с наивысшим приоритетом; gated-обёртка master_toggle добавляется
 *     ОТДЕЛЬНО и не считается дублем поля).
 *   - Шаги без question (нет в словаре) пропускаются для kinds 'incomplete'
 *     и 'assumption'. Для 'finding' допустимо: некоторые правила Health
 *     ссылаются на pricing-метаданные без fieldIds — они отфильтровываются
 *     ещё в stepFromFinding (возвращает null).
 *   - Gated-обёртка master_toggle добавляется только ОДНА: если вопрос имеет
 *     цепочку dependsOn длиннее 1 уровня и оба master'а выключены, добавляется
 *     ближайший. После re-evaluate plan пересоберётся.
 */
export function buildCompletionPlan(calc, inputs = {}) {
    const safe = {
        steps: [],
        totalSteps: 0,
        sourceCounts: { errors: 0, warnings: 0, risky: 0, incomplete: 0 }
    };
    if (!calc || typeof calc !== 'object') return safe;

    const qIndex = buildQuestionIndex(calc);
    const healthFindings = Array.isArray(inputs.healthFindings) ? inputs.healthFindings : [];
    const riskyAssumptions = Array.isArray(inputs.riskyAssumptions) ? inputs.riskyAssumptions : [];

    const sourceCounts = { errors: 0, warnings: 0, risky: 0, incomplete: 0 };
    const rawSteps = [];

    // ---- Health findings ----
    for (const f of healthFindings) {
        if (!f) continue;
        if (f.severity !== 'error' && f.severity !== 'warning') continue;
        const step = stepFromFinding(f, qIndex);
        if (!step) continue;
        rawSteps.push(step);
        if (f.severity === 'error') sourceCounts.errors++;
        else sourceCounts.warnings++;
    }

    // ---- Risky assumptions ----
    for (const a of riskyAssumptions) {
        if (!a || !a.fieldId) continue;
        const step = stepFromAssumption(a, qIndex);
        if (!step.question) continue;  // нет в словаре — пропускаем
        rawSteps.push(step);
        sourceCounts.risky++;
    }

    // ---- Incomplete key fields ----
    const incompleteIds = findIncompleteKeyFields(calc, qIndex);
    for (const fid of incompleteIds) {
        const step = stepFromIncompleteField(fid, qIndex);
        if (!step) continue;
        rawSteps.push(step);
        sourceCounts.incomplete++;
    }

    // ---- Dedup по fieldId ----
    // Сохраняем шаг с наивысшим приоритетом (минимальный priority-номер).
    // При равенстве — первый встреченный (стабильно по порядку добавления).
    const byField = new Map();
    for (const step of rawSteps) {
        if (!step.fieldId) continue;
        const prev = byField.get(step.fieldId);
        if (!prev || step.priority < prev.priority) {
            byField.set(step.fieldId, step);
        }
    }

    // ---- Сортировка: priority asc, затем questionnaire order asc ----
    const deduped = [...byField.values()].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return getQuestionOrder(qIndex, a.fieldId) - getQuestionOrder(qIndex, b.fieldId);
    });

    // ---- Gated wrapping ----
    // Перед каждым шагом, у которого dependsOn включает выключенный master,
    // вставляется master_toggle-шаг. Если master уже представлен в plan'е
    // другим источником (например, ai_llm_used сам в findings), не дублируем.
    const finalSteps = [];
    const seenMasterToggleIds = new Set();
    for (const step of deduped) {
        if (step.kind === 'master_toggle') {
            finalSteps.push(step);
            continue;
        }
        const unmetMaster = findUnmetMaster(step, calc);
        if (unmetMaster) {
            // Не добавляем master_toggle, если этот же master уже планируется
            // следующим шагом основного списка (не успели дойти, дедуплицируем).
            const alreadyAsRegular = finalSteps.some(s => s.fieldId === unmetMaster);
            const stepWillCome = deduped.some(s => s.fieldId === unmetMaster && s !== step);
            if (alreadyAsRegular || stepWillCome) {
                finalSteps.push(step);
                continue;
            }
            const masterStep = makeMasterToggleStep(unmetMaster, step, qIndex);
            if (!seenMasterToggleIds.has(masterStep.id)) {
                finalSteps.push(masterStep);
                seenMasterToggleIds.add(masterStep.id);
            }
        }
        finalSteps.push(step);
    }

    return {
        steps: finalSteps,
        totalSteps: finalSteps.length,
        sourceCounts
    };
}

/* ============================================================
 * Step navigation helpers
 * ============================================================ */

/**
 * Возвращает шаг с заданным абсолютным индексом, не пропуская и не пересчитывая.
 * Skip-логика реализуется на уровне controller'а (он хранит skippedIds и сам
 * выбирает, какой индекс показать).
 */
export function getStepAt(plan, index) {
    if (!plan || !Array.isArray(plan.steps)) return null;
    if (index < 0 || index >= plan.steps.length) return null;
    return plan.steps[index];
}

/**
 * Прогресс мастера. completedIds + skippedIds — сетки id шагов, обработанных
 * пользователем. Возвращает counts для UI.
 */
export function getCompletionProgress(plan, completedIds = [], skippedIds = []) {
    const total = plan?.totalSteps || 0;
    const completed = (completedIds || []).length;
    const skipped = (skippedIds || []).length;
    const remaining = Math.max(0, total - completed - skipped);
    return { completed, skipped, remaining, total };
}

/**
 * Поиск ближайшего следующего шага, который ещё не обработан (не completed
 * и не skipped). Если все обработаны — null.
 */
export function findNextActionableIndex(plan, fromIndex, completedIds = [], skippedIds = []) {
    if (!plan || !Array.isArray(plan.steps)) return -1;
    const completedSet = new Set(completedIds || []);
    const skippedSet = new Set(skippedIds || []);
    for (let i = Math.max(0, fromIndex); i < plan.steps.length; i++) {
        const s = plan.steps[i];
        if (completedSet.has(s.id) || skippedSet.has(s.id)) continue;
        return i;
    }
    return -1;
}
