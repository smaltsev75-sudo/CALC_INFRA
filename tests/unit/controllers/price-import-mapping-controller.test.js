/**
 * Stage 16.2 — priceImportMappingController integration tests.
 *
 * Покрывает: open/close, handleFile (CSV/JSON-array/provider-JSON),
 * setMapping, validatePriceImport, applyPriceImport (success + persist).
 *
 * Использует реальный store + mock localStorage + DI для readPriceImportFile.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let store, ctl;

before(async () => {
    const m = new Map();
    globalThis.localStorage = {
        getItem: k => m.has(k) ? m.get(k) : null,
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k),
        key: i => Array.from(m.keys())[i] ?? null,
        get length() { return m.size; },
        clear: () => m.clear()
    };
    if (!globalThis.crypto) globalThis.crypto = await import('node:crypto');

    const storeModule = await import('../../../js/state/store.js');
    const ctlModule   = await import('../../../js/controllers/priceImportMappingController.js');
    store = storeModule.store;
    ctl   = ctlModule;
});

function setupCalc({ provider = 'sbercloud', items = null } = {}) {
    const defaultItems = [
        { id: 'cpu-vcpu-shared', name: 'vCPU shared',  category: 'HW', pricePerUnit: 800 },
        { id: 'ram-gb',          name: 'RAM 1 GB',     category: 'HW', pricePerUnit: 200 },
        { id: 'storage-ssd-tb',  name: 'SSD storage 1 TB', category: 'HW', pricePerUnit: 12000 }
    ];
    store.setActiveCalc({
        id: 't', name: 'T', schemaVersion: 12,
        answers: {}, answersMeta: {},
        settings: { applyRiskFactors: true, provider },
        dictionaries: {
            questions: [],
            items: items || defaultItems,
            settings: {}
        },
        view: {}
    });
}

function ui() { return store.getState().ui?.priceImport; }
function modalOpen() { return store.getState().modals.priceImportMapping?.open === true; }

/* Mock readPriceImportFile (DI через opts). */
function makeReadFnReturning(result) {
    return async () => result;
}

/* ============================================================
 * open / close
 * ============================================================ */

describe('open / close', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ priceImport: null });
    });

    it('open пишет step=upload + providerId по умолчанию', () => {
        setupCalc({ provider: 'yandex' });
        ctl.openPriceImportMappingModal();
        assert.equal(modalOpen(), true);
        const u = ui();
        assert.equal(u.step, 'upload');
        assert.equal(u.providerId, 'yandex');
        assert.deepEqual(u.mappings, {});
    });

    it('close очищает transient state', () => {
        setupCalc();
        ctl.openPriceImportMappingModal();
        assert.equal(modalOpen(), true);
        ctl.closePriceImportMappingModal();
        assert.equal(modalOpen(), false);
        assert.equal(ui(), null);
    });

    it('setPriceImportProvider меняет providerId, сбрасывает validation', () => {
        setupCalc();
        ctl.openPriceImportMappingModal();
        ctl.setPriceImportProvider('vk');
        assert.equal(ui().providerId, 'vk');
        assert.equal(ui().validationResult, null);
    });
});

/* ============================================================
 * handlePriceImportFile — три kind'а
 * ============================================================ */

