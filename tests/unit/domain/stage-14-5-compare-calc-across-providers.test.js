/**
 * Stage 14.5 (PATCH 2.7.3) — domain helper для cross-provider scenario сравнения.
 *
 * Контракт:
 *   compareCalcAcrossProviders(calc, providerIds, ctx)
 *     calc           — расчёт с зафиксированным calc.settings.provider
 *     providerIds    — массив id провайдеров для сравнения
 *     ctx.effectivePricesByProvider — { [pid]: { [itemId]: { pricePerUnit } } }
 *     ctx.providerLabels            — { [pid]: 'human label' }
 *
 *   returns: {
 *     currentProviderId,
 *     providers: Array<{
 *       id, label, totalMonthly, deltaAbs, deltaPct,
 *       perItem: Array<{ itemId, name, category, pricePerUnit,
 *                         totalMonthly, deltaAbs, deltaPct }>
 *     }>
 *   }
 *
 * Pure domain — DI через ctx, никаких обращений к store/persistence.
 *
 * Стратегия: для каждого provider'а собираем sim-calc с его effective ценами +
 * marker `__sim__@<ms>` в providerVersion (чтобы applyProviderOverlay не
 * перетёр items). Зовём calculate(simCalc), извлекаем totalMonthly per item.
 * Дельты считаем относительно current provider (calc.settings.provider).
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let compareCalcAcrossProviders;
let calculate;

before(async () => {
    installLocalStorage();
    ({ compareCalcAcrossProviders } = await import('../../../js/domain/calcImpact.js'));
    ({ calculate } = await import('../../../js/domain/calculator.js'));
});

/* Минимальный calc с парой items для unit-тестов. Реальный seed/dictionary
   не нужен — мы передаём dictionaries.items вручную. */
function makeCalc({ provider = 'sbercloud', items, answers = {} } = {}) {
    return {
        id: 'test-calc',
        name: 'Test Calc',
        schemaVersion: 12,
        settings: {
            provider,
            applyRiskFactors: false,
            vatEnabled: false,
            vatRate: 0,
            phaseDurationMonths: 12,
            planningHorizonYears: 1,
            kInflation: 0,
            kSeasonal: 0,
            bufferTask: 0,
            bufferProject: 0,
            kScheduleShift: 0,
            kContingency: 0,
            standSizeRatio: { DEV: 0, IFT: 0, PSI: 0, LOAD: 0, PROD: 1 }
        },
        view: { disabledStands: [] },
        answers,
        answersMeta: {},
        dictionaries: {
            items: items || [],
            questions: [],
            settings: {}
        },
        wizard: null,
        providerVersion: null
    };
}

describe('Stage 14.5 / compareCalcAcrossProviders — базовый API', () => {
    it('экспортируется как функция', () => {
        assert.equal(typeof compareCalcAcrossProviders, 'function');
    });

    it('null/некорректный calc → пустой результат', () => {
        const r = compareCalcAcrossProviders(null, ['sbercloud'], {});
        assert.equal(r.providers.length, 0);
        assert.equal(r.currentProviderId, null);
    });

    it('пустой providerIds → providers=[]', () => {
        const calc = makeCalc({ items: [] });
        const r = compareCalcAcrossProviders(calc, [], { effectivePricesByProvider: {} });
        assert.equal(r.providers.length, 0);
        assert.equal(r.currentProviderId, 'sbercloud');
    });

    it('non-array providerIds → providers=[]', () => {
        const calc = makeCalc({ items: [] });
        const r = compareCalcAcrossProviders(calc, null, { effectivePricesByProvider: {} });
        assert.equal(r.providers.length, 0);
    });
});

