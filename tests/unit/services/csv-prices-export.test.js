/**
 * Тесты экспорта прайса ЭК в CSV.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPricesCsv, buildPricesCsvFilename } from '../../../js/services/csvExport.js';

const sampleItem = (overrides = {}) => ({
    id: 'cpu-vcpu-shared',
    name: 'vCPU (общий пул)',
    vendor: 'Cloud.ru',
    unit: 'шт.',
    category: 'HW',
    resourceClass: 'CPU',
    billingInterval: 'monthly',
    pricePerUnit: 840,
    priceUpdatedAt: '2026-05-02T10:00:00.000Z',
    priceSource: 'manual',
    ...overrides
});

describe('buildPricesCsv: header', () => {
    it('начинается с BOM (для Excel-кириллицы)', () => {
        const csv = buildPricesCsv([sampleItem()]);
        assert.equal(csv.charCodeAt(0), 0xFEFF);
    });
    it('содержит все 11 колонок: id..costType', () => {
        const csv = buildPricesCsv([sampleItem()]);
        const headerLine = csv.replace(/^﻿/, '').split('\r\n')[0];
        const cells = headerLine.split(';');
        assert.deepEqual(cells, [
            'id', 'name', 'vendor', 'unit', 'category', 'resourceClass',
            'billingInterval', 'pricePerUnit', 'priceUpdatedAt', 'priceSource', 'costType'
        ]);
    });
});

describe('buildPricesCsv: data', () => {
    it('одна строка на каждый ЭК', () => {
        const csv = buildPricesCsv([sampleItem(), sampleItem({ id: 'ram-gb' })]);
        const lines = csv.replace(/^﻿/, '').split('\r\n');
        assert.equal(lines.length, 3); // header + 2 data
    });
    it('цена форматируется с запятой как десятичным разделителем (RU-локаль)', () => {
        const csv = buildPricesCsv([sampleItem({ pricePerUnit: 14.2 })]);
        assert.match(csv, /14,2/);
    });
    it('priceSource = "seed" если не задан', () => {
        const csv = buildPricesCsv([sampleItem({ priceSource: undefined })]);
        const lines = csv.replace(/^﻿/, '').split('\r\n');
        const cells = lines[1].split(';');
        // priceSource — 10-я колонка (индекс 9); 11-я (последняя) = costType.
        assert.equal(cells[9], 'seed');
    });
    it('priceUpdatedAt пустой если не задан', () => {
        const csv = buildPricesCsv([sampleItem({ priceUpdatedAt: undefined })]);
        const lines = csv.replace(/^﻿/, '').split('\r\n');
        const cells = lines[1].split(';');
        // 9-я колонка (priceUpdatedAt) — индекс 8
        assert.equal(cells[8], '');
    });
});

describe('buildPricesCsv: escaping', () => {
    it('значение с точкой с запятой — оборачивается в кавычки', () => {
        const csv = buildPricesCsv([sampleItem({ name: 'A; B; C' })]);
        assert.match(csv, /"A; B; C"/);
    });
    it('кавычки удваиваются внутри значения', () => {
        const csv = buildPricesCsv([sampleItem({ name: 'A "quoted" name' })]);
        assert.match(csv, /"A ""quoted"" name"/);
    });
    it('перевод строки — экранируется кавычками', () => {
        const csv = buildPricesCsv([sampleItem({ vendor: 'Line1\nLine2' })]);
        assert.match(csv, /"Line1\nLine2"/);
    });
});

describe('buildPricesCsv: пустой каталог', () => {
    it('возвращает только header', () => {
        const csv = buildPricesCsv([]);
        const lines = csv.replace(/^﻿/, '').split('\r\n');
        assert.equal(lines.length, 1);
    });
    it('обрабатывает null/undefined items', () => {
        assert.doesNotThrow(() => buildPricesCsv(null));
        assert.doesNotThrow(() => buildPricesCsv(undefined));
    });
});

describe('buildPricesCsvFilename', () => {
    it('содержит prices и текущую дату', () => {
        const f = buildPricesCsvFilename();
        assert.match(f, /^prices-\d{2}\.\d{2}\.\d{4}\.csv$/);
    });
});
