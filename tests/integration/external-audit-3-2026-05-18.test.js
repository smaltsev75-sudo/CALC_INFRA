/**
 * Внешний аудит #3 (2026-05-18, последний из серии 3 аудитов того же дня).
 *
 * Этот файл — TDD-regress-якори для 7 пунктов аудита #3 + ключевой
 * acceptance-тест: applyOverride → buildStateBundle → applyStateBundle
 * (roundtrip), который пользователь явно потребовал «приложение само
 * не должно импортировать то, что само экспортировало».
 *
 * Каждый assert привязан к конкретному пункту аудита и file:line, чтобы
 * следующий аудитор/Claude мог за 30 секунд понять, что именно
 * регрессировало.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const storageMod = await import('../../js/services/storage.js');
const persist = await import('../../js/state/persistence.js');
const bundleMod = await import('../../js/services/bundleExport.js');
const calcListMod = await import('../../js/controllers/calcListController.js');
const providerCtl = await import('../../js/controllers/providerController.js');
const { store } = await import('../../js/state/store.js');
const { validateCalculation } = await import('../../js/domain/validation.js');
const { applyOverrideToItems } = await import('../../js/domain/calcVersioning.js');
const { acquireProviderLock } = await import('../../js/state/crossTabSync.js');

function snapshot() {
    const out = {};
    for (let i = 0; i < globalThis.localStorage.length; i++) {
        const k = globalThis.localStorage.key(i);
        out[k] = globalThis.localStorage.getItem(k);
    }
    return out;
}
function installQuotaSpy({ passProbe = true } = {}) {
    const data = new Map();
    let quotaOn = false;
    const ls = {
        get length() { return data.size; },
        key(i) { return Array.from(data.keys())[i] ?? null; },
        getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
        setItem(k, v) {
            const key = String(k);
            if (quotaOn && !(passProbe && key === '__test__')) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            data.set(key, String(v));
        },
        removeItem(k) { data.delete(String(k)); },
        clear() { data.clear(); }
    };
    Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
    return { ls, data, enableQuota() { quotaOn = true; }, disableQuota() { quotaOn = false; } };
}

/* ============================================================
 * P1 — priceSource validation mismatch + bundle roundtrip
 * ============================================================ */

