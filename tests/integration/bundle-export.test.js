import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const { store } = await import('../../js/state/store.js');
const calcList = await import('../../js/controllers/calcListController.js');
const calc = await import('../../js/controllers/calcController.js');
const persist = await import('../../js/state/persistence.js');
const bundleMod = await import('../../js/services/bundleExport.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
});

describe('bundleExport: buildStateBundle', () => {
    it('собирает все расчёты + справочник + active id', () => {
        const c1 = calcList.createCalc('A');
        const c2 = calcList.createCalc('B');
        // c2 теперь активный (последний созданный)

        const bundle = bundleMod.buildStateBundle();
        /* Stage VAT-2 Phase 6: BUNDLE_MAJOR bumped 2→3 (provider JSON schema v2
         * внутри bundle). Новый export всегда пишет 3.0; bundle-2.x / 1.x
         * остаются читаемыми через migrateCalculation. */
        assert.equal(bundle.version, 'bundle-3.0');
        assert.ok(bundle.exportedAt);
        assert.ok(bundle.appVersion);
        assert.equal(bundle.calculations.length, 2);
        assert.equal(bundle.activeCalcId, c2.id);
        assert.ok(Array.isArray(bundle.defaultDictionary.items));
        assert.ok(Array.isArray(bundle.defaultDictionary.questions));
    });

    it('пустое состояние = пустой bundle', () => {
        const bundle = bundleMod.buildStateBundle();
        assert.equal(bundle.calculations.length, 0);
        assert.equal(bundle.activeCalcId, null);
    });
});

describe('bundleExport: validateBundle', () => {
    it('принимает корректный bundle', () => {
        calcList.createCalc('Test');
        const bundle = bundleMod.buildStateBundle();
        const v = bundleMod.validateBundle(bundle);
        assert.equal(v.valid, true, JSON.stringify(v.errors));
    });

    it('отвергает не-объект', () => {
        assert.equal(bundleMod.validateBundle(null).valid, false);
        assert.equal(bundleMod.validateBundle('hello').valid, false);
    });

    it('отвергает без version', () => {
        const r = bundleMod.validateBundle({ calculations: [] });
        assert.equal(r.valid, false);
        assert.ok(r.errors.some(e => e.path === 'version'));
    });

    it('отвергает не-bundle version', () => {
        const r = bundleMod.validateBundle({ version: '1.0', calculations: [] });
        assert.equal(r.valid, false);
    });

    it('отвергает calculations не массив', () => {
        const r = bundleMod.validateBundle({ version: 'bundle-1.0', calculations: 'oops' });
        assert.equal(r.valid, false);
    });

    it('отвергает битый расчёт внутри', () => {
        const r = bundleMod.validateBundle({
            version: 'bundle-1.0',
            calculations: [{ id: '', name: '' /* пусто */ }]
        });
        assert.equal(r.valid, false);
        assert.ok(r.errors.length > 0);
    });

    it('отвергает defaultDictionary без items/questions', () => {
        const r = bundleMod.validateBundle({
            version: 'bundle-1.0',
            calculations: [],
            defaultDictionary: { items: 'not-array' }
        });
        assert.equal(r.valid, false);
    });
});

