import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    calculate,
    billingIntervalToMonthlyMultiplier,
    riskFactor,
    clearCalculationCache
} from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import {
    DEFAULT_PHASE_DURATION_MONTHS,
    DEFAULT_DAYS_PER_MONTH,
    DEFAULT_STAND_SIZE_RATIO
} from '../../../js/utils/constants.js';

const makeCalc = (overrides = {}) => {
    const dict = buildSeedDictionaries();
    return {
        version: '1.0', id: 't', name: 'T', schemaVersion: 2,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        settings: { ...SEED_SETTINGS, phaseDurationMonths: 4 },
        answers: defaultAnswersFrom(dict.questions),
        dictionaries: dict,
        ...overrides
    };
};

/**
 * Минимальный «нейтральный» расчёт: один ЭК на PROD, все коэффициенты обнулены.
 * Удобно для проверки одной грани логики, не отвлекаясь на seed-формулы.
 */
const makeNeutralCalc = (item, settingOverrides = {}) => ({
    version: '1.0', id: 'neutral', name: 'N', schemaVersion: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    settings: {
        period: 'monthly',
        bufferTask: 0, bufferProject: 0,
        kInflation: 0, kSeasonal: 0, kScheduleShift: 0, kContingency: 0,
        vatEnabled: false, vatRate: 0,
        planningHorizonYears: 1,
        daysPerMonth: DEFAULT_DAYS_PER_MONTH,
        phaseDurationMonths: DEFAULT_PHASE_DURATION_MONTHS,
        standSizeRatio: { ...DEFAULT_STAND_SIZE_RATIO, PROD: 1.0 },
        ...settingOverrides
    },
    answers: {},
    dictionaries: { items: [item], questions: [] }
});

describe('billingIntervalToMonthlyMultiplier', () => {
    it('monthly = 1', () => {
        assert.equal(billingIntervalToMonthlyMultiplier('monthly', 30, 12), 1);
    });
    it('annual = 1/12', () => {
        assert.equal(billingIntervalToMonthlyMultiplier('annual', 30, 12), 1 / 12);
    });
    it('daily = daysPerMonth', () => {
        assert.equal(billingIntervalToMonthlyMultiplier('daily', 30, 12), 30);
        assert.equal(billingIntervalToMonthlyMultiplier('daily', 31, 12), 31);
    });
    it('daily fallbacks for invalid daysPerMonth', () => {
        assert.equal(billingIntervalToMonthlyMultiplier('daily', 0, 12), DEFAULT_DAYS_PER_MONTH);
        assert.equal(billingIntervalToMonthlyMultiplier('daily', -3, 12), DEFAULT_DAYS_PER_MONTH);
        assert.equal(billingIntervalToMonthlyMultiplier('daily', NaN, 12), DEFAULT_DAYS_PER_MONTH);
    });
    it('oneTime divides by phaseDurationMonths', () => {
        assert.equal(billingIntervalToMonthlyMultiplier('oneTime', 30, 4), 1 / 4);
        assert.equal(billingIntervalToMonthlyMultiplier('oneTime', 30, 12), 1 / 12);
    });
    it('oneTime fallbacks for invalid duration', () => {
        assert.equal(billingIntervalToMonthlyMultiplier('oneTime', 30, 0), 1 / DEFAULT_PHASE_DURATION_MONTHS);
        assert.equal(billingIntervalToMonthlyMultiplier('oneTime', 30, -5), 1 / DEFAULT_PHASE_DURATION_MONTHS);
        assert.equal(billingIntervalToMonthlyMultiplier('oneTime', 30, NaN), 1 / DEFAULT_PHASE_DURATION_MONTHS);
    });
    it('unknown interval = 1', () => {
        assert.equal(billingIntervalToMonthlyMultiplier('unknown', 30, 12), 1);
    });
});

