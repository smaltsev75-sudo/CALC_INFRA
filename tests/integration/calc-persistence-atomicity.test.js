/**
 * Атомарность commitActiveCalc по двум ключам localStorage (Этап 10.1.5).
 *
 * commitActiveCalc пишет в storage два ключа:
 *   1) calc.<id> — полный расчёт.
 *   2) calc.list — мета-список с обновлёнными name/updatedAt.
 *
 * Контракт: после возврата (успех или ошибка) состояние в storage должно
 * быть согласованным — list[i].name === calc.name (для соответствующего id),
 * list[i].updatedAt === calc.updatedAt. Никаких «полузаписей»: либо записан
 * новый снапшот целиком, либо состояние осталось как в backup.
 *
 * Тестируем 3 сценария:
 *   - Кейс 1: setItem кидает QuotaExceededError на ВТОРОМ вызове (после успешной
 *     записи calc) → commitActiveCalc возвращает false, persistStatus.kind===error,
 *     loadCalcList() == backupList (откат сработал).
 *   - Кейс 2: setItem кидает на ПЕРВОМ вызове (saveCalc → false) → list и calc
 *     остались прежними, никаких изменений в storage.
 *   - Кейс 3: оба успешны → состояние согласовано (list[i].name === calc.name,
 *     updatedAt совпадает).
 *
 * Технически: storage-mock из storage-mock.js не умеет «бросать на N-м setItem»,
 * поэтому переопределяем localStorage локальным spy-объектом.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

// Установить mock localStorage ДО импорта модулей, использующих storage.
installLocalStorage();

const { store } = await import('../../js/state/store.js');
const calcList = await import('../../js/controllers/calcListController.js');
const persist = await import('../../js/state/persistence.js');
const { commitActiveCalc, commitNewCalc } = await import('../../js/services/calcPersistence.js');

/**
 * Spy-обёртка над MemoryStorage, позволяющая бросать ошибки на N-м вызове setItem.
 *
 * @param {object} opts
 * @param {Set<number>} [opts.failOnSetCalls] — индексы вызовов setItem (1-based),
 *   на которых нужно бросить QuotaExceededError. Если множество пустое — обычный storage.
 * @param {Set<string>} [opts.failOnKeys] — ключи, при записи которых бросаем ошибку.
 */
function installSpyStorage(opts = {}) {
    const { failOnSetCalls = new Set(), failOnKeys = new Set() } = opts;
    const data = new Map();
    let setCount = 0;
    const spy = {
        data,
        setCalls: [],
        get length() { return data.size; },
        setItem(k, v) {
            setCount += 1;
            this.setCalls.push({ key: String(k), call: setCount });
            if (failOnSetCalls.has(setCount) || failOnKeys.has(String(k))) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            data.set(String(k), String(v));
        },
        getItem(k) { return data.has(k) ? data.get(k) : null; },
        removeItem(k) { data.delete(k); },
        key(i) { return Array.from(data.keys())[i] ?? null; },
        clear() { data.clear(); }
    };
    Object.defineProperty(globalThis, 'localStorage', {
        value: spy,
        configurable: true,
        writable: true
    });
    return spy;
}

/** Снять снапшот текущего содержимого storage (для сравнения «до/после»). */
function snapshotStorage() {
    const out = {};
    for (let i = 0; i < globalThis.localStorage.length; i++) {
        const k = globalThis.localStorage.key(i);
        out[k] = globalThis.localStorage.getItem(k);
    }
    return out;
}

beforeEach(() => {
    // Чистый mock без спая для подготовки исходных данных.
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setPersistStatus('idle');
});