describe('bundleExport: applyStateBundle', () => {
    it('заменяет всё состояние', () => {
        // 1. Создаём bundle с 2 расчётами «NEW».
        calcList.createCalc('NEW-1');
        calcList.createCalc('NEW-2');
        const bundle = bundleMod.buildStateBundle();
        assert.equal(bundle.calculations.length, 2);

        // 2. Полностью очищаем и создаём один OLD-расчёт.
        installLocalStorage();
        store.setActiveCalc(null);
        store.setCalcList([]);
        calcList.createCalc('OLD');
        assert.equal(persist.loadCalcList().length, 1);

        // 3. Применяем bundle → OLD должен быть заменён на NEW-1, NEW-2.
        const result = bundleMod.applyStateBundle(bundle);
        assert.equal(result.ok, true);
        assert.equal(result.applied.calculations, 2);

        const list = persist.loadCalcList();
        assert.equal(list.length, 2);
        assert.ok(list.find(m => m.name === 'NEW-1'));
        assert.ok(list.find(m => m.name === 'NEW-2'));
        assert.ok(!list.find(m => m.name === 'OLD'));
    });

    it('активный id корректно восстанавливается', () => {
        calcList.createCalc('A');
        const cB = calcList.createCalc('B');
        const bundle = bundleMod.buildStateBundle();

        installLocalStorage();
        bundleMod.applyStateBundle(bundle);
        assert.equal(persist.loadActiveCalcId(), cB.id);
    });

    it('при невалидном bundle ничего не меняется', () => {
        calcList.createCalc('Original');
        const before = persist.loadCalcList();

        const r = bundleMod.applyStateBundle({ version: 'bundle-1.0', calculations: 'broken' });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'validation');

        const after = persist.loadCalcList();
        assert.deepEqual(before, after);
    });

    it('применяет миграцию к legacy-расчётам внутри bundle', () => {
        // Сделаем bundle с legacy-форматом: phase_duration_months в answers
        const legacyCalc = {
            id: 'legacy-1', name: 'Legacy', version: '1.0',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            settings: { period: 'monthly', bufferTask: 0.3, bufferProject: 0.15, indexation: 0.1, currency: 'RUB' },
            answers: { phase_duration_months: 6, pcu: 50 },
            dictionaries: { items: [], questions: [] }
        };
        const bundle = {
            version: 'bundle-1.0',
            exportedAt: '2026',
            appVersion: '1.0.0',
            activeCalcId: 'legacy-1',
            defaultDictionary: { items: [], questions: [] },
            calculations: [legacyCalc]
        };

        installLocalStorage();
        const r = bundleMod.applyStateBundle(bundle);
        assert.equal(r.ok, true, JSON.stringify(r));

        const loaded = persist.loadCalc('legacy-1');
        assert.equal(loaded.settings.phaseDurationMonths, 6);
        assert.ok(!('phase_duration_months' in loaded.answers));
    });
});

describe('bundleExport: round-trip', () => {
    it('export → import → identical state', () => {
        calcList.createCalc('A');
        calc.setAnswer('pcu', 100);
        calcList.createCalc('B');
        calc.setAnswer('pcu', 200);

        const bundle = bundleMod.buildStateBundle();
        const json = JSON.stringify(bundle);

        installLocalStorage();
        const parsed = JSON.parse(json);
        const r = bundleMod.applyStateBundle(parsed);

        assert.equal(r.ok, true);
        assert.equal(persist.loadCalcList().length, 2);
        assert.ok(persist.loadCalcList().find(m => m.name === 'A'));
        assert.ok(persist.loadCalcList().find(m => m.name === 'B'));
    });
});

/* ---------- Хелперы-конструкторы фикстур (10.1.2 / 10.1.4) ---------- */

/**
 * Минимально валидный ЭК для defaultDictionary.items.
 * Перекрывайте поля через overrides, чтобы получить «битый» вариант.
 * @param {Partial<object>} overrides
 * @returns {object}
 */
function makeValidItem(overrides = {}) {
    return {
        id: 'item-1',
        name: 'Тестовый ЭК',
        unit: 'шт.',
        pricePerUnit: 100,
        category: 'HW',
        billingInterval: 'monthly',
        resourceClass: 'CPU',
        applicableStands: ['DEV', 'PROD'],
        qtyFormulas: { DEV: '1', PROD: '1' },
        ...overrides
    };
}

/**
 * Минимально валидный вопрос для defaultDictionary.questions.
 * @param {Partial<object>} overrides
 * @returns {object}
 */
function makeValidQuestion(overrides = {}) {
    return {
        id: 'q_one',
        section: 'business',
        title: 'Тестовый вопрос',
        type: 'number',
        order: 100,
        ...overrides
    };
}

/**
 * Минимально валидный bundle (пустой), куда удобно подкидывать
 * defaultDictionary / calculations через overrides.
 * @param {Partial<object>} overrides
 * @returns {object}
 */
function makeValidBundle(overrides = {}) {
    return {
        version: 'bundle-1.0',
        exportedAt: '2026-05-03T00:00:00Z',
        appVersion: '1.1.0',
        activeCalcId: null,
        defaultDictionary: { items: [], questions: [] },
        calculations: [],
        ...overrides
    };
}