describe('Stage 14.5 / compareCalcAcrossProviders — расчёт total per provider', () => {
    /* ЭК: 1 vCPU на ПРОМ, формула qty=10. Цена 100₽ у sbercloud, 200₽ у yandex.
       Без рисков и НДС: total = 10 * price. */
    const items = [{
        id: 'cpu-vcpu-shared',
        name: 'vCPU shared',
        category: 'HW',
        applicableStands: ['PROD'],
        qtyFormulas: { PROD: '10' },
        billingInterval: 'monthly',
        pricePerUnit: 100,
        unit: 'мес'
    }];
    const calc = makeCalc({ provider: 'sbercloud', items });
    const ctx = {
        effectivePricesByProvider: {
            sbercloud: { 'cpu-vcpu-shared': { pricePerUnit: 100 } },
            yandex:    { 'cpu-vcpu-shared': { pricePerUnit: 200 } }
        },
        providerLabels: {
            sbercloud: 'SberCloud',
            yandex:    'Yandex'
        }
    };

    it('возвращает 2 провайдера для providerIds=[sbercloud, yandex]', () => {
        const r = compareCalcAcrossProviders(calc, ['sbercloud', 'yandex'], ctx);
        assert.equal(r.providers.length, 2);
        assert.equal(r.providers[0].id, 'sbercloud');
        assert.equal(r.providers[1].id, 'yandex');
    });

    it('каждый провайдер имеет id/label/totalMonthly/deltaAbs/deltaPct/perItem', () => {
        const r = compareCalcAcrossProviders(calc, ['sbercloud', 'yandex'], ctx);
        for (const p of r.providers) {
            assert.equal(typeof p.id, 'string');
            assert.equal(typeof p.label, 'string');
            assert.ok(Number.isFinite(p.totalMonthly));
            assert.ok(Number.isFinite(p.deltaAbs));
            assert.ok(Number.isFinite(p.deltaPct));
            assert.ok(Array.isArray(p.perItem));
        }
    });

    it('current provider имеет deltaAbs=0 и deltaPct=0', () => {
        const r = compareCalcAcrossProviders(calc, ['sbercloud', 'yandex'], ctx);
        const sber = r.providers.find(p => p.id === 'sbercloud');
        assert.equal(sber.deltaAbs, 0);
        assert.equal(sber.deltaPct, 0);
    });

    it('alt-provider с большей ценой → положительная deltaAbs', () => {
        const r = compareCalcAcrossProviders(calc, ['sbercloud', 'yandex'], ctx);
        const ya = r.providers.find(p => p.id === 'yandex');
        /* yandex price = 200 vs sbercloud 100, qty=10 → delta = 1000 */
        assert.ok(ya.deltaAbs > 0, `yandex должен быть дороже: deltaAbs=${ya.deltaAbs}`);
        assert.ok(ya.deltaPct > 0);
    });

    it('label берётся из providerLabels, fallback к id', () => {
        const r = compareCalcAcrossProviders(calc, ['sbercloud', 'yandex'], ctx);
        assert.equal(r.providers.find(p => p.id === 'sbercloud').label, 'SberCloud');
        assert.equal(r.providers.find(p => p.id === 'yandex').label, 'Yandex');
    });
});

