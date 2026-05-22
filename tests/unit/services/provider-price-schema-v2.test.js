/**
 * Stage VAT-2 Phase 1 — Provider Price JSON Schema v2.
 *
 * Покрывает контракт `validateProviderPriceJson` (расширенный для v2) +
 * `normalizeProviderPriceEntry` (новый pure helper) из
 * [providerPriceFetch.js](js/services/providerPriceFetch.js).
 *
 * Группы тестов (по spec-plan
 * [provider-price-schema-v2.spec-plan.md](provider-price-schema-v2.spec-plan.md)):
 *   A — v2 happy paths (net / gross+vatRate / net+gross+vatRate)
 *   B — v2 rejects (mismatch / gross без vatRate / invalid rate / negative price /
 *       unsupported schemaVersion)
 *   C — v1 fallback с user-policy (net / gross-20 / gross-22 / require-policy)
 *   D — anti-patterns (priceSource not authoritative, null vatPolicy, confidence whitelist)
 *   F — validator API contract (signature + идемпотентность)
 *
 * Group E (double-VAT regression) — отдельный integration-test:
 * [tests/integration/vat-double-regression.test.js].
 *
 * Главный инвариант, защищаемый этим файлом:
 *
 *   normalized.prices[id].pricePerUnit === NET
 *
 * Calculator применяет НДС ровно один раз через `vatMul` поверх net —
 * см. [calculator.js](js/domain/calculator.js#L1) `costFinal`.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';
import { EPSILON_VAT_CONSISTENCY } from '../../../js/utils/constants.js';

let svc;

const PROVIDER_VAT_POLICY_GROSS_22 = Object.freeze({
    pricesIncludeVat: true,
    vatRateIncluded: 0.22,
    confidence: 'verified'
});

const PROVIDER_VAT_POLICY_NET = Object.freeze({
    pricesIncludeVat: false,
    confidence: 'verified'
});

function makeValidV2(prices) {
    return {
        schemaVersion: 2,
        providerId: 'sbercloud',
        version: '2026-Q3-test',
        timestamp: '2026-05-12T10:00:00.000Z',
        source: 'test fixture v2',
        vatPolicy: PROVIDER_VAT_POLICY_GROSS_22,
        prices: prices ?? {
            'cpu-vcpu-shared': {
                pricePerUnitGross: 122,
                vatRate: 0.22,
                vendor: 'SberCloud',
                priceSource: 'test'
            }
        }
    };
}

function makeValidV1(prices) {
    return {
        schemaVersion: 1,
        providerId: 'sbercloud',
        version: '2026-Q3-test',
        timestamp: '2026-05-12T10:00:00.000Z',
        source: 'test fixture v1',
        prices: prices ?? {
            'cpu-vcpu-shared': {
                pricePerUnit: 122,
                vendor: 'SberCloud',
                priceSource: 'test'
            }
        }
    };
}

before(async () => {
    installLocalStorage();
    svc = await import('../../../js/services/providerPriceFetch.js');
});

/* ============================================================
 * Group A — v2 happy paths
 * ============================================================ */

describe('A.1 — v2 принимает pricePerUnitNet', () => {
    it('сохраняет pricePerUnit = net и помечает vatNormalized', () => {
        const json = makeValidV2({
            'cpu-vcpu-shared': {
                pricePerUnitNet: 100,
                vendor: 'SberCloud',
                priceSource: 'test'
            }
        });
        json.vatPolicy = PROVIDER_VAT_POLICY_NET;
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
        const entry = r.data.prices['cpu-vcpu-shared'];
        assert.equal(entry.pricePerUnit, 100);
        assert.equal(entry.pricePerUnitNet, 100);
        assert.equal(entry.vatNormalized, true);
    });
});

describe('A.2 — v2 принимает gross + vatRate, считает net', () => {
    it('122 / 1.22 → net=100, gross=122, vatRateIncluded=0.22', () => {
        const json = makeValidV2({
            'cpu-vcpu-shared': {
                pricePerUnitGross: 122,
                vatRate: 0.22,
                vendor: 'SberCloud',
                priceSource: 'test'
            }
        });
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
        const entry = r.data.prices['cpu-vcpu-shared'];
        assert.equal(entry.pricePerUnit, 100);
        assert.equal(entry.pricePerUnitGross, 122);
        assert.equal(entry.vatRateIncluded, 0.22);
        assert.equal(entry.vatNormalized, true);
    });
});

