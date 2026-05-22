/**
 * Stage 16.2 — Price Import Mapping (domain) tests.
 *
 * Покрывает:
 *   - detectShape: provider-json | json-array | unknown
 *   - normalizeRows: detect полей по EN/RU синонимам, RU-локаль чисел
 *   - suggestItemMappings: high (id/alias/name) / medium / low / none
 *   - validatePriceMappings: invalid price / unknown item / duplicate / no mappings
 *   - buildProviderPriceJson: shape, default vendor, empty prices
 *   - getMappingSummary: counters
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    detectShape,
    normalizeRows,
    suggestItemMappings,
    validatePriceMappings,
    buildProviderPriceJson,
    getMappingSummary,
    KNOWN_ALIASES
} from '../../../js/domain/priceImportMapping.js';

const KNOWN_ITEMS = [
    { id: 'cpu-vcpu-shared',   name: 'vCPU shared',         category: 'HW' },
    { id: 'cpu-vcpu-dedicated', name: 'vCPU dedicated',     category: 'HW' },
    { id: 'ram-gb',            name: 'RAM 1 GB',            category: 'HW' },
    { id: 'storage-ssd-tb',    name: 'SSD storage 1 TB',    category: 'HW' },
    { id: 'storage-object-tb', name: 'Object storage 1 TB', category: 'HW' },
    { id: 'network-waf',       name: 'WAF',                 category: 'SECURITY' }
];

/* ============================================================
 * detectShape
 * ============================================================ */

describe('detectShape', () => {
    it('распознаёт provider-json по schemaVersion + providerId + prices', () => {
        const shape = detectShape({
            schemaVersion: 1, providerId: 'sbercloud',
            version: '2026-Q3', timestamp: '2026-09-01T00:00:00Z',
            source: '', prices: { 'cpu-vcpu-shared': { pricePerUnit: 800 } }
        });
        assert.equal(shape, 'provider-json');
    });

    it('распознаёт массив объектов как json-array', () => {
        assert.equal(detectShape([{ a: 1 }, { a: 2 }]), 'json-array');
    });

    it('пустой массив → unknown', () => {
        assert.equal(detectShape([]), 'unknown');
    });

    it('null/undefined/строка → unknown', () => {
        assert.equal(detectShape(null), 'unknown');
        assert.equal(detectShape(undefined), 'unknown');
        assert.equal(detectShape('hello'), 'unknown');
    });

    it('object без schemaVersion → unknown', () => {
        assert.equal(detectShape({ providerId: 'sbercloud' }), 'unknown');
    });
});

/* ============================================================
 * normalizeRows
 * ============================================================ */

describe('normalizeRows', () => {
    it('распознаёт name/price из стандартных колонок', () => {
        const rows = [
            { service: 'vCPU shared', unit: 'month', price: 920 },
            { service: 'RAM 1 GB',    unit: 'month', price: 240 }
        ];
        const norm = normalizeRows(rows);
        assert.equal(norm.length, 2);
        assert.equal(norm[0].sourceName, 'vCPU shared');
        assert.equal(norm[0].price, 920);
        assert.equal(norm[0].sourceUnit, 'month');
        assert.equal(norm[0].rowId, 'row-1');
    });

    it('распознаёт RU-заголовки (наименование/цена/категория)', () => {
        const rows = [{ 'Наименование': 'RAM 1 GB', 'Цена': '240', 'Категория': 'HW' }];
        const norm = normalizeRows(rows);
        assert.equal(norm[0].sourceName, 'RAM 1 GB');
        assert.equal(norm[0].price, 240);
        assert.equal(norm[0].sourceCategory, 'HW');
    });

    it('RU-локаль числа: запятая + пробел-разделитель', () => {
        const rows = [{ name: 'GPU', price: '14 400,50' }];
        const norm = normalizeRows(rows);
        assert.equal(norm[0].price, 14400.5);
    });

    it('пустая цена → price=null', () => {
        const rows = [{ name: 'Test', price: '' }];
        const norm = normalizeRows(rows);
        assert.equal(norm[0].price, null);
    });

    it('id-колонка отделена от name-колонки', () => {
        const rows = [{ id: 'cpu-vcpu-shared', name: 'vCPU', price: '500' }];
        const norm = normalizeRows(rows);
        assert.equal(norm[0].sourceId, 'cpu-vcpu-shared');
        assert.equal(norm[0].sourceName, 'vCPU');
    });

    it('пустые/мусорные rows возвращаются с null-полями, не throw', () => {
        const norm = normalizeRows([null, undefined, 'string', 42]);
        assert.equal(norm.length, 4);
        for (const n of norm) {
            assert.equal(n.price, null);
            assert.equal(n.sourceName, null);
        }
    });

    it('non-array → []', () => {
        assert.deepEqual(normalizeRows(null), []);
        assert.deepEqual(normalizeRows(undefined), []);
        assert.deepEqual(normalizeRows('string'), []);
    });
});