describe('Stage 14.5 / compareCalcAcrossProviders — perItem breakdown', () => {
    const items = [
        { id: 'cpu-vcpu-shared', name: 'vCPU', category: 'HW',
          applicableStands: ['PROD'], qtyFormulas: { PROD: '10' },
          billingInterval: 'monthly', pricePerUnit: 100, unit: 'мес' },
        { id: 'ram-gb', name: 'RAM', category: 'HW',
          applicableStands: ['PROD'], qtyFormulas: { PROD: '20' },
          billingInterval: 'monthly', pricePerUnit: 50, unit: 'ГБ/мес' }
    ];
    const calc = makeCalc({ provider: 'sbercloud', items });
    const ctx = {
        effectivePricesByProvider: {
            sbercloud: { 'cpu-vcpu-shared': { pricePerUnit: 100 },
                         'ram-gb':            { pricePerUnit: 50 } },
            yandex:    { 'cpu-vcpu-shared': { pricePerUnit: 200 },
                         'ram-gb':            { pricePerUnit: 50 } } /* RAM same */
        }
    };

    it('perItem длиной как items', () => {
        const r = compareCalcAcrossProviders(calc, ['sbercloud', 'yandex'], ctx);
        assert.equal(r.providers[0].perItem.length, 2);
        assert.equal(r.providers[1].perItem.length, 2);
    });

    it('каждый perItem имеет itemId/name/pricePerUnit/totalMonthly/deltaAbs/deltaPct', () => {
        const r = compareCalcAcrossProviders(calc, ['sbercloud', 'yandex'], ctx);
        const cpuItem = r.providers[0].perItem.find(i => i.itemId === 'cpu-vcpu-shared');
        assert.equal(cpuItem.itemId, 'cpu-vcpu-shared');
        assert.equal(cpuItem.name, 'vCPU');
        assert.ok(Number.isFinite(cpuItem.pricePerUnit));
        assert.ok(Number.isFinite(cpuItem.totalMonthly));
        assert.ok(Number.isFinite(cpuItem.deltaAbs));
        assert.ok(Number.isFinite(cpuItem.deltaPct));
    });

    it('item-level pricePerUnit берётся из effectivePricesByProvider', () => {
        const r = compareCalcAcrossProviders(calc, ['sbercloud', 'yandex'], ctx);
        const yaCpu = r.providers.find(p => p.id === 'yandex')
            .perItem.find(i => i.itemId === 'cpu-vcpu-shared');
        assert.equal(yaCpu.pricePerUnit, 200);
    });

    it('item с одинаковой ценой между провайдерами → deltaAbs=0', () => {
        const r = compareCalcAcrossProviders(calc, ['sbercloud', 'yandex'], ctx);
        const yaRam = r.providers.find(p => p.id === 'yandex')
            .perItem.find(i => i.itemId === 'ram-gb');
        assert.equal(yaRam.deltaAbs, 0);
        assert.equal(yaRam.deltaPct, 0);
    });
});

describe('Stage 14.5 / compareCalcAcrossProviders — graceful skip', () => {
    it('provider без effective-цен → totalMonthly = base (cены items как есть)', () => {
        const items = [{ id: 'cpu-vcpu-shared', name: 'vCPU', category: 'HW',
            applicableStands: ['PROD'], qtyFormulas: { PROD: '5' },
            billingInterval: 'monthly', pricePerUnit: 100, unit: 'мес' }];
        const calc = makeCalc({ provider: 'sbercloud', items });
        const ctx = {
            effectivePricesByProvider: {
                sbercloud: { 'cpu-vcpu-shared': { pricePerUnit: 100 } }
                /* yandex отсутствует */
            }
        };
        const r = compareCalcAcrossProviders(calc, ['sbercloud', 'yandex'], ctx);
        const ya = r.providers.find(p => p.id === 'yandex');
        /* Без overlay'а используются цены из items как есть → одинаковый total. */
        assert.equal(ya.deltaAbs, 0);
    });

    it('item без цены у alt-provider → effective остаётся base, deltaAbs=0', () => {
        const items = [{ id: 'cpu-vcpu-shared', name: 'vCPU', category: 'HW',
            applicableStands: ['PROD'], qtyFormulas: { PROD: '5' },
            billingInterval: 'monthly', pricePerUnit: 100, unit: 'мес' }];
        const calc = makeCalc({ provider: 'sbercloud', items });
        const ctx = {
            effectivePricesByProvider: {
                sbercloud: { 'cpu-vcpu-shared': { pricePerUnit: 100 } },
                yandex:    {} /* пусто */
            }
        };
        const r = compareCalcAcrossProviders(calc, ['sbercloud', 'yandex'], ctx);
        const ya = r.providers.find(p => p.id === 'yandex');
        assert.equal(ya.providers?.length || ya.deltaAbs, 0);
    });
});