describe('handlePriceImportFile', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ priceImport: null });
    });

    it('CSV → step=preview, kind=csv, normalizedRows + auto-mappings', async () => {
        setupCalc();
        ctl.openPriceImportMappingModal();
        const readFn = makeReadFnReturning({
            ok: true, kind: 'csv', fileName: 'test.csv',
            rows: [
                { name: 'vCPU shared', price: 900 },
                { name: 'RAM 1 GB',    price: 240 }
            ],
            headers: ['name', 'price']
        });
        const r = await ctl.handlePriceImportFile(null,
            { _readFile: readFn, _pickFile: async () => ({ name: 'test.csv' }) });
        assert.equal(r.ok, true);
        assert.equal(r.kind, 'csv');
        const u = ui();
        assert.equal(u.step, 'preview');
        assert.equal(u.kind, 'csv');
        assert.equal(u.fileName, 'test.csv');
        assert.equal(u.normalizedRows.length, 2);
        // auto-mapping применил high-confidence suggestions
        assert.equal(u.mappings['row-1'], 'cpu-vcpu-shared');
        assert.equal(u.mappings['row-2'], 'ram-gb');
    });

    it('JSON-array → kind=json-array, normalize + suggest', async () => {
        setupCalc();
        ctl.openPriceImportMappingModal();
        const readFn = makeReadFnReturning({
            ok: true, kind: 'json-array', fileName: 'p.json',
            rows: [{ service: 'RAM 1 GB', price: 240 }]
        });
        const r = await ctl.handlePriceImportFile(null,
            { _readFile: readFn, _pickFile: async () => ({ name: 'p.json' }) });
        assert.equal(r.ok, true);
        assert.equal(ui().kind, 'json-array');
        assert.equal(ui().mappings['row-1'], 'ram-gb');
    });

    it('provider-JSON → kind=provider-json, providerJsonData', async () => {
        setupCalc();
        ctl.openPriceImportMappingModal();
        const data = {
            schemaVersion: 1,
            providerId: 'sbercloud',
            version: '2026-Q3',
            timestamp: '2026-09-01T00:00:00Z',
            source: 'test',
            prices: { 'ram-gb': { pricePerUnit: 250, vendor: 'X', priceSource: 'test' } }
        };
        const readFn = makeReadFnReturning({
            ok: true, kind: 'provider-json', fileName: 'sb.json', data
        });
        const r = await ctl.handlePriceImportFile(null,
            { _readFile: readFn, _pickFile: async () => ({ name: 'sb.json' }) });
        assert.equal(r.ok, true);
        assert.equal(ui().kind, 'provider-json');
        assert.equal(ui().providerJsonData.providerId, 'sbercloud');
        // mappings/normalizedRows для provider-json не нужны
        assert.deepEqual(ui().mappings, {});
    });

    it('error при чтении → step=upload, error в ui', async () => {
        setupCalc();
        ctl.openPriceImportMappingModal();
        const readFn = makeReadFnReturning({
            ok: false, reason: 'parse', message: 'Bad file'
        });
        const r = await ctl.handlePriceImportFile(null,
            { _readFile: readFn, _pickFile: async () => ({ name: 'bad.csv' }) });
        assert.equal(r.ok, false);
        const u = ui();
        assert.equal(u.step, 'upload');
        assert.equal(u.error, 'Bad file');
    });

    it('cancelled file picker → ok=false reason=cancelled', async () => {
        setupCalc();
        ctl.openPriceImportMappingModal();
        const r = await ctl.handlePriceImportFile(null,
            { _pickFile: async () => null });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'cancelled');
    });
});

/* ============================================================
 * setPriceImportMapping
 * ============================================================ */

describe('setPriceImportMapping', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ priceImport: null });
    });

    it('добавляет mapping для строки', async () => {
        setupCalc();
        ctl.openPriceImportMappingModal();
        await ctl.handlePriceImportFile(null, {
            _readFile: makeReadFnReturning({
                ok: true, kind: 'csv', fileName: 'x', rows: [{ name: 'whatever-unmatched', price: 100 }]
            }),
            _pickFile: async () => ({ name: 'x' })
        });
        ctl.setPriceImportMapping('row-1', 'ram-gb');
        assert.equal(ui().mappings['row-1'], 'ram-gb');
    });

    it('itemId=null удаляет mapping', async () => {
        setupCalc();
        ctl.openPriceImportMappingModal();
        await ctl.handlePriceImportFile(null, {
            _readFile: makeReadFnReturning({
                ok: true, kind: 'csv', fileName: 'x', rows: [{ name: 'RAM', price: 100 }]
            }),
            _pickFile: async () => ({ name: 'x' })
        });
        // auto-match сделал mapping
        assert.equal(ui().mappings['row-1'], 'ram-gb');
        ctl.setPriceImportMapping('row-1', null);
        assert.equal(ui().mappings['row-1'], undefined);
    });
});

/* ============================================================
 * validatePriceImport
 * ============================================================ */

