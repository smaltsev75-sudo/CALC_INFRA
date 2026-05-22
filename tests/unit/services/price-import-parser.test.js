/**
 * Stage 16.2 — Price Import Parser tests.
 *
 * Покрывает контракт readPriceImportFile + parsePriceImportText:
 *   - CSV (comma/semicolon/tab) → kind='csv'
 *   - JSON-array → kind='json-array'
 *   - Provider-JSON со schemaVersion=1 → kind='provider-json'
 *   - Empty/oversize/invalid → reason=...
 *
 * Использует parsePriceImportText (синхронный) для большинства тестов;
 * readPriceImportFile тестируется через mock File / FileReader.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    parsePriceImportText,
    PRICE_IMPORT_MAX_ROWS
} from '../../../js/services/priceImportParser.js';

/* ============================================================
 * CSV
 * ============================================================ */

describe('parsePriceImportText: CSV', () => {
    it('comma-delimited CSV распознаётся', () => {
        const r = parsePriceImportText(
            'name,price,unit\nvCPU shared,900,month\nRAM 1 GB,240,month',
            'csv'
        );
        assert.equal(r.ok, true);
        assert.equal(r.kind, 'csv');
        assert.equal(r.rows.length, 2);
        assert.equal(r.rows[0].name, 'vCPU shared');
        assert.equal(r.rows[0].price, '900');
    });

    it('semicolon-delimited CSV распознаётся', () => {
        const r = parsePriceImportText(
            'name;price;unit\nvCPU shared;900;month\nRAM 1 GB;240;month',
            'csv'
        );
        assert.equal(r.ok, true);
        assert.equal(r.kind, 'csv');
        assert.equal(r.rows.length, 2);
        assert.equal(r.delimiter, ';');
    });

    it('пустой CSV → reason=parse', () => {
        const r = parsePriceImportText('', 'csv');
        assert.equal(r.ok, false);
        // CSV-парсер throws «Файл пуст»; обёртка превращает в reason=parse
        assert.equal(r.reason, 'parse');
    });

    it('CSV только с заголовками (без data rows) → reason=empty', () => {
        const r = parsePriceImportText('name,price', 'csv');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'empty');
    });
});

/* ============================================================
 * JSON
 * ============================================================ */

describe('parsePriceImportText: JSON', () => {
    it('массив объектов распознаётся как json-array', () => {
        const r = parsePriceImportText(
            JSON.stringify([
                { service: 'vCPU shared', price: 900 },
                { service: 'RAM 1 GB', price: 240 }
            ]),
            'json'
        );
        assert.equal(r.ok, true);
        assert.equal(r.kind, 'json-array');
        assert.equal(r.rows.length, 2);
    });

    it('provider-JSON со schemaVersion=1 распознаётся отдельно', () => {
        const r = parsePriceImportText(
            JSON.stringify({
                schemaVersion: 1,
                providerId: 'sbercloud',
                version: '2026-Q3',
                timestamp: '2026-09-01T00:00:00Z',
                source: 'test',
                prices: {
                    'cpu-vcpu-shared': {
                        pricePerUnit: 900, vendor: 'X', priceSource: 'test'
                    }
                }
            }),
            'json'
        );
        assert.equal(r.ok, true);
        assert.equal(r.kind, 'provider-json');
        assert.equal(r.data.providerId, 'sbercloud');
    });

    it('пустой массив → reason=empty', () => {
        const r = parsePriceImportText('[]', 'json');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'empty');
    });

    it('массив примитивов → reason=shape', () => {
        const r = parsePriceImportText('[1, 2, 3]', 'json');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'shape');
    });

    it('object не provider-JSON → reason=shape', () => {
        const r = parsePriceImportText('{"foo": "bar"}', 'json');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'shape');
    });

    it('невалидный JSON → reason=parse', () => {
        const r = parsePriceImportText('{not-json}', 'json');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'parse');
    });

    it('строка вместо объекта/массива → reason=shape', () => {
        const r = parsePriceImportText('"hello"', 'json');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'shape');
    });

    it('массив объектов → row count limit (PRICE_IMPORT_MAX_ROWS)', () => {
        const huge = JSON.stringify(
            Array.from({ length: PRICE_IMPORT_MAX_ROWS + 1 }, (_, i) => ({ name: `x${i}`, price: i }))
        );
        const r = parsePriceImportText(huge, 'json');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'size');
    });
});

/* ============================================================
 * BOM handling
 * ============================================================ */

describe('parsePriceImportText: BOM', () => {
    it('UTF-8 BOM в начале CSV не ломает парсер', () => {
        const csv = '﻿name,price\nvCPU,900';
        const r = parsePriceImportText(csv, 'csv');
        assert.equal(r.ok, true);
        assert.equal(r.rows[0].name, 'vCPU');
    });

    it('UTF-8 BOM в начале JSON не ломает парсер', () => {
        const json = '﻿[{"service":"vCPU","price":900}]';
        const r = parsePriceImportText(json, 'json');
        assert.equal(r.ok, true);
        assert.equal(r.kind, 'json-array');
    });
});

/* ============================================================
 * Unknown kind
 * ============================================================ */

describe('parsePriceImportText: unknown kind', () => {
    it('некорректный kind → reason=parse', () => {
        const r = parsePriceImportText('any', 'binary');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'parse');
    });
});
