/**
 * Инвариант «ни один стенд по мощности не превосходит ПРОМ» — действует для
 * DEV/ИФТ/ПСИ. Для LOAD (нагрузочный) инвариант СНЯТ в Stage 19 (MINOR 2.19.0)
 * — нагрузочный стенд может иметь capacity-запас сверх PROD для load testing
 * under stress (max 1.20).
 *
 * Stage 19 (2026-05-19, MINOR 2.19.0): по запросу пользователя.
 *   - DEFAULT_STAND_SIZE_RATIO.LOAD: 0.80 → 1.20
 *   - STAND_RATIO_RANGES.LOAD.max: 1.00 → 1.20
 *   - VALIDATION.RATIO_MAX: 1.0 → 1.20 (общий потолок, per-stand детально)
 *   - DEV дефолт 0.16 → 0.20 (больше ресурсов разработчикам)
 *
 * AI-фактор стенда (aiStandFactor) — инвариант ≤ 1.00 СОХРАНЁН для всех
 * стендов: AI-нагрузка измеряется относительно prod-эквивалента, не имеет
 * смысла превышать.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    STAND_RATIO_RANGES,
    AI_STAND_FACTOR_RANGES,
    DEFAULT_STAND_SIZE_RATIO,
    DEFAULT_RESOURCE_RATIO,
    DEFAULT_AI_STAND_FACTOR,
    VALIDATION,
    STAND_IDS
} from '../../../js/utils/constants.js';

const STANDS_LE_PROD = ['DEV', 'IFT', 'PSI', 'PROD'];

describe('инвариант стенд ≤ ПРОМ (Stage 19: снят для LOAD)', () => {
    it('STAND_RATIO_RANGES: DEV/ИФТ/ПСИ max ≤ 1.00 (инвариант сохранён)', () => {
        for (const stand of STANDS_LE_PROD) {
            const range = STAND_RATIO_RANGES[stand];
            assert.ok(range, `${stand}: диапазон должен быть определён`);
            assert.ok(range.max <= 1.00,
                `${stand}.max = ${range.max}, должен быть ≤ 1.00 (ПРОМ — эталон)`);
        }
    });

    it('STAND_RATIO_RANGES.LOAD.max = 1.20 (capacity-запас разрешён)', () => {
        const loadRange = STAND_RATIO_RANGES.LOAD;
        assert.equal(loadRange.max, 1.20,
            'LOAD.max должен быть 1.20: нагрузочный стенд под stress\'ом должен ' +
            'иметь capacity-запас сверх PROD для load testing.');
    });

    it('AI_STAND_FACTOR_RANGES: каждый stand max ≤ 1.00 (инвариант для AI-фактора сохранён)', () => {
        /* AI-фактор: PROD — эталон AI-нагрузки. Превышать смысла нет —
         * это не capacity, а доля. */
        for (const stand of STAND_IDS) {
            const range = AI_STAND_FACTOR_RANGES[stand];
            assert.ok(range, `${stand}: диапазон должен быть определён`);
            assert.ok(range.max <= 1.00,
                `${stand}.max = ${range.max}, должен быть ≤ 1.00 (ПРОМ — эталон AI-нагрузки)`);
        }
    });

    it('VALIDATION.RATIO_MAX = 1.20 (общий потолок, per-stand детально через STAND_RATIO_RANGES)', () => {
        assert.equal(VALIDATION.RATIO_MAX, 1.20,
            'RATIO_MAX — общий потолок standSizeRatio/resourceRatio. Stage 19: ' +
            'поднят 1.0 → 1.20 чтобы пропустить LOAD до 1.20. Per-stand точная ' +
            'проверка делается через STAND_RATIO_RANGES.');
    });

    it('DEFAULT_STAND_SIZE_RATIO: PROD=1.00, DEV/IFT/PSI ≤ 1.00', () => {
        assert.equal(DEFAULT_STAND_SIZE_RATIO.PROD, 1.00, 'PROD дефолт = 1.00');
        for (const stand of STANDS_LE_PROD) {
            assert.ok(DEFAULT_STAND_SIZE_RATIO[stand] <= 1.00,
                `${stand} дефолт = ${DEFAULT_STAND_SIZE_RATIO[stand]}, ожидался ≤ 1.00`);
        }
    });

    it('DEFAULT_STAND_SIZE_RATIO.DEV = 0.20 (Stage 19: 0.16 → 0.20)', () => {
        assert.equal(DEFAULT_STAND_SIZE_RATIO.DEV, 0.20,
            'DEV дефолт поднят 0.16 → 0.20 в Stage 19 (больше ресурсов разработчикам).');
    });

    it('DEFAULT_STAND_SIZE_RATIO.LOAD = 1.20 (Stage 19: 0.80 → 1.20)', () => {
        assert.equal(DEFAULT_STAND_SIZE_RATIO.LOAD, 1.20,
            'LOAD дефолт поднят 0.80 → 1.20 в Stage 19 (capacity-запас для load testing).');
    });

    it('DEFAULT_RESOURCE_RATIO: DEV/IFT/PSI ячейки ≤ 1.00; LOAD до 1.20', () => {
        for (const stand of STANDS_LE_PROD) {
            const row = DEFAULT_RESOURCE_RATIO[stand];
            for (const resource of Object.keys(row)) {
                assert.ok(row[resource] <= 1.00,
                    `${stand}.${resource} = ${row[resource]}, ожидался ≤ 1.00`);
            }
        }
        const loadRow = DEFAULT_RESOURCE_RATIO.LOAD;
        for (const resource of Object.keys(loadRow)) {
            assert.ok(loadRow[resource] <= 1.20,
                `LOAD.${resource} = ${loadRow[resource]}, ожидался ≤ 1.20`);
        }
    });

    it('DEFAULT_AI_STAND_FACTOR: PROD=1.00, все ≤ 1.00 (инвариант для AI сохранён)', () => {
        assert.equal(DEFAULT_AI_STAND_FACTOR.PROD, 1.00, 'PROD дефолт = 1.00');
        for (const stand of STAND_IDS) {
            assert.ok(DEFAULT_AI_STAND_FACTOR[stand] <= 1.00,
                `${stand} дефолт = ${DEFAULT_AI_STAND_FACTOR[stand]}, ожидался ≤ 1.00`);
        }
    });
});
