/**
 * Stage VAT-2 Phase 1 — Double-VAT Regression (acceptance core, criterion 22).
 *
 * Группа E из spec-plan
 * [provider-price-schema-v2.spec-plan.md](../../docs/assistant/provider-price-schema-v2.spec-plan.md).
 *
 * Главный инвариант VAT-2:
 *
 *   Provider JSON gross price → normalizeProviderPriceEntry → net
 *   Calculator multiplies by vatMul ровно один раз
 *   → итог = qty × net × (1 + calc.vatRate), а НЕ × gross × (1 + calc.vatRate)
 *
 * Конкретный регрессионный сценарий:
 *
 *   gross 122 + vatRate 0.22 → net 100
 *   calc VAT 20% manual → final = 1 × 100 × 1.20 = 120
 *   ЗАПРЕЩЕНО: final === 146.4 (= 1 × 122 × 1.20, double-VAT)
 *
 * Тест работает на границе validator/normalizer (выход Phase 1). Полная
 * интеграция с calculator.js через calc.dictionaries — Phase 3 (когда
 * bundled JSON конвертированы в v2) + Phase 4 (overlay убран). Здесь
 * проверяем, что НА ВЫХОДЕ из Phase 1 normalizer'а pricePerUnit = net,
 * и мульпликация `× (1 + vat)` даёт ожидаемое значение.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

let svc;

before(async () => {
    installLocalStorage();
    svc = await import('../../js/services/providerPriceFetch.js');
});

/**
 * Симулирует ту же арифметику, что calculator.js#riskFactor применяет к
 * cell.cost: `qty × pricePerUnit × vatMul` при applyRiskFactors=false
 * (изолируем НДС от риск-коэффициентов). Точная формула в
 * [calculator.js](../../js/domain/calculator.js) — `costFinal = costBase × vatMul`.
 */
function simulateCalcFinal(qty, pricePerUnit, vatEnabled, calcVatRate) {
    const vatMul = vatEnabled ? (1 + calcVatRate) : 1;
    const costBase = qty * pricePerUnit;
    return costBase * vatMul;
}

function makeV2(prices, vatPolicy) {
    return {
        schemaVersion: 2,
        providerId: 'sbercloud',
        version: '2026-Q3-test',
        timestamp: '2026-05-12T10:00:00.000Z',
        source: 'test fixture v2',
        vatPolicy,
        prices
    };
}

describe('E.1 — JSON gross 22% → calc VAT 20% manual → final = 120 (НЕ 146.4)', () => {
    it('защита от двойного учёта НДС — ядро acceptance criterion 22 VAT-2', () => {
        /* Шаг 1: импорт. v2 JSON, gross=122, vatRate=0.22 → normalize → net=100. */
        const json = makeV2(
            {
                X: {
                    pricePerUnitGross: 122,
                    vatRate: 0.22,
                    vendor: 'TestVendor',
                    priceSource: 'gross 22% reference'
                }
            },
            { pricesIncludeVat: true, vatRateIncluded: 0.22, confidence: 'verified' }
        );
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, true, `validator must accept: ${JSON.stringify(r)}`);
        const net = r.data.prices.X.pricePerUnit;
        assert.equal(net, 100, 'normalized pricePerUnit must equal net (gross/1.22)');

        /* Шаг 2: расчёт. qty=1, vatEnabled=true, calc.vatRate=0.20 (manual). */
        const final = simulateCalcFinal(1, net, true, 0.20);

        /* Шаг 3: assert. */
        assert.equal(final, 120, `expected single-VAT 120, got ${final}`);
        assert.notEqual(final, 146.4,
            'CRITICAL: double-VAT detected. ' +
            'gross 122 был использован вместо net 100 — нормализация сломана.');
    });
});

describe('E.2 — JSON net → calc VAT 22% (auto/manual) → final = 122', () => {
    it('net-only JSON: pricePerUnit=100 + calc.vatRate=0.22 → final 122', () => {
        const json = makeV2(
            {
                X: {
                    pricePerUnitNet: 100,
                    vendor: 'TestVendor',
                    priceSource: 'net reference'
                }
            },
            { pricesIncludeVat: false, confidence: 'verified' }
        );
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, true);
        const final = simulateCalcFinal(1, r.data.prices.X.pricePerUnit, true, 0.22);
        assert.equal(final, 122);
    });
});

describe('E.3 — JSON gross 22% → calc VAT отключён → final = 100', () => {
    it('vatEnabled=false → net остаётся как был (без mult), НЕ gross', () => {
        const json = makeV2(
            {
                X: {
                    pricePerUnitGross: 122,
                    vatRate: 0.22,
                    vendor: 'TestVendor',
                    priceSource: 'gross 22% with calc VAT off'
                }
            },
            { pricesIncludeVat: true, vatRateIncluded: 0.22, confidence: 'verified' }
        );
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, true);
        const final = simulateCalcFinal(1, r.data.prices.X.pricePerUnit, false, 0);
        assert.equal(final, 100,
            'vatEnabled=false с gross-источником должен дать net (100), ' +
            'НЕ 122 (старый gross snapshot), НЕ 146.4 (double-VAT)');
    });
});

describe('E.4 — Frozen mode сохраняет ставку, цена остаётся net', () => {
    it('Legacy frozen calc.vatRate=0.20 + новый v2 импорт gross 22% → final 120', () => {
        /* Legacy calc заморозил НДС на 20% (VAT-1 frozen mode). Пользователь
         * импортировал свежий v2 prices с gross 22%. Цена нормализуется к net
         * (100), calc применяет frozen 20% → final 120. */
        const json = makeV2(
            {
                X: {
                    pricePerUnitGross: 122,
                    vatRate: 0.22,
                    vendor: 'TestVendor',
                    priceSource: 'gross 22% frozen-calc scenario'
                }
            },
            { pricesIncludeVat: true, vatRateIncluded: 0.22, confidence: 'verified' }
        );
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, true);
        const final = simulateCalcFinal(1, r.data.prices.X.pricePerUnit, true, 0.20);
        assert.equal(final, 120, 'frozen 20% применяется к net, НЕ к gross');
    });
});

describe('E.5 — v1 + user-policy gross-22 → final при vat=0.20 = 120', () => {
    it('legacy v1 импорт с явной user-policy → net, далее calc применяет VAT', () => {
        /* Симметрия E.1 через v1+userVatPolicy путь — для legacy CSV-imports
         * или старых JSONs без vatPolicy. */
        const json = {
            schemaVersion: 1,
            providerId: 'sbercloud',
            version: '2026-Q3-test',
            timestamp: '2026-05-12T10:00:00.000Z',
            source: 'legacy v1 test',
            prices: {
                X: {
                    pricePerUnit: 122,
                    vendor: 'TestVendor',
                    priceSource: 'legacy без VAT-policy'
                }
            }
        };
        const r = svc.validateProviderPriceJson(
            json, 'sbercloud', { userVatPolicy: 'gross-22' });
        assert.equal(r.ok, true);
        const net = r.data.prices.X.pricePerUnit;
        assert.equal(net, 100, 'v1 + gross-22 policy → /1.22 → 100');

        const final = simulateCalcFinal(1, net, true, 0.20);
        assert.equal(final, 120);
        assert.notEqual(final, 146.4, 'double-VAT regression через v1-path');
    });
});
