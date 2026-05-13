/**
 * Сервис: фиксация изменений активного расчёта в localStorage.
 * Атомарно сохраняет полный расчёт + обновляет запись в списке (`name`, `updatedAt`).
 *
 * Управляет статусом сохранения в store: pending → saved | error.
 * Используется контроллерами CRUD и автосохранением.
 *
 * Атомарность (Этап 10.1.5):
 *   - Перед записью снимается backupList = loadCalcList().
 *   - Сначала пишется сам расчёт; если saveCalc вернул false — список НЕ
 *     трогаем (старая запись в списке указывала на старый name/updatedAt,
 *     но самой записи calc.<id> ещё может не быть либо она прежняя — в
 *     любом случае состояние согласовано относительно прежнего снапшота).
 *   - Затем пишется список; если saveCalcList упал — пытаемся откатить
 *     список к backupList. Это лучшая попытка консистентности по двум
 *     ключам localStorage: после сбоя пользователь видит persistStatus=error
 *     и список соответствует тому состоянию, что было до commit.
 *
 * Этап 11.1.1: единое атомарное ядро `_atomicCalcAndListWrite` используется
 * всеми CRUD-операциями (create / rename / duplicate / migrated / import).
 * Контроллеры больше не вызывают `persist.saveCalc + persist.saveCalcList`
 * напрямую — это гарантирует, что любой сбой одного из шагов запускает
 * откат списка и переводит persistStatus в 'error'.
 */

import * as persist from '../state/persistence.js';
import { store } from '../state/store.js';
import { PERSIST_STATUS_DECAY_MS } from '../utils/constants.js';

let _savedTimer = null;

const QUOTA_ERROR_MSG = 'Не удалось сохранить расчёт. Возможно, превышен лимит хранилища. Сохраните JSON.';

/** Выставить persistStatus=saved и через PERSIST_STATUS_DECAY_MS вернуть idle (если не перезаписано). */
function _scheduleSavedDecay() {
    if (_savedTimer) clearTimeout(_savedTimer);
    _savedTimer = setTimeout(() => {
        if (store.getState().persistStatus === 'saved') {
            store.setPersistStatus('idle');
        }
        _savedTimer = null;
    }, PERSIST_STATUS_DECAY_MS);
}

/**
 * Атомарная запись пары (calc, calc.list) в localStorage.
 *
 * @param {object} calc — полный расчёт; пишется в calc.<id>.
 * @param {(currentList: Array) => Array} listBuilder — функция, получающая
 *   текущий список (после успешной записи calc) и возвращающая новый список
 *   для записи. Должна быть чистой и не бросать кроме редких случаев
 *   (повреждённый storage).
 * @returns {boolean} true — оба шага успешны; false — ошибка, persistStatus=error.
 *
 * Контракт:
 *   - persistStatus → 'pending' в начале;
 *   - на ошибке любого шага: пытаемся откатить список к backup; persistStatus='error';
 *   - на успехе: persistStatus='saved' + decay через 1.5 с в 'idle'.
 */
function _atomicCalcAndListWrite(calc, listBuilder) {
    if (!calc) return false;
    store.setPersistStatus('pending');

    // Снимаем backup до любой записи. Если loadCalcList бросает (повреждённый
    // storage) — backup = null, откат недоступен, но логика записи продолжается.
    let backupList = null;
    try {
        backupList = persist.loadCalcList();
    } catch (e) {
        backupList = null;
    }

    // Шаг 1: запись самого расчёта. На сбое — список не трогаем.
    const okSelf = persist.saveCalc(calc);
    if (!okSelf) {
        store.setPersistStatus('error', QUOTA_ERROR_MSG);
        return false;
    }

    // Шаг 2: пересборка списка через listBuilder. На исключении — откатываем.
    let updatedList;
    try {
        updatedList = listBuilder(persist.loadCalcList());
    } catch (e) {
        if (backupList) {
            try { persist.saveCalcList(backupList); } catch (e2) { /* откат тоже упал */ }
        }
        store.setPersistStatus('error', QUOTA_ERROR_MSG);
        return false;
    }

    // Шаг 3: запись списка.
    let okList;
    try {
        okList = persist.saveCalcList(updatedList);
    } catch (e) {
        okList = false;
    }
    if (!okList) {
        if (backupList) {
            try { persist.saveCalcList(backupList); } catch (e2) { /* откат не удался */ }
        }
        store.setPersistStatus('error', QUOTA_ERROR_MSG);
        return false;
    }

    store.setPersistStatus('saved');
    _scheduleSavedDecay();
    return true;
}

/**
 * Зафиксировать изменения активного расчёта (rename / автосохранение).
 * Обновляет name + updatedAt у существующей записи в calc.list.
 */
export function commitActiveCalc(calc) {
    if (!calc) return false;
    return _atomicCalcAndListWrite(calc, (list) =>
        list.map(m =>
            m.id === calc.id ? { ...m, name: calc.name, updatedAt: calc.updatedAt } : m
        )
    );
}

/**
 * Зафиксировать новый расчёт (createCalc / duplicateCalc / importCalcFromFile).
 * Добавляет запись о расчёте в calc.list. Если запись с таким id уже есть —
 * обновляет её (защита от дубликатов в списке).
 *
 * @param {object} calc — полный расчёт.
 * @param {{ id: string, name: string, updatedAt: string }} [listEntry] —
 *   мета-запись для списка. По умолчанию собирается из calc.
 */
export function commitNewCalc(calc, listEntry) {
    if (!calc) return false;
    const entry = listEntry || { id: calc.id, name: calc.name, updatedAt: calc.updatedAt };
    return _atomicCalcAndListWrite(calc, (list) => {
        const idx = list.findIndex(m => m.id === entry.id);
        if (idx >= 0) {
            // Уже есть в списке — заменяем (например, повторная фиксация
            // того же id после rollback). Обычно сюда не попадаем.
            const next = list.slice();
            next[idx] = { ...next[idx], ...entry };
            return next;
        }
        return [...list, entry];
    });
}

/**
 * Зафиксировать переименование расчёта. Семантически совпадает с
 * commitActiveCalc, но имя выражает намерение явно.
 */
export function commitCalcRename(calc) {
    return commitActiveCalc(calc);
}

/**
 * Зафиксировать расчёт после миграции схемы.
 * Перезаписывает calc.<id> и обновляет name/updatedAt в списке.
 * Семантически совпадает с commitActiveCalc.
 */
export function commitMigratedCalc(calc) {
    return commitActiveCalc(calc);
}