describe('bundleExport: validateBundle — поэлементная валидация defaultDictionary (10.1.2)', () => {
    it('отвергает item с отрицательным pricePerUnit', () => {
        const bundle = makeValidBundle({
            defaultDictionary: {
                items: [makeValidItem({ pricePerUnit: -100 })],
                questions: []
            }
        });
        const r = bundleMod.validateBundle(bundle);
        assert.equal(r.valid, false);
        assert.ok(
            r.errors.some(e => e.path.startsWith('defaultDictionary.items[0]')),
            `Ожидалась ошибка с path defaultDictionary.items[0].*, получено: ${JSON.stringify(r.errors)}`
        );
    });

    it('отвергает item без обязательного поля id', () => {
        const broken = makeValidItem();
        delete broken.id;
        const bundle = makeValidBundle({
            defaultDictionary: {
                items: [broken],
                questions: []
            }
        });
        const r = bundleMod.validateBundle(bundle);
        assert.equal(r.valid, false);
        assert.ok(
            r.errors.some(e => e.path === 'defaultDictionary.items[0].id'),
            `Ожидалась ошибка по id, получено: ${JSON.stringify(r.errors)}`
        );
    });

    it('отвергает question без id', () => {
        const broken = makeValidQuestion();
        delete broken.id;
        const bundle = makeValidBundle({
            defaultDictionary: {
                items: [],
                questions: [broken]
            }
        });
        const r = bundleMod.validateBundle(bundle);
        assert.equal(r.valid, false);
        assert.ok(
            r.errors.some(e => e.path === 'defaultDictionary.questions[0].id'),
            `Ожидалась ошибка по id, получено: ${JSON.stringify(r.errors)}`
        );
    });

    it('пропускает минимально валидный bundle (защита от регрессии)', () => {
        const bundle = makeValidBundle({
            defaultDictionary: {
                items: [makeValidItem()],
                questions: [makeValidQuestion()]
            }
        });
        const r = bundleMod.validateBundle(bundle);
        assert.equal(r.valid, true, JSON.stringify(r.errors));
    });
});

describe('bundleExport: applyStateBundle — атомарность миграции (10.1.3)', () => {
    it('возвращает ok=false reason="migration" и не меняет состояние при падении migrate', () => {
        // 1. Готовим baseline-состояние: один обычный расчёт «BASELINE».
        installLocalStorage();
        store.setActiveCalc(null);
        store.setCalcList([]);
        const baseline = calcList.createCalc('BASELINE');
        const listBefore = persist.loadCalcList();
        const baselineLoadedBefore = persist.loadCalc(baseline.id);
        const activeBefore = persist.loadActiveCalcId();

        // 2. Готовим bundle с заведомо битым legacy-расчётом: dictionaries.items
        //    задан как объект (не массив). Шаг 1→2 ожидает массив и при
        //    `for (const item of items)` с object (не итерируемый) бросит TypeError,
        //    который migrateCalculation обернёт в MigrationError.
        const brokenLegacy = {
            id: 'broken-1',
            name: 'Broken legacy',
            version: '1.0',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            schemaVersion: 1,
            settings: {
                period: 'monthly', bufferTask: 0, bufferProject: 0,
                indexation: 0, phaseDurationMonths: 6
            },
            answers: {},
            dictionaries: {
                // Вместо массива — объект: for...of упадёт TypeError.
                items: { not: 'an array' },
                questions: []
            }
        };
        const bundle = {
            version: 'bundle-1.0',
            exportedAt: '2026-05-03T00:00:00Z',
            appVersion: '1.1.0',
            activeCalcId: 'broken-1',
            defaultDictionary: { items: [], questions: [] },
            calculations: [brokenLegacy]
        };

        // 3. Применяем — должны получить reason='migration' и сохранённое состояние.
        const r = bundleMod.applyStateBundle(bundle);
        assert.equal(r.ok, false, JSON.stringify(r));
        assert.equal(r.reason, 'migration', `Ожидался reason=migration, получено: ${JSON.stringify(r)}`);
        assert.ok(Array.isArray(r.errors) && r.errors.length > 0, 'errors[] обязательно');
        const err = r.errors[0];
        assert.equal(err.calcId, 'broken-1');
        assert.equal(err.step, '1→2');
        assert.ok(/Migration 1→2 failed/.test(err.message), `сообщение должно содержать «Migration 1→2 failed», получено: ${err.message}`);

        // 4. Состояние storage не должно измениться (атомарность):
        //    список тот же, расчёт тот же, активный id тот же.
        const listAfter = persist.loadCalcList();
        assert.deepEqual(listAfter, listBefore, 'список расчётов не должен измениться');
        const baselineLoadedAfter = persist.loadCalc(baseline.id);
        assert.deepEqual(baselineLoadedAfter, baselineLoadedBefore, 'baseline-расчёт не должен измениться');
        assert.equal(persist.loadActiveCalcId(), activeBefore, 'активный id не должен измениться');
        // И битый расчёт точно НЕ записан.
        assert.equal(persist.loadCalc('broken-1'), null, 'битый calc не должен попасть в storage');
    });
});