describe('validatePriceImport', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ priceImport: null });
    });

    it('валидный mapping → step=validate, validationResult.ok=true', async () => {
        setupCalc();
        ctl.openPriceImportMappingModal();
        await ctl.handlePriceImportFile(null, {
            _readFile: makeReadFnReturning({
                ok: true, kind: 'csv', fileName: 'x',
                rows: [{ name: 'RAM 1 GB', price: 250 }]
            }),
            _pickFile: async () => ({ name: 'x' })
        });
        ctl.validatePriceImport();
        const u = ui();
        assert.equal(u.step, 'validate');
        assert.equal(u.validationResult.ok, true);
    });

    it('provider-json mismatch → validationResult.ok=false', async () => {
        setupCalc({ provider: 'sbercloud' });
        ctl.openPriceImportMappingModal();
        const data = {
            schemaVersion: 1, providerId: 'yandex',  // mismatch!
            version: 'v1', timestamp: new Date().toISOString(),
            source: '', prices: { 'ram-gb': { pricePerUnit: 200, vendor: 'X', priceSource: 'y' } }
        };
        await ctl.handlePriceImportFile(null, {
            _readFile: makeReadFnReturning({ ok: true, kind: 'provider-json', fileName: 'p', data }),
            _pickFile: async () => ({ name: 'p' })
        });
        ctl.validatePriceImport();
        const u = ui();
        assert.equal(u.step, 'validate');
        assert.equal(u.validationResult.ok, false);
    });
});

/* ============================================================
 * applyPriceImport
 * ============================================================ */

describe('applyPriceImport', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ priceImport: null });
        // Очищаем localStorage между тестами для чистого snapshot pipeline.
        if (typeof globalThis.localStorage.clear === 'function') {
            globalThis.localStorage.clear();
        }
    });

    /* Контракт после внешнего аудита 2026-05-18 (P1-3):
     * v1 provider-JSON без vatPolicy (включая JSON, собранный из CSV/JSON-array
     * через buildProviderPriceJson) попадает в user-import path и обязан
     * пройти через выбор VAT-policy. applyPriceImport возвращает
     * { ok: false, reason: 'vat-policy-required', awaitingChoice: true },
     * открывает модалку vatPolicyChoice; после выбора пользователя
     * сохранение делает providerController.applyProviderPricesWithVatPolicy. */
    it('CSV apply v1 без vatPolicy → vat-policy-required (защита от double-VAT)', async () => {
        setupCalc({ provider: 'sbercloud' });
        ctl.openPriceImportMappingModal();
        await ctl.handlePriceImportFile(null, {
            _readFile: makeReadFnReturning({
                ok: true, kind: 'csv', fileName: 'sb.csv',
                rows: [{ name: 'RAM 1 GB', price: 250 }]
            }),
            _pickFile: async () => ({ name: 'sb.csv' })
        });
        ctl.validatePriceImport();
        const r = ctl.applyPriceImport();
        assert.equal(r.ok, false, 'apply должен ждать VAT-policy выбора');
        assert.equal(r.reason, 'vat-policy-required');
        assert.equal(r.awaitingChoice, true);

        // Модалка выбора политики открыта с preloaded JSON.
        const m = store.getState().modals.vatPolicyChoice;
        assert.equal(m?.open, true, 'vatPolicyChoice модалка должна быть открыта');
        assert.equal(m.providerId, 'sbercloud');
        assert.equal(m.preloaded?.prices['ram-gb']?.pricePerUnit, 250);

        // Поскольку apply остановился — overrides в localStorage НЕ записан.
        const overrides = JSON.parse(globalThis.localStorage.getItem('calc.providerOverlayOverrides') || '{}');
        assert.equal(overrides.sbercloud, undefined,
            'overrides не должны быть записаны до выбора VAT-policy');
    });

    it('второй apply v1 без vatPolicy → тоже vat-policy-required (без silent-overwrite)', async () => {
        setupCalc({ provider: 'sbercloud' });

        // Подготовим первый override: симулируем что прошлый apply уже сохранил
        // данные через providerController (с VAT-policy). Для проверки контракта
        // достаточно положить override напрямую в localStorage.
        const firstOverride = {
            schemaVersion: 2,
            providerId: 'sbercloud',
            version: '2026-Q3-first',
            timestamp: '2026-05-01T00:00:00.000Z',
            source: 'first',
            vatPolicy: { pricesIncludeVat: false, confidence: 'verified' },
            prices: {
                'ram-gb': { pricePerUnitNet: 250, vendor: 'X', priceSource: 'first', vatNormalized: true }
            }
        };
        globalThis.localStorage.setItem('calc.providerOverlayOverrides',
            JSON.stringify({ sbercloud: firstOverride }));

        // Второй apply через CSV — снова требует VAT-policy choice.
        ctl.openPriceImportMappingModal();
        await ctl.handlePriceImportFile(null, {
            _readFile: makeReadFnReturning({
                ok: true, kind: 'csv', fileName: 'b.csv',
                rows: [{ name: 'RAM 1 GB', price: 300 }]
            }),
            _pickFile: async () => ({ name: 'b.csv' })
        });
        ctl.validatePriceImport();
        const r = ctl.applyPriceImport();
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'vat-policy-required');

        // Прежний override НЕ перезаписан — gate блокирует silent overwrite.
        const overrides = JSON.parse(globalThis.localStorage.getItem('calc.providerOverlayOverrides') || '{}');
        assert.equal(overrides.sbercloud.version, '2026-Q3-first',
            'прежний override не должен быть перезаписан до выбора VAT-policy');
    });

    it('apply без активной модалки → reason=modal-closed', () => {
        setupCalc();
        const r = ctl.applyPriceImport();
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'modal-closed');
    });
});