/* ============================================================
 * suggestItemMappings — confidence levels
 * ============================================================ */

describe('suggestItemMappings: confidence', () => {
    it('exact id match → high', () => {
        const norm = normalizeRows([{ id: 'ram-gb', name: 'whatever', price: 200 }]);
        const sug = suggestItemMappings(norm, KNOWN_ITEMS);
        assert.equal(sug['row-1'].itemId, 'ram-gb');
        assert.equal(sug['row-1'].confidence, 'high');
        assert.equal(sug['row-1'].reason, 'exact-id');
    });

    it('exact alias match → high (vCPU shared → cpu-vcpu-shared)', () => {
        const norm = normalizeRows([{ name: 'vCPU shared', price: 900 }]);
        const sug = suggestItemMappings(norm, KNOWN_ITEMS);
        assert.equal(sug['row-1'].itemId, 'cpu-vcpu-shared');
        assert.equal(sug['row-1'].confidence, 'high');
        assert.equal(sug['row-1'].reason, 'alias');
    });

    it('exact name match (нормализованный) → high', () => {
        const norm = normalizeRows([{ name: 'WAF', price: 5000 }]);
        const sug = suggestItemMappings(norm, KNOWN_ITEMS);
        assert.equal(sug['row-1'].itemId, 'network-waf');
        assert.equal(sug['row-1'].confidence, 'high');
    });

    it('partial overlap → medium или low', () => {
        const norm = normalizeRows([{ name: 'SSD storage', category: 'HW', price: 12000 }]);
        const sug = suggestItemMappings(norm, KNOWN_ITEMS);
        assert.ok(sug['row-1'], 'должен быть suggestion');
        assert.equal(sug['row-1'].itemId, 'storage-ssd-tb');
        assert.ok(['high', 'medium', 'low'].includes(sug['row-1'].confidence));
    });

    it('no match → отсутствует в результате', () => {
        const norm = normalizeRows([{ name: 'абсолютно-неизвестный-сервис-xyz', price: 100 }]);
        const sug = suggestItemMappings(norm, KNOWN_ITEMS);
        assert.equal(sug['row-1'], undefined);
    });

    it('пустые строки/items → пустой результат', () => {
        assert.deepEqual(suggestItemMappings([], KNOWN_ITEMS), {});
        assert.deepEqual(suggestItemMappings(normalizeRows([{name:'x'}]), []), {});
        assert.deepEqual(suggestItemMappings(null, KNOWN_ITEMS), {});
    });

    it('KNOWN_ALIASES содержит распространённые синонимы', () => {
        // Защита от случайного удаления критичных алиасов.
        assert.equal(KNOWN_ALIASES['vcpu shared'], 'cpu-vcpu-shared');
        assert.equal(KNOWN_ALIASES['ram'], 'ram-gb');
        assert.equal(KNOWN_ALIASES['s3'], 'storage-object-tb');
        assert.equal(KNOWN_ALIASES['waf'], 'network-waf');
    });
});

/* ============================================================
 * validatePriceMappings
 * ============================================================ */

