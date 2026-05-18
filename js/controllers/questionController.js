/**
 * CRUD-операции над вопросами.
 */

import { store } from '../state/store.js';
import * as persist from '../state/persistence.js';
import { uuid } from '../utils/uuid.js';
import { validateQuestion } from '../domain/validation.js';
import { downloadJson } from '../services/json.js';
import { dateForFilename } from '../services/format.js';
import { importJsonCollection } from '../services/jsonImport.js';
import { commitActiveCalc } from '../services/calcPersistence.js';
import { upsertById, mergeById, removeById } from '../utils/collections.js';

/* ---------- Новый вопрос с дефолтами ---------- */

export function makeNewQuestion() {
    return {
        id: 'q_' + uuid().slice(0, 8),
        section: 'business',
        subgroup: '',
        title: '',
        description: '',
        recommendation: '',
        impact: '',
        type: 'number',
        defaultValue: 0,
        defaultIfUnknown: undefined,
        allowUnknown: true,
        assumptionRisk: 'low',
        order: 100,
        min: 0, max: 1000000, step: 1
    };
}

export function saveQuestion(q) {
    const errors = [];
    validateQuestion(q, errors);
    if (errors.length) return { ok: false, errors };

    const calc = store.getState().activeCalc;
    if (!calc) return { ok: false, errors: [{ message: 'Нет активного расчёта' }] };

    const questions = upsertById(calc.dictionaries.questions, q);

    // Если вопрос новый — добавим дефолтный ответ.
    const answers = { ...calc.answers };
    if (!(q.id in answers)) answers[q.id] = defaultAnswerFor(q);

    const dictionaries = { ...calc.dictionaries, questions };
    store.updateActiveCalc({ dictionaries, answers });
    /* Внешний аудит #4 (2026-05-18, P1-2): см. parallel-фикс в itemController. */
    if (!commitActiveCalc(store.getState().activeCalc)) {
        return { ok: false, errors: [{ message:
            'Не удалось сохранить вопрос: превышен лимит хранилища (quota?). ' +
            'Освободите место (экспорт JSON + удаление старых расчётов) и повторите.' }] };
    }

    syncDefaultDictionary({ questions: upsertById(currentDefaultQuestions(), q) });
    return { ok: true };
}

export function deleteQuestion(qid) {
    const calc = store.getState().activeCalc;
    if (!calc) return { ok: false, reason: 'noActiveCalc' };
    const questions = removeById(calc.dictionaries.questions, qid);
    const answers = { ...calc.answers };
    delete answers[qid];
    store.updateActiveCalc({ dictionaries: { ...calc.dictionaries, questions }, answers });
    /* Внешний аудит #5 (2026-05-18, P2): см. itemController.deleteItem. */
    if (!commitActiveCalc(store.getState().activeCalc)) {
        return { ok: false, reason: 'persist',
            message: 'Не удалось удалить вопрос: превышен лимит хранилища (quota?). ' +
                     'Освободите место и повторите.' };
    }
    syncDefaultDictionary({ questions: removeById(currentDefaultQuestions(), qid) });
    return { ok: true };
}

/**
 * Дублирует вопрос с новым id.
 */
export function duplicateQuestion(qid) {
    const calc = store.getState().activeCalc;
    if (!calc) return null;
    const src = calc.dictionaries.questions.find(q => q.id === qid);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = `${src.id}_copy_${uuid().slice(0, 4)}`;
    copy.title = `${src.title} (копия)`;
    saveQuestion(copy);
    return copy.id;
}

/* ---------- Импорт/экспорт ---------- */

export function exportQuestions() {
    const calc = store.getState().activeCalc;
    const qs = calc?.dictionaries?.questions
        ?? store.getState().defaultDictionary?.questions
        ?? [];
    downloadJson(`questions-${dateForFilename()}.json`, { questions: qs });
}

export async function importQuestions({ replace = false } = {}) {
    return importJsonCollection({
        pluralKey: 'questions',
        validator: validateQuestion,
        onAccepted: (accepted) => {
            const calc = store.getState().activeCalc;
            if (calc) {
                const base = replace ? [] : [...calc.dictionaries.questions];
                const merged = mergeById(base, accepted);
                const answers = { ...calc.answers };
                for (const q of accepted) {
                    if (!(q.id in answers)) answers[q.id] = defaultAnswerFor(q);
                }
                store.updateActiveCalc({
                    dictionaries: { ...calc.dictionaries, questions: merged },
                    answers
                });
                /* Внешний аудит #5 (2026-05-18, P2): commit-fail пробрасываем
                 * как persist-reason — см. itemController.importItems. */
                if (!commitActiveCalc(store.getState().activeCalc)) {
                    return { ok: false, reason: 'persist',
                        message: 'Импорт не сохранён в хранилище (quota?).' };
                }
            }
            const defBase = replace ? [] : currentDefaultQuestions();
            syncDefaultDictionary({ questions: mergeById(defBase, accepted) });
            return { ok: true };
        }
    });
}

/* ---------- Модалка ---------- */

export function openQuestionEditor(qOrNull) {
    const draft = qOrNull ?? makeNewQuestion();
    store.openModal('questionEdit', { draft, errors: [] });
}
export function closeQuestionEditor() {
    store.closeModal('questionEdit');
}

/* ---------- Утилиты ---------- */

function defaultAnswerFor(q) {
    if (q.defaultValue !== undefined && q.defaultValue !== null) return q.defaultValue;
    if (q.type === 'boolean') return false;
    if (q.type === 'multiselect') return [];
    if (q.type === 'number') return 0;
    return '';
}

function currentDefaultQuestions() {
    const def = persist.loadDefaultDictionary() || { items: [], questions: [] };
    return [...(def.questions || [])];
}

function syncDefaultDictionary({ items, questions }) {
    const def = persist.loadDefaultDictionary() || { items: [], questions: [] };
    const next = {
        ...def,
        ...(items !== undefined ? { items } : {}),
        ...(questions !== undefined ? { questions } : {})
    };
    /* Внешний аудит #2 (2026-05-18, P3-1): тот же класс, что в itemController. */
    if (!persist.saveDefaultDictionary(next)) {
        store.setPersistStatus('error', 'Не удалось сохранить справочник вопросов (quota?)');
    }
    store.setDefaultDictionary(next);
}