describe('calculate: basic invariants on seed', () => {
    it('возвращает финитный неотрицательный итог при дефолтных ответах', () => {
        // ВАЖНО: в текущем seed все pricePerUnit = 0 (каталог-placeholder), поэтому
        // итог при любых ответах = 0. Тест проверяет лишь что расчёт не падает
        // и не даёт NaN/Infinity. Стоимостная часть проверяется отдельно через
        // makeNeutralCalc с явно заданным pricePerUnit.
        clearCalculationCache();
        const r = calculate(makeCalc());
        assert.ok(Number.isFinite(r.totalMonthly), 'totalMonthly должен быть финитным');
        assert.ok(r.totalMonthly >= 0, 'итог не может быть отрицательным');
    });
    it('totalMonthly равен сумме по стендам', () => {
        const r = calculate(makeCalc());
        const sum = ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']
            .reduce((acc, sid) => acc + r.stands[sid].totalMonthly, 0);
        assert.ok(Math.abs(sum - r.totalMonthly) < 0.01);
    });
    it('totalAnnual = totalMonthly * 12', () => {
        const r = calculate(makeCalc());
        assert.ok(Math.abs(r.totalAnnual - r.totalMonthly * 12) < 0.01);
    });
    it('byCategory totals складываются в общий итог', () => {
        const r = calculate(makeCalc());
        const sum = Object.values(r.byCategory).reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(sum - r.totalMonthly) < 0.01);
    });

    it('Q.* со значением null/undefined использует defaultIfUnknown, а явный 0 сохраняется', () => {
        const item = {
            id: 'fallback-item', name: 'Fallback item', unit: 'шт.', pricePerUnit: 1,
            category: 'HW', resourceClass: 'RAM', billingInterval: 'monthly',
            applicableStands: ['PROD'],
            qtyFormulas: { PROD: 'Q.ram_ratio + Q.cache_gb + Q.explicit_zero' }
        };
        const calc = makeNeutralCalc(item);
        calc.answers = {
            ram_ratio: null,
            cache_gb: undefined,
            explicit_zero: 0
        };
        calc.dictionaries.questions = [
            { id: 'ram_ratio', type: 'number', defaultIfUnknown: 4 },
            { id: 'cache_gb', type: 'number', defaultIfUnknown: 8 },
            { id: 'explicit_zero', type: 'number', defaultIfUnknown: 10 }
        ];
        const r = calculate(calc);
        assert.equal(r.items['fallback-item'].stands.PROD.qty, 12,
            'null/undefined должны взять defaultIfUnknown: 4 + 8, явный 0 не заменяется на 10');
    });
});

describe('calculate: revision cache', () => {
    it('кэширует по id+revision', () => {
        clearCalculationCache();
        const calc = makeCalc();
        const r1 = calculate(calc, 1);
        const r2 = calculate(calc, 1);
        assert.equal(r1, r2, 'один и тот же revision → тот же объект');
    });
    it('разный revision — пересчёт', () => {
        clearCalculationCache();
        const calc = makeCalc();
        const r1 = calculate(calc, 1);
        const r2 = calculate(calc, 2);
        assert.notEqual(r1, r2);
        assert.equal(r1.totalMonthly, r2.totalMonthly);
    });
    it('без revision — кэш отключён', () => {
        clearCalculationCache();
        const calc = makeCalc();
        const r1 = calculate(calc);
        const r2 = calculate(calc);
        assert.notEqual(r1, r2);
    });
});

describe('calculate: applicableStands', () => {
    it('пропускает qty для не применимого стенда', () => {
        const item = {
            id: 'x', name: 'X', unit: 'шт', pricePerUnit: 100,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            vendor: '', description: '',
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: '5', IFT: '5', PSI: '5', PROD: '5', LOAD: '5' }
        };
        const r = calculate(makeNeutralCalc(item));
        assert.equal(r.items.x.stands.DEV.qty, 0);
        assert.equal(r.items.x.stands.PROD.qty, 5);
    });
});

describe('calculate: errors in formula', () => {
    it('фиксирует parse error', () => {
        const item = {
            id: 'bad', name: 'Bad', unit: 'шт', pricePerUnit: 100,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            vendor: '', description: '',
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1 + +', LOAD: '' }
        };
        const r = calculate(makeNeutralCalc(item));
        assert.equal(r.items.bad.stands.PROD.qty, 0);
        assert.ok(r.items.bad.stands.PROD.error, 'должно быть сообщение об ошибке');
    });
    it('фиксирует Infinity как «Числовое переполнение»', () => {
        clearCalculationCache();
        const item = {
            id: 'inf', name: 'I', unit: 'шт', pricePerUnit: 100,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            vendor: '', description: '',
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1e308 * 10', LOAD: '' }
        };
        const r = calculate(makeNeutralCalc(item));
        assert.equal(r.items.inf.stands.PROD.qty, 0);
        assert.equal(r.items.inf.stands.PROD.costBase, 0);
        assert.equal(r.items.inf.stands.PROD.costFinal, 0);
        assert.equal(r.items.inf.stands.PROD.error, 'Числовое переполнение');
    });
});

