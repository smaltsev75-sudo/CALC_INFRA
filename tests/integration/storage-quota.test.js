/**
 * Smoke-тесты на исчерпание квоты localStorage (Этап 10.3.3).
 *
 * Цель: убедиться, что когда браузер бросает QuotaExceededError при записи
 * в localStorage, приложение:
 *   - НЕ роняет UI (commitActiveCalc возвращает false, не пробрасывает throw),
 *   - выставляет state.persistStatus === 'error' (пользователь увидит индикатор),
 *   - не оставляет state.calcList сломанным (сам in-memory state не зависит
 *     от storage-сбоя),
 *   - после исчезновения квоты следующая запись проходит штатно.
 *
 * Тестовая инфраструктура: spy-обёртка над MemoryStorage из storage-mock.js,
 * умеющая бросать QuotaExceededError по ключу или по N-му вызову setItem.
 *
 * Атомарность по двум ключам (сценарий «частичная квота») уже покрыта
 * в calc-persistence-atomicity.test.js — здесь не дублируем; этот файл
 * фокусируется на пользовательской observability сбоя.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

// Установить mock localStorage ДО импорта модулей, использующих storage.
installLocalStorage();

const { store } = await import('../../js/state/store.js');
const calcList = await import('../../js/controllers/calcListController.js');
const persist = await import('../../js/state/persistence.js');
const { commitActiveCalc } = await import('../../js/services/calcPersistence.js');

/**
 * Spy-обёртка над MemoryStorage — повторяем хелпер из
 * calc-persistence-atomicity.test.js (там он private, экспорта нет).
 * Поведение идентично; см. подробные комментарии в источнике.
 *
 * @param {object} opts
 * @param {Set<string>} [opts.failOnKeys] — ключи, при записи которых бросаем quota.
 * @param {Set<number>} [opts.failOnSetCalls] — номера вызовов setItem (1-based)
 *   для падения. Удобно для воспроизведения «вторая запись падает».
 * @param {boolean} [opts.failAll] — кидать ошибку на любой setItem (тотальная
 *   квота). При этом storage.js на пробе '__test__' переключится в memory
 *   fallback — это ожидаемое поведение, тестируем именно его.
 */
