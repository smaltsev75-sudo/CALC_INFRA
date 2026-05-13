/**
 * Глубокая заморозка объекта. Используется в state/store.js, чтобы
 * предотвратить случайные мутации вложенных структур (контракт «state —
 * иммутабельный»).
 *
 * Безопасно для DAG — повторно замороженные узлы пропускаются.
 * Не циклоустойчиво — структура расчёта (calculation) дерево, циклов нет.
 */
export function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Object.isFrozen(obj)) return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value && typeof value === 'object') deepFreeze(value);
    }
    return obj;
}