describe('calculate: overflow → cell.error', () => {
    it('переполнение в qty: «Числовое переполнение», qty/cost = 0', () => {
        clearCalculationCache();
        const item = {
            id: 'big', name: 'Big', unit: 'шт', pricePerUnit: 100,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            vendor: '', description: '',
            applicableStands: ['PROD'],
            // 1e308 + 1e308 = Infinity
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1e308 + 1e308', LOAD: '' }
        };
        const r = calculate(makeNeutralCalc(item));
        const cell = r.items.big.stands.PROD;
        assert.equal(cell.error, 'Числовое переполнение');
        assert.equal(cell.qty, 0);
        assert.equal(cell.costBase, 0);
        assert.equal(cell.costFinal, 0);
        // riskBreakdown остаётся реальным (CLAUDE.md: ВСЕГДА содержит реальные коэффициенты)
        assert.ok(cell.riskBreakdown, 'riskBreakdown должен сохраниться');
        assert.ok(Number.isFinite(cell.riskBreakdown.total), 'breakdown.total финитен');
    });

    it('переполнение в costBase: qty финитный, но qty × price → Infinity', () => {
        clearCalculationCache();
        const item = {
            id: 'big2', name: 'B2', unit: 'шт', pricePerUnit: 1e200,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            vendor: '', description: '',
            applicableStands: ['PROD'],
            // qty = 1e200 (финитное), price = 1e200 → costBase = Infinity
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1e200', LOAD: '' }
        };
        const r = calculate(makeNeutralCalc(item));
        const cell = r.items.big2.stands.PROD;
        assert.equal(cell.error, 'Числовое переполнение');
        assert.equal(cell.qty, 0);
        assert.equal(cell.costBase, 0);
        assert.equal(cell.costFinal, 0);
    });

    it('агрегаты не становятся NaN/Infinity при переполнении одной ячейки', () => {
        clearCalculationCache();
        const goodItem = {
            id: 'good', name: 'Good', unit: 'шт', pricePerUnit: 100,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            vendor: '', description: '',
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '5', LOAD: '' }
        };
        const badItem = {
            id: 'bad', name: 'Bad', unit: 'шт', pricePerUnit: 100,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            vendor: '', description: '',
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1e308 * 10', LOAD: '' }
        };
        const calc = makeNeutralCalc(goodItem);
        calc.dictionaries.items = [goodItem, badItem];
        const r = calculate(calc);

        // Сбойная ячейка вносит 0; нормальная даёт 5 × 100 = 500.
        assert.ok(Number.isFinite(r.totalMonthly), 'totalMonthly должен быть финитным');
        assert.ok(Number.isFinite(r.totalAnnual),  'totalAnnual должен быть финитным');
        assert.equal(r.totalMonthly, 500);

        // Агрегаты по категориям / по типу расхода — тоже финитны.
        for (const v of Object.values(r.byCategory))        assert.ok(Number.isFinite(v));
        for (const v of Object.values(r.byResourceClass))   assert.ok(Number.isFinite(v));
        for (const v of Object.values(r.byBillingInterval)) assert.ok(Number.isFinite(v));
        for (const v of Object.values(r.byCostType))        assert.ok(Number.isFinite(v));

        // Сбойная ячейка отмечена ошибкой, нормальная — нет.
        assert.equal(r.items.bad.stands.PROD.error, 'Числовое переполнение');
        assert.equal(r.items.good.stands.PROD.error, null);
        assert.equal(r.items.good.stands.PROD.costFinal, 500);
    });
});

describe('calculate: bufferFactor (нейтральные коэффициенты)', () => {
    it('без буферов и риск-коэффициентов: costFinal = qty × price', () => {
        const item = {
            id: 'x', name: 'X', unit: 'шт', pricePerUnit: 100,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            vendor: '', description: '',
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '10', LOAD: '' }
        };
        const r = calculate(makeNeutralCalc(item));
        assert.equal(r.items.x.stands.PROD.costFinal, 10 * 100);
    });
    it('буферы перемножаются: bufferTask × bufferProject', () => {
        const item = {
            id: 'x', name: 'X', unit: 'шт', pricePerUnit: 100,
            category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
            vendor: '', description: '',
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '10', LOAD: '' }
        };
        const r = calculate(makeNeutralCalc(item, { bufferTask: 0.3, bufferProject: 0.15 }));
        const expected = 10 * 100 * 1.30 * 1.15;
        assert.ok(Math.abs(r.items.x.stands.PROD.costFinal - expected) < 0.001);
    });
});