describe('A.3 — v2 принимает net + gross + vatRate, валидирует consistency', () => {
    it('согласованные net=100, gross=122, vat=0.22 → ok, net=100', () => {
        const json = makeValidV2({
            'cpu-vcpu-shared': {
                pricePerUnitNet: 100.00,
                pricePerUnitGross: 122.00,
                vatRate: 0.22,
                vendor: 'SberCloud',
                priceSource: 'test'
            }
        });
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
        assert.equal(r.data.prices['cpu-vcpu-shared'].pricePerUnit, 100.00);
    });
});

/* ============================================================
 * Group B — v2 rejects
 * ============================================================ */

describe('B.1 — net/gross mismatch вне EPSILON_VAT_CONSISTENCY → vat-inconsistency', () => {
    it('gross=122.05 при net=100 vat=0.22 (ожидался 122.00, отклонение 0.05 > 0.01)', () => {
        const json = makeValidV2({
            'cpu-vcpu-shared': {
                pricePerUnitNet: 100.00,
                pricePerUnitGross: 122.05,
                vatRate: 0.22,
                vendor: 'X',
                priceSource: 'y'
            }
        });
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'vat-inconsistency');
    });
});

describe('B.2 — mismatch внутри EPSILON_VAT_CONSISTENCY → принимается', () => {
    it('gross=122.005 при net=100 vat=0.22 (отклонение 0.005 <= 0.01) → ok', () => {
        const json = makeValidV2({
            'cpu-vcpu-shared': {
                pricePerUnitNet: 100.00,
                pricePerUnitGross: 122.005,
                vatRate: 0.22,
                vendor: 'X',
                priceSource: 'y'
            }
        });
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, true, `expected ok within EPSILON, got ${JSON.stringify(r)}`);
        assert.equal(r.data.prices['cpu-vcpu-shared'].pricePerUnit, 100.00);
    });

    it('EPSILON_VAT_CONSISTENCY ровно 0.01 (контракт зафиксирован в constants)', () => {
        assert.equal(EPSILON_VAT_CONSISTENCY, 0.01);
    });
});

describe('B.3 — gross без vatRate → gross-without-vat-rate', () => {
    it('pricePerUnitGross=122 без vatRate → reject', () => {
        const json = makeValidV2({
            'cpu-vcpu-shared': {
                pricePerUnitGross: 122,
                vendor: 'X',
                priceSource: 'y'
            }
        });
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'gross-without-vat-rate');
    });
});

describe('B.4 — invalid vatRate (table-driven)', () => {
    const cases = [
        { name: 'отрицательный', vatRate: -0.1 },
        { name: 'больше 1 (доля, не процент)', vatRate: 1.5 },
        { name: 'ровно 22 (как процент, не доля)', vatRate: 22 },
        { name: 'NaN', vatRate: NaN },
        { name: 'Infinity', vatRate: Infinity },
        { name: 'строка', vatRate: '0.22' }
    ];
    for (const c of cases) {
        it(`reject: vatRate=${c.name}`, () => {
            const json = makeValidV2({
                'cpu-vcpu-shared': {
                    pricePerUnitGross: 122,
                    vatRate: c.vatRate,
                    vendor: 'X',
                    priceSource: 'y'
                }
            });
            const r = svc.validateProviderPriceJson(json, 'sbercloud');
            assert.equal(r.ok, false, `expected reject for vatRate=${c.name}`);
            assert.equal(r.reason, 'invalid-vat-rate');
        });
    }
});

describe('B.5 — negative / Infinity / NaN net/gross', () => {
    const cases = [
        { field: 'pricePerUnitNet', value: -1, reason: 'invalid-price' },
        { field: 'pricePerUnitGross', value: -1, reason: 'invalid-price' },
        { field: 'pricePerUnitNet', value: Infinity, reason: 'invalid-price' },
        { field: 'pricePerUnitNet', value: NaN, reason: 'invalid-price' }
    ];
    for (const c of cases) {
        it(`reject: ${c.field}=${c.value}`, () => {
            const entry = c.field === 'pricePerUnitGross'
                ? { pricePerUnitGross: c.value, vatRate: 0.22, vendor: 'X', priceSource: 'y' }
                : { [c.field]: c.value, vendor: 'X', priceSource: 'y' };
            const json = makeValidV2({ 'cpu-vcpu-shared': entry });
            const r = svc.validateProviderPriceJson(json, 'sbercloud');
            assert.equal(r.ok, false);
            assert.equal(r.reason, c.reason);
        });
    }
});

describe('B.6 — unsupported schemaVersion', () => {
    it('schemaVersion=3 → schema-version', () => {
        const json = { ...makeValidV2(), schemaVersion: 3 };
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'schema-version');
    });

    it('schemaVersion=0 → schema-version', () => {
        const json = { ...makeValidV2(), schemaVersion: 0 };
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'schema-version');
    });
});

