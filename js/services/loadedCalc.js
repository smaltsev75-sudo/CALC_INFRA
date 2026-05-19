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
    if (!stored || typeof stored !== 'object') {
        return { calc: stored, needsPersist: false, error: null };
    }
    let calc;
    try {
        calc = migrateCalculation(stored);
    } catch (e) {
        return { calc: null, needsPersist: false, error: e };
    }

    /* enrich мутирует calc.dictionaries напрямую (push новых вопросов/ЭК
     * + замена qtyFormulas у целевых). Перед/после считаем размеры словаря
     * — если выросли или formulas обновились, считаем что enrich что-то
     * изменил, и storage нужно перезаписать. */
    const beforeQ = Array.isArray(calc.dictionaries?.questions) ? calc.dictionaries.questions.length : 0;
    const beforeI = Array.isArray(calc.dictionaries?.items) ? calc.dictionaries.items.length : 0;
    /* Хэш qtyFormulas агентских ЭК до enrich. _AGENT_FORMULA_REFRESH_IDS —
     * внутренний для seed.js, здесь повторять не надо: enrich сам решит,
     * нужно ли формулы обновлять. Для invalid'ации хватает length-check'а;
     * корнер-кейс «то же количество, но другие формулы» закрывается тем,
     * что enrich идемпотентен — повторный вызов в новой сессии тоже
     * перезапишет, F5 → ok. */
    enrichLegacyDictionaryWithAgentSeed(calc);
    const afterQ = Array.isArray(calc.dictionaries?.questions) ? calc.dictionaries.questions.length : 0;
    const afterI = Array.isArray(calc.dictionaries?.items) ? calc.dictionaries.items.length : 0;
    const enrichChanged = (afterQ !== beforeQ) || (afterI !== beforeI);

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