describe('validatePriceMappings', () => {
    it('валидный mapping → ok=true, errors=[]', () => {
        const norm = normalizeRows([{ name: 'RAM 1 GB', price: 240 }]);
        const r = validatePriceMappings({ 'row-1': 'ram-gb' }, norm, KNOWN_ITEMS);
        assert.equal(r.ok, true);
        assert.deepEqual(r.errors, []);
    });

    it('mapping на несуществующий item → reason=unknown-item', () => {
        const norm = normalizeRows([{ name: 'X', price: 100 }]);
        const r = validatePriceMappings({ 'row-1': 'totally-unknown' }, norm, KNOWN_ITEMS);
        assert.equal(r.ok, false);
        assert.ok(r.errors.some(e => e.reason === 'unknown-item'));
    });

    it('пустая цена → reason=invalid-price', () => {
        const norm = normalizeRows([{ name: 'X', price: '' }]);
        const r = validatePriceMappings({ 'row-1': 'ram-gb' }, norm, KNOWN_ITEMS);
        assert.equal(r.ok, false);
        assert.ok(r.errors.some(e => e.reason === 'invalid-price'));
    });

    it('отрицательная цена → reason=invalid-price', () => {
        const norm = normalizeRows([{ name: 'X', price: -10 }]);
        const r = validatePriceMappings({ 'row-1': 'ram-gb' }, norm, KNOWN_ITEMS);
        assert.equal(r.ok, false);
        assert.ok(r.errors.some(e => e.reason === 'invalid-price'));
    });

    it('две строки → один itemId → reason=duplicate-mapping', () => {
        const norm = normalizeRows([
            { name: 'A', price: 100 },
            { name: 'B', price: 200 }
        ]);
        const r = validatePriceMappings(
            { 'row-1': 'ram-gb', 'row-2': 'ram-gb' },
            norm, KNOWN_ITEMS
        );
        assert.equal(r.ok, false);
        const dup = r.errors.find(e => e.reason === 'duplicate-mapping');
        assert.ok(dup);
        assert.deepEqual(dup.rowIds.sort(), ['row-1', 'row-2']);
    });

    it('пустые mappings → warning «ничего не сопоставлено»', () => {
        const norm = normalizeRows([{ name: 'X', price: 100 }]);
        const r = validatePriceMappings({}, norm, KNOWN_ITEMS);
        assert.ok(r.warnings.some(w => /сопоставлен/i.test(w.message)));
    });

    it('null mappings → reason=no-mappings', () => {
        const r = validatePriceMappings(null, [], KNOWN_ITEMS);
        assert.equal(r.ok, false);
        assert.ok(r.errors.some(e => e.reason === 'no-mappings'));
    });
});

/* ============================================================
 * buildProviderPriceJson
 * ============================================================ */

