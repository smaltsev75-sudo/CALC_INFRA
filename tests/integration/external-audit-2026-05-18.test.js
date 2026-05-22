/**
 * Регрессионные тесты по результатам внешнего аудита (2026-05-18).
 *
 * 5 пунктов аудита:
 *   P1-1: storage.js — probe через setItem ломает чтение при quota.
 *   P1-2: bundleExport — applyStateBundle игнорирует false от persist.save*().
 *   P1-3: priceImportMappingController — validateProviderPriceJson без
 *         { requireVatPolicy: true }, что в user-import пути даёт double-VAT.
 *   P2-1: priceImportParser — accept-list schemaVersion ограничен 1, не v2.
 *   P2-2: providerController#applyOverrideToAllCalcsForProvider — игнорирует
 *         результат commitActiveCalc() в active-calc ветке.
 *
 * Все тесты должны падать на коде ДО фикса и проходить после.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const storageMod = await import('../../js/services/storage.js');
const persist = await import('../../js/state/persistence.js');
const bundleMod = await import('../../js/services/bundleExport.js');
const calcListMod = await import('../../js/controllers/calcListController.js');
const { store } = await import('../../js/state/store.js');
const ctlMod = await import('../../js/controllers/priceImportMappingController.js');
const providerCtl = await import('../../js/controllers/providerController.js');
const parserMod = await import('../../js/services/priceImportParser.js');
const calcPersist = await import('../../js/services/calcPersistence.js');

/* ---------------- helpers ---------------- */

/**
 * Spy localStorage с управляемым quota-режимом.
 *
 * Контракт quota в реальном браузере: при исчерпанной квоте setItem ЛЮБОГО
 * нового значения (включая probe '__test__') бросает QuotaExceededError. На
 * это и опирается аудитор в репро P1-1: probe в storage.getStorage() фейлится
 * → fallback на in-memory Map → readJson возвращает fallback-значение, хотя
 * данные ещё лежат в реальном localStorage и getItem их бы вернул.
 *
 * `passProbe=false` (default) — реалистичная quota: ронять и '__test__'.
 * `passProbe=true` — для тестов P1-2/P2-2: probe пропускается, ронять только
 * настоящие ключи приложения; это нужно, чтобы добраться до save-логики в
 * applyStateBundle / applyOverrideToAllCalcs (иначе getStorage сразу
 * переключается на memory и записи "проходят" в Map, не доходя до спая).
 */
function installQuotaSpy({ passProbe = false } = {}) {
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
    Object.defineProperty(globalThis, 'localStorage', {
        value: ls, configurable: true, writable: true
    });
    return {
        ls,
        data,
        enableQuota() { quotaOn = true; },
        disableQuota() { quotaOn = false; }
    };
}

/* ============================================================
 * P1-1: storage.js probe не должен ломать чтение при quota
 * ============================================================ */

describe('audit P1-1: storage.getStorage — probe не должен переключать на in-memory при quota во время чтения', () => {
    beforeEach(() => {
        installLocalStorage();
    });

    it('readJson возвращает существующее значение даже если probe-setItem фейлится', () => {
        /* 1. Создаём расчёт обычным путём, чтобы calc.list был записан в storage. */
        store.setActiveCalc(null);
        store.setCalcList([]);
        const c = calcListMod.createCalc('Quota-read-test');
        assert.ok(c?.id);
        const idBefore = c.id;
        const listBefore = persist.loadCalcList();
        assert.ok(listBefore.length >= 1);

        /* 2. Переносим данные из MemoryStorage в spy, активируем quota. Read
         *    после этого должен идти из реального хранилища, НЕ возвращать []. */
        const oldData = {};
        for (let i = 0; i < globalThis.localStorage.length; i++) {
            const k = globalThis.localStorage.key(i);
            oldData[k] = globalThis.localStorage.getItem(k);
        }
        /* passProbe=false → probe '__test__' тоже бросает (реалистичный
         * браузерный quota). Это и есть условие, при котором проявляется баг
         * P1-1: getStorage уходит в memory fallback и readJson возвращает []. */
        const spy = installQuotaSpy({ passProbe: false });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);
        spy.enableQuota();

        const listAfter = persist.loadCalcList();
        assert.deepEqual(
            listAfter, listBefore,
            'P1-1 baseline-bug: при quota probe сваливался в in-memory fallback ' +
            '(пустая Map) и loadCalcList возвращал []. После фикса readJson ' +
            'должен идти напрямую в localStorage и вернуть сохранённый список.'
        );

        const cAfter = persist.loadCalc(idBefore);
        assert.ok(cAfter, 'P1-1: loadCalc должен вернуть существующий расчёт под quota');
        assert.equal(cAfter.id, idBefore);
    });
});