/* ============================================================
 * goPriceImportBack / proceedToMappingStep
 * ============================================================ */

describe('navigation', () => {
    beforeEach(() => {
        store.closeAllModals();
        store.setUi({ priceImport: null });
    });

    it('goBack от preview → upload', async () => {
        setupCalc();
        ctl.openPriceImportMappingModal();
        await ctl.handlePriceImportFile(null, {
            _readFile: makeReadFnReturning({
                ok: true, kind: 'csv', fileName: 'x', rows: [{ name: 'RAM', price: 100 }]
            }),
            _pickFile: async () => ({ name: 'x' })
        });
        assert.equal(ui().step, 'preview');
        ctl.goPriceImportBack();
        assert.equal(ui().step, 'upload');
    });

    it('proceedToMappingStep от preview → mapping', async () => {
        setupCalc();
        ctl.openPriceImportMappingModal();
        await ctl.handlePriceImportFile(null, {
            _readFile: makeReadFnReturning({
                ok: true, kind: 'csv', fileName: 'x', rows: [{ name: 'RAM', price: 100 }]
            }),
            _pickFile: async () => ({ name: 'x' })
        });
        ctl.proceedToMappingStep();
        assert.equal(ui().step, 'mapping');
    });

    it('proceedToMappingStep для provider-json v1 без vatPolicy → открывает vat-policy choice (P1-3)', async () => {
        setupCalc({ provider: 'sbercloud' });
        ctl.openPriceImportMappingModal();
        const data = {
            schemaVersion: 1, providerId: 'sbercloud',
            version: 'v1', timestamp: new Date().toISOString(),
            source: '', prices: { 'ram-gb': { pricePerUnit: 200, vendor: 'X', priceSource: 'y' } }
        };
        await ctl.handlePriceImportFile(null, {
            _readFile: makeReadFnReturning({ ok: true, kind: 'provider-json', fileName: 'p', data }),
            _pickFile: async () => ({ name: 'p' })
        });
        ctl.proceedToMappingStep();
        /* Контракт после P1-3: до выбора политики мы НЕ уходим в validate.
         * Шаг остаётся preview, открыта модалка выбора VAT-policy. */
        assert.equal(ui().step, 'preview',
            'шаг должен остаться preview — gate блокирует переход в validate');
        const m = store.getState().modals.vatPolicyChoice;
        assert.equal(m?.open, true, 'vatPolicyChoice должна быть открыта');
        assert.equal(m.providerId, 'sbercloud');
    });

    it('proceedToMappingStep для provider-json v2 → validate (skip mapping)', async () => {
        setupCalc({ provider: 'sbercloud' });
        ctl.openPriceImportMappingModal();
        /* v2 уже содержит vatPolicy — gate его пропускает, поведение идентично старому. */
        const data = {
            schemaVersion: 2, providerId: 'sbercloud',
            version: 'v2', timestamp: new Date().toISOString(),
            source: '',
            vatPolicy: { pricesIncludeVat: false, confidence: 'verified' },
            prices: {
                'ram-gb': { pricePerUnitNet: 200, vendor: 'X', priceSource: 'y', vatNormalized: true }
            }
        };
        await ctl.handlePriceImportFile(null, {
            _readFile: makeReadFnReturning({ ok: true, kind: 'provider-json', fileName: 'p', data }),
            _pickFile: async () => ({ name: 'p' })
        });
        ctl.proceedToMappingStep();
        assert.equal(ui().step, 'validate');
        assert.equal(ui().validationResult.ok, true);
    });
});