describe('commitActiveCalc — атомарность по двум ключам', () => {
    it('Кейс 3 (baseline): оба setItem успешны → state согласован', () => {
        // Подготовка: создаём расчёт обычным путём.
        const calc = calcList.createCalc('Atomic OK');
        // После createCalc commitActiveCalc уже отработал — в storage есть calc и list.
        const id = calc.id;

        // Меняем name + updatedAt и снова коммитим.
        const updated = { ...calc, name: 'Renamed', updatedAt: new Date().toISOString() };
        const ok = commitActiveCalc(updated);

        assert.equal(ok, true);
        assert.equal(store.getState().persistStatus, 'saved');

        const listAfter = persist.loadCalcList();
        const calcAfter = persist.loadCalc(id);
        const listEntry = listAfter.find(m => m.id === id);

        assert.ok(listEntry, 'запись в списке должна существовать');
        assert.equal(calcAfter.name, 'Renamed');
        assert.equal(listEntry.name, calcAfter.name,
            'list[i].name должно совпадать с calc.name');
        assert.equal(listEntry.updatedAt, calcAfter.updatedAt,
            'list[i].updatedAt должно совпадать с calc.updatedAt');
    });

    it('Кейс 2: первый setItem падает → list и calc остались прежними', () => {
        // Подготовка: создаём расчёт обычным путём (storage ещё не spy).
        const calc = calcList.createCalc('Initial');
        const id = calc.id;
        const oldName = calc.name;
        const oldUpdatedAt = calc.updatedAt;

        // Переносим прежнее содержимое в новый spy-storage и подменяем localStorage.
        const oldData = snapshotStorage();
        const spy = installSpyStorage({ failOnKeys: new Set(['calc.' + id]) });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);

        // Снимаем снапшот ДО commit.
        const before = snapshotStorage();

        // Пытаемся закоммитить с новым name. saveCalc должен упасть на первом setItem.
        const newCalc = { ...calc, name: 'NewName', updatedAt: new Date().toISOString() };
        const ok = commitActiveCalc(newCalc);

        assert.equal(ok, false);
        assert.equal(store.getState().persistStatus, 'error');

        // Storage не изменился: list и calc — прежние.
        const after = snapshotStorage();
        assert.deepEqual(after, before,
            'после неудачи saveCalc storage должен остаться в прежнем состоянии');

        const listAfter = persist.loadCalcList();
        const calcAfter = persist.loadCalc(id);
        const listEntry = listAfter.find(m => m.id === id);
        assert.equal(calcAfter.name, oldName, 'calc.name не меняется');
        assert.equal(calcAfter.updatedAt, oldUpdatedAt, 'calc.updatedAt не меняется');
        assert.equal(listEntry.name, oldName, 'list[i].name не меняется');
        assert.equal(listEntry.updatedAt, oldUpdatedAt, 'list[i].updatedAt не меняется');
    });

    it('Кейс 1: второй setItem падает (quota на calc.list) → откат списка к backup', () => {
        // Подготовка: создаём расчёт обычным путём.
        const calc = calcList.createCalc('Initial');
        const id = calc.id;
        const oldName = calc.name;
        const oldUpdatedAt = calc.updatedAt;

        // Снимаем backup списка ДО переключения на spy.
        const backupList = persist.loadCalcList();
        assert.ok(backupList.length >= 1, 'в backup должна быть запись о расчёте');

        // Переносим содержимое в spy и роняем сохранение списка (calc.list).
        const oldData = snapshotStorage();
        const spy = installSpyStorage({ failOnKeys: new Set(['calc.list']) });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);

        // Коммит должен:
        //  1) успешно записать calc.<id>,
        //  2) попытаться сохранить calc.list (упадёт),
        //  3) попытаться откатить calc.list к backup (тоже упадёт, т.к. spy роняет
        //     любую запись calc.list — но это допустимо: критично, что состояние,
        //     наблюдаемое через persist.loadCalcList, осталось backup'ом, ведь
        //     значение в storage не было перезаписано).
        const newCalc = { ...calc, name: 'WillFail', updatedAt: new Date().toISOString() };
        const ok = commitActiveCalc(newCalc);

        assert.equal(ok, false);
        assert.equal(store.getState().persistStatus, 'error');

        // calc.list в storage не изменился (запись не прошла) → loadCalcList === backup.
        const listAfter = persist.loadCalcList();
        assert.deepEqual(listAfter, backupList,
            'после неудачи saveCalcList список должен соответствовать backup');

        // ПОСЛЕ внешнего аудита #4 (PATCH 2.17.6) контракт усилен: при сбое
        // list-write _atomicCalcAndListWrite откатывает ОБА ключа к backup.
        // Поэтому calc.<id> также возвращается к oldName, и list[i].name тоже —
        // полная консистентность относительно backup-снапшота.
        const listEntry = listAfter.find(m => m.id === id);
        assert.equal(listEntry.name, oldName, 'list[i].name остался старым (откат)');
        assert.equal(listEntry.updatedAt, oldUpdatedAt, 'list[i].updatedAt остался старым (откат)');

        const calcAfter = persist.loadCalc(id);
        assert.equal(calcAfter.name, oldName,
            'audit #4 P1-1: calc.<id> также откатан к backup (раньше оставался NewName → расхождение)');
    });

    it('Кейс 1b: первая запись calc.list падает, откат calc.list успешен', () => {
        // Подготовка: создаём расчёт обычным путём.
        const calc = calcList.createCalc('Initial');
        const id = calc.id;
        const oldName = calc.name;

        const backupList = persist.loadCalcList();

        // Цель сценария: проверить, что когда первая попытка saveCalcList
        // падает, явная откатная запись saveCalcList(backupList) успешно
        // восстанавливает значение в storage.
        //
        // Привязываемся к ключу 'calc.list', а не к глобальному счётчику setItem,
        // потому что storage.js перед каждой записью делает probe setItem('__test__', ...)
        // — это сбивает любые count-based стратегии и при первой же ошибке
        // probe'а переключает storage на in-memory fallback.
        const oldData = snapshotStorage();
        const spy = installSpyStorage({});
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);

        let listWriteFailed = false;
        const origSetItem = spy.setItem.bind(spy);
        spy.setItem = function (k, v) {
            if (String(k) === 'calc.list' && !listWriteFailed) {
                listWriteFailed = true;
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            return origSetItem(k, v);
        };

        const newCalc = { ...calc, name: 'WillFail2', updatedAt: new Date().toISOString() };
        const ok = commitActiveCalc(newCalc);

        assert.equal(ok, false);
        assert.equal(store.getState().persistStatus, 'error');
        assert.equal(listWriteFailed, true, 'первая запись calc.list должна была упасть');

        // Список должен быть откатан явно: вторая запись calc.list
        // (saveCalcList(backupList)) проходит, восстанавливая значение.
        const listAfter = persist.loadCalcList();
        assert.deepEqual(listAfter, backupList,
            'явный откат saveCalcList(backupList) должен восстановить список к снапшоту');

        // Проверяем согласованность относительно backup.
        const listEntry = listAfter.find(m => m.id === id);
        assert.equal(listEntry.name, oldName, 'list[i].name откачен к backup');
    });
});