/* ============================================================
 * P1-2: bundleExport — apply-фаза реагирует на false из persist.save*
 * ============================================================ */

describe('audit P1-2: applyStateBundle — фейл persist.saveCalc при apply откатывает на backup', () => {
    beforeEach(() => {
        installLocalStorage();
        store.setActiveCalc(null);
        store.setCalcList([]);
    });

    it('quota на новых calc.<id> → ok=false и существующие данные сохранены', () => {
        /* 1. В нормальном storage готовим bundle с двумя новыми расчётами. */
        calcListMod.createCalc('BUNDLE-A');
        calcListMod.createCalc('BUNDLE-B');
        const bundle = JSON.parse(JSON.stringify(bundleMod.buildStateBundle()));
        assert.equal(bundle.calculations.length, 2);
        const bundleIds = bundle.calculations.map(c => c.id);

        /* 2. Чистим и кладём один baseline-расчёт. */
        installLocalStorage();
        store.setActiveCalc(null);
        store.setCalcList([]);
        const baseline = calcListMod.createCalc('BASELINE');
        const baselineSnapshot = JSON.parse(JSON.stringify(baseline));

        /* 3. Spy: настоящая запись baseline уже в MemoryStorage, переносим
         *    в spy и активируем quota ТОЛЬКО на новые calc.<id> из bundle.
         *    Запись saveCalcList / saveActiveCalcId должна пройти, а
         *    saveCalc для bundle.calculations[0] — упасть. */
        const oldData = {};
        for (let i = 0; i < globalThis.localStorage.length; i++) {
            const k = globalThis.localStorage.key(i);
            oldData[k] = globalThis.localStorage.getItem(k);
        }
        const spy = installQuotaSpy({ passProbe: true });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);

        /* Quota только на новые calc-ключи. */
        const failKeys = new Set(bundleIds.map(id => `calc.${id}`));
        const origSet = spy.ls.setItem.bind(spy.ls);
        spy.ls.setItem = function (k, v) {
            if (failKeys.has(String(k))) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            return origSet(k, v);
        };

        const r = bundleMod.applyStateBundle(bundle);

        /* P1-2 baseline-bug: applyStateBundle возвращал ok=true, потому что
         * persist.saveCalc(false-результат) не пробрасывался в catch. После фикса
         * — должно быть ok=false. */
        assert.equal(r.ok, false,
            'P1-2: при quota на новых calc.<id> applyStateBundle обязан вернуть ok=false');

        /* baseline-расчёт должен сохраниться (был в backup). */
        const baselineAfter = persist.loadCalc(baselineSnapshot.id);
        assert.ok(baselineAfter,
            'P1-2: baseline должен остаться в storage (rollback из backup)');
        assert.equal(baselineAfter.name, 'BASELINE');

        /* Новых calc.<id> в storage не должно быть. */
        for (const id of bundleIds) {
            const stored = persist.loadCalc(id);
            assert.equal(stored, null,
                `P1-2: bundle calc ${id} не должен попасть в storage (quota → rollback)`);
        }
    });
});

/* ============================================================
 * P1-3: priceImportMappingController должен требовать VAT-policy для v1
 * ============================================================ */

describe('audit P1-3: priceImportMappingController — applyPriceImport для v1 provider-JSON требует userVatPolicy', () => {
    beforeEach(() => {
        installLocalStorage();
        store.setActiveCalc(null);
        store.setCalcList([]);
        store.setUi({ priceImport: null });
        store.closeAllModals();
    });

    it('applyPriceImport на v1 provider-JSON без vatPolicy → reason=vat-policy-required (не silent-save)', () => {
        /* Минимальный валидный v1 provider-JSON БЕЗ vatPolicy metadata
         * (старый формат, до Stage VAT-2). */
        const v1Json = {
            schemaVersion: 1,
            providerId: 'sbercloud',
            version: '2026-test-v1',
            timestamp: '2026-05-18T00:00:00.000Z',
            source: 'audit-P1-3-test',
            prices: {
                'cpu-vcpu-shared': {
                    pricePerUnit: 1000, vendor: 'Cloud.ru', priceSource: 'test'
                }
            }
        };

        store.setActiveCalc({
            id: 't', name: 'T', schemaVersion: 12,
            answers: {}, answersMeta: {},
            settings: { applyRiskFactors: true, provider: 'sbercloud' },
            dictionaries: { questions: [], items: [], settings: {} },
            view: {}
        });

        ctlMod.openPriceImportMappingModal();
        ctlMod.setPriceImportProvider('sbercloud');
        /* Имитируем шаг handlePriceImportFile вручную — кладём готовый
         * provider-json как preview state. */
        store.setUi({
            priceImport: {
                ...store.getState().ui.priceImport,
                step: 'preview',
                kind: 'provider-json',
                fileName: 'audit-P1-3.json',
                providerJsonData: v1Json
            }
        });

        const result = ctlMod.applyPriceImport();
        assert.equal(result.ok, false,
            'P1-3: applyPriceImport не должен молча сохранять v1-прайс без VAT-policy');
        assert.equal(result.reason, 'vat-policy-required',
            'P1-3: reason должен быть vat-policy-required для последующего показа модалки выбора');
    });
});

