/**
 * Stage 5A — validateItem принимает опциональное поле ekClass.
 *
 * ekClass опционален в контракте (backward-compat: legacy-словари без поля
 * валидны), но если задан — должен быть из EKCLASS_IDS. Полнота на SEED_ITEMS
 * гарантируется отдельным arch-тестом, не контрактом импорта.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateItem } from '../../../js/domain/validation.js';

function goodItem(extra = {}) {
    return {
        id: 'x-test', name: 'Тест', unit: 'шт.', pricePerUnit: 100,
        category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
        applicableStands: ['PROD'], qtyFormulas: { PROD: '1' },
        ...extra
    };
}

describe('Stage 5A validateItem — ekClass', () => {
    it('валидный ekClass принимается', () => {
        const errors = validateItem(goodItem({ ekClass: 'prod-derived' }), [], 'item');
        assert.equal(errors.filter(e => e.path.endsWith('.ekClass')).length, 0);
    });
    it('отсутствие ekClass допустимо (backward-compat)', () => {
        const errors = validateItem(goodItem(), [], 'item');
        assert.equal(errors.filter(e => e.path.endsWith('.ekClass')).length, 0);
    });
    it('невалидный ekClass отвергается', () => {
        const errors = validateItem(goodItem({ ekClass: 'bogus' }), [], 'item');
        assert.equal(errors.filter(e => e.path.endsWith('.ekClass')).length, 1);
    });
    it('пустая строка ekClass трактуется как отсутствие (не ошибка)', () => {
        const errors = validateItem(goodItem({ ekClass: '' }), [], 'item');
        assert.equal(errors.filter(e => e.path.endsWith('.ekClass')).length, 0);
    });
});