describe('calculate: риск-коэффициенты', () => {
    const baseItem = {
        id: 'x', name: 'X', unit: 'шт', pricePerUnit: 100,
        category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
        vendor: '', description: '',
        applicableStands: ['PROD'],
        qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '10', LOAD: '' }
    };

    it('kInflation возводится в степень planningHorizonYears', () => {
        // CPU не подпадает под seasonal; PROD не LOAD; billingInterval не oneTime —
        // значит ни seasonalMul, ни scheduleMul не применяются.
        const r = calculate(makeNeutralCalc(baseItem, {
            kInflation: 0.10, planningHorizonYears: 3
        }));
        const expected = 10 * 100 * Math.pow(1.10, 3);
        assert.ok(Math.abs(r.items.x.stands.PROD.costFinal - expected) < 0.001,
            `ожидалось ${expected}, получено ${r.items.x.stands.PROD.costFinal}`);
    });

    it('VAT множит на (1 + vatRate) когда vatEnabled', () => {
        const r1 = calculate(makeNeutralCalc(baseItem, { vatEnabled: true, vatRate: 0.20 }));
        const r2 = calculate(makeNeutralCalc(baseItem, { vatEnabled: false, vatRate: 0.20 }));
        assert.ok(Math.abs(r1.items.x.stands.PROD.costFinal - 1200) < 0.001);
        assert.ok(Math.abs(r2.items.x.stands.PROD.costFinal - 1000) < 0.001);
    });

    it('kContingency применяется ко всем ЭК', () => {
        const r = calculate(makeNeutralCalc(baseItem, { kContingency: 0.05 }));
        assert.ok(Math.abs(r.items.x.stands.PROD.costFinal - 1050) < 0.001);
    });

    it('kSeasonal применяется только к NETWORK/TRAFFIC/SERVICE/AI_LLM', () => {
        const cpuItem = { ...baseItem, id: 'cpu', resourceClass: 'CPU' };
        const trafItem = { ...baseItem, id: 'traf', resourceClass: 'TRAFFIC' };
        const r1 = calculate(makeNeutralCalc(cpuItem, { kSeasonal: 0.20 }));
        const r2 = calculate(makeNeutralCalc(trafItem, { kSeasonal: 0.20 }));
        assert.ok(Math.abs(r1.items.cpu.stands.PROD.costFinal - 1000) < 0.001,
            'CPU не должен подпадать под kSeasonal');
        assert.ok(Math.abs(r2.items.traf.stands.PROD.costFinal - 1200) < 0.001,
            'TRAFFIC должен умножаться на (1+kSeasonal)');
    });

    it('kScheduleShift применяется ТОЛЬКО к oneTime (13.U10: убран с LOAD)', () => {
        // PROD + monthly + CPU → не применяется
        const r1 = calculate(makeNeutralCalc(baseItem, { kScheduleShift: 0.30 }));
        assert.ok(Math.abs(r1.items.x.stands.PROD.costFinal - 1000) < 0.001);

        // oneTime + PROD → применяется (буфер на сдвиг релиза для разовых платежей)
        const oneItem = { ...baseItem, id: 'one', billingInterval: 'oneTime' };
        const r2 = calculate(makeNeutralCalc(oneItem, {
            kScheduleShift: 0.30, phaseDurationMonths: 12
        }));
        const expected = 10 * 100 / 12 * 1.30;
        assert.ok(Math.abs(r2.items.one.stands.PROD.costFinal - expected) < 0.001);

        // LOAD + monthly → НЕ применяется (13.U10: иначе LOAD по мощностям > PROD).
        // Раньше formula × 1.30 давала 1300 на LOAD при 1000 на PROD — нагрузочный
        // стенд требовал больше инфраструктуры чем сам прод, что бессмысленно.
        const loadItem = { ...baseItem, id: 'load',
            applicableStands: ['LOAD'],
            qtyFormulas: { DEV:'', IFT:'', PSI:'', PROD:'', LOAD: '10' }
        };
        const r3 = calculate(makeNeutralCalc(loadItem, { kScheduleShift: 0.30 }));
        // costBase = 10 * 100 = 1000, БЕЗ × 1.30. Инвариант LOAD ≤ PROD сохранён.
        assert.ok(Math.abs(r3.items.load.stands.LOAD.costFinal - 1000) < 0.001,
            `LOAD costFinal должен быть 1000 (без scheduleShift), получено ${r3.items.load.stands.LOAD.costFinal}`);
    });
});

