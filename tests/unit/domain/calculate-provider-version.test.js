/**
 * Stage 8.3: интеграционный тест — calculate() пропускает applyProviderOverlay
 * для calc'ов с `providerVersion` маркером (snapshot уже применён к dictionary).
 *
 * Минимальный setup: один ЭК cpu-vcpu-shared с qty=1 на PROD, без рисков и НДС.
 * После этого результат должен напрямую отражать pricePerUnit:
 *   - БЕЗ providerVersion → applyProviderOverlay перетирает pricePerUnit на frozen
 *     sbercloud (840) → cell.value содержит 840.
 *   - С providerVersion → items используются как есть → cell.value содержит то,
 *     что мы записали в dictionaries.items[i].pricePerUnit (например 12345).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from '../../../js/domain/calculator.js';

function makeMinimalCalc(pricePerUnit, extra = {}) {
    return {
        id: 'test',
        name: 'test',
        settings: {
            applyRiskFactors: false,
            vatEnabled: false,
            provider: 'sbercloud',
            standSizeRatio: { DEV: 0, IFT: 0, PSI: 0, PROD: 1, LOAD: 0 },
            phaseDurationMonths: 1
        },
        answers: {},
        dictionaries: {
            items: [{
                id: 'cpu-vcpu-shared',
                name: 'vCPU',
                category: 'HW',
                resourceClass: 'CPU',
                billingInterval: 'monthly',
                pricePerUnit,
                applicableStands: ['PROD'],
                qtyFormulas: { PROD: '1' }
            }],
            questions: []
        },
        view: { disabledStands: [] },
        ...extra
    };
}

describe('Stage 8.3 calculate(): providerVersion gate', () => {
    it('БЕЗ providerVersion: applyProviderOverlay применяется → pricePerUnit перетёрт на bundled net', () => {
        const calc = makeMinimalCalc(12345);
        const result = calculate(calc, 'rev1');
        const prodCell = result.stands.PROD.items.find(c => c.itemId === 'cpu-vcpu-shared');
        assert.ok(prodCell, 'PROD cell должен существовать');
        /* Stage VAT-2 Phase 4: frozen overlay = bundled net price (582.61 для
         * sbercloud cpu-vcpu-shared = 712 gross / 1.22). Раньше было 840 из
         * hardcoded SBERCLOUD_PRICES — после Phase 4 hardcoded удалён. */
        assert.equal(prodCell.costBase, 583.61,
            'без providerVersion frozen sbercloud overlay (bundled net) должен применяться');
    });

    it('С providerVersion: НЕ применяет overlay, pricePerUnit как есть (12345)', () => {
        const calc = makeMinimalCalc(12345, {
            providerVersion: { id: 'sbercloud', version: '2026-Q3-test', timestamp: '2026-05-09T12:00:00Z' }
        });
        const result = calculate(calc, 'rev2');
        const prodCell = result.stands.PROD.items.find(c => c.itemId === 'cpu-vcpu-shared');
        assert.ok(prodCell);
        assert.equal(prodCell.costBase, 12345,
            'с providerVersion frozen-overlay НЕ должен перетирать pricePerUnit');
    });

    it('providerVersion=null эквивалентен отсутствию поля (overlay применяется)', () => {
        const calc = makeMinimalCalc(12345, { providerVersion: null });
        const result = calculate(calc, 'rev3');
        const prodCell = result.stands.PROD.items.find(c => c.itemId === 'cpu-vcpu-shared');
        /* После Phase 4 — bundled net (583.61), не legacy hardcoded 840. */
        assert.equal(prodCell.costBase, 583.61);
    });
});
