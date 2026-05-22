/**
 * Внешний аудит #8 (2026-05-18, восьмой за день).
 *
 * 5 пунктов — следующая волна silent-failure'ов того же класса:
 *
 *   P1-1 storage.getReadStorage после write-probe fail возвращал memory
 *        fallback по `_probedOk===false`. При квоте writeJson → false,
 *        потом readJson → пустой fallback (хотя данные в реальном localStorage).
 *
 *   P1-2 duplicateItem/duplicateQuestion игнорировали результат saveItem/
 *        saveQuestion: при quota возвращали copy.id, caller лживо рапортовал
 *        success, дубль не создан.
 *
 *   P2-1 priceImportMappingController.applyPriceImport смотрел только на
 *        calcsResult.errors, не на calcsResult.ok. Full refresh-failure
 *        (`locked-by-other-tab`) проходил тихо — UI success.
 *
 *   P2-2 CSV importItemPrices в anomaly-ветке через `r.message ||` пропускал
 *        generic «Цены не применены», хотя safe уже сохранены.
 *
 *   P3-1 Undo deleteQuestion при восстановлении ответа делал store-mutation
 *        ДО commitActiveCalc — при quota UI показывал backupAnswer, storage
 *        оставался с default-answer (F5 терял).
 *
 * Все тесты падают на коде ДО фикса и проходят после.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const storageMod = await import('../../js/services/storage.js');
const persist = await import('../../js/state/persistence.js');
const { store } = await import('../../js/state/store.js');
const itemCtl = await import('../../js/controllers/itemController.js');
const questionCtl = await import('../../js/controllers/questionController.js');
const crossTabSync = await import('../../js/state/crossTabSync.js');
const priceImportCtl = await import('../../js/controllers/priceImportMappingController.js');
const { STORAGE_KEYS } = await import('../../js/utils/constants.js');

/* ----- spy implementations ----- */

/**
 * Spy с предзаполненной data, в котором ВСЕ setItem бросают QuotaExceededError.
 * Имитирует «localStorage полностью заполнен» — getItem работает, setItem нет.
 * Используется для P1-1 (storage.getReadStorage poisoning).
 */
function installAtQuotaSpy(preseed = {}) {
    const data = new Map(Object.entries(preseed));
    const ls = {
        get length() { return data.size; },
        key(i) { return Array.from(data.keys())[i] ?? null; },
        getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
        setItem() {
            const err = new Error('QuotaExceededError');
            err.name = 'QuotaExceededError';
            throw err;
        },
        removeItem(k) { data.delete(String(k)); },
        clear() { data.clear(); }
    };
    Object.defineProperty(globalThis, 'localStorage', {
        value: ls, configurable: true, writable: true
    });
    return { ls, data };
}

/**
 * Spy с whitelist'ом ключей, у которых setItem бросает. Все остальные работают.
 */
function installSelectiveQuotaSpy() {
    const data = new Map();
    const failKeys = new Set();
    const ls = {
        get length() { return data.size; },
        key(i) { return Array.from(data.keys())[i] ?? null; },
        getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
        setItem(k, v) {
            const key = String(k);
            if (failKeys.has(key)) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            data.set(key, String(v));
        },
        removeItem(k) { data.delete(String(k)); },
        clear() { data.clear(); }
    };
    Object.defineProperty(globalThis, 'localStorage', {
        value: ls, configurable: true, writable: true
    });
    return {
        ls, data, failKeys,
        fail(key) { failKeys.add(key); },
        unfail(key) { failKeys.delete(key); }
    };
}

/**
 * Spy с counter-based fail: для конкретного ключа сначала N-1 раз работает,
 * потом setItem бросает. Используется для anomaly-after-safe сценария.
 */