describe('calculate: oneTime billingInterval', () => {
    it('амортизируется по phaseDurationMonths', () => {
        const item = {
            id: 'audit', name: 'Audit', unit: 'аудит', pricePerUnit: 600000,
            category: 'SERVICES', billingInterval: 'oneTime', resourceClass: 'ONE_TIME',
            vendor: '', description: '',
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1', LOAD: '' }
        };
        const r = calculate(makeNeutralCalc(item, { phaseDurationMonths: 6 }));
        // 600k / 6 мес = 100k/мес; коэффициенты нейтральны.
        assert.equal(r.items.audit.stands.PROD.costFinal, 100000);
    });
});

describe('calculate: daily billingInterval', () => {
    it('умножается на daysPerMonth для перевода в месячную стоимость', () => {
        const item = {
            id: 'd', name: 'D', unit: 'день', pricePerUnit: 1000,
            category: 'SERVICES', billingInterval: 'daily', resourceClass: 'SERVICE',
            vendor: '', description: '',
            applicableStands: ['PROD'],
            qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1', LOAD: '' }
        };
        const r = calculate(makeNeutralCalc(item, { daysPerMonth: 30 }));
        // 1 ед. × 1000₽/день × 30 дней/мес = 30000₽/мес.
        assert.equal(r.items.d.stands.PROD.costFinal, 30000);
    });
});

describe('calculate: byCostType (CAPEX / OPEX)', () => {
    const monthlyItem = {
        id: 'm', name: 'M', unit: 'шт', pricePerUnit: 100,
        category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
        vendor: '', description: '',
        applicableStands: ['PROD'],
        qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '10', LOAD: '' }
    };
    const oneTimeItem = {
        id: 'o', name: 'O', unit: 'шт', pricePerUnit: 1200,
        category: 'SERVICES', billingInterval: 'oneTime', resourceClass: 'ONE_TIME',
        vendor: '', description: '',
        applicableStands: ['PROD'],
        qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1', LOAD: '' }
    };

    it('result.byCostType.capex + .opex == result.totalMonthly', () => {
        const calc = makeNeutralCalc(monthlyItem);
        calc.dictionaries.items = [monthlyItem, oneTimeItem];
        const r = calculate(calc);
        const sum = (r.byCostType.capex || 0) + (r.byCostType.opex || 0);
        assert.ok(Math.abs(sum - r.totalMonthly) < 1e-9,
            `byCostType sum (${sum}) != totalMonthly (${r.totalMonthly})`);
    });

    it('oneTime ЭК → попадает в capex', () => {
        const calc = makeNeutralCalc(oneTimeItem, { phaseDurationMonths: 12 });
        const r = calculate(calc);
        assert.ok(r.byCostType.capex > 0, 'capex должен быть > 0');
        assert.equal(r.byCostType.opex, 0, 'opex должен быть 0');
    });

    it('monthly ЭК → попадает в opex', () => {
        const calc = makeNeutralCalc(monthlyItem);
        const r = calculate(calc);
        assert.ok(r.byCostType.opex > 0, 'opex должен быть > 0');
        assert.equal(r.byCostType.capex, 0, 'capex должен быть 0');
    });

    it('item.costType="capex" переопределяет автоматику для monthly', () => {
        const explicit = { ...monthlyItem, costType: 'capex' };
        const calc = makeNeutralCalc(explicit);
        const r = calculate(calc);
        assert.ok(r.byCostType.capex > 0);
        assert.equal(r.byCostType.opex, 0);
        assert.equal(r.items.m.costType, 'capex');
    });

    it('item.costType="opex" переопределяет автоматику для oneTime', () => {
        const explicit = { ...oneTimeItem, costType: 'opex' };
        const calc = makeNeutralCalc(explicit, { phaseDurationMonths: 12 });
        const r = calculate(calc);
        assert.ok(r.byCostType.opex > 0);
        assert.equal(r.byCostType.capex, 0);
        assert.equal(r.items.o.costType, 'opex');
    });

    it('сумма byCostType по стендам == result.byCostType', () => {
        const calc = makeNeutralCalc(monthlyItem);
        calc.dictionaries.items = [monthlyItem, oneTimeItem];
        const r = calculate(calc);
        const stands = ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD'];
        for (const ct of ['capex', 'opex']) {
            const sum = stands.reduce((acc, sid) => acc + (r.stands[sid].byCostType[ct] || 0), 0);
            assert.ok(Math.abs(sum - r.byCostType[ct]) < 1e-9,
                `byCostType[${ct}]: sum(stands)=${sum} != total=${r.byCostType[ct]}`);
        }
    });

    it('result.items[id].costType — отражает getCostType', () => {
        const calc = makeNeutralCalc(monthlyItem);
        calc.dictionaries.items = [monthlyItem, oneTimeItem];
        const r = calculate(calc);
        assert.equal(r.items.m.costType, 'opex');
        assert.equal(r.items.o.costType, 'capex');
    });
});

