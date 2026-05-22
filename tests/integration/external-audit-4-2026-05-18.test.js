/**
 * Внешний аудит #4 (2026-05-18, четвёртый за день).
 *
 * 8 пунктов аудита по версии 2.17.5:
 *   P1-1  calcPersistence._atomicCalcAndListWrite: при сбое list-write
 *         откатывается только список, calc.<id> остаётся orphan/dirty.
 *         createCalc/duplicateCalc возвращают null, но calc.<uuid> уже
 *         в storage; renameCalc пишет новое имя в calc.<id>, list — старый.
 *   P1-2  itemController.saveItem + questionController.saveQuestion:
 *         игнорируют return commitActiveCalc → возвращают {ok:true} при
 *         quota, модалка закрывается, правка теряется после F5.
 *   P2-1  calcListController.resetToDefaults: rollback-saveCalcList(backup)
 *         результат игнорируется. При сбое rollback'а сообщение
 *         «Состояние восстановлено» лжёт.
 *   P2-2  providerController.restoreProviderOverrideFromHistory: сначала
 *         сохраняет current snapshot, потом trim history. При сбое второго
 *         current уже подменён, история не обрезана — partial state.
 *   P2-3  storage.resetAll/listKeys через getStorage() с write-probe. При
 *         полной quota probe фейлится → memory fallback → реальные calc.*
 *         не видны и не очищаются, хотя removeItem безопасен.
 *   P3-1  crossTabSync.releaseProviderLock: removeItem без проверки writeJson.
 *         При сбое lock остаётся в storage до TTL 60s, блокирует другие
 *         вкладки.
 *   P3-2  appendHealthScoreTrendSnapshot игнорирует saveHealthScoreTrend.
 *         recordHealthScoreSnapshot возвращает {ok:true, written:true} при
 *         quota — caller думает snapshot записан, на F5 история пуста.
 *   P3-3  README.md CSP без frame-ancestors 'none', хотя HOW_TO_START.md
 *         правильно требует HTTP-заголовок с frame-ancestors. Кто следует
 *         README — публикует без clickjacking-защиты.
 *
 * Все тесты должны падать на коде ДО фикса и проходить после.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

installLocalStorage();

const storageMod = await import('../../js/services/storage.js');
const persist = await import('../../js/state/persistence.js');
const calcListMod = await import('../../js/controllers/calcListController.js');
const { store } = await import('../../js/state/store.js');
const calcPersist = await import('../../js/services/calcPersistence.js');
const itemCtl = await import('../../js/controllers/itemController.js');
const questionCtl = await import('../../js/controllers/questionController.js');
const providerCtl = await import('../../js/controllers/providerController.js');
const crossTabSync = await import('../../js/state/crossTabSync.js');
const healthScoreTrendCtl = await import('../../js/controllers/healthScoreTrendController.js');
const { STORAGE_KEYS } = await import('../../js/utils/constants.js');

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ============================================================
 * helpers
 * ============================================================ */

/**
 * Spy localStorage с per-key quota: setItem на любой ключ из failKeys
 * бросает QuotaExceededError, на остальные — пишет нормально.
 *
 * Для теста P1-1/P2-1/P2-2: нужно «отдельные ключи фейлятся» без
 * глобального перехода в memory fallback. passProbe=true пропускает
 * '__test__' probe → _probedOk остаётся true, getStorage() отдаёт
 * сам spy, и failure локализован на конкретных setItem'ах.
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
            /* probe '__test__' всегда проходит — не сваливаемся в memory fallback. */
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
        ls,
        data,
        failKeys,
        fail(key) { failKeys.add(key); },
        unfail(key) { failKeys.delete(key); }
    };
}

/**
 * Spy для P2-3: probe фейлится → реалистичный quota. Чтобы при этом resetAll/
 * listKeys могли увидеть реальные данные, они должны обходить getStorage()
 * и использовать localStorage напрямую (это и есть фикс).
 */