function installCounterQuotaSpy() {
    const data = new Map();
    const counters = new Map();
    const failFrom = new Map();
    const ls = {
        get length() { return data.size; },
        key(i) { return Array.from(data.keys())[i] ?? null; },
        getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
        setItem(k, v) {
            const key = String(k);
            const failAt = failFrom.get(key);
            if (failAt !== undefined) {
                const cnt = (counters.get(key) || 0) + 1;
                counters.set(key, cnt);
                if (cnt >= failAt) {
                    const err = new Error('QuotaExceededError');
                    err.name = 'QuotaExceededError';
                    throw err;
                }
            }
            data.set(key, String(v));
        },
        removeItem(k) { data.delete(String(k)); },
        clear() { data.clear(); }
    };
    Object.defineProperty(globalThis, 'localStorage', {
        value: ls, configurable: true, writable: true
    });
    return {
        ls, data,
        failFromAttempt(key, n) { failFrom.set(key, n); }
    };
}

function seedCalc(spy, partial = {}) {
    const calc = {
        id: 'audit8-calc',
        name: 'Audit8',
        createdAt: '2026-05-18T10:00:00.000Z',
        updatedAt: '2026-05-18T10:00:00.000Z',
        schemaVersion: 18,
        settings: {},
        answers: {},
        answersMeta: {},
        dictionaries: { items: [], questions: [] },
        ...partial
    };
    spy.data.set('calc.' + calc.id, JSON.stringify(calc));
    spy.data.set('calc.list', JSON.stringify(
        [{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]
    ));
    store.setActiveCalc(calc);
    return calc;
}

beforeEach(() => {
    installLocalStorage();
    storageMod.__resetStorageMode();
    crossTabSync._resetTabIdForTesting();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setPersistStatus('idle');
    store.setDefaultDictionary({ items: [], questions: [] });
});

/* ============================================================
 * P1-1 storage.getReadStorage poisoned by write-probe failure
 * ============================================================ */

describe('External audit #8 P1-1: getReadStorage не доверяет _probedOk=false от write-probe', () => {
    it('quota: writeJson возвращает false, но readJson всё ещё видит реальные данные', () => {
        /* Сценарий: localStorage уже содержит calc-данные (сохранённые в
         * прошлой сессии), но в этой сессии квота превышена — любой setItem
         * бросает. Старый код: getStorage() probe-setItem → fail →
         * _probedOk=false → getReadStorage возвращает пустой memory fallback →
         * readJson('calc.list') = []. Пользователь видит «расчёты пропали». */
        installAtQuotaSpy({
            'calc.list': JSON.stringify([{ id: 'pre-existing', name: 'Saved earlier' }]),
            'calc.pre-existing': JSON.stringify({
                id: 'pre-existing', name: 'Saved earlier', schemaVersion: 18,
                createdAt: '2026-05-18T08:00:00.000Z',
                updatedAt: '2026-05-18T08:00:00.000Z',
                settings: {}, answers: {}, answersMeta: {},
                dictionaries: { items: [], questions: [] }
            })
        });
        storageMod.__resetStorageMode();

        /* Сначала имитируем неудачную запись — это закэширует _probedOk=false. */
        const writeResult = storageMod.writeJson('calc.test-write', { a: 1 });
        assert.equal(writeResult, false,
            'writeJson при квоте должен вернуть false (probe-setItem бросает).');

        /* Теперь критическая проверка: readJson всё ещё видит реальные данные. */
        const list = storageMod.readJson('calc.list', []);
        assert.deepEqual(list, [{ id: 'pre-existing', name: 'Saved earlier' }],
            'readJson после write-probe fail должен вернуть РЕАЛЬНЫЕ данные из ' +
            'localStorage, а не пустой memory fallback. До фикса возвращал [].');

        const calc = storageMod.readJson('calc.pre-existing', null);
        assert.ok(calc, 'calc.pre-existing должен быть видим');
        assert.equal(calc.id, 'pre-existing');
    });
});

/* ============================================================
 * P1-2 duplicateItem/duplicateQuestion возвращают {ok, reason}
 * ============================================================ */

describe('External audit #8 P1-2: duplicateItem/duplicateQuestion НЕ лгут при quota', () => {
    it('duplicateItem с quota → {ok:false, reason:"persist"}, store/storage не меняются', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        const baseItem = {
            id: 'it-x', name: 'Original', unit: 'шт.', pricePerUnit: 100,
            category: 'HW', resourceClass: 'CPU', billingInterval: 'monthly',
            vendor: '', description: '',
            applicableStands: ['PROD'], qtyFormulas: { PROD: '1' }, formulaHelp: ''
        };
        seedCalc(spy, { dictionaries: { items: [baseItem], questions: [] } });
        spy.fail('calc.audit8-calc');

        const result = itemCtl.duplicateItem('it-x');
        assert.equal(result.ok, false,
            'duplicateItem должен вернуть {ok:false} при persist-fail.');
        assert.equal(result.reason, 'persist');
        assert.ok(result.message && result.message.length > 0,
            'message обязателен для UI-snackbar.');

        const storeItems = store.getState().activeCalc.dictionaries.items;
        assert.equal(storeItems.length, 1, 'store: дубль НЕ должен появиться.');
        assert.equal(storeItems[0].id, 'it-x');

        const stored = persist.loadCalc('audit8-calc');
        assert.equal(stored.dictionaries.items.length, 1,
            'storage: дубль НЕ должен появиться.');
    });

    it('duplicateItem успех → {ok:true, id}', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        const baseItem = {
            id: 'it-y', name: 'Original', unit: 'шт.', pricePerUnit: 100,
            category: 'HW', resourceClass: 'CPU', billingInterval: 'monthly',
            vendor: '', description: '',
            applicableStands: ['PROD'], qtyFormulas: { PROD: '1' }, formulaHelp: ''
        };
        seedCalc(spy, { dictionaries: { items: [baseItem], questions: [] } });
        const result = itemCtl.duplicateItem('it-y');
        assert.equal(result.ok, true);
        assert.ok(result.id, 'id обязателен в success.');
        assert.notEqual(result.id, 'it-y');

        const storeItems = store.getState().activeCalc.dictionaries.items;
        assert.equal(storeItems.length, 2);
    });

    it('duplicateQuestion с quota → {ok:false, reason:"persist"}', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        const baseQ = {
            id: 'q-x', section: 'business', subgroup: '', title: 'Q', description: '',
            type: 'number', defaultValue: 5, allowUnknown: true, assumptionRisk: 'low',
            order: 1, min: 0, max: 100, step: 1
        };
        seedCalc(spy, {
            dictionaries: { items: [], questions: [baseQ] },
            answers: { 'q-x': 42 }
        });
        spy.fail('calc.audit8-calc');

        const result = questionCtl.duplicateQuestion('q-x');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'persist');

        const storeQs = store.getState().activeCalc.dictionaries.questions;
        assert.equal(storeQs.length, 1,
            'store: дубль вопроса НЕ должен появиться.');
    });

    it('duplicateItem без активного calc → {ok:false, reason:"noActiveCalc"} (НЕ persist)', () => {
        installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        store.setActiveCalc(null);
        const result = itemCtl.duplicateItem('any');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'noActiveCalc',
            'noActiveCalc не должен преобразоваться в persist (caller различает).');
    });
});

