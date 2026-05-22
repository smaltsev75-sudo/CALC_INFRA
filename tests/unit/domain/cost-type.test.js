/**
 * Unit-тесты утилиты getCostType: автоопределение CAPEX/OPEX по billingInterval
 * + поддержка явного переопределения через item.costType.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCostType, makeZeroCostTypeMap } from '../../../js/domain/costType.js';
import { COST_TYPE_IDS } from '../../../js/utils/constants.js';

describe('getCostType: явное переопределение', () => {
    it('costType="capex" → capex (даже если billingInterval=monthly)', () => {
        assert.equal(getCostType({ costType: 'capex', billingInterval: 'monthly' }), 'capex');
    });
    it('costType="opex" → opex (даже если billingInterval=oneTime)', () => {
        assert.equal(getCostType({ costType: 'opex', billingInterval: 'oneTime' }), 'opex');
    });
});

describe('getCostType: автоопределение по billingInterval', () => {
    it('billingInterval=oneTime → capex', () => {
        assert.equal(getCostType({ billingInterval: 'oneTime' }), 'capex');
    });
    it('billingInterval=monthly → opex', () => {
        assert.equal(getCostType({ billingInterval: 'monthly' }), 'opex');
    });
    it('billingInterval=annual → opex', () => {
        assert.equal(getCostType({ billingInterval: 'annual' }), 'opex');
    });
    it('billingInterval=daily → opex', () => {
        assert.equal(getCostType({ billingInterval: 'daily' }), 'opex');
    });
});

describe('getCostType: edge cases', () => {
    it('undefined item → opex (безопасный дефолт)', () => {
        assert.equal(getCostType(undefined), 'opex');
    });
    it('null item → opex', () => {
        assert.equal(getCostType(null), 'opex');
    });
    it('пустой объект → opex', () => {
        assert.equal(getCostType({}), 'opex');
    });
    it('costType=мусорное значение → fallback по billingInterval', () => {
        assert.equal(getCostType({ costType: 'whatever', billingInterval: 'oneTime' }), 'capex');
        assert.equal(getCostType({ costType: 'WHATEVER', billingInterval: 'monthly' }), 'opex');
    });
    it('costType="" (пустая строка) → fallback по billingInterval', () => {
        assert.equal(getCostType({ costType: '', billingInterval: 'oneTime' }), 'capex');
    });
    it('costType=null → fallback по billingInterval', () => {
        assert.equal(getCostType({ costType: null, billingInterval: 'oneTime' }), 'capex');
    });
});

describe('makeZeroCostTypeMap', () => {
    it('возвращает {capex:0, opex:0}', () => {
        const m = makeZeroCostTypeMap();
        assert.deepEqual(m, { capex: 0, opex: 0 });
    });
    it('содержит все ключи из COST_TYPE_IDS', () => {
        const m = makeZeroCostTypeMap();
        for (const id of COST_TYPE_IDS) assert.ok(id in m, `ключ ${id} должен присутствовать`);
    });
});