describe('bundleExport: validateBundle — отлов дублей id (10.1.4)', () => {
    it('отвергает bundle с двумя calculations одного id', () => {
        // Готовим два расчёта с одинаковым id. Минимальная структура,
        // которая пройдёт validateCalculation, не интересна — даже если
        // расчёты невалидны, ошибка про дубликат должна присутствовать.
        const calcA = {
            id: 'dup-id',
            name: 'A',
            version: '1.0',
            settings: { period: 'monthly' },
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
        const calcB = { ...calcA, name: 'B' };
        const bundle = makeValidBundle({ calculations: [calcA, calcB] });

        const r = bundleMod.validateBundle(bundle);
        assert.equal(r.valid, false);
        const dupErr = r.errors.find(e =>
            e.path === 'calculations[1].id' && /Дубликат id/.test(e.message)
        );
        assert.ok(dupErr, `Ожидалась ошибка «Дубликат id» по calculations[1].id, получено: ${JSON.stringify(r.errors)}`);
        assert.ok(/dup-id/.test(dupErr.message));
    });

    it('отвергает bundle с двумя defaultDictionary.items одного id', () => {
        const itemA = makeValidItem({ id: 'same-id', name: 'A' });
        const itemB = makeValidItem({ id: 'same-id', name: 'B' });
        const bundle = makeValidBundle({
            defaultDictionary: {
                items: [itemA, itemB],
                questions: []
            }
        });

        const r = bundleMod.validateBundle(bundle);
        assert.equal(r.valid, false);
        const dupErr = r.errors.find(e =>
            e.path === 'defaultDictionary.items[1].id' && /Дубликат id/.test(e.message)
        );
        assert.ok(dupErr, `Ожидалась ошибка «Дубликат id» по items[1].id, получено: ${JSON.stringify(r.errors)}`);
        assert.ok(/same-id/.test(dupErr.message));
    });

    it('отвергает bundle с двумя defaultDictionary.questions одного id', () => {
        const qA = makeValidQuestion({ id: 'q_dup', title: 'A' });
        const qB = makeValidQuestion({ id: 'q_dup', title: 'B' });
        const bundle = makeValidBundle({
            defaultDictionary: {
                items: [],
                questions: [qA, qB]
            }
        });

        const r = bundleMod.validateBundle(bundle);
        assert.equal(r.valid, false);
        const dupErr = r.errors.find(e =>
            e.path === 'defaultDictionary.questions[1].id' && /Дубликат id/.test(e.message)
        );
        assert.ok(dupErr, `Ожидалась ошибка «Дубликат id» по questions[1].id, получено: ${JSON.stringify(r.errors)}`);
        assert.ok(/q_dup/.test(dupErr.message));
    });
});

/* ---------- 10.2.4: тесты rollback в applyStateBundle ---------- */

/**
 * Установить «жадный» localStorage-mock с инжектом throw-поведения.
 * Возвращает объект с методами для управления throw-сценариями
 * на конкретных вызовах setItem/removeItem.
 *
 * Зачем: writeJson в storage.js глотает ошибки setItem (возвращает false),
 * а вот removeKey пробрасывает throw наружу. Чтобы добраться до catch
 * в applyStateBundle, нам нужно выбросить из removeItem.
 */
function installThrowingStorage() {
    const data = new Map();
    const state = {
        throwOnRemoveItem: null,    // (key, callIdx) => true чтобы кинуть
        removeItemCalls: 0,
        thrownMessages: []
    };
    const ls = {
        get length() { return data.size; },
        key(i) { return Array.from(data.keys())[i] ?? null; },
        getItem(k) { return data.has(k) ? data.get(k) : null; },
        setItem(k, v) { data.set(String(k), String(v)); },
        removeItem(k) {
            state.removeItemCalls++;
            if (state.throwOnRemoveItem && state.throwOnRemoveItem(String(k), state.removeItemCalls)) {
                const msg = `mock removeItem throw: key=${k} call=${state.removeItemCalls}`;
                state.thrownMessages.push(msg);
                throw new Error(msg);
            }
            data.delete(String(k));
        },
        clear() { data.clear(); }
    };
    Object.defineProperty(globalThis, 'localStorage', {
        value: ls, configurable: true, writable: true
    });
    return { ls, data, state };
}

describe('bundleExport: applyStateBundle — rollback при ошибке записи (10.2.4)', () => {
    it('при падении в фазе apply возвращает ok=false reason="apply" и восстанавливает backup', () => {
        // 1. В обычном (не-throw) storage готовим bundle с двумя НОВЫМИ
        //    расчётами «NEW-A»/«NEW-B». Сохраняем JSON-копию, чтобы потом
        //    применить тот же bundle в throw-storage.
        installLocalStorage();
        store.setActiveCalc(null);
        store.setCalcList([]);
        calcList.createCalc('NEW-A');
        calcList.createCalc('NEW-B');
        const bundle = JSON.parse(JSON.stringify(bundleMod.buildStateBundle()));
        assert.equal(bundle.calculations.length, 2, 'precondition: bundle с 2 расчётами');

        // 2. Готовим baseline-данные (полноценный объект расчёта),
        //    которые позже руками положим в throw-storage.
        installLocalStorage();
        store.setActiveCalc(null);
        store.setCalcList([]);
        const baseline = calcList.createCalc('BASELINE');
        const baselineCopy = JSON.parse(JSON.stringify(baseline));

        // 3. Включаем throw-storage и заново кладём только baseline.
        const env = installThrowingStorage();
        store.setActiveCalc(null);
        store.setCalcList([]);
        persist.saveCalc(baselineCopy);
        persist.saveCalcList([{
            id: baselineCopy.id, name: baselineCopy.name, updatedAt: baselineCopy.updatedAt
        }]);
        persist.saveActiveCalcId(baselineCopy.id);

        const listBefore = persist.loadCalcList();
        const baselineLoadedBefore = persist.loadCalc(baselineCopy.id);
        const activeBefore = persist.loadActiveCalcId();
        assert.equal(listBefore.length, 1, 'precondition: один baseline в storage');
        assert.ok(baselineLoadedBefore, 'precondition: baseline загружается');

        // 4. Throw ТОЛЬКО на removeItem с ключом «calc.<baseline.id>» —
        //    это первый persist.removeCalc(...) в фазе apply. Bundle-новые
        //    калки имеют другие id, поэтому при rollback'овском
        //    persist.removeCalc(c.id) для них throw НЕ сработает,
        //    и rollback пройдёт чисто.
        const baselineKey = `calc.${baselineCopy.id}`;
        env.state.throwOnRemoveItem = (k) => k === baselineKey;

        const r = bundleMod.applyStateBundle(bundle);

        // 5. Ожидаем ok=false с reason='apply'.
        assert.equal(r.ok, false, JSON.stringify(r));
        assert.equal(r.reason, 'apply', `Ожидался reason=apply, получено: ${JSON.stringify(r)}`);
        assert.ok(typeof r.error === 'string' && r.error.length > 0, 'error-сообщение должно присутствовать');

        // 6. После rollback (с отключённым throw для чистоты ассертов):
        //    baseline на месте, новых калков нет, активный id восстановлен.
        env.state.throwOnRemoveItem = null;
        const baselineLoadedAfter = persist.loadCalc(baselineCopy.id);
        assert.deepEqual(baselineLoadedAfter, baselineLoadedBefore, 'baseline восстановлен из backup');
        const listAfter = persist.loadCalcList();
        assert.deepEqual(listAfter, listBefore, 'список расчётов восстановлен из backup');
        assert.equal(persist.loadActiveCalcId(), activeBefore, 'активный id восстановлен из backup');
        // rollback прошёл без ошибок → rollbackError отсутствует.
        assert.equal(r.rollbackError, undefined, 'rollback без ошибок ⇒ rollbackError отсутствует');
    });

    it('если падает и primary, и rollback — возвращает rollbackError', () => {
        // 1. Готовим bundle в чистом storage (как в первом тесте).
        installLocalStorage();
        store.setActiveCalc(null);
        store.setCalcList([]);
        calcList.createCalc('NEW-X');
        const bundle = JSON.parse(JSON.stringify(bundleMod.buildStateBundle()));

        // 2. Готовим baseline-данные (полноценный объект).
        installLocalStorage();
        store.setActiveCalc(null);
        store.setCalcList([]);
        const baseline = calcList.createCalc('BASELINE-2');
        const baselineCopy = JSON.parse(JSON.stringify(baseline));

        // 3. throw-storage + только baseline.
        const env = installThrowingStorage();
        store.setActiveCalc(null);
        store.setCalcList([]);
        persist.saveCalc(baselineCopy);
        persist.saveCalcList([{
            id: baselineCopy.id, name: baselineCopy.name, updatedAt: baselineCopy.updatedAt
        }]);
        persist.saveActiveCalcId(baselineCopy.id);

        // 4. Throw на КАЖДОМ removeItem кроме служебной integrity-проверки
        //    `__test__` из storage.js:getStorage() — иначе getStorage()
        //    свалится в _memoryFallback и наш throw-mock вообще не дойдёт
        //    до applyStateBundle. Это сначала поломает первый
        //    persist.removeCalc(baseline.id) в основной фазе apply
        //    (primary throw), затем в catch-блоке поломает
        //    persist.removeCalc(bundle.calculations[0].id) в rollback —
        //    rollbackError должен быть зафиксирован.
        env.state.throwOnRemoveItem = (k) => k !== '__test__';

        const r = bundleMod.applyStateBundle(bundle);

        assert.equal(r.ok, false, JSON.stringify(r));
        assert.equal(r.reason, 'apply');
        assert.ok(typeof r.error === 'string' && r.error.length > 0, 'primary error присутствует');
        // Главное для 10.2.4: rollback-ошибка теперь видна, а не проглочена.
        assert.ok(typeof r.rollbackError === 'string' && r.rollbackError.length > 0,
            `rollbackError должен присутствовать, получено: ${JSON.stringify(r)}`);
    });
});

/* ---------- 10.2.6: forward-compat для bundle version ---------- */

describe('bundleExport: validateBundle — forward-compat по version (10.2.6 / Sprint 3.0 / VAT-2 Phase 6)', () => {
    /* Stage VAT-2 Phase 6: BUNDLE_MAJOR bumped 2→3 (provider JSON schema v2).
       v1.x / v2.x — legacy, ещё читаются (backward compat); v3.x — текущие;
       v4.x+ — будущие, отвергаются (forward-compat защита). */
    it('отвергает bundle с major выше текущего (bundle-4.0)', () => {
        const bundle = makeValidBundle({ version: 'bundle-4.0' });
        const r = bundleMod.validateBundle(bundle);
        assert.equal(r.valid, false);
        const verr = r.errors.find(e => e.path === 'version' && /более новой версии/.test(e.message));
        assert.ok(verr, `Ожидалась ошибка про «более новой версии», получено: ${JSON.stringify(r.errors)}`);
    });

    it('принимает bundle с тем же major и более высоким minor (bundle-3.5)', () => {
        const bundle = makeValidBundle({ version: 'bundle-3.5' });
        const r = bundleMod.validateBundle(bundle);
        assert.equal(r.valid, true, JSON.stringify(r.errors));
    });

    it('принимает bundle текущего major (bundle-3.0)', () => {
        const bundle = makeValidBundle({ version: 'bundle-3.0' });
        const r = bundleMod.validateBundle(bundle);
        assert.equal(r.valid, true, JSON.stringify(r.errors));
    });

    it('legacy bundle прошлого major всё ещё принимается (bundle-2.0 backward compat)', () => {
        const bundle = makeValidBundle({ version: 'bundle-2.0' });
        const r = bundleMod.validateBundle(bundle);
        assert.equal(r.valid, true, `bundle-2.0 должен оставаться читаемым: ${JSON.stringify(r.errors)}`);
    });

    it('legacy bundle совсем старого major (bundle-1.0 backward compat)', () => {
        const bundle = makeValidBundle({ version: 'bundle-1.0' });
        const r = bundleMod.validateBundle(bundle);
        assert.equal(r.valid, true, `bundle-1.0 должен оставаться читаемым: ${JSON.stringify(r.errors)}`);
    });

    it('отвергает bundle с неузнаваемым форматом version (bundle-x.y)', () => {
        const bundle = makeValidBundle({ version: 'bundle-x.y' });
        const r = bundleMod.validateBundle(bundle);
        assert.equal(r.valid, false);
        const verr = r.errors.find(e => e.path === 'version' && /Некорректный формат/.test(e.message));
        assert.ok(verr, `Ожидалась ошибка про «Некорректный формат», получено: ${JSON.stringify(r.errors)}`);
    });
});
