/**
 * Whitelist id вопросов, удалённых из SEED_QUESTIONS прошлыми миграциями,
 * + идемпотентный sanitize-хелпер ВСЕХ слоёв, где может храниться deprecated id.
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
 *
 * PATCH 2.18.3 (audit-10): sanitize расширен на 5 слоёв (root.answers +
 * root.answersMeta + dictionaries.questions + scenarios[*].answers +
 * scenarios[*].answersMeta). Symmetric invariant — если чистится в root,
 * чистится и в каждом scenario.
 */

export const DEPRECATED_QUESTION_IDS = Object.freeze(new Set([
    'dau_target',              // удалён миграцией 3→4 (12.U18)
    'mau_target',              // удалён миграцией 4→5 (12.U19)
    'mau_growth_rate_percent'  // удалён миграцией 18→19 (MINOR 2.18.0)
]));

/** Содержит ли calc хотя бы один deprecated id (в любом из 5 слоёв)?
 *  Используется openCalc как guard «нужно ли persist'ить результат sanitize».
 *  Без этого indicator'а openCalc не знает, что sanitize что-то изменил
 *  (calc clone'ируется через JSON deep copy в migrateCalculation, reference-
 *  сравнение бесполезно). */
export function hasDeprecatedQuestions(calc) {
    if (!calc || typeof calc !== 'object') return false;
    if (_someKeyInSet(calc.answers, DEPRECATED_QUESTION_IDS)) return true;
    if (_someKeyInSet(calc.answersMeta, DEPRECATED_QUESTION_IDS)) return true;
    const dict = calc.dictionaries;
    if (dict && Array.isArray(dict.questions)
        && dict.questions.some(q => q && DEPRECATED_QUESTION_IDS.has(q.id))) return true;
    if (Array.isArray(calc.scenarios)) {
        for (const sc of calc.scenarios) {
            if (!sc) continue;
            if (_someKeyInSet(sc.answers, DEPRECATED_QUESTION_IDS)) return true;
            if (_someKeyInSet(sc.answersMeta, DEPRECATED_QUESTION_IDS)) return true;
        }
    }
    return false;
}

function _someKeyInSet(obj, set) {
    if (!obj || typeof obj !== 'object') return false;
    for (const k of Object.keys(obj)) if (set.has(k)) return true;
    return false;
}

function _stripDeprecatedKeys(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    let touched = false;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (DEPRECATED_QUESTION_IDS.has(k)) { touched = true; continue; }
        out[k] = v;
    }
    return touched ? out : obj;
}

/**
 * Идемпотентная зачистка deprecated-вопросов из снимка расчёта.
 * Возвращает новый объект (не мутирует вход). Безопасно вызывать на любом
 * calc независимо от schemaVersion. Если чистить нечего — возвращает тот же
 * reference (важно для reference-equality в store-подписчиках).
 *
 * Покрывает 5 слоёв (PATCH 2.18.3, audit-10):
 *   - calc.answers
 *   - calc.answersMeta
 *   - calc.dictionaries.questions
 *   - calc.scenarios[*].answers
 *   - calc.scenarios[*].answersMeta
 *
 * Defense-in-depth (audit-9 P1): если snapshot уже на schemaVersion ≥ той,
 * в которой id был удалён, миграция-удаление пропускается — sanitize всё
 * равно отловит stale поле. Symmetric (audit-10 P1.2 + P2.1): что чистится
 * в root, чистится и в каждом scenario.
 */
export function sanitizeDeprecatedQuestions(calc) {
    if (!calc || typeof calc !== 'object') return calc;
    if (!hasDeprecatedQuestions(calc)) return calc;

    const out = { ...calc };

    // root.answers / root.answersMeta
    const cleanAnswers = _stripDeprecatedKeys(calc.answers);
    if (cleanAnswers !== calc.answers) out.answers = cleanAnswers;
    const cleanMeta = _stripDeprecatedKeys(calc.answersMeta);
    if (cleanMeta !== calc.answersMeta) out.answersMeta = cleanMeta;

    // dictionaries.questions
    const dict = calc.dictionaries;
    if (dict && Array.isArray(dict.questions)
        && dict.questions.some(q => q && DEPRECATED_QUESTION_IDS.has(q.id))) {
        out.dictionaries = {
            ...dict,
            questions: dict.questions.filter(q => !q || !DEPRECATED_QUESTION_IDS.has(q.id))
        };
    }

    // scenarios[*].answers + scenarios[*].answersMeta
    if (Array.isArray(calc.scenarios)) {
        let scTouched = false;
        const nextScenarios = calc.scenarios.map(sc => {
            if (!sc) return sc;
            const scAnswers = _stripDeprecatedKeys(sc.answers);
            const scMeta = _stripDeprecatedKeys(sc.answersMeta);
            if (scAnswers === sc.answers && scMeta === sc.answersMeta) return sc;
            scTouched = true;
            const next = { ...sc };
            if (scAnswers !== sc.answers) next.answers = scAnswers;
            if (scMeta !== sc.answersMeta) next.answersMeta = scMeta;
            return next;
        });
        if (scTouched) out.scenarios = nextScenarios;
    }

    return out;
}

/**
 * Содержит ли defaultDictionary хотя бы один deprecated id?
 * Symmetric helper для calc-варианта (hasDeprecatedQuestions выше) —
 * без него нельзя сделать guarded sanitize без двойного scan'а.
 *
 * Внешний аудит #9 (2026-05-19, P1#2): makeNewCalculation берёт stored
 * defaultDictionary без sanitize и переносит deprecated вопросы в новый
 * calc. До фикса единственный sanitize в коде — на calc (через migrate),
 * default dict оставался нетронутым.
 */
export function hasDeprecatedInDictionary(dict) {
    if (!dict || typeof dict !== 'object') return false;
    if (!Array.isArray(dict.questions)) return false;
    return dict.questions.some(q => q && DEPRECATED_QUESTION_IDS.has(q.id));
}

/**
 * Идемпотентная зачистка deprecated-вопросов из defaultDictionary.
 *
 * Возвращает новый объект (не мутирует вход). Если чистить нечего —
 * возвращает тот же reference (важно для reference-equality в подписчиках).
 *
 * Используется в:
 *   - calcListController.makeNewCalculation (стертые stale id не попадают
 *     в dictionaries.questions и в answers нового calc'а);
 *   - bundleExport.buildStateBundle (stale не утекает в backup);
 *   - state/persistence.saveDefaultDictionary (write-side cleanup — новый
 *     stale не создаётся, даже если caller передал грязный объект).
 *
 * @param {object} dict
 * @returns {object}
 */
export function sanitizeDefaultDictionary(dict) {
    if (!hasDeprecatedInDictionary(dict)) return dict;
    return {
        ...dict,
        questions: dict.questions.filter(q => !q || !DEPRECATED_QUESTION_IDS.has(q.id))
    };
}