/* ============================================================
 * Group C — v1 fallback с user-policy
 * ============================================================ */

describe('C.1 — v1 + requireVatPolicy=true без userVatPolicy → vat-policy-required', () => {
    it('блокирует «тихий» импорт legacy-файла', () => {
        const r = svc.validateProviderPriceJson(
            makeValidV1(),
            'sbercloud',
            { requireVatPolicy: true }
        );
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'vat-policy-required');
    });

    it('default: requireVatPolicy=false → v1 без policy НЕ ломается (backwards-compat для bundled JSON)', () => {
        const r = svc.validateProviderPriceJson(makeValidV1(), 'sbercloud');
        assert.equal(r.ok, true);
        /* Без policy v1 не нормализуется — pricePerUnit остаётся как был. */
        assert.equal(r.data.prices['cpu-vcpu-shared'].pricePerUnit, 122);
        assert.notEqual(r.data.prices['cpu-vcpu-shared'].vatNormalized, true);
    });
});

describe('C.2 — v1 + userVatPolicy=net → цена не меняется', () => {
    it('pricePerUnit=122 при policy=net → нормализованный pricePerUnit=122', () => {
        const r = svc.validateProviderPriceJson(
            makeValidV1(),
            'sbercloud',
            { userVatPolicy: 'net' }
        );
        assert.equal(r.ok, true);
        const entry = r.data.prices['cpu-vcpu-shared'];
        assert.equal(entry.pricePerUnit, 122);
        assert.equal(entry.pricePerUnitNet, 122);
        assert.equal(entry.vatNormalized, true);
        assert.equal(entry.vatPolicyConfidence, 'user-declared');
    });
});

describe('C.3 — v1 + userVatPolicy=gross-20 → /1.20', () => {
    it('pricePerUnit=120 → net=100, gross=120, vatRateIncluded=0.20', () => {
        const r = svc.validateProviderPriceJson(
            makeValidV1({
                'cpu-vcpu-shared': { pricePerUnit: 120, vendor: 'X', priceSource: 'y' }
            }),
            'sbercloud',
            { userVatPolicy: 'gross-20' }
        );
        assert.equal(r.ok, true);
        const entry = r.data.prices['cpu-vcpu-shared'];
        assert.equal(entry.pricePerUnit, 100);
        assert.equal(entry.pricePerUnitGross, 120);
        assert.equal(entry.vatRateIncluded, 0.20);
        assert.equal(entry.vatPolicyConfidence, 'user-declared');
        assert.equal(entry.originalPricePerUnit, 120);
    });
});

describe('C.4 — v1 + userVatPolicy=gross-22 → /1.22', () => {
    it('pricePerUnit=122 → net=100, gross=122, vatRateIncluded=0.22', () => {
        const r = svc.validateProviderPriceJson(
            makeValidV1(),
            'sbercloud',
            { userVatPolicy: 'gross-22' }
        );
        assert.equal(r.ok, true);
        const entry = r.data.prices['cpu-vcpu-shared'];
        assert.equal(entry.pricePerUnit, 100);
        assert.equal(entry.pricePerUnitGross, 122);
        assert.equal(entry.vatRateIncluded, 0.22);
    });
});

/* ============================================================
 * Group D — anti-patterns
 * ============================================================ */

describe('D.1 — priceSource НЕ парсится как VAT source of truth', () => {
    it('v1 «цена С НДС 22%» в priceSource БЕЗ userVatPolicy и БЕЗ requireVatPolicy → ok без нормализации', () => {
        /* Защита от соблазна парсить «С НДС 22%» из текста.
         * Текстовый priceSource остаётся meta-полем, не правит цену. */
        const json = makeValidV1({
            'cpu-vcpu-shared': {
                pricePerUnit: 122,
                vendor: 'X',
                priceSource: 'Cloud.ru Evolution, цена С НДС 22%'
            }
        });
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, true);
        /* Если бы priceSource парсился — pricePerUnit бы пересчитался в ~100.
         * Этого происходить НЕ должно. */
        assert.equal(r.data.prices['cpu-vcpu-shared'].pricePerUnit, 122);
        assert.notEqual(r.data.prices['cpu-vcpu-shared'].vatNormalized, true);
    });

    it('v1 priceSource с «НДС» + requireVatPolicy → всё равно reject (нет explicit policy)', () => {
        const json = makeValidV1({
            'cpu-vcpu-shared': {
                pricePerUnit: 122,
                vendor: 'X',
                priceSource: 'С НДС 22%'
            }
        });
        const r = svc.validateProviderPriceJson(
            json, 'sbercloud', { requireVatPolicy: true });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'vat-policy-required');
    });
});

