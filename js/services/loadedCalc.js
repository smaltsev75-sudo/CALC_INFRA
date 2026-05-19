/**
 * Единый pipeline загрузки calc из любого raw-источника (storage / JSON-import /
 * bundle-apply). Живёт в services/, потому что зависит от state/migrations.js
 * (domain не имеет права импортировать state — layer-imports.test.js). И
 * controllers, и services (bundleExport) могут использовать без cross-layer
 * dependency: services → state ОК, services → domain ОК.
 *
 * Pipeline: migrateCalculation → enrichLegacyDictionaryWithAgentSeed →
 * applyVatResolver. Возвращает { calc, needsPersist, error } — caller
 * сам решает, что делать с needsPersist (commit через calcPersistence или
 * никак).
 *
 * Внешний аудит #11 (2026-05-19, PATCH 2.18.4) ввёл этот pipeline как
 * shared helper в controllers/calcListController.js. Внешний аудит #12
 * (тот же день, PATCH 2.18.5) выявил две проблемы:
 *
 *   1. needsPersist не учитывал enrichChanged → openCalc enrich'нул в-памяти,
 *      но storage остался без agent-данных; buildStateBundle экспортировал
 *      raw без agent-вопросов.
 *
 *   2. services/bundleExport.js не мог использовать helper из controllers/
 *      без нарушения layer-linter'а — поэтому собирал миграцию вручную и
 *      опять расходился (без enrich + sanitize ДО migrate теряло данные).
 *
 * Решение #12: вынести в domain, расширить enrichChanged-check, использовать
 * везде. Архитектурный invariant-тест защищает симметрию.
 */

import { migrateCalculation } from '../state/migrations.js';
import { enrichLegacyDictionaryWithAgentSeed } from '../domain/seed.js';
import { applyVatResolver } from '../domain/vatResolver.js';
import { hasDeprecatedQuestions } from '../domain/deprecatedQuestions.js';

/**
 * Подготовить calc из raw stored для use в store.
 *
 * @param {object} stored — raw calc (из persist.loadCalc / JSON-файл /
 *                          элемент bundle.calculations).
 * @returns {{ calc: object|null, needsPersist: boolean, error: Error|null }}
 */
export function prepareLoadedCalc(stored) {
    /* null / undefined — нет stored, это не ошибка (caller обычно сразу
     * возвращает null до вызова — но defensive: позволяем). */
    if (stored === null || stored === undefined) {
        return { calc: stored, needsPersist: false, error: null };
    }
    /* Внешний аудит #13 (2026-05-19, P1/P2#3): любой не-object вход
     * (строка/число/boolean/массив) — это битый stored, не валидный calc.
     * Раньше guard `typeof stored !== 'object'` пропускал primitives
     * через success path с calc=stored. store.setActiveCalc("bad") через
     * spread деструктурировался в `{0:'b',1:'a',2:'d'}`. */
    if (typeof stored !== 'object' || Array.isArray(stored)) {
        const err = new TypeError(
            `prepareLoadedCalc: stored должен быть объектом-calc, получено ${
                Array.isArray(stored) ? 'массив' : typeof stored
            }`
        );
        return { calc: null, needsPersist: false, error: err };
    }
    let calc;
    try {
        calc = migrateCalculation(stored);
    } catch (e) {
        return { calc: null, needsPersist: false, error: e };
    }

    /* enrich мутирует calc.dictionaries напрямую (push новых вопросов/ЭК
     * + замена qtyFormulas/applicableStands/formulaHelp у целевых items).
     *
     * Внешний аудит #13 (2026-05-19, P2#4): прежний length-check ловил
     * только добавления, не refresh формул у уже существующих items
     * (_AGENT_FORMULA_REFRESH_IDS в seed.js). Calc, у которого все agent-
     * items уже есть, но qtyFormulas устарели — `length до === length после`,
     * needsPersist=false, openCalc не персистил обновлённые формулы.
     *
     * Снапшот перед enrich — JSON-string словаря; после — сравнение строк.
     * Это покрывает все три операции enrich (push questions, push items,
     * refresh qtyFormulas/applicableStands/formulaHelp). Цена — один deep
     * stringify на load; для 80 вопросов + 36 items — миллисекунды,
     * acceptable для openCalc / boot. */
    const beforeSnapshot = JSON.stringify(calc.dictionaries);
    enrichLegacyDictionaryWithAgentSeed(calc);
    const afterSnapshot = JSON.stringify(calc.dictionaries);
    const enrichChanged = beforeSnapshot !== afterSnapshot;

    const beforeVat = calc;
    calc = applyVatResolver(calc);
    const vatChanged = calc !== beforeVat;

    const storedVersion = Number.isFinite(stored.schemaVersion) ? stored.schemaVersion : 0;
    const schemaChanged = calc.schemaVersion !== storedVersion;
    const hadDeprecated = hasDeprecatedQuestions(stored);

    return {
        calc,
        needsPersist: schemaChanged || vatChanged || hadDeprecated || enrichChanged,
        error: null
    };
}