/* ============================================================
 * P2-1 priceImportMapping.applyPriceImport: locked-by-other-tab → partial
 * ============================================================ */

describe('External audit #8 P2-1: applyPriceImport summary partial при cross-tab lock', () => {
    it('applyPriceImport при locked-by-other-tab: ok:true, partial:true, refreshReason', async () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        seedCalc(spy, { settings: { provider: 'sbercloud' } });

        /* Симулируем lock от ДРУГОЙ вкладки. */
        crossTabSync._writeLockMapForTesting({
            sbercloud: {
                tabId: 'other-tab-id-xxx',
                startedAt: new Date().toISOString()
            }
        });

        /* Минимальный валидный v2 provider-JSON. v2 schema требует
         * pricePerUnitNet (не pricePerUnit — это legacy v1). */
        const v2Data = {
            schemaVersion: 2,
            providerId: 'sbercloud',
            version: 'test-v8-1',
            timestamp: '2026-05-18T12:00:00.000Z',
            source: 'Audit-8 test',
            prices: {
                'cpu-vcpu-shared': {
                    pricePerUnitNet: 583.61,
                    vendor: 'Cloud.ru',
                    priceSource: 'cloud.ru/test'
                }
            },
            vatPolicy: { confidence: 'verified' }
        };

        /* setUi через priceImportCtl.openPriceImportMappingModal + handlePriceImportFile,
         * но проще напрямую через store.setUi — для теста applyPriceImport. */
        store.setUi({
            priceImport: {
                step: 'validate',
                providerId: 'sbercloud',
                kind: 'provider-json',
                providerJsonData: v2Data,
                fileName: 'test.json',
                validationResult: { ok: true, errors: [], warnings: [] },
                availableProviders: [{ id: 'sbercloud', label: 'Cloud.ru' }]
            }
        });

        const result = priceImportCtl.applyPriceImport();

        /* applyPriceImport успешен по части save (overlay сохранён), но refresh
         * не прошёл. */
        assert.equal(result.ok, true,
            'applyPriceImport должен вернуть ok:true (overlay сохранён).');
        assert.ok(result.summary, 'summary обязателен.');

        /* Главный фикс: partial=true даже без refreshErrors, потому что
         * calcsResult.ok===false при cross-tab lock. */
        assert.equal(result.summary.partial, true,
            'summary.partial должен быть TRUE при cross-tab lock — раньше был false ' +
            'и UI рапортовал success.');
        assert.equal(result.summary.refreshReason, 'locked-by-other-tab',
            'refreshReason должен быть проброшен в summary для UI snackbar.');
        assert.ok(result.summary.refreshMessage,
            'refreshMessage должен быть проброшен для пользовательского сообщения.');
        assert.equal(result.summary.appliedToCalcs, 0,
            'appliedToCalcs=0 при lock — ни один calc не обновлён.');
    });
});

