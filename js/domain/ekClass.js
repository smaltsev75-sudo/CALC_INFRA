/**
 * ekClass — классификатор «драйвер количества» ЭК (Stage 5A).
 *
 * ekClass отвечает на вопрос «ЧТО определяет qty этого ЭК»: нагрузка, объём
 * данных, AI-нагрузка, доля от объёма ПРОМ (DR), фиксация по условию, число из
 * ответа или константа. Это ось объяснимости и предмет арх-инвариантов
 * (см. tests/unit/architecture/ekclass-*.test.js).
 *
 * getEkClass — total-function. Для SEED_ITEMS поле ekClass задано всегда
 * (arch-тест completeness). Для legacy-словарей из старых JSON-расчётов поле
 * может отсутствовать — тогда деривируем безопасный fallback по resourceClass.
 *
 * ВАЖНО: fallback НИКОГДА не возвращает 'prod-derived'. Иначе legacy DR-ЭК,
 * чьи сохранённые формулы ещё gate-based (qty 0/1), получили бы prod-derived
 * пере-расчёт в post-pass и прочитали бы отсутствующий S.prodComputeVcpu → 0.
 * Backward-compat: старые расчёты сохраняют ровно своё прежнее поведение.
 */

import { EKCLASS_IDS } from '../utils/constants.js';

/**
 * Безопасная деривация ekClass для legacy-ЭК без явного поля.
 * Эвристика по resourceClass — только для отображения класса; денежных
 * последствий не несёт (старые формулы не ссылаются на S.prod*).
 */
function deriveEkClassFallback(item) {
    const rc = item && typeof item === 'object' ? item.resourceClass : null;
    if (rc === 'AI_LLM') return 'ai-driven';
    if (rc === 'CPU' || rc === 'RAM') return 'load-driven';
    if (rc === 'STORAGE') return 'data-driven';
    // NETWORK / LICENSE / TRAFFIC / SERVICE / ONE_TIME / RESERVE и всё прочее.
    // Намеренно НЕ prod-derived / constant / count-driven: их нельзя надёжно
    // вывести из resourceClass, а ошибочный prod-derived сломал бы legacy DR.
    return 'flag-fixed';
}

/**
 * Класс драйвера количества ЭК.
 *
 * @param {Object} item — элемент конфигурации
 * @returns {'load-driven'|'data-driven'|'ai-driven'|'prod-derived'|'flag-fixed'|'count-driven'|'constant'}
 */
export function getEkClass(item) {
    if (item && typeof item === 'object' && EKCLASS_IDS.includes(item.ekClass)) {
        return item.ekClass;
    }
    return deriveEkClassFallback(item);
}
