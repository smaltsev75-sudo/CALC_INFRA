/**
 * CRUD-операции над вопросами.
 */

import { store } from '../state/store.js';
import * as persist from '../state/persistence.js';
import { uuid } from '../utils/uuid.js';
import { validateQuestion, validateAnswersConsistency } from '../domain/validation.js';
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

    const newCalc = { ...calc, dictionaries: { ...calc.dictionaries, questions }, answers };

    /* Внешний аудит #15 (2026-05-19, PATCH 2.19.2, P2): частичная валидация
     * answers ↔ questions для newCalc. Раньше: вопрос с min=0 редактировался
     * на min=5, существующий answer=0 оставался — saveQuestion возвращал
     * {ok:true}, но calc становился невалидным. Также number без default +
     * min>0 + defaultAnswerFor=0 → answer вне диапазона при создании.
     * Полную validateCalculation НЕ используем — она требует валидный
     * settings/items, что для минимальных тестовых fixtures избыточно.
     * validateAnswersConsistency проверяет ТОЛЬКО answer↔question. */
    const answerErrors = [];
    validateAnswersConsistency(newCalc, answerErrors);
    if (answerErrors.length) {
        return { ok: false, errors: answerErrors.map(e => ({
            path: e.path,
            message: `Сохранение нарушит расчёт: ${e.message}. Уточните min/max/default вопроса или поправьте текущий ответ.`
        })) };
    }

    /* Внешний аудит #7 (2026-05-18, P1): inverse pattern — commit ПЕРВЫМ.
     * См. parallel-фикс в itemController.saveItem. */
    if (!commitActiveCalc(newCalc)) {
        return { ok: false, errors: [{ message:
            'Не удалось сохранить вопрос: превышен лимит хранилища (quota?). ' +
            'Освободите место (экспорт JSON + удаление старых расчётов) и повторите.' }] };
    }
    store.setActiveCalc(newCalc);
    syncDefaultDictionary({ questions: upsertById(currentDefaultQuestions(), q) });
    return { ok: true };
}

export function deleteQuestion(qid) {
    const calc = store.getState().activeCalc;
    if (!calc) return { ok: false, reason: 'noActiveCalc' };
    /* Внешний аудит #6 (2026-05-18, P2-1): inverse pattern — persist первым,
     * store вторым (см. itemController.deleteItem). */
    const questions = removeById(calc.dictionaries.questions, qid);
    const answers = { ...calc.answers };
    delete answers[qid];
    const newCalc = { ...calc, dictionaries: { ...calc.dictionaries, questions }, answers };
    if (!commitActiveCalc(newCalc)) {
        return { ok: false, reason: 'persist',
            message: 'Не удалось удалить вопрос: превышен лимит хранилища (quota?). ' +
                     'Освободите место и повторите.' };
    }
    store.setActiveCalc(newCalc);
    syncDefaultDictionary({ questions: removeById(currentDefaultQuestions(), qid) });
    return { ok: true };
}

/**
 * Дублирует вопрос с новым id. Возвращает `{ok:true, id}` либо
 * `{ok:false, reason, message?}` — см. parallel-фикс в itemController.duplicateItem.
 *
 * Внешний аудит #8 (2026-05-18, P1-2): раньше игнорировал результат
 * saveQuestion — при quota врал об успехе.
 */
export function duplicateQuestion(qid) {
    const calc = store.getState().activeCalc;
    if (!calc) return { ok: false, reason: 'noActiveCalc' };
    const src = calc.dictionaries.questions.find(q => q.id === qid);
    if (!src) return { ok: false, reason: 'notFound' };
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = `${src.id}_copy_${uuid().slice(0, 4)}`;
    copy.title = `${src.title} (копия)`;
    const r = saveQuestion(copy);
    if (!r || r.ok === false) {
        return {
            ok: false,
            reason: 'persist',
            message: r?.errors?.[0]?.message
                || 'Не удалось сохранить дубликат вопроса: превышен лимит хранилища (quota?).'
        };
    }
    return { ok: true, id: copy.id };
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
                const newCalc = {
                    ...calc,
                    dictionaries: { ...calc.dictionaries, questions: merged },
                    answers
                };
                /* Внешний аудит #15 (2026-05-19, PATCH 2.19.2, P2): частичная
                 * валидация answers ↔ questions — родственное к saveQuestion. */
                const answerErrors = [];
                validateAnswersConsistency(newCalc, answerErrors);
                if (answerErrors.length) {
                    return { ok: false, reason: 'invalid',
                        message: `Импорт нарушит расчёт: ${answerErrors[0].message}. Проверьте min/max/default вопросов.` };
                }
                /* Внешний аудит #7 (2026-05-18, P1): inverse pattern. */
                if (!commitActiveCalc(newCalc)) {
                    return { ok: false, reason: 'persist',
                        message: 'Импорт не сохранён в хранилище (quota?).' };
                }
                store.setActiveCalc(newCalc);
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