describe('buildProviderPriceJson', () => {
    it('собирает provider JSON со schemaVersion=1 + prices', () => {
        const norm = normalizeRows([
            { name: 'vCPU shared', price: 900 },
            { name: 'RAM 1 GB',    price: 240 }
        ]);
        const r = buildProviderPriceJson({
            providerId: 'sbercloud',
            normalizedRows: norm,
            mappings: { 'row-1': 'cpu-vcpu-shared', 'row-2': 'ram-gb' },
            defaultVendor: 'TestVendor'
        });
        assert.equal(r.ok, true);
        assert.equal(r.data.schemaVersion, 1);
        assert.equal(r.data.providerId, 'sbercloud');
        assert.equal(r.data.prices['cpu-vcpu-shared'].pricePerUnit, 900);
        assert.equal(r.data.prices['cpu-vcpu-shared'].vendor, 'TestVendor');
        assert.ok(typeof r.data.prices['cpu-vcpu-shared'].priceSource === 'string'
            && r.data.prices['cpu-vcpu-shared'].priceSource.length > 0);
        assert.equal(r.data.prices['ram-gb'].pricePerUnit, 240);
    });

    it('default version = "import-YYYY-MM-DD"', () => {
        const norm = normalizeRows([{ name: 'RAM', price: 200 }]);
        const r = buildProviderPriceJson({
            providerId: 'sbercloud',
            normalizedRows: norm,
            mappings: { 'row-1': 'ram-gb' }
        });
        assert.equal(r.ok, true);
        assert.match(r.data.version, /^import-\d{4}-\d{2}-\d{2}$/);
    });

    it('пустой mapping → reason=empty-prices', () => {
        const norm = normalizeRows([{ name: 'RAM', price: 200 }]);
        const r = buildProviderPriceJson({
            providerId: 'sbercloud',
            normalizedRows: norm,
            mappings: {}
        });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'empty-prices');
    });

    it('без providerId → reason=invalid-provider', () => {
        const r = buildProviderPriceJson({
            providerId: '',
            normalizedRows: normalizeRows([{ name: 'RAM', price: 200 }]),
            mappings: { 'row-1': 'ram-gb' }
        });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'invalid-provider');
    });

    it('vendor берётся из row, если задан', () => {
        const norm = normalizeRows([{ name: 'RAM', price: 200, vendor: 'CustomVendor' }]);
        const r = buildProviderPriceJson({
            providerId: 'sbercloud',
            normalizedRows: norm,
            mappings: { 'row-1': 'ram-gb' }
        });
        assert.equal(r.ok, true);
        assert.equal(r.data.prices['ram-gb'].vendor, 'CustomVendor');
    });
});

/* ============================================================
 * Integration с validateProviderPriceJson
 * ============================================================ */

describe('Integration: built JSON проходит validateProviderPriceJson', async () => {
    const { validateProviderPriceJson } = await import('../../../js/services/providerPriceFetch.js');

    it('собранный JSON валиден для validateProviderPriceJson', () => {
        const norm = normalizeRows([
            { name: 'vCPU shared', price: 900 },
            { name: 'RAM 1 GB',    price: 240 }
        ]);
        const r = buildProviderPriceJson({
            providerId: 'sbercloud',
            normalizedRows: norm,
            mappings: { 'row-1': 'cpu-vcpu-shared', 'row-2': 'ram-gb' },
            defaultVendor: 'TestVendor',
            source: 'unit-test'
        });
        assert.equal(r.ok, true);
        const validated = validateProviderPriceJson(r.data, 'sbercloud');
        assert.equal(validated.ok, true,
            `validator rejected: ${validated.reason || ''} ${validated.message || ''}`);
    });

    it('provider mismatch отклоняется validateProviderPriceJson', () => {
        const norm = normalizeRows([{ name: 'RAM', price: 200 }]);
        const r = buildProviderPriceJson({
            providerId: 'yandex',
            normalizedRows: norm,
            mappings: { 'row-1': 'ram-gb' },
            defaultVendor: 'TestVendor'
        });
        assert.equal(r.ok, true);
        const validated = validateProviderPriceJson(r.data, 'sbercloud');
        assert.equal(validated.ok, false);
        assert.equal(validated.reason, 'provider-mismatch');
    });
});

/* ============================================================
 * getMappingSummary
 * ============================================================ */

describe('getMappingSummary', () => {
    it('считает mapped / unmapped / withErrors / duplicates', () => {
        const norm = normalizeRows([
            { name: 'A', price: 100 }, { name: 'B', price: 200 },
            { name: 'C', price: 300 }, { name: 'D', price: 400 }
        ]);
        const mappings = { 'row-1': 'ram-gb', 'row-2': 'cpu-vcpu-shared' };
        const validation = {
            errors: [
                { rowId: 'row-1', reason: 'invalid-price' },
                { reason: 'duplicate-mapping', rowIds: ['row-3', 'row-4'], itemId: 'ram-gb' }
            ],
            warnings: []
        };
        const s = getMappingSummary(norm, mappings, validation);
        assert.equal(s.total, 4);
        assert.equal(s.mapped, 2);
        assert.equal(s.unmapped, 2);
        assert.ok(s.withErrors >= 1);
        assert.equal(s.duplicates, 1);
    });
});