describe('riskFactor: декомпозиция', () => {
    it('возвращает все компоненты + total (12.U20: total БЕЗ vatMul)', () => {
        const item = {
            id: 'i', resourceClass: 'CPU', billingInterval: 'monthly'
        };
        const settings = {
            bufferTask: 0.3, bufferProject: 0.15,
            kInflation: 0.10, kSeasonal: 0.0,
            kScheduleShift: 0.15, kContingency: 0.05,
            vatEnabled: true, vatRate: 0.20,
            planningHorizonYears: 1
        };
        const f = riskFactor(item, 'PROD', settings);
        assert.equal(f.bufferFactor, 1.30 * 1.15);
        assert.equal(f.inflationMul,  1.10);
        assert.equal(f.seasonalMul,   1);              // CPU не сезонный
        assert.equal(f.scheduleMul,   1);              // PROD + monthly
        assert.equal(f.contingencyMul, 1.05);
        assert.equal(f.vatMul,        1.20);
        // 12.U20: total — ТОЛЬКО риски (без НДС). НДС применяется отдельно в calculate().
        const expected = 1.30 * 1.15 * 1.10 * 1 * 1 * 1.05;
        assert.ok(Math.abs(f.total - expected) < 1e-9,
            `total должен быть ${expected} (без vatMul), получено ${f.total}`);
    });
});

describe('calculate: VAT независим от applyRiskFactors (12.U20)', () => {
    const baseItem = {
        id: 'x', name: 'X', unit: 'шт', pricePerUnit: 100,
        category: 'HW', billingInterval: 'monthly', resourceClass: 'CPU',
        vendor: '', description: '',
        applicableStands: ['PROD'],
        qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '10', LOAD: '' }
    };

    it('VAT применяется при applyRiskFactors=false (НДС — не риск)', () => {
        // Риски выкл, VAT вкл → costFinal = costBase × vatMul.
        const r = calculate(makeNeutralCalc(baseItem, {
            applyRiskFactors: false,
            vatEnabled: true, vatRate: 0.20,
            // Реальные риски, чтобы убедиться, что они НЕ попали в final.
            bufferTask: 0.30, kInflation: 0.10, kContingency: 0.05
        }));
        const expected = 10 * 100 * 1.20; // = 1200, без буферов/инфляции/резерва
        assert.ok(Math.abs(r.items.x.stands.PROD.costFinal - expected) < 0.001,
            `applyRisks=false + VAT=on: ожидалось ${expected}, получено ${r.items.x.stands.PROD.costFinal}`);
    });

    it('Риски без VAT — costFinal = costBase × riskTotal (без vatMul)', () => {
        const r = calculate(makeNeutralCalc(baseItem, {
            applyRiskFactors: true,
            vatEnabled: false, vatRate: 0.20, // ставка задана, но toggle off — VAT не применяется
            bufferTask: 0.10
        }));
        const expected = 10 * 100 * 1.10; // = 1100
        assert.ok(Math.abs(r.items.x.stands.PROD.costFinal - expected) < 0.001);
    });

    it('Риски + VAT — обе оси перемножаются', () => {
        const r = calculate(makeNeutralCalc(baseItem, {
            applyRiskFactors: true,
            vatEnabled: true, vatRate: 0.20,
            bufferTask: 0.10
        }));
        const expected = 10 * 100 * 1.10 * 1.20; // = 1320
        assert.ok(Math.abs(r.items.x.stands.PROD.costFinal - expected) < 0.001);
    });

    it('Без рисков и без VAT — costFinal = costBase', () => {
        const r = calculate(makeNeutralCalc(baseItem, {
            applyRiskFactors: false,
            vatEnabled: false,
            bufferTask: 0.30, kInflation: 0.20
        }));
        assert.ok(Math.abs(r.items.x.stands.PROD.costFinal - 1000) < 0.001);
    });

    it('riskBreakdown.total НЕ содержит vatMul (12.U20)', () => {
        const r = calculate(makeNeutralCalc(baseItem, {
            applyRiskFactors: true,
            vatEnabled: true, vatRate: 0.20,
            bufferTask: 0.10
        }));
        const cell = r.items.x.stands.PROD;
        // breakdown.total = bufferFactor только (всё остальное нейтрально)
        assert.ok(Math.abs(cell.riskBreakdown.total - 1.10) < 1e-9,
            `breakdown.total должен быть 1.10 (без VAT), получено ${cell.riskBreakdown.total}`);
        // breakdown.vatMul отдельно
        assert.equal(cell.riskBreakdown.vatMul, 1.20);
        // costFinal = costBase × total × vatMul = 1000 × 1.10 × 1.20
        assert.ok(Math.abs(cell.costFinal - 1320) < 0.001);
    });
});