/**
 * Этап 11.1.1: контроллеры CRUD больше не вызывают persist.saveCalc и
 * persist.saveCalcList напрямую — они идут через commitActiveCalc /
 * commitNewCalc / commitCalcRename / commitMigratedCalc, которые делят
 * единое атомарное ядро _atomicCalcAndListWrite.
 *
 * Контракт для CRUD:
 *   - При сбое второго setItem (calc.list) список откатывается к backup,
 *     persistStatus → 'error'.
 *   - Контроллеры могут оставить activeCalc в store (это in-memory state),
 *     но снапшот в storage остаётся согласованным относительно backup'а.
 */
describe('CRUD-контроллеры — атомарность пары (calc, calc.list)', () => {
    it('createCalc: quota на calc.list → null + persistStatus=error (контракт изменён в аудите #3)', () => {
        // Подготовка: создаём начальное состояние через обычный mock.
        // backup списка = [] (расчётов ещё нет).
        const backupList = persist.loadCalcList();
        assert.deepEqual(backupList, [], 'baseline: список пуст');

        // Переносим в spy-storage и роняем calc.list при любой записи.
        const oldData = snapshotStorage();
        const spy = installSpyStorage({ failOnKeys: new Set(['calc.list']) });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);

        /* Внешний аудит #3 (2026-05-18, P2): createCalc на сбое commitNewCalc
         * возвращает null (раньше возвращал calc-объект → UI показывал
         * success-snackbar для несохранённого расчёта). */
        const created = calcList.createCalc('Quota Fail Create');
        assert.equal(created, null, 'createCalc должен вернуть null при quota');

        // Storage: persistStatus='error'.
        assert.equal(store.getState().persistStatus, 'error',
            'на сбое list-записи persistStatus должен стать error');

        // Список в storage = backup (откат сработал, либо запись не прошла).
        const listAfter = persist.loadCalcList();
        assert.deepEqual(listAfter, backupList,
            'после неудачной createCalc список должен соответствовать backup');
    });

    it('renameCalc: quota на calc.list → имя в списке откатывается к backup', () => {
        // Подготовка: создаём расчёт обычным путём.
        const calc = calcList.createCalc('OriginalName');
        const id = calc.id;
        const oldName = calc.name;
        const oldUpdatedAt = calc.updatedAt;

        // backup до rename.
        const backupList = persist.loadCalcList();
        const backupEntry = backupList.find(m => m.id === id);
        assert.ok(backupEntry, 'backup содержит запись о расчёте');
        assert.equal(backupEntry.name, oldName);

        // Переносим в spy и роняем calc.list.
        const oldData = snapshotStorage();
        const spy = installSpyStorage({ failOnKeys: new Set(['calc.list']) });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);

        // Rename — пара (calc, calc.list); list упадёт.
        calcList.renameCalc(id, 'NewName');

        // persistStatus=error, list[i].name остался старым.
        assert.equal(store.getState().persistStatus, 'error');

        const listAfter = persist.loadCalcList();
        const listEntry = listAfter.find(m => m.id === id);
        assert.ok(listEntry, 'запись в списке должна существовать');
        assert.equal(listEntry.name, oldName,
            'list[i].name должен остаться прежним (откат)');
        assert.equal(listEntry.updatedAt, oldUpdatedAt,
            'list[i].updatedAt должен остаться прежним (откат)');
    });

    it('duplicateCalc: quota на calc.list → дубль не появился в списке', () => {
        // Подготовка: исходный расчёт.
        const src = calcList.createCalc('Source');
        const srcId = src.id;

        // backup списка содержит ровно одну запись.
        const backupList = persist.loadCalcList();
        assert.equal(backupList.length, 1);

        // Переносим в spy и роняем calc.list.
        const oldData = snapshotStorage();
        const spy = installSpyStorage({ failOnKeys: new Set(['calc.list']) });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);

        // Дублируем — пара (calc, calc.list); list упадёт.
        /* Внешний аудит #3 (2026-05-18, P2): duplicateCalc на сбое возвращает null. */
        const copy = calcList.duplicateCalc(srcId);
        assert.equal(copy, null, 'duplicateCalc должен вернуть null при quota');

        // persistStatus=error, дубль не появился в списке storage.
        assert.equal(store.getState().persistStatus, 'error');

        const listAfter = persist.loadCalcList();
        assert.deepEqual(listAfter, backupList,
            'после неудачной duplicateCalc список должен соответствовать backup');
    });

    it('importCalcFromFile (новый id): quota на calc.list → calc.list не изменён', async () => {
        // Подготовка: один существующий расчёт + backup списка.
        const existing = calcList.createCalc('Existing');
        const backupList = persist.loadCalcList();
        assert.equal(backupList.length, 1);

        // Эмулируем импортированный расчёт (после миграции и валидации).
        // Проще — вызываем напрямую commitNewCalc, что эквивалентно тому,
        // как importCalcFromFile коммитит новый calc после resolve конфликта
        // id (через uuid). Это та же атомарная пара.
        const importedId = 'imported-' + Date.now();
        const importedCalc = {
            ...existing,
            id: importedId,
            name: 'Imported',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Переносим в spy и роняем calc.list.
        const oldData = snapshotStorage();
        const spy = installSpyStorage({ failOnKeys: new Set(['calc.list']) });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);

        // Имитация финальной фиксации importCalcFromFile.
        const ok = commitNewCalc(importedCalc, {
            id: importedCalc.id,
            name: importedCalc.name,
            updatedAt: importedCalc.updatedAt
        });

        assert.equal(ok, false, 'commitNewCalc вернул false на сбое list');
        assert.equal(store.getState().persistStatus, 'error');

        // Список в storage не изменился (откат к backup).
        const listAfter = persist.loadCalcList();
        assert.deepEqual(listAfter, backupList,
            'после неудачной фиксации импорта список должен соответствовать backup');
        const importedEntry = listAfter.find(m => m.id === importedId);
        assert.equal(importedEntry, undefined,
            'импортированный расчёт НЕ должен появиться в списке после отката');
    });
});
