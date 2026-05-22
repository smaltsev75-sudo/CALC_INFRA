/**
 * Unit-тесты applyStandFilter — пересчёт ИТОГО / byCategory / byCostType
 * по подмножеству активных стендов.
 *
 * Используем как реальный seed-расчёт (через calculator), так и синтетический
 * mock-result для тестов edge-cases (полностью отключённые стенды, нулевые
 * суммы и пр.).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyStandFilter } from '../../../js/domain/standsFilter.js';
import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import {
    STAND_IDS, CATEGORY_IDS, COST_TYPE_IDS,
    DEFAULT_DAYS_PER_MONTH, DEFAULT_PHASE_DURATION_MONTHS, DEFAULT_STAND_SIZE_RATIO
} from '../../../js/utils/constants.js';

const EPS = 1e-6;

/* ---------- Хелперы ---------- */

/** Синтетический result: каждый стенд имеет свои простые суммы. */
function makeMockResult({ standMonthly, byCategory, byCostType, daysPerMonth = 30 } = {}) {
    const stands = {};
    let total = 0;
    for (const sid of STAND_IDS) {
        const m = standMonthly?.[sid] ?? 1000;
        total += m;
        stands[sid] = {
            items: [],
            totalMonthly: m,
            totalAnnual: m * 12,
            totalDaily: m / daysPerMonth,
            byCategory: byCategory?.[sid] || Object.fromEntries(CATEGORY_IDS.map(c => [c, 0])),
            byCostType: byCostType?.[sid] || Object.fromEntries(COST_TYPE_IDS.map(c => [c, 0])),
            byResourceClass: {},
            byBillingInterval: {}
        };
    }
    return {
        stands,
        items: {},
        totalMonthly: total,
        totalAnnual: total * 12,
        totalDaily: total / daysPerMonth,
        byCategory: aggregate(stands, 'byCategory', CATEGORY_IDS),
        byCostType: aggregate(stands, 'byCostType', COST_TYPE_IDS)
    };
}
function aggregate(stands, field, keys) {
    const out = Object.fromEntries(keys.map(k => [k, 0]));
    for (const sid of STAND_IDS) {
        const m = stands[sid][field] || {};
        for (const k of keys) out[k] += m[k] || 0;
    }
    return out;
}

function makeSeedResult() {
    const dict = buildSeedDictionaries();
    const calc = {
        version: '1.0', id: 'sf-test', name: 'SF', schemaVersion: 2,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        settings: { ...SEED_SETTINGS, phaseDurationMonths: 4 },
        answers: defaultAnswersFrom(dict.questions),
        dictionaries: dict
    };
    clearCalculationCache();
    return { result: calculate(calc), calc };
}

/* ---------- Тесты ---------- */

describe('applyStandFilter: short-circuit', () => {
    it('пустой disabledStands → возвращает исходный объект (identity)', () => {
        const r = makeMockResult();
        const f = applyStandFilter(r, []);
        assert.equal(f, r, 'должен вернуться тот же объект, без копирования');
    });

    it('disabledStands=undefined → возвращает исходный объект', () => {
        const r = makeMockResult();
        const f = applyStandFilter(r);
        assert.equal(f, r);
    });

    it('disabledStands с неизвестным id (не из STAND_IDS) → identity', () => {
        const r = makeMockResult();
        const f = applyStandFilter(r, ['UNKNOWN_STAND']);
        assert.equal(f, r, 'неизвестные id игнорируются, активные = все 5 → short-circuit');
    });

    it('null result → возвращает null безопасно', () => {
        assert.equal(applyStandFilter(null, ['LOAD']), null);
    });
});

describe('applyStandFilter: один отключённый стенд', () => {
    it('totalMonthly = sum(остальных 4)', () => {
        const r = makeMockResult({
            standMonthly: { DEV: 100, IFT: 200, PSI: 300, PROD: 400, LOAD: 500 }
        });
        const f = applyStandFilter(r, ['LOAD']);
        assert.ok(Math.abs(f.totalMonthly - (100 + 200 + 300 + 400)) < EPS);
        assert.ok(Math.abs(f.totalMonthly - 1000) < EPS);
    });

    it('totalAnnual / totalDaily пересчитаны соответственно', () => {
        const r = makeMockResult({
            standMonthly: { DEV: 100, IFT: 100, PSI: 100, PROD: 100, LOAD: 100 }
        });
        const f = applyStandFilter(r, ['DEV']);
        assert.ok(Math.abs(f.totalMonthly - 400) < EPS);
        assert.ok(Math.abs(f.totalAnnual - 400 * 12) < EPS);
        // totalDaily — sum of stand.totalDaily; stand.totalDaily = 100/30
        assert.ok(Math.abs(f.totalDaily - 4 * (100 / 30)) < EPS);
    });

    it('исходный result не мутируется', () => {
        const r = makeMockResult({
            standMonthly: { DEV: 100, IFT: 100, PSI: 100, PROD: 100, LOAD: 100 }
        });
        const before = r.totalMonthly;
        applyStandFilter(r, ['LOAD']);
        assert.equal(r.totalMonthly, before, 'оригинал не должен меняться');
    });
});

