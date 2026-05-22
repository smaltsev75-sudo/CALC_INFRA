/**
 * Тесты pure-валидации `validateProviderPriceJson`.
 *
 * Stage 17.2 Phase 5: bundled-fetch path удалён. Тесты на удалённые
 * функции (`fetchProviderPriceJson`, `applyProviderPriceUpdate`,
 * `rollbackProviderPriceUpdate`) тоже удалены вместе с самими функциями.
 *
 * Файл оставлен под историческим именем для минимальной диффузии PR
 * (импорты в других тестах не меняются). Validate-логика — это
 * по-прежнему core-инвариант провайдер-прайс пайплайна (live-вызывается
 * из providerController + priceImportMappingController).
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let svc;

const VALID = Object.freeze({
    schemaVersion: 1,
    providerId: 'sbercloud',
    version: '2026-Q3-test',
    timestamp: '2026-05-09T12:00:00.000Z',
    source: 'test fixture',
    prices: {
        'cpu-vcpu-shared': { pricePerUnit: 900, vendor: 'SberCloud', priceSource: 'cloud.ru/2026-Q3-test' }
    }
});

before(async () => {
    installLocalStorage();
    svc = await import('../../../js/services/providerPriceFetch.js');
});

beforeEach(() => installLocalStorage());

describe('validateProviderPriceJson — happy path', () => {
    it('валидный JSON с providerId совпадает', () => {
        const r = svc.validateProviderPriceJson(VALID, 'sbercloud');
        assert.equal(r.ok, true);
        assert.deepEqual(r.data, VALID);
    });
});

describe('validateProviderPriceJson — top-level structure', () => {
    it('reject: null', () => {
        const r = svc.validateProviderPriceJson(null, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'shape');
    });

    it('reject: array', () => {
        const r = svc.validateProviderPriceJson([VALID], 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'shape');
    });

    it('reject: schemaVersion=3 (unsupported)', () => {
        /* Stage VAT-2 Phase 1: schemaVersion=2 теперь валиден как v2-схема
         * (см. provider-price-schema-v2.test.js). Тест на «unsupported» поднят
         * до 3 — это следующая будущая версия после v2. */
        const r = svc.validateProviderPriceJson({ ...VALID, schemaVersion: 3 }, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'schema-version');
    });

    it('reject: providerId не совпадает с expected', () => {
        const r = svc.validateProviderPriceJson(VALID, 'yandex');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'provider-mismatch');
    });

    it('reject: пустой providerId', () => {
        const r = svc.validateProviderPriceJson({ ...VALID, providerId: '' }, '');
        assert.equal(r.ok, false);
    });

    it('reject: missing version', () => {
        const obj = { ...VALID };
        delete obj.version;
        const r = svc.validateProviderPriceJson(obj, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'missing-field');
    });

    it('reject: invalid timestamp', () => {
        const r = svc.validateProviderPriceJson({ ...VALID, timestamp: 'not-a-date' }, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'invalid-timestamp');
    });

    it('reject: empty prices', () => {
        const r = svc.validateProviderPriceJson({ ...VALID, prices: {} }, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'empty-prices');
    });

    it('reject: prices не object (array)', () => {
        const r = svc.validateProviderPriceJson({ ...VALID, prices: [] }, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'shape-prices');
    });

    it('reject: extra top-level field', () => {
        const r = svc.validateProviderPriceJson({ ...VALID, extra: 'oops' }, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'unknown-fields');
    });
});

describe('validateProviderPriceJson — price entry rules', () => {
    it('reject: pricePerUnit отрицательный', () => {
        const obj = { ...VALID, prices: { 'cpu-vcpu-shared': { pricePerUnit: -1, vendor: 'X', priceSource: 'y' } } };
        const r = svc.validateProviderPriceJson(obj, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'invalid-price');
    });

    it('reject: pricePerUnit = 0', () => {
        const obj = { ...VALID, prices: { 'cpu-vcpu-shared': { pricePerUnit: 0, vendor: 'X', priceSource: 'y' } } };
        const r = svc.validateProviderPriceJson(obj, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'invalid-price');
    });

    it('reject: pricePerUnit = Infinity', () => {
        const obj = { ...VALID, prices: { 'cpu-vcpu-shared': { pricePerUnit: Infinity, vendor: 'X', priceSource: 'y' } } };
        const r = svc.validateProviderPriceJson(obj, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'invalid-price');
    });

    it('reject: pricePerUnit отсутствует', () => {
        const obj = { ...VALID, prices: { 'cpu-vcpu-shared': { vendor: 'X', priceSource: 'y' } } };
        const r = svc.validateProviderPriceJson(obj, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'invalid-price');
    });

    it('accept: vendor может быть пустой строкой', () => {
        const obj = { ...VALID, prices: { 'cpu-vcpu-shared': { pricePerUnit: 100, vendor: '', priceSource: 'y' } } };
        const r = svc.validateProviderPriceJson(obj, 'sbercloud');
        assert.equal(r.ok, true);
    });

    it('forward-compat: дополнительные поля внутри price entry — игнор', () => {
        const obj = { ...VALID, prices: { 'cpu-vcpu-shared': { pricePerUnit: 100, vendor: 'X', priceSource: 'y', futureField: 'whatever' } } };
        const r = svc.validateProviderPriceJson(obj, 'sbercloud');
        assert.equal(r.ok, true);
    });
});