/* ============================================================
 * P2-1: priceImportParser — должен принимать v2 provider-JSON
 * ============================================================ */

describe('audit P2-1: parsePriceImportText — provider-JSON v2 принимается как kind=provider-json', () => {
    it('schemaVersion=2 + vatPolicy → kind=provider-json (не shape-reject)', () => {
        const v2Json = {
            schemaVersion: 2,
            providerId: 'sbercloud',
            version: '2026-Q3-v2',
            timestamp: '2026-09-01T00:00:00Z',
            source: 'audit-P2-1-test',
            vatPolicy: { pricesIncludeVat: false, confidence: 'verified' },
            prices: {
                'cpu-vcpu-shared': {
                    pricePerUnitNet: 800, vendor: 'X', priceSource: 'test',
                    vatNormalized: true
                }
            }
        };
        const r = parserMod.parsePriceImportText(JSON.stringify(v2Json), 'json');
        assert.equal(r.ok, true,
            'P2-1: parsePriceImportText обязан принять provider-JSON v2');
        assert.equal(r.kind, 'provider-json');
        assert.equal(r.data.schemaVersion, 2);
    });
});

/* ============================================================
 * P2-2: providerController.applyOverrideToAllCalcsForProvider — active calc
 * ============================================================ */

describe('audit P2-2: applyOverrideToAllCalcsForProvider — фейл commitActiveCalc не должен инкрементировать applied', () => {
    beforeEach(() => {
        installLocalStorage();
        store.setActiveCalc(null);
        store.setCalcList([]);
        store.setUi({ providerOverlayUpdate: {} });
        store.closeAllModals();
    });

    it('quota на calc.<active.id> при apply → applied=0, errors[active.id]=...', () => {
        /* 1. Регистрируем active calc с providerId='sbercloud'. */
        const calc = {
            id: 'active-c1', name: 'Active', schemaVersion: 17,
            settings: { provider: 'sbercloud', applyRiskFactors: true },
            answers: {},
            dictionaries: {
                items: [
                    { id: 'cpu-vcpu-shared', pricePerUnit: 840, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q2' }
                ],
                questions: []
            },
            view: { disabledStands: [] },
            updatedAt: '2026-01-01T00:00:00.000Z'
        };
        persist.saveCalc(calc);
        persist.saveCalcList([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]);
        store.setActiveCalc(calc);

        /* 2. Сохраняем override v1 (для applyOverrideToAllCalcsForProvider
         *    структура v1 достаточна; resolver просто положит pricePerUnit
         *    как net в items). */
        const override = {
            schemaVersion: 1,
            providerId: 'sbercloud',
            version: '2026-Q3-audit',
            timestamp: '2026-05-18T00:00:00.000Z',
            source: 'audit-P2-2',
            prices: {
                'cpu-vcpu-shared': { pricePerUnit: 999, vendor: 'Cloud.ru', priceSource: 'test' }
            }
        };
        persist.saveProviderOverride('sbercloud', override);

        /* 3. Переносим состояние в spy и роняем именно calc.<active.id>. */
        const oldData = {};
        for (let i = 0; i < globalThis.localStorage.length; i++) {
            const k = globalThis.localStorage.key(i);
            oldData[k] = globalThis.localStorage.getItem(k);
        }
        const spy = installQuotaSpy({ passProbe: true });
        for (const [k, v] of Object.entries(oldData)) spy.data.set(k, v);
        const failKey = `calc.${calc.id}`;
        const origSet = spy.ls.setItem.bind(spy.ls);
        spy.ls.setItem = function (k, v) {
            if (String(k) === failKey) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            return origSet(k, v);
        };

        const result = providerCtl.applyOverrideToAllCalcsForProvider('sbercloud');

        /* P2-2 baseline-bug: applied=1 даже при сбое commitActiveCalc.
         * После фикса — applied=0 + один error по этому calc. */
        assert.equal(result.applied, 0,
            'P2-2: applied не должен инкрементироваться при сбое commitActiveCalc');
        const err = (result.errors || []).find(e => e.calcId === calc.id);
        assert.ok(err,
            `P2-2: errors[] должен содержать запись по active calc, получено: ${JSON.stringify(result.errors)}`);
    });
});
