/**
 * Утилиты для работы со списками сущностей, идентифицируемых по `id`.
 * Используются контроллерами CRUD (ЭК, вопросы) для иммутабельных обновлений.
 */

/**
 * Вставить или обновить элемент по id. Не мутирует исходный массив.
 */
export function upsertById(list, entry) {
    const idx = list.findIndex(x => x.id === entry.id);
    if (idx === -1) return [...list, { ...entry }];
    const next = list.slice();
    next[idx] = { ...entry };
    return next;
}

/**
 * Слияние двух списков по id: для каждого incoming — обновить существующий
 * или добавить, если его нет.
 */
export function mergeById(base, incoming) {
    const out = base.slice();
    for (const inc of incoming) {
        const idx = out.findIndex(x => x.id === inc.id);
        if (idx === -1) out.push({ ...inc });
        else out[idx] = { ...inc };
    }
    return out;
}

/**
 * Удалить элемент по id. Не мутирует исходный массив.
 */
export function removeById(list, id) {
    return list.filter(x => x.id !== id);
}
