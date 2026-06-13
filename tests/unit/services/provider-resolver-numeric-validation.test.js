/**
 * TDD для T-RISK-7 (data-safety review): provider-override resolver вливал цены
 * в расчёт БЕЗ числовой ре-валидации pricePerUnit. Подделанный/legacy
 * providerOverlayOverrides с pricePerUnit = -500/NaN/0/'abc' тёк через
 * getEffectivePricesForProvider → applyOverrideToItems → в calc → toNum
 * coerce → тихо неверный/отрицательный итог.
 *
 * Фикс: на apply-пути (resolver merge) применяется тот же числовой контракт,
 * что и import-валидатор (providerPriceFetch.js:164): pricePerUnit должен быть
 * положительным конечным числом, иначе override этого ЭК отбрасывается →
 * fallback на frozen-default. defense-in-depth (не exploitable в threat-model
 * offline SPA, но закрывает silent-wrong-number путь).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';
import { __resetStorageMode } from '../../../js/services/storage.js';
import { saveProviderOverride } from '../../../js/state/persistence.js';
import { getEffectivePricesForProvider } from '../../../js/services/providerPriceResolver.js';
import { getEffectivePrices } from '../../../js/domain/providerOverlay.js';

const PROVIDER = 'sbercloud';

describe('providerPriceResolver: числовая ре-валидация pricePerUnit на apply-пути (T-RISK-7)', () => {
    beforeEach(() => {
        installLocalStorage();
        __resetStorageMode();
    });

    it('frozen-провайдер имеет хотя бы 2 ЭК с числовым pricePerUnit (sanity для теста)', () => {
        const frozen = getEffectivePrices(PROVIDER);
        const ids = Object.keys(frozen);
        assert.ok(ids.length >= 2, `ожидалось ≥2 ЭК у ${PROVIDER}, получено ${ids.length}`);
        assert.equal(typeof frozen[ids[0]].pricePerUnit, 'number');
    });

    it('невалидный pricePerUnit в override отбрасывается → fallback на frozen; валидный применяется', () => {
        const frozen = getEffectivePrices(PROVIDER);
        const ids = Object.keys(frozen);
        const corruptId = ids[0];
        const validId = ids[1];
        const frozenCorrupt = frozen[corruptId].pricePerUnit;

        saveProviderOverride(PROVIDER, {
            prices: {
                [corruptId]: { pricePerUnit: -500, vendor: 'tampered' }, // невалидный (отрицательный)
                [validId]: { pricePerUnit: 12345, vendor: 'legit' }       // валидный
            }
        });

        const eff = getEffectivePricesForProvider(PROVIDER);
        assert.equal(eff[corruptId].pricePerUnit, frozenCorrupt,
            'отрицательный override отброшен → frozen-цена');
        assert.equal(eff[validId].pricePerUnit, 12345,
            'валидный override применён');
    });

    it('каждый невалидный класс (NaN / 0 / строка / отсутствует) → fallback на frozen', () => {
        const frozen = getEffectivePrices(PROVIDER);
        const ids = Object.keys(frozen);
        const id = ids[0];
        const frozenPrice = frozen[id].pricePerUnit;

        for (const bad of [NaN, 0, -1, 'abc', null, undefined, Infinity]) {
            saveProviderOverride(PROVIDER, { prices: { [id]: { pricePerUnit: bad, vendor: 'x' } } });
            const eff = getEffectivePricesForProvider(PROVIDER);
            assert.equal(eff[id].pricePerUnit, frozenPrice,
                `pricePerUnit=${String(bad)} должен быть отброшен → frozen`);
        }
    });
});