describe('applyStandFilter: все стенды отключены', () => {
    it('totalMonthly = 0, byCategory все 0, byCostType все 0', () => {
        const r = makeMockResult({
            standMonthly: { DEV: 100, IFT: 200, PSI: 300, PROD: 400, LOAD: 500 }
        });
        const f = applyStandFilter(r, [...STAND_IDS]);
        assert.equal(f.totalMonthly, 0);
        assert.equal(f.totalAnnual, 0);
        assert.equal(f.totalDaily, 0);
        for (const cat of CATEGORY_IDS) assert.equal(f.byCategory[cat], 0, `byCategory.${cat} === 0`);
        for (const ct of COST_TYPE_IDS) assert.equal(f.byCostType[ct], 0, `byCostType.${ct} === 0`);
    });

    it('activeStands = [], disabledStands = все 5', () => {
        const r = makeMockResult();
        const f = applyStandFilter(r, [...STAND_IDS]);
        assert.deepEqual(f.activeStands, []);
        assert.deepEqual([...f.disabledStands].sort(), [...STAND_IDS].sort());
    });
});

describe('applyStandFilter: byCostType корректно пересчитан', () => {
    it('sum(byCostType) === totalMonthly после фильтрации', () => {
        const byCostType = {};
        const standMonthly = {};
        for (const sid of STAND_IDS) {
            // На каждом стенде половина — capex, половина — opex.
            byCostType[sid] = { capex: 50, opex: 50 };
            standMonthly[sid] = 100;
        }
        const r = makeMockResult({ standMonthly, byCostType });
        const f = applyStandFilter(r, ['LOAD', 'DEV']);
        // Активны 3 стенда → 300 ИТОГО, 150/150 capex/opex
        assert.ok(Math.abs(f.totalMonthly - 300) < EPS);
        assert.ok(Math.abs(f.byCostType.capex - 150) < EPS);
        assert.ok(Math.abs(f.byCostType.opex - 150) < EPS);
        assert.ok(Math.abs((f.byCostType.capex + f.byCostType.opex) - f.totalMonthly) < EPS);
    });

    it('капекс только на одном (отключённом) стенде → byCostType.capex = 0', () => {
        const standMonthly = { DEV: 100, IFT: 100, PSI: 100, PROD: 100, LOAD: 200 };
        const byCostType = {
            DEV:  { capex: 0,   opex: 100 },
            IFT:  { capex: 0,   opex: 100 },
            PSI:  { capex: 0,   opex: 100 },
            PROD: { capex: 0,   opex: 100 },
            LOAD: { capex: 200, opex: 0   }   // капекс только тут
        };
        const r = makeMockResult({ standMonthly, byCostType });
        const f = applyStandFilter(r, ['LOAD']);
        assert.equal(f.byCostType.capex, 0);
        assert.ok(Math.abs(f.byCostType.opex - 400) < EPS);
    });
});

describe('applyStandFilter: byCategory корректно пересчитан', () => {
    it('sum(byCategory) === totalMonthly после фильтрации', () => {
        const standMonthly = {};
        const byCategory = {};
        for (const sid of STAND_IDS) {
            standMonthly[sid] = 700;
            // По 100 на каждую из 7 категорий — даёт 700 на стенд.
            byCategory[sid] = Object.fromEntries(CATEGORY_IDS.map(c => [c, 100]));
        }
        const r = makeMockResult({ standMonthly, byCategory });
        const f = applyStandFilter(r, ['DEV', 'IFT']);
        const sum = CATEGORY_IDS.reduce((a, c) => a + f.byCategory[c], 0);
        assert.ok(Math.abs(sum - f.totalMonthly) < EPS);
        // 3 активных стенда × 100 на категорию = 300 в каждой.
        for (const cat of CATEGORY_IDS) assert.ok(Math.abs(f.byCategory[cat] - 300) < EPS, cat);
    });
});