describe('D.2 — v2 без vatPolicy → missing-vat-policy', () => {
    it('schemaVersion=2 + vatPolicy=null → reject', () => {
        const json = { ...makeValidV2(), vatPolicy: null };
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'missing-vat-policy');
    });

    it('schemaVersion=2 + vatPolicy отсутствует → reject', () => {
        const json = makeValidV2();
        delete json.vatPolicy;
        const r = svc.validateProviderPriceJson(json, 'sbercloud');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'missing-vat-policy');
    });
});

describe('D.3 — confidence строго в whitelist', () => {
    const valid = ['verified', 'source-level', 'assumed'];
    const invalid = ['certified', 'unknown', 'true', '', null];

    for (const c of valid) {
        it(`accept: confidence='${c}'`, () => {
            const json = makeValidV2();
            json.vatPolicy = { ...json.vatPolicy, confidence: c };
            const r = svc.validateProviderPriceJson(json, 'sbercloud');
            assert.equal(r.ok, true, `expected ok for '${c}'`);
        });
    }

    for (const c of invalid) {
        it(`reject: confidence='${String(c)}'`, () => {
            const json = makeValidV2();
            json.vatPolicy = { ...json.vatPolicy, confidence: c };
            const r = svc.validateProviderPriceJson(json, 'sbercloud');
            assert.equal(r.ok, false, `expected reject for '${String(c)}'`);
            assert.equal(r.reason, 'invalid-confidence');
        });
    }
});

/* ============================================================
 * Group F — validator API contract
 * ============================================================ */

describe('F.1 — validateProviderPriceJson signature', () => {
    it('options 3-й параметр — необязательный (backwards-compat)', () => {
        const r = svc.validateProviderPriceJson(makeValidV1(), 'sbercloud');
        assert.equal(r.ok, true);
    });

    it('options.userVatPolicy игнорируется для schemaVersion=2 (у v2 свой vatPolicy)', () => {
        /* В v2 vatPolicy задана в JSON. options.userVatPolicy — это путь для v1.
         * При v2 + userVatPolicy → userVatPolicy игнорируется (приоритет — JSON). */
        const json = makeValidV2();
        const r = svc.validateProviderPriceJson(
            json, 'sbercloud', { userVatPolicy: 'net' });
        assert.equal(r.ok, true);
        const entry = r.data.prices['cpu-vcpu-shared'];
        /* Confidence приходит от JSON vatPolicy, не от user-declared. */
        assert.equal(entry.vatPolicyConfidence, 'verified');
    });
});

describe('F.2 — normalizeProviderPriceEntry signature', () => {
    it('экспортируется отдельно (pure helper для тестирования)', () => {
        assert.equal(typeof svc.normalizeProviderPriceEntry, 'function');
    });

    it('возвращает { ok, entry } или { ok, reason, message }', () => {
        const r = svc.normalizeProviderPriceEntry(
            { pricePerUnitNet: 100, vendor: 'X', priceSource: 'y' },
            { pricesIncludeVat: false, confidence: 'verified' }
        );
        assert.equal(r.ok, true);
        assert.equal(r.entry.pricePerUnit, 100);
        assert.equal(r.entry.pricePerUnitNet, 100);
        assert.equal(r.entry.vatNormalized, true);
    });
});

describe('F.3 — нормализация идемпотентна', () => {
    it('normalize(normalize(entry)) === normalize(entry)', () => {
        const entry = {
            pricePerUnitGross: 122,
            vatRate: 0.22,
            vendor: 'X',
            priceSource: 'y'
        };
        const r1 = svc.normalizeProviderPriceEntry(
            entry,
            { pricesIncludeVat: true, vatRateIncluded: 0.22, confidence: 'verified' }
        );
        assert.equal(r1.ok, true);
        const r2 = svc.normalizeProviderPriceEntry(
            r1.entry,
            { pricesIncludeVat: true, vatRateIncluded: 0.22, confidence: 'verified' }
        );
        assert.equal(r2.ok, true);
        assert.equal(r2.entry.pricePerUnit, r1.entry.pricePerUnit);
        assert.equal(r2.entry.pricePerUnitNet, r1.entry.pricePerUnitNet);
        assert.equal(r2.entry.pricePerUnitGross, r1.entry.pricePerUnitGross);
        assert.equal(r2.entry.vatRateIncluded, r1.entry.vatRateIncluded);
        assert.equal(r2.entry.vatNormalized, true);
    });
});