function installSpyStorage(opts = {}) {
    const { failOnSetCalls = new Set(), failOnKeys = new Set(), failAll = false } = opts;
    const data = new Map();
    let setCount = 0;
    const spy = {
        data,
        setCalls: [],
        get length() { return data.size; },
        setItem(k, v) {
            setCount += 1;
            this.setCalls.push({ key: String(k), call: setCount });
            if (failAll || failOnSetCalls.has(setCount) || failOnKeys.has(String(k))) {
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

/** Снять снапшот текущего содержимого storage. */
function snapshotStorage() {
    const out = {};
    for (let i = 0; i < globalThis.localStorage.length; i++) {
        const k = globalThis.localStorage.key(i);
        out[k] = globalThis.localStorage.getItem(k);
    }
    return out;
}

beforeEach(() => {
    // Чистый mock без spy для подготовки исходных данных.
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setPersistStatus('idle');
});

describe('storage quota — пользовательская реакция на сбой записи', () => {
    it('quota на ВСЕ calc-ключи → commitActiveCalc=false, persistStatus=error, calcList в store не сломан', () => {
        // Подготовка: создаём расчёт обычным путём (storage ещё не spy).
        const calc = calcList.createCalc('Quota-test');
        const id = calc.id;

        // Снимаем снапшот state.calcList ДО переключения на падающий storage.
        const calcListBefore = store.getState().calcList;
        assert.ok(calcListBefore.length >= 1, 'baseline: расчёт зарегистрирован в store');

        // Подменяем localStorage на spy, который роняет любую запись с
        // префиксом 'calc.' (и calc.<id>, и calc.list, и calc.activeCalc),
        // но пропускает probe '__test__'. Это моделирует реальный браузерный
        // кейс «свободного места достаточно на проб, но не на сохранение
        // больших значений приложения». Если бросать на ВСЕ ключи (включая
        // probe), getStorage() в storage.js переключится в in-memory fallback
        // и writeJson вернёт true — тогда мы тестировали бы graceful
        // degradation, а не наблюдаемость сбоя для пользователя.
        const oldData = snapshotStorage();
        const spy = installSpyStorage({});
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);
        const origSetItem = spy.setItem.bind(spy);
        spy.setItem = function (k, v) {
            if (String(k).startsWith('calc.')) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            return origSetItem(k, v);
        };

        const updated = { ...calc, name: 'Renamed under quota', updatedAt: new Date().toISOString() };
        const ok = commitActiveCalc(updated);

        assert.equal(ok, false, 'commitActiveCalc должен вернуть false при quota');
        assert.equal(store.getState().persistStatus, 'error',
            'persistStatus должен переключиться в error для UI-индикатора');

        // state.calcList в store остаётся таким же (мы не делали store.setCalcList
        // в этом тесте — store независим от storage-сбоя).
        const calcListAfter = store.getState().calcList;
        assert.deepEqual(calcListAfter, calcListBefore,
            'state.calcList в store не должен измениться из-за storage-сбоя');
    });

    it('quota только на calc.list → commitActiveCalc=false, оба ключа откатаны к backup (audit #4 P1-1)', () => {
        // Подготовка: создаём расчёт обычным путём.
        const calc = calcList.createCalc('Partial-quota-test');
        const id = calc.id;
        const originalName = calc.name;

        // Переносим данные в spy и роняем именно calc.list.
        // ДО внешнего аудита #4 (PATCH 2.17.6) saveCalc(<id>) перезаписывал
        // calc.<id> новым содержимым ДО падения saveCalcList → расхождение
        // calc.<id>='NewName' vs list[i].name='Partial-quota-test'.
        // ПОСЛЕ audit-4 P1-1 _atomicCalcAndListWrite берёт backup calc.<id>
        // ДО первой записи и откатывает его при сбое list-write → ОБА ключа
        // консистентны относительно backup'а.
        const oldData = snapshotStorage();
        const spy = installSpyStorage({ failOnKeys: new Set(['calc.list']) });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);

        const updated = { ...calc, name: 'NewName', updatedAt: new Date().toISOString() };
        const ok = commitActiveCalc(updated);

        assert.equal(ok, false);
        assert.equal(store.getState().persistStatus, 'error');

        // ПОСЛЕ аудита #4: calc.<id> откатан к backup-snapshot → старое имя.
        const calcAfter = persist.loadCalc(id);
        assert.ok(calcAfter, 'после rollback calc.<id> должен присутствовать в storage');
        assert.equal(calcAfter.name, originalName,
            'calc.<id> откатан к backup-snapshot (старое имя), а не перезаписан новым');
    });

    it('quota исчезает при повторной попытке → следующий commitActiveCalc успешен', () => {
        // Подготовка: создаём расчёт обычным путём.
        const calc = calcList.createCalc('Recoverable-quota');
        const id = calc.id;

        // Spy с одноразовой ошибкой: первая запись calc.<id> падает,
        // вторая (после «освобождения» квоты) проходит. Эмулируем повторную
        // попытку пользователя.
        const oldData = snapshotStorage();
        const spy = installSpyStorage({});
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);

        let calcWriteFailed = false;
        const calcKey = 'calc.' + id;
        const origSetItem = spy.setItem.bind(spy);
        spy.setItem = function (k, v) {
            if (String(k) === calcKey && !calcWriteFailed) {
                calcWriteFailed = true;
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            return origSetItem(k, v);
        };

        // Первая попытка должна провалиться.
        const updated = { ...calc, name: 'Try1', updatedAt: new Date().toISOString() };
        const ok1 = commitActiveCalc(updated);
        assert.equal(ok1, false, 'первая попытка: quota → false');
        assert.equal(store.getState().persistStatus, 'error');
        assert.equal(calcWriteFailed, true, 'падение действительно произошло');

        // Вторая попытка с тем же контентом — теперь storage принимает запись.
        const ok2 = commitActiveCalc(updated);
        assert.equal(ok2, true, 'вторая попытка: quota исчезла → true');
        assert.equal(store.getState().persistStatus, 'saved',
            'persistStatus должен восстановиться в saved');

        // Проверяем согласованность: list[i] и calc.<id> совпадают по name/updatedAt.
        const listAfter = persist.loadCalcList();
        const calcAfter = persist.loadCalc(id);
        const listEntry = listAfter.find(m => m.id === id);
        assert.ok(listEntry, 'запись в списке должна существовать');
        assert.equal(calcAfter.name, 'Try1');
        assert.equal(listEntry.name, calcAfter.name,
            'после восстановления list[i].name должен совпасть с calc.name');
        assert.equal(listEntry.updatedAt, calcAfter.updatedAt,
            'после восстановления list[i].updatedAt должен совпасть с calc.updatedAt');
    });
});