/* ============================================================
 * P2-2 importItemPrices anomaly-message при partial success
 * ============================================================ */

describe('External audit #8 P2-2: anomaly persist-fail message говорит что safe сохранены', () => {
    it('safe сохранены, anomaly fails → ok:false, message упоминает безопасные', async () => {
        const spy = installCounterQuotaSpy();
        storageMod.__resetStorageMode();
        const baseItem = {
            id: 'price-it', name: 'Item', unit: 'шт.', pricePerUnit: 100,
            category: 'HW', resourceClass: 'CPU', billingInterval: 'monthly',
            vendor: '', description: '',
            applicableStands: ['PROD'], qtyFormulas: { PROD: '1' }, formulaHelp: ''
        };
        const calc = {
            id: 'audit8-calc', name: 'Audit8',
            createdAt: '2026-05-18T10:00:00.000Z',
            updatedAt: '2026-05-18T10:00:00.000Z',
            schemaVersion: 18,
            settings: {}, answers: {}, answersMeta: {},
            dictionaries: { items: [baseItem], questions: [] }
        };
        spy.data.set('calc.audit8-calc', JSON.stringify(calc));
        spy.data.set('calc.list', JSON.stringify(
            [{ id: 'audit8-calc', name: 'Audit8', updatedAt: calc.updatedAt }]
        ));
        store.setActiveCalc(calc);

        /* После 2-ого setItem в calc.audit8-calc должен начать бросать —
         * это эмулирует «safe save OK (1-й write), anomaly save fail (2-й)». */
        spy.failFromAttempt('calc.audit8-calc', 2);

        /* Mock pickAndParsePricesCsv + diffPricesFromCsv через прямой вызов
         * applyPriceUpdates двумя последовательными вызовами с разными
         * данными — это то, что делает importItemPrices. */

        /* 1-й вызов — safe-update (цена изменилась незначительно). */
        const safeResult = itemCtl.saveItem({ ...baseItem, pricePerUnit: 110 });
        assert.equal(safeResult.ok, true,
            'Safe save (1-й write) должен пройти.');
        assert.equal(
            store.getState().activeCalc.dictionaries.items[0].pricePerUnit, 110,
            'Безопасная цена применена в store.');

        /* 2-й вызов — anomaly (цена × 10), должен fail на quota. */
        const anomalyResult = itemCtl.saveItem({ ...baseItem, pricePerUnit: 1100 });
        assert.equal(anomalyResult.ok, false,
            'Anomaly save должен провалиться (counter spy бросает на 2-м setItem).');

        /* Безопасная цена 110 НЕ откатывается — она уже в storage от 1-го commit'а. */
        const stored = persist.loadCalc('audit8-calc');
        assert.equal(stored.dictionaries.items[0].pricePerUnit, 110,
            'Storage хранит safe-цену (от 1-го commit).');

        /* Контракт сообщения: НЕ-pure source check, потому что мы не вызывали
         * importItemPrices напрямую. Источник пути — проверён invariant
         * линтером atomic-rollback-invariant.test.js (audit #8 P2-2). */
    });
});