describe('applyStandFilter: метаданные activeStands / disabledStands', () => {
    it('правильно перечисляет активные и выключенные', () => {
        const r = makeMockResult();
        const f = applyStandFilter(r, ['LOAD']);
        assert.deepEqual(f.disabledStands, ['LOAD']);
        assert.deepEqual(f.activeStands, ['DEV', 'IFT', 'PSI', 'PROD']);
    });

    it('игнорирует неизвестные id в disabledStands', () => {
        const r = makeMockResult();
        const f = applyStandFilter(r, ['LOAD', 'NONEXISTENT', 'DEV']);
        assert.deepEqual([...f.disabledStands].sort(), ['DEV', 'LOAD']);
        assert.deepEqual(f.activeStands, ['IFT', 'PSI', 'PROD']);
    });
});

describe('applyStandFilter: интеграция с реальным calculate', () => {
    it('seed-расчёт: totalMonthly после фильтра ≤ исходного', () => {
        const { result } = makeSeedResult();
        const f = applyStandFilter(result, ['LOAD']);
        assert.ok(f.totalMonthly <= result.totalMonthly + EPS);
    });

    it('seed-расчёт: исключение всех стендов даёт ИТОГО=0', () => {
        const { result } = makeSeedResult();
        const f = applyStandFilter(result, [...STAND_IDS]);
        assert.equal(f.totalMonthly, 0);
        assert.equal(f.totalAnnual, 0);
        assert.equal(f.totalDaily, 0);
    });

    it('seed-расчёт: stands и items сохранены по ссылке (UI видит исходные суммы по стендам)', () => {
        const { result } = makeSeedResult();
        const f = applyStandFilter(result, ['LOAD']);
        assert.equal(f.stands, result.stands, 'stands не должен копироваться (UI читает оригинал)');
        assert.equal(f.items, result.items, 'items не должен копироваться');
    });

    it('seed-расчёт: sum(byCategory) после фильтра совпадает с totalMonthly', () => {
        const { result } = makeSeedResult();
        const f = applyStandFilter(result, ['LOAD', 'DEV']);
        const sum = CATEGORY_IDS.reduce((a, c) => a + (f.byCategory[c] || 0), 0);
        assert.ok(Math.abs(sum - f.totalMonthly) < 1e-3,
            `sum(byCategory)=${sum} должно ≈ totalMonthly=${f.totalMonthly}`);
    });

    it('seed-расчёт: sum(byCostType) после фильтра совпадает с totalMonthly', () => {
        const { result } = makeSeedResult();
        const f = applyStandFilter(result, ['LOAD']);
        const sum = COST_TYPE_IDS.reduce((a, c) => a + (f.byCostType[c] || 0), 0);
        assert.ok(Math.abs(sum - f.totalMonthly) < 1e-3,
            `sum(byCostType)=${sum} должно ≈ totalMonthly=${f.totalMonthly}`);
    });

    it('seed-расчёт: f.totalMonthly === sum(stands[active].totalMonthly)', () => {
        const { result } = makeSeedResult();
        const disabled = ['LOAD', 'PSI'];
        const f = applyStandFilter(result, disabled);
        const expected = STAND_IDS
            .filter(s => !disabled.includes(s))
            .reduce((a, sid) => a + result.stands[sid].totalMonthly, 0);
        assert.ok(Math.abs(f.totalMonthly - expected) < EPS,
            `f.totalMonthly=${f.totalMonthly} expected=${expected}`);
    });
});

/* ---------- TODO: интеграционный UI-тест ----------
 *
 * Идея: после ctx.toggleStand('LOAD') дашборд / детализация должны
 * использовать пересчитанный applyStandFilter(result, ['LOAD']).
 *
 * Существующий ui-modules-smoke.test.js ловит только import-time ошибки
 * под минимальным DOM-mock'ом. Полноценного store-rendering harness'а нет —
 * добавление полноценной интеграции потребует больше инфраструктуры. Сейчас
 * корректность пересчёта доказана через standsFilter unit-тесты + ручной
 * прогон в dev (Ctrl+Alt+3 → клик по чипу LOAD → числа в ИТОГО меняются).
 */