describe('calculate: per-resource standSizeRatio override (12.U12)', () => {
    /* Item с dashboardResource. Формула умножает qty на S.standSizeRatio.<STAND>.
       Per-resource override должен подменить значение на settings.resourceRatio[stand][resource]. */
    const cpuItem = {
        id: 'test-cpu', name: 'Test CPU', unit: 'шт.',
        pricePerUnit: 100, billingInterval: 'monthly',
        category: 'HW', resourceClass: 'CPU',
        dashboardResource: 'CPU',
        applicableStands: ['DEV', 'IFT', 'PROD'],
        qtyFormulas: {
            DEV: '10 * S.standSizeRatio.DEV',
            IFT: '10 * S.standSizeRatio.IFT',
            PROD: '10 * S.standSizeRatio.PROD'
        }
    };
    const ramItem = { ...cpuItem, id: 'test-ram', name: 'Test RAM', dashboardResource: 'RAM',
        qtyFormulas: {
            DEV: '20 * S.standSizeRatio.DEV',
            IFT: '20 * S.standSizeRatio.IFT',
            PROD: '20 * S.standSizeRatio.PROD'
        }
    };
    /* Item БЕЗ dashboardResource — должен пользоваться общим standSizeRatio. */
    const serviceItem = { ...cpuItem, id: 'test-svc', name: 'Test Service',
        category: 'SERVICES', resourceClass: 'SERVICE', dashboardResource: undefined };

    const baseCalc = (resourceRatio) => ({
        version: '1.0', id: 'rrtest', name: 'RR', schemaVersion: 3,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        settings: {
            period: 'monthly',
            bufferTask: 0, bufferProject: 0, kInflation: 0, kSeasonal: 0,
            kScheduleShift: 0, kContingency: 0, vatEnabled: false, vatRate: 0,
            planningHorizonYears: 1, daysPerMonth: 30, phaseDurationMonths: 12,
            standSizeRatio: { DEV: 0.50, IFT: 0.50, PSI: 0.50, LOAD: 0.50, PROD: 1.0 },
            resourceRatio
        },
        answers: {},
        dictionaries: { items: [cpuItem, ramItem, serviceItem], questions: [] }
    });

    it('item с dashboardResource получает per-resource ratio в S.standSizeRatio', () => {
        const calc = baseCalc({
            DEV:  { CPU: 0.10, GPU: 0.10, RAM: 0.40, SSD: 0.10, HDD: 0.10, S3: 0.10 },
            IFT:  { CPU: 0.20, GPU: 0.20, RAM: 0.50, SSD: 0.20, HDD: 0.20, S3: 0.20 },
            PSI:  { CPU: 0.50, GPU: 0.50, RAM: 0.50, SSD: 0.50, HDD: 0.50, S3: 0.50 },
            LOAD: { CPU: 0.50, GPU: 0.50, RAM: 0.50, SSD: 0.50, HDD: 0.50, S3: 0.50 },
            PROD: { CPU: 1.00, GPU: 1.00, RAM: 1.00, SSD: 1.00, HDD: 1.00, S3: 1.00 }
        });
        const r = calculate(calc);
        // CPU: 10 * 0.10 (DEV/CPU) = 1
        assert.equal(r.items['test-cpu'].stands.DEV.qty, 1, 'DEV/CPU = 10 * 0.10');
        // RAM: 20 * 0.40 (DEV/RAM) = 8 — НЕЗАВИСИМО от CPU ratio
        assert.equal(r.items['test-ram'].stands.DEV.qty, 8, 'DEV/RAM = 20 * 0.40 (изоляция от CPU)');
        // IFT: разные значения — проверяем что override per-stand работает
        assert.equal(r.items['test-cpu'].stands.IFT.qty, 2, 'IFT/CPU = 10 * 0.20');
        assert.equal(r.items['test-ram'].stands.IFT.qty, 10, 'IFT/RAM = 20 * 0.50');
        // PROD = 1.00 для всех
        assert.equal(r.items['test-cpu'].stands.PROD.qty, 10);
    });

    it('item БЕЗ dashboardResource использует общий standSizeRatio (Услуги/Лицензии)', () => {
        const calc = baseCalc({
            DEV: { CPU: 0.10, GPU: 0.10, RAM: 0.10, SSD: 0.10, HDD: 0.10, S3: 0.10 },
            IFT: { CPU: 0.10, GPU: 0.10, RAM: 0.10, SSD: 0.10, HDD: 0.10, S3: 0.10 },
            PSI: { CPU: 0.10, GPU: 0.10, RAM: 0.10, SSD: 0.10, HDD: 0.10, S3: 0.10 },
            LOAD:{ CPU: 0.10, GPU: 0.10, RAM: 0.10, SSD: 0.10, HDD: 0.10, S3: 0.10 },
            PROD:{ CPU: 1.00, GPU: 1.00, RAM: 1.00, SSD: 1.00, HDD: 1.00, S3: 1.00 }
        });
        const r = calculate(calc);
        // serviceItem: 10 * S.standSizeRatio.DEV. Без dashboardResource → общий ratio = 0.50
        // (НЕ 0.10 из resourceRatio).
        assert.equal(r.items['test-svc'].stands.DEV.qty, 5,
                     'service item использует общий standSizeRatio.DEV = 0.50');
    });

    it('обратная совместимость: settings.resourceRatio отсутствует → общий standSizeRatio', () => {
        const calc = baseCalc(undefined);
        delete calc.settings.resourceRatio;
        const r = calculate(calc);
        // Без resourceRatio все items используют общий standSizeRatio.
        assert.equal(r.items['test-cpu'].stands.DEV.qty,  5);   // 10 * 0.50
        assert.equal(r.items['test-ram'].stands.DEV.qty, 10);   // 20 * 0.50
        assert.equal(r.items['test-svc'].stands.DEV.qty,  5);
    });

    it('частично заданный resourceRatio (нет нужного ресурса) → fallback на общий', () => {
        const calc = baseCalc({
            DEV: { CPU: 0.10 },  // только CPU задан
            IFT: { CPU: 0.20 },
            PROD: { CPU: 1.00 }
        });
        const r = calculate(calc);
        assert.equal(r.items['test-cpu'].stands.DEV.qty, 1, 'CPU взят из resourceRatio');
        assert.equal(r.items['test-ram'].stands.DEV.qty, 10, 'RAM не задан → 20 * 0.50 (общий)');
    });

    it('идентичность Дашборд ↔ Детализация: одна функция calculate() → одинаковые qty', () => {
        // Этот тест защищает от регрессии: оба UI зависят от одного calculate(),
        // так что значения должны сходиться по построению. Проверяем явно, что
        // повторный вызов calculate() для того же calc даёт идентичный результат.
        const calc = baseCalc({
            DEV: { CPU: 0.30, GPU: 0.10, RAM: 0.20, SSD: 0.10, HDD: 0.10, S3: 0.10 },
            IFT: { CPU: 0.30, GPU: 0.10, RAM: 0.20, SSD: 0.10, HDD: 0.10, S3: 0.10 },
            PSI: { CPU: 0.30, GPU: 0.10, RAM: 0.20, SSD: 0.10, HDD: 0.10, S3: 0.10 },
            LOAD:{ CPU: 0.30, GPU: 0.10, RAM: 0.20, SSD: 0.10, HDD: 0.10, S3: 0.10 },
            PROD:{ CPU: 1.00, GPU: 1.00, RAM: 1.00, SSD: 1.00, HDD: 1.00, S3: 1.00 }
        });
        clearCalculationCache();
        const r1 = calculate(calc);
        const r2 = calculate(calc);
        assert.equal(r1.items['test-cpu'].stands.DEV.qty, r2.items['test-cpu'].stands.DEV.qty);
        assert.equal(r1.items['test-ram'].stands.DEV.qty, r2.items['test-ram'].stands.DEV.qty);
        assert.equal(r1.totalMonthly, r2.totalMonthly);
    });
});