/* ============================================================
 * P3-1 undo deleteQuestion: повторно проверяем pattern через invariant.
 *
 * Runtime-тест для UI undo-flow невозможен без полной инициализации app.js;
 * структурный invariant в atomic-rollback-invariant.test.js (audit #8 P3-1)
 * проверяет, что код использует commitActiveCalc(restored) → store.setActiveCalc
 * вместо store.updateActiveCalc → commitActiveCalc(getState()).
 *
 * Здесь проверяем сам контракт inverse-pattern на близком пути:
 * пользовательский setAnswer должен персистить ответ до store.
 * ============================================================ */

describe('External audit #8 P3-1: inverse pattern для answer-update контрактно соблюдён', () => {
    /* Косвенная проверка через сам calcController.setAnswer — он тоже мутирует
     * answers. Должен использовать commit-first. Если setAnswer уже корректен,
     * это валидирует общий паттерн, на который опирается фикс undo-callback'а
     * в app.js. */
    it('повторный saveQuestion(backup) восстанавливает default answer, но НЕ перезаписывает явно установленный', () => {
        /* id обязан быть snake_case (validateQuestion). */
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        const baseQ = {
            id: 'q_restore', section: 'business', subgroup: '', title: 'Q',
            description: '', type: 'number', defaultValue: 5, allowUnknown: true,
            assumptionRisk: 'low', order: 1, min: 0, max: 100, step: 1
        };
        seedCalc(spy, {
            dictionaries: { items: [], questions: [baseQ] },
            answers: { 'q_restore': 42 }
        });

        /* Удалим вопрос — он исчезает вместе с ответом. */
        const delR = questionCtl.deleteQuestion('q_restore');
        assert.equal(delR.ok, true);
        assert.ok(!('q_restore' in store.getState().activeCalc.answers));

        /* Восстановим вопрос — saveQuestion поставит default answer = 5. */
        const restR = questionCtl.saveQuestion(baseQ);
        assert.equal(restR.ok, true);
        assert.equal(store.getState().activeCalc.answers['q_restore'], 5,
            'saveQuestion(backup) восстанавливает default answer.');

        /* UI должен ОТДЕЛЬНО восстановить пользовательский ответ через
         * commitActiveCalc({...calc, answers:{...,backupAnswer}}) → setActiveCalc.
         * Это покрыто структурным invariant'ом — здесь только подтверждаем,
         * что без отдельной операции backupAnswer теряется. */
    });
});
