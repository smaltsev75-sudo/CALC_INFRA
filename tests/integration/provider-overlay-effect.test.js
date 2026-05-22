/**
 * 14.U6 integration: applyProviderOverlay реально влияет на calculate().
 *
 * Сценарии:
 *   1. SberCloud overlay переопределяет pricePerUnit для известных id —
 *      cell.costBase меняется по сравнению с seed-расчётом.
 *   2. Silent fallback: для item.id не в overlay seed-цена сохраняется.
 *   3. Смена provider → пересчёт даёт другую сумму (через кэш-инвалидацию).
 *   4. Stub-провайдер (active=false) → overlay не применяется, расчёт = seed.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, clearCalculationCache } from '../../js/domain/calculator.js';
import { buildSeedDictionaries } from '../../js/domain/seed.js';
import { PROVIDER_OVERLAYS } from '../../js/domain/providerOverlay.js';

function makeCalc(provider) {
    const dict = buildSeedDictionaries();
    /* Минимальный набор answers — реалистичный профиль (B2B/M).
       Достаточно чтобы CPU/RAM/Storage получили ненулевые qty. */
    const answers = {};
    for (const q of dict.questions) {
        if (q.defaultValue !== undefined && q.defaultValue !== null) answers[q.id] = q.defaultValue;
    }
    answers.registered_users_total = 100000;
    answers.dau_share_of_registered_percent = 20;
    answers.peak_rps = 200;
    answers.microservices_count = 8;

    return {
        id: `test-${provider}`,
        version: '1.0',
        schemaVersion: 14,
        wizard: null,
        answersMeta: {},
        answers,
        settings: {
            provider,
            providerSetByWizard: false,
            phaseDurationMonths: 12,
            applyRiskFactors: false,  /* Чтобы видеть прямой эффект на costBase, не на costFinal */
            vatEnabled: false,
            kInflation: 0,
            kSeasonal: 0,
            kScheduleShift: 0,
            kContingency: 0,
            bufferTask: 0,
            bufferProject: 0
        },
        view: { disabledStands: [] },
        dictionaries: dict
    };
}

beforeEach(() => clearCalculationCache());

describe('14.U6 applyProviderOverlay меняет cell.costBase', () => {
    it('SberCloud: cpu-vcpu-shared имеет другую цену чем seed (overlay reaches calculate)', () => {
        /* Phase 4: service-sms-per-1k не в bundled sbercloud → беру core SKU
         * cpu-vcpu-shared, который ЕСТЬ в bundled и отличается от seed. */
        const seedItem = buildSeedDictionaries().items.find(i => i.id === 'cpu-vcpu-shared');
        const overlayPrice = PROVIDER_OVERLAYS.sbercloud.prices['cpu-vcpu-shared'].pricePerUnit;
        // Sanity: overlay-цена ≠ seed-цена (если они равны, тест бессмысленный)
        assert.notEqual(overlayPrice, seedItem.pricePerUnit,
            `overlay-цена ${overlayPrice} совпадает с seed-ценой ${seedItem.pricePerUnit} — ` +
            `тест не проверит overlay-эффект`);

        const c = makeCalc('sbercloud');
        const r = calculate(c);
        const cell = r.items['cpu-vcpu-shared'].stands.PROD;
        if (cell.qty > 0) {
            // costBase = qty × pricePerUnit × billingIntervalMul (для monthly = 1)
            const expectedFromOverlay = cell.qty * overlayPrice;
            const expectedFromSeed    = cell.qty * seedItem.pricePerUnit;
            // costBase должен быть ближе к overlay-цене, не seed
            assert.ok(Math.abs(cell.costBase - expectedFromOverlay) < Math.abs(cell.costBase - expectedFromSeed),
                `cell.costBase ${cell.costBase} ближе к seed (${expectedFromSeed}), не к overlay (${expectedFromOverlay})`);
        }
    });

    it('Silent fallback: ЭК БЕЗ записи в overlay использует seed pricePerUnit', () => {
        /* В SberCloud overlay 14 ЭК. Найдём seed-item, которого там нет. */
        const overlayIds = new Set(Object.keys(PROVIDER_OVERLAYS.sbercloud.prices));
        const seedItemNotInOverlay = buildSeedDictionaries().items
            .find(i => !overlayIds.has(i.id) && i.pricePerUnit > 0);
        assert.ok(seedItemNotInOverlay, 'нужен seed-item не в overlay для теста fallback');

        const c = makeCalc('sbercloud');
        const r = calculate(c);
        const cell = r.items[seedItemNotInOverlay.id]?.stands.PROD;
        if (cell && cell.qty > 0) {
            const expected = cell.qty * seedItemNotInOverlay.pricePerUnit;
            assert.ok(Math.abs(cell.costBase - expected) < 0.01,
                `costBase для ${seedItemNotInOverlay.id} (без overlay) должен быть ${expected}, ` +
                `получено ${cell.costBase}`);
        }
    });
});

describe('Stage 4.7: stub-провайдер (onprem) не применяет overlay', () => {
    /* Stage 4.7: vk переключён с inactive stub на active overlay (14 ЭК).
       Stub-роль теперь только у onprem (CAPEX-модель — overlay подменяет
       OPEX, для onprem нужна отдельная calc-модель). */
    it('provider="onprem" (active=false) → расчёт идентичен seed-only', () => {
        const cOnprem = makeCalc('onprem');
        const rOnprem = calculate(cOnprem);
        const seedItem = buildSeedDictionaries().items.find(i => i.id === 'service-sms-per-1k');
        const cell = rOnprem.items['service-sms-per-1k'].stands.PROD;
        if (cell.qty > 0) {
            const expectedFromSeed = cell.qty * seedItem.pricePerUnit;
            assert.ok(Math.abs(cell.costBase - expectedFromSeed) < 0.01,
                `onprem (active=false) → costBase должен быть ${expectedFromSeed} (seed), ` +
                `получено ${cell.costBase}`);
        }
    });
});

describe('14.U6/14.U8 cache invalidation при смене provider', () => {
    it('два разных активных provider дают два разных результата', () => {
        /* Phase 4: service-sms-per-1k не в bundled. Используем cpu-vcpu-shared —
         * core SKU, разный в bundled.sbercloud (583.61 net) и
         * bundled.yandex (741.80 net). */
        const sberPrice = PROVIDER_OVERLAYS.sbercloud.prices['cpu-vcpu-shared'].pricePerUnit;
        const yandexPrice = PROVIDER_OVERLAYS.yandex.prices['cpu-vcpu-shared'].pricePerUnit;
        assert.notEqual(sberPrice, yandexPrice,
            `sber/yandex prices для cpu-vcpu-shared должны отличаться`);

        const cSber   = makeCalc('sbercloud');
        const cYandex = makeCalc('yandex');
        const rSber   = calculate(cSber);
        const rYandex = calculate(cYandex);

        const cellSber   = rSber.items['cpu-vcpu-shared'].stands.PROD;
        const cellYandex = rYandex.items['cpu-vcpu-shared'].stands.PROD;
        if (cellSber.qty > 0) {
            assert.notEqual(cellSber.costBase, cellYandex.costBase,
                'SberCloud и Yandex должны давать разные costBase для cpu-vcpu-shared');
        }
    });
});