function installFullQuotaSpyAfterSeed() {
    const data = new Map();
    let quotaOn = false;
    const ls = {
        get length() { return data.size; },
        key(i) { return Array.from(data.keys())[i] ?? null; },
        getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
        setItem(k, v) {
            if (quotaOn) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            data.set(String(k), String(v));
        },
        removeItem(k) { data.delete(String(k)); },
        clear() { data.clear(); }
    };
    Object.defineProperty(globalThis, 'localStorage', {
        value: ls, configurable: true, writable: true
    });
    return {
        ls,
        data,
        enable() { quotaOn = true; },
        disable() { quotaOn = false; }
    };
}

beforeEach(() => {
    installLocalStorage();
    storageMod.__resetStorageMode();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setPersistStatus('idle');
});

/* ============================================================
 * P1-1: атомарный откат calc.<id> при сбое list-write
 * ============================================================ */

describe('External audit #4 P1-1: calcPersistence atomic rollback of calc.<id>', () => {
    it('commitNewCalc: при сбое calc.list orphan calc.<id> должен быть удалён', () => {
        /* Baseline: storage пустой, мы пробуем создать первый calc. */
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();

        spy.fail('calc.list');

        const newCalc = {
            id: 'orphan-test-1',
            name: 'Orphan Test',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            schemaVersion: 18,
            settings: {},
            answers: {},
            dictionaries: { items: [], questions: [] }
        };

        const ok = calcPersist.commitNewCalc(newCalc);
        assert.equal(ok, false, 'commitNewCalc возвращает false при сбое list');

        /* КРИТИЧНО: calc.<id> в storage НЕ должен остаться (orphan). */
        const storedCalc = persist.loadCalc('orphan-test-1');
        assert.equal(storedCalc, null,
            'calc.<id> должен быть удалён при rollback (был new, не было backup)');
    });

    it('commitActiveCalc (rename): при сбое calc.list calc.<id> откатывается к backup', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();

        /* Подготовка: записываем calc и list. */
        const originalCalc = {
            id: 'rename-test-1',
            name: 'OriginalName',
            updatedAt: '2026-05-18T10:00:00.000Z',
            schemaVersion: 18,
            settings: {},
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
        persist.saveCalc(originalCalc);
        persist.saveCalcList([{ id: 'rename-test-1', name: 'OriginalName', updatedAt: '2026-05-18T10:00:00.000Z' }]);

        /* Включаем quota на calc.list. */
        spy.fail('calc.list');

        /* Пытаемся переименовать. */
        const renamed = { ...originalCalc, name: 'NewName', updatedAt: '2026-05-18T11:00:00.000Z' };
        const ok = calcPersist.commitActiveCalc(renamed);
        assert.equal(ok, false);

        /* calc.<id> в storage должен быть прежним (OriginalName), не NewName. */
        const stored = persist.loadCalc('rename-test-1');
        assert.ok(stored);
        assert.equal(stored.name, 'OriginalName',
            'calc.<id> откатан к backup-snapshot при сбое list-write');
    });
});

/* ============================================================
 * P1-2: saveItem/saveQuestion → {ok:false} при commit-fail
 * ============================================================ */