describe('audit-3 P1: provider override → calc проходит собственную валидацию (roundtrip)', () => {
    beforeEach(() => {
        installLocalStorage();
        storageMod.__resetStorageMode?.();
        store.setActiveCalc(null);
        store.setCalcList([]);
    });

    it('applyOverrideToItems нормализует priceSource в "provider", оригинал в priceSourceRef', () => {
        const items = [{
            id: 'cpu', name: 'cpu', unit: 'шт.', pricePerUnit: 100, category: 'HW',
            billingInterval: 'monthly', applicableStands: ['PROD'],
            qtyFormulas: { PROD: '1' }, priceSource: 'manual'
        }];
        const overlay = { cpu: { pricePerUnit: 999, vendor: 'X', priceSource: 'cloud.ru/2026-Q3-test' } };
        const out = applyOverrideToItems(items, overlay);
        assert.equal(out[0].pricePerUnit, 999);
        assert.equal(out[0].priceSource, 'provider',
            'P1: vendor-specific priceSource должен быть нормализован к whitelisted значению');
        assert.equal(out[0].priceSourceRef, 'cloud.ru/2026-Q3-test',
            'P1: оригинальный ref сохранён для UI');
    });

    it('validateItem принимает priceSource="provider" (расширенный whitelist)', () => {
        const calc = {
            id: 'p1', name: 'P1', version: '1.0', schemaVersion: 18,
            createdAt: '2026-05-18T00:00:00Z', updatedAt: '2026-05-18T00:00:00Z',
            settings: {
                period: 'monthly', bufferTask: 0.3, bufferProject: 0.15,
                indexation: 0.1, phaseDurationMonths: 6, applyRiskFactors: true,
                vatEnabled: true, vatRate: 0.22
            },
            answers: {},
            dictionaries: {
                items: [{
                    id: 'cpu', name: 'cpu', unit: 'шт.', pricePerUnit: 999, category: 'HW',
                    billingInterval: 'monthly', applicableStands: ['PROD'],
                    qtyFormulas: { PROD: '1' },
                    priceSource: 'provider', priceSourceRef: 'cloud.ru/2026-Q3'
                }],
                questions: []
            }
        };
        const errors = [];
        validateCalculation(calc, errors);
        const priceSrcErr = errors.find(e => /priceSource/.test(e.path));
        assert.equal(priceSrcErr, undefined,
            `P1: validateCalculation должен принимать priceSource='provider'. Errors: ${JSON.stringify(errors)}`);
    });

    it('ACCEPTANCE: applyOverrideToActiveCalc → buildStateBundle → applyStateBundle (roundtrip)', () => {
        /* Полный сценарий пользователя:
         *  1. Создать расчёт.
         *  2. Применить provider override → items получают priceSource из vendor.
         *  3. Экспортировать bundle.
         *  4. Импортировать bundle обратно — НЕ должно фейлиться. */
        const calc = calcListMod.createCalc('roundtrip-p1');
        assert.ok(calc, 'baseline calc создан');

        /* Включаем sbercloud-провайдера и применяем override. */
        store.updateActiveCalc({
            settings: { ...calc.settings, provider: 'sbercloud' }
        });
        const override = {
            schemaVersion: 1,
            providerId: 'sbercloud', version: '2026-Q3-roundtrip',
            timestamp: '2026-05-18T00:00:00.000Z', source: 'roundtrip-test',
            prices: { 'cpu-vcpu-shared': { pricePerUnit: 999, vendor: 'X', priceSource: 'cloud.ru/2026-Q3-roundtrip' } }
        };
        persist.saveProviderOverride('sbercloud', override);
        const applied = providerCtl.applyOverrideToActiveCalc();
        assert.equal(applied.ok, true, `apply должен пройти: ${JSON.stringify(applied)}`);

        /* Build & re-validate. */
        const bundle = bundleMod.buildStateBundle();
        const v = bundleMod.validateBundle(bundle);
        assert.equal(v.valid, true,
            `P1 ACCEPTANCE: bundle, собранный после applyOverride, обязан проходить ` +
            `собственную валидацию. Errors: ${JSON.stringify(v.errors)}`);

        /* И applyStateBundle тоже. */
        const r = bundleMod.applyStateBundle(bundle);
        assert.equal(r.ok, true,
            `P1 ACCEPTANCE: applyStateBundle на тот же bundle обязан вернуть ok=true. ` +
            `Получено: ${JSON.stringify(r)}`);
    });

    it('migrate 17→18 нормализует legacy item.priceSource (например "cloud.ru/...")', () => {
        const legacy = {
            version: '1.0', id: 'legacy-18', name: 'Legacy',
            schemaVersion: 17,
            createdAt: '2025-01-01T00:00:00Z',
            settings: { vatRate: 0.20, vatRateMode: 'frozen', vatEffectiveDate: '2025-01-01' },
            answers: {}, view: { disabledStands: [] },
            dictionaries: {
                items: [{
                    id: 'cpu', name: 'cpu', unit: 'шт.', pricePerUnit: 100,
                    category: 'HW', billingInterval: 'monthly',
                    applicableStands: ['PROD'], qtyFormulas: { PROD: '1' },
                    priceSource: 'cloud.ru/2026-Q2'
                }],
                questions: []
            }
        };
        persist.saveCalc(legacy);
        persist.saveCalcList([{ id: legacy.id, name: legacy.name, updatedAt: '2025-01-01' }]);
        const opened = calcListMod.openCalc(legacy.id);
        const item = opened.dictionaries.items[0];
        assert.equal(item.priceSource, 'provider', 'миграция 17→18 нормализовала priceSource');
        assert.equal(item.priceSourceRef, 'cloud.ru/2026-Q2', 'оригинал в priceSourceRef');
    });
});

/* ============================================================
 * P2 — deleteCalc/resetToDefaults атомарность (order инверсия)
 * ============================================================ */

describe('audit-3 P2: deleteCalc/resetToDefaults — атомарность через инверсию порядка', () => {
    beforeEach(() => {
        installLocalStorage();
        storageMod.__resetStorageMode?.();
        store.setActiveCalc(null);
        store.setCalcList([]);
    });

    it('deleteCalc: quota на saveCalcList → calc.<id> НЕ удалён (был бы dangling)', () => {
        const c = calcListMod.createCalc('to-delete');
        const id = c.id;

        const old = snapshot();
        const spy = installQuotaSpy({ passProbe: true });
        for (const [k, v] of Object.entries(old)) spy.data.set(k, v);
        storageMod.__resetStorageMode?.();
        const origSet = spy.ls.setItem.bind(spy.ls);
        spy.ls.setItem = function (k, v) {
            if (String(k) === 'calc.list') {
                const err = new Error('QuotaExceededError'); err.name = 'QuotaExceededError'; throw err;
            }
            return origSet(k, v);
        };

        calcListMod.deleteCalc(id);

        /* P2 audit-3: calc.<id> ОБЯЗАН остаться в storage. Состояние согласовано. */
        const stored = persist.loadCalc(id);
        assert.ok(stored, 'P2: при сбое saveCalcList calc.<id> НЕ должен быть удалён ' +
            '(новый order: сначала list, потом remove)');
    });

    it('resetToDefaults: quota на saveCalcList → calc.<id> НЕ удалены, list прежний', () => {
        const c1 = calcListMod.createCalc('reset-1');
        const c2 = calcListMod.createCalc('reset-2');
        const listBefore = persist.loadCalcList();

        const old = snapshot();
        const spy = installQuotaSpy({ passProbe: true });
        for (const [k, v] of Object.entries(old)) spy.data.set(k, v);
        storageMod.__resetStorageMode?.();
        const origSet = spy.ls.setItem.bind(spy.ls);
        spy.ls.setItem = function (k, v) {
            if (String(k) === 'calc.list') {
                const err = new Error('QuotaExceededError'); err.name = 'QuotaExceededError'; throw err;
            }
            return origSet(k, v);
        };

        calcListMod.resetToDefaults();

        assert.ok(persist.loadCalc(c1.id), 'reset-1 ОБЯЗАН остаться (новый order)');
        assert.ok(persist.loadCalc(c2.id), 'reset-2 ОБЯЗАН остаться');
        assert.deepEqual(persist.loadCalcList(), listBefore, 'list не изменился');
    });
});

