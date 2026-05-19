/**
 * Whitelist id вопросов, удалённых из SEED_QUESTIONS прошлыми миграциями,
 * + идемпотентный sanitize-хелпер.
 *
 * Вынесено в отдельный модуль БЕЗ внешних imports, чтобы избежать
 * циркулярной зависимости `migrations → seed → constants → migrations`
 * (constants.js re-export'ит LATEST_SCHEMA_VERSION из migrations.js).
 *
 * Re-export из `seed.js` для удобства потребителей UI/доменного слоя;
 * `migrations.js` импортирует напрямую отсюда.
 *
 * При добавлении новой миграции `dict.questions.filter(q => q.id !== 'X')` —
 * синхронно расширить этот Set. Линтер
 * [tests/unit/architecture/deprecated-questions-invariant.test.js]
 * валит CI, если миграция удаляет id, не отмеченный здесь.
 */

export const DEPRECATED_QUESTION_IDS = Object.freeze(new Set([
    'dau_target',              // удалён миграцией 3→4 (12.U18)
    'mau_target',              // удалён миграцией 4→5 (12.U19)
    'mau_growth_rate_percent'  // удалён миграцией 18→19 (MINOR 2.18.0)
]));

/**
 * Идемпотентная зачистка deprecated-вопросов из снимка расчёта.
 * Возвращает новый объект (не мутирует вход). Удаляет stale id и из
 * `dictionaries.questions`, и из `answers`. Безопасно вызывать на любом
 * calc независимо от schemaVersion.
 *
 * Defense-in-depth (audit-9 P1, PATCH 2.18.2): если snapshot уже на
 * schemaVersion ≥ той, в которой id был удалён, миграция-удаление
 * пропускается — sanitize всё равно отловит stale поле.
 */
export function sanitizeDeprecatedQuestions(calc) {
    if (!calc || typeof calc !== 'object') return calc;
    const dict = calc.dictionaries;
    const hasQs = dict && Array.isArray(dict.questions)
        && dict.questions.some(q => q && DEPRECATED_QUESTION_IDS.has(q.id));
    const answers = calc.answers || {};
    const hasAns = Object.keys(answers).some(id => DEPRECATED_QUESTION_IDS.has(id));
    if (!hasQs && !hasAns) return calc;

    const out = { ...calc };
    if (hasQs) {
        out.dictionaries = {
            ...dict,
            questions: dict.questions.filter(q => !q || !DEPRECATED_QUESTION_IDS.has(q.id))
        };
    }
    if (hasAns) {
        const cleanAnswers = { ...answers };
        for (const id of DEPRECATED_QUESTION_IDS) delete cleanAnswers[id];
        out.answers = cleanAnswers;
    }
    return out;
}