describe('External audit #4 P1-2: saveItem/saveQuestion возвращают {ok:false} при commit-fail', () => {
    it('saveItem при quota → возвращает {ok:false, errors:[...]} с понятным сообщением', () => {
        /* Подготовка: активный расчёт с минимальным dictionaries. */
        const calc = {
            id: 'item-test-1',
            name: 'Item Test',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            schemaVersion: 18,
            settings: {},
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
        persist.saveCalc(calc);
        persist.saveCalcList([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]);
        store.setActiveCalc(calc);

        /* Включаем quota на calc.<id> — commitActiveCalc провалит на step 1. */
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        /* Копируем подготовленные данные в spy. */
        spy.data.set('calc.' + calc.id, JSON.stringify(calc));
        spy.data.set('calc.list', JSON.stringify([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]));
        spy.fail('calc.' + calc.id);

        const newItem = {
            id: 'new-item-1',
            name: 'New ЭК',
            unit: 'шт.',
            pricePerUnit: 100,
            category: 'HW',
            resourceClass: 'CPU',
            billingInterval: 'monthly',
            vendor: '',
            description: '',
            applicableStands: ['DEV', 'IFT', 'PSI', 'LOAD', 'PROD'],
            qtyFormulas: { DEV: '1', IFT: '1', PSI: '1', LOAD: '1', PROD: '1' },
            formulaHelp: ''
        };
        const result = itemCtl.saveItem(newItem);

        assert.equal(result.ok, false,
            'saveItem должен вернуть ok:false при сбое commitActiveCalc');
        assert.ok(Array.isArray(result.errors) && result.errors.length > 0,
            'errors должен содержать сообщение об ошибке');
        assert.match(
            String(result.errors[0].message || ''),
            /сохран|quota|хранилищ/i,
            'сообщение должно говорить о проблеме с сохранением'
        );
    });

    it('saveQuestion при quota → возвращает {ok:false, errors:[...]}', () => {
        const calc = {
            id: 'question-test-1',
            name: 'Q Test',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            schemaVersion: 18,
            settings: {},
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
        persist.saveCalc(calc);
        persist.saveCalcList([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]);
        store.setActiveCalc(calc);

        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        spy.data.set('calc.' + calc.id, JSON.stringify(calc));
        spy.data.set('calc.list', JSON.stringify([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]));
        spy.fail('calc.' + calc.id);

        const newQ = {
            id: 'q_new',
            section: 'business',
            subgroup: '',
            title: 'New Q',
            description: '',
            type: 'number',
            defaultValue: 0,
            allowUnknown: true,
            assumptionRisk: 'low',
            order: 100,
            min: 0, max: 100, step: 1
        };
        const result = questionCtl.saveQuestion(newQ);

        assert.equal(result.ok, false,
            'saveQuestion должен вернуть ok:false при сбое commitActiveCalc');
        assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
        assert.match(
            String(result.errors[0].message || ''),
            /сохран|quota|хранилищ/i
        );
    });
});

/* ============================================================
 * P2-1: resetToDefaults rollback-fail messaging
 * ============================================================ */

describe('External audit #4 P2-1: resetToDefaults честное сообщение при rollback-fail', () => {
    it('saveCalcList(backup) rollback тоже фейлится → persistStatus говорит о partial state', () => {
        /* Подготовка: один calc в списке. */
        const calc = {
            id: 'reset-test-1',
            name: 'Reset Test',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            schemaVersion: 18,
            settings: {},
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
        persist.saveCalc(calc);
        persist.saveCalcList([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]);
        persist.saveDefaultDictionary({ items: [], questions: [] });
        store.setCalcList([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]);
        store.setActiveCalc(calc);

        /* Подменяем на spy с двумя fail-ключами: dictionary + rollback list. */
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        spy.data.set('calc.' + calc.id, JSON.stringify(calc));
        spy.data.set('calc.list', JSON.stringify([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]));
        spy.data.set('calc.defaultDictionary', JSON.stringify({ items: [], questions: [] }));

        /* Сценарий: saveCalcList([]) проходит, saveDefaultDictionary fails,
         * попытка rollback saveCalcList(backup) тоже fails → partial state. */
        let calcListWrites = 0;
        const origSet = spy.ls.setItem.bind(spy.ls);
        spy.ls.setItem = function (k, v) {
            const key = String(k);
            if (key === 'calc.list') {
                calcListWrites += 1;
                /* Первая запись (clear list) проходит, вторая (rollback) фейлится. */
                if (calcListWrites >= 2) {
                    const err = new Error('QuotaExceededError');
                    err.name = 'QuotaExceededError';
                    throw err;
                }
            }
            if (key === 'calc.defaultDictionary') {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            return origSet(k, v);
        };

        calcListMod.resetToDefaults();

        assert.equal(store.getState().persistStatus, 'error');
        const msg = String(store.getState().persistMessage || '');
        /* Сообщение НЕ должно лгать «Состояние восстановлено» — rollback тоже упал. */
        assert.doesNotMatch(msg, /восстановлено/i,
            'при failed rollback не говорить «восстановлено» — state partial. ' +
            `Получено: "${msg}"`);
        /* Должно быть явное предупреждение о partial state. */
        assert.match(msg, /перезагруз|partial|противоречи|нарушен|восстановить вручную/i,
            'сообщение должно сигнализировать о требуемой ручной reconciliation. ' +
            `Получено: "${msg}"`);
    });
});

/* ============================================================
 * P2-2: provider restore atomicity
 * ============================================================ */

describe('External audit #4 P2-2: restoreProviderOverrideFromHistory атомарность', () => {
    it('history-write fail после current-write → current откатывается к прежнему snapshot', () => {
        const providerId = 'test-prov';
        const oldCurrent = { providerId, version: 'v-old', items: [{ id: 'a', pricePerUnit: 100 }] };
        const target = { providerId, version: 'v-target', items: [{ id: 'a', pricePerUnit: 80 }] };
        const history = [
            { appliedJSON: target, appliedAt: '2026-05-17T00:00:00.000Z' },
            { appliedJSON: oldCurrent, appliedAt: '2026-05-16T00:00:00.000Z' }
        ];

        /* Подготовка через persist API. */
        persist.saveProviderOverride(providerId, oldCurrent);
        persist.setProviderOverrideHistory(providerId, history);

        /* Spy: ронять PROVIDER_OVERRIDE_HISTORY. */
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        spy.data.set(STORAGE_KEYS.PROVIDER_OVERLAY_OVERRIDES,
            JSON.stringify({ [providerId]: oldCurrent }));
        spy.data.set(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY,
            JSON.stringify({ [providerId]: history }));

        spy.fail(STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY);

        const result = providerCtl.restoreProviderOverrideFromHistory(providerId, 0);
        assert.equal(result.ok, false);

        /* current должен быть откатан к oldCurrent (не target). */
        const persistedOverrides = persist.loadProviderOverrides();
        assert.ok(persistedOverrides && persistedOverrides[providerId]);
        assert.equal(persistedOverrides[providerId].version, 'v-old',
            'current откатан к прежнему snapshot — partial state не допустим');
    });
});

/* ============================================================
 * P2-3: storage.resetAll / listKeys при полной quota
 * ============================================================ */

describe('External audit #4 P2-3: storage.resetAll/listKeys работают при quota', () => {
    it('listKeys видит calc.* даже когда probe-setItem фейлится', () => {
        const spy = installFullQuotaSpyAfterSeed();
        storageMod.__resetStorageMode();

        /* Seed данных пока quota off. */
        spy.disable();
        persist.saveCalcList([{ id: 'a', name: 'A', updatedAt: '2026-05-18T00:00:00.000Z' }]);
        persist.saveCalc({ id: 'a', name: 'A' });
        persist.saveTheme('dark');

        /* Включаем quota — любой setItem (включая probe) бросает. */
        spy.enable();
        storageMod.__resetStorageMode();  /* сбрасываем кэш probe */

        const keys = storageMod.listKeys();
        assert.ok(keys.some(k => k === 'calc.a'),
            'listKeys должен видеть calc.<id> в реальном storage, даже при quota');
        assert.ok(keys.some(k => k === 'calc.list'));
    });

    it('resetAll очищает реальные calc.* через removeItem даже при quota', () => {
        const spy = installFullQuotaSpyAfterSeed();
        storageMod.__resetStorageMode();

        spy.disable();
        persist.saveCalcList([{ id: 'b', name: 'B', updatedAt: '2026-05-18T00:00:00.000Z' }]);
        persist.saveCalc({ id: 'b', name: 'B' });

        spy.enable();
        storageMod.__resetStorageMode();

        /* resetAll использует removeItem (не бросает при quota), должен очистить. */
        storageMod.resetAll();

        /* Перепроверяем — в storage не должно остаться calc.*. */
        spy.disable();  /* для верификации getItem без quota нюансов */
        const remaining = storageMod.listKeys();
        assert.equal(remaining.length, 0,
            'resetAll должен очистить calc.* несмотря на quota probe-fail');
    });
});

/* ============================================================
 * P3-1: crossTabSync.releaseProviderLock проверяет write
 * ============================================================ */

describe('External audit #4 P3-1: releaseProviderLock проверяет writeJson', () => {
    it('write fail → возвращает {ok:false, reason:persist}, lock остаётся для диагностики', () => {
        const providerId = 'release-test';

        /* Сначала ставим spy, потом захватываем lock — чтобы lock попал
         * в spy.data, а не в исходный mock localStorage. */
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();

        const acquireResult = crossTabSync.acquireProviderLock(providerId);
        assert.equal(acquireResult.ok, true, 'lock захвачен');
        const lockMapKey = STORAGE_KEYS.PROVIDER_TAB_LOCKS;
        assert.ok(spy.data.has(lockMapKey), 'lock записан в spy storage');

        /* Теперь включаем quota на lock-map ключ. */
        spy.fail(lockMapKey);

        /* releaseProviderLock должен сигнализировать сбой write. */
        const releaseResult = crossTabSync.releaseProviderLock(providerId);
        assert.ok(releaseResult && typeof releaseResult === 'object',
            'releaseProviderLock должен возвращать {ok, reason}, не void');
        assert.equal(releaseResult.ok, false,
            'при сбое writeJson → ok:false');
        assert.equal(releaseResult.reason, 'persist');
    });
});

/* ============================================================
 * P3-2: appendHealthScoreTrendSnapshot честный return
 * ============================================================ */

describe('External audit #4 P3-2: appendHealthScoreTrendSnapshot честный return', () => {
    it('saveHealthScoreTrend fails → appendHealthScoreTrendSnapshot возвращает false', () => {
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();

        spy.fail(STORAGE_KEYS.HEALTH_SCORE_TREND);

        const snapshot = {
            ts: Date.now(),
            score: 75,
            breakdown: {},
            source: 'manual_recheck'
        };
        const ok = persist.appendHealthScoreTrendSnapshot('calc-1', snapshot);

        assert.equal(ok, false,
            'при сбое saveHealthScoreTrend функция должна вернуть false (не true)');
    });

    it('recordHealthScoreSnapshot caller получает written:false при сбое save', () => {
        /* Подготовка активного calc для evaluateCalculationHealth. */
        const calc = {
            id: 'health-test-1',
            name: 'H',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            schemaVersion: 18,
            settings: { applyRiskFactors: true, vatEnabled: false, vatRate: 0.22 },
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
        store.setActiveCalc(calc);

        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        spy.fail(STORAGE_KEYS.HEALTH_SCORE_TREND);

        const fakeHealth = {
            score: 50,
            breakdown: { a: 25, b: 25 },
            decoratedItems: [],
            recommendations: []
        };
        const result = healthScoreTrendCtl.recordHealthScoreSnapshot(
            calc.id, fakeHealth, 'manual_recheck'
        );

        assert.equal(result.ok, true, 'evaluate-фаза прошла');
        assert.equal(result.written, false,
            'written:false должен отражать реальный save fail');
    });
});

/* ============================================================
 * P3-3: README.md CSP содержит frame-ancestors
 * ============================================================ */

describe('External audit #4 P3-3: README CSP содержит frame-ancestors', () => {
    it('README.md CSP пример включает frame-ancestors \'none\'', () => {
        const readmePath = join(__dirname, '..', '..', 'README.md');
        const readme = readFileSync(readmePath, 'utf8');

        /* Ищем CSP-блок: строки начинающиеся с Content-Security-Policy: */
        const cspLines = readme.split('\n').filter(l => l.includes('Content-Security-Policy:'));
        assert.ok(cspLines.length > 0, 'README должен содержать пример CSP');

        for (const line of cspLines) {
            assert.match(line, /frame-ancestors\s+'none'/,
                `README CSP пример должен включать frame-ancestors 'none' (строка: ${line.trim()})`);
        }
    });

    it('README объясняет что frame-ancestors в <meta> игнорируется и должен быть HTTP-заголовком', () => {
        const readmePath = join(__dirname, '..', '..', 'README.md');
        const readme = readFileSync(readmePath, 'utf8');

        /* Краткое упоминание clickjacking ИЛИ объяснение разницы meta vs header. */
        assert.match(readme,
            /frame-ancestors.*HTTP-заголов|HTTP-заголов.*frame-ancestors|clickjacking|игнорируется.*meta|meta.*игнориру/i,
            'README должен упоминать что frame-ancestors применяется только через HTTP-заголовок'
        );
    });
});