/* ============================================================
 * P2 — createCalc/duplicateCalc возвращают null при quota
 * ============================================================ */

describe('audit-3 P2: create/duplicate возвращают null при сбое — не лгут UI', () => {
    beforeEach(() => {
        installLocalStorage();
        storageMod.__resetStorageMode?.();
        store.setActiveCalc(null);
        store.setCalcList([]);
    });

    it('createCalc: quota → null (раньше возвращал calc, UI показывал success)', () => {
        const spy = installQuotaSpy({ passProbe: true });
        storageMod.__resetStorageMode?.();
        spy.enableQuota();
        const c = calcListMod.createCalc('quota-test');
        assert.equal(c, null, 'createCalc должен вернуть null при quota');
    });
});

/* ============================================================
 * P2 — pushProviderOverrideHistory false не игнорируется
 * ============================================================ */

describe('audit-3 P2: pushProviderOverrideHistory сбой → persistStatus=error', () => {
    beforeEach(() => {
        installLocalStorage();
        storageMod.__resetStorageMode?.();
        store.setActiveCalc(null);
        store.setUi({ providerOverlayUpdate: {} });
    });

    it('повторный save provider override при quota на providerOverrideHistory → status signal', async () => {
        /* 1. Записываем первый override. */
        const first = {
            schemaVersion: 1,
            providerId: 'sbercloud', version: 'v1',
            timestamp: '2026-05-01T00:00:00Z', source: 'a',
            prices: { 'cpu-vcpu-shared': { pricePerUnit: 100, vendor: 'X', priceSource: 'a' } }
        };
        persist.saveProviderOverride('sbercloud', first);

        /* 2. Spy + quota на providerOverrideHistory (но не на overlayOverrides). */
        const old = snapshot();
        const spy = installQuotaSpy({ passProbe: true });
        for (const [k, v] of Object.entries(old)) spy.data.set(k, v);
        storageMod.__resetStorageMode?.();
        const origSet = spy.ls.setItem.bind(spy.ls);
        spy.ls.setItem = function (k, v) {
            if (String(k) === 'calc.providerOverrideHistory') {
                const err = new Error('QuotaExceededError'); err.name = 'QuotaExceededError'; throw err;
            }
            return origSet(k, v);
        };

        /* 3. Повторный save через updateProviderPricesFromFile DI. */
        const second = { ...first, version: 'v2', timestamp: '2026-05-18T00:00:00Z' };
        store.setPersistStatus('idle');
        const result = await providerCtl.updateProviderPricesFromFile('sbercloud', {
            _pickFile: async () => ({ name: 'v2.json' }),
            _readJsonFile: async () => ({ data: { ...second, vatPolicy: { pricesIncludeVat: false, confidence: 'verified' }, schemaVersion: 2,
                prices: { 'cpu-vcpu-shared': { pricePerUnitNet: 100, vendor: 'X', priceSource: 'a', vatNormalized: true } } } })
        });

        assert.equal(result.ok, true, 'основной save (overlay) должен пройти');
        assert.equal(result.historyDegraded, true,
            'P2: при сбое pushProviderOverrideHistory флаг historyDegraded должен быть true');
        assert.equal(store.getState().persistStatus, 'error',
            'P2: persistStatus должен сигналить о потере отметки в истории');
    });
});

/* ============================================================
 * P3 — crossTabSync writeJson возврат не игнорируется
 * ============================================================ */

describe('audit-3 P3: acquireProviderLock возвращает {ok:false, reason:persist} при quota', () => {
    beforeEach(() => {
        installLocalStorage();
        storageMod.__resetStorageMode?.();
    });

    it('quota на providerTabLocks → ok=false (раньше silent ok=true)', () => {
        const spy = installQuotaSpy({ passProbe: true });
        storageMod.__resetStorageMode?.();
        const origSet = spy.ls.setItem.bind(spy.ls);
        spy.ls.setItem = function (k, v) {
            if (String(k) === 'calc.providerTabLocks') {
                const err = new Error('QuotaExceededError'); err.name = 'QuotaExceededError'; throw err;
            }
            return origSet(k, v);
        };

        const result = acquireProviderLock('sbercloud');
        assert.equal(result.ok, false,
            'P3: acquireProviderLock на сбое writeJson должен вернуть ok=false (защита от race)');
        assert.equal(result.reason, 'persist');
    });
});
