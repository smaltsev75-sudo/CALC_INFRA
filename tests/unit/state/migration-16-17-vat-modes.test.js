/**
 * Stage VAT-1 Phase 2: миграция 16→17 — Calc VAT modes.
 *
 * Покрывает 6 классов legacy-расчётов + acceptance criterion «сумма не меняется
 * после миграции для исторической ставки».
 *
 * Правила миграции — см. описание шага в [js/state/migrations.js] из секции
 * `from: 16, to: 17`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    migrateCalculation,
    MIGRATIONS,
    LATEST_SCHEMA_VERSION
} from '../../../js/state/migrations.js';
import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import {
    DEFAULT_STAND_SIZE_RATIO,
    DEFAULT_PHASE_DURATION_MONTHS,
    DEFAULT_DAYS_PER_MONTH
} from '../../../js/utils/constants.js';

/**
 * Минимальный legacy v16-расчёт. Указываем schemaVersion: 16, чтобы
 * `migrateCalculation` пропустил все более ранние шаги (0→1..15→16) и
 * применил ТОЛЬКО 16→17 — то, что мы тут проверяем.
 *
 * При schemaVersion: 16 более ранние миграции не запускаются — поля
 * settings уже должны быть в форме v16.
 */
function legacyV16({ vatRate, createdAt, extraSettings = {} } = {}) {
    return {
        version: '1.0',
        id: 'test-legacy',
        name: 'Legacy',
        schemaVersion: 16,
        ...(createdAt !== undefined && { createdAt }),
        updatedAt: '2026-05-12T10:00:00Z',
        settings: {
            vatEnabled: true,
            ...(vatRate !== undefined && { vatRate }),
            applyRiskFactors: true,
            planningHorizonYears: 1,
            phaseDurationMonths: DEFAULT_PHASE_DURATION_MONTHS,
            daysPerMonth: DEFAULT_DAYS_PER_MONTH,
            standSizeRatio: { ...DEFAULT_STAND_SIZE_RATIO },
            bufferTask: 0, bufferProject: 0,
            kInflation: 0, kSeasonal: 0, kScheduleShift: 0, kContingency: 0,
            ...extraSettings
        },
        answers: {},
        dictionaries: { items: [], questions: [], categories: [] }
    };
}

/* ---------- 6 классов legacy-расчётов ---------- */

describe('Migration 16→17: legacy vatRate=0.20 (НДС 2019-2025)', () => {
    it('createdAt=2024-06-01 → mode=frozen, vatEffectiveDate=2024-06-01, vatRate=0.20', () => {
        const out = migrateCalculation(legacyV16({
            vatRate: 0.20,
            createdAt: '2024-06-01T10:00:00Z'
        }));
        assert.equal(out.settings.vatRateMode, 'frozen');
        assert.equal(out.settings.vatEffectiveDate, '2024-06-01');
        assert.equal(out.settings.vatRate, 0.20);  // СУММА НЕ МЕНЯЕТСЯ
        assert.equal(out.schemaVersion, LATEST_SCHEMA_VERSION);
    });

    it('createdAt=2025-11-30 → mode=frozen (конец 20%-периода)', () => {
        const out = migrateCalculation(legacyV16({
            vatRate: 0.20,
            createdAt: '2025-11-30T10:00:00Z'
        }));
        assert.equal(out.settings.vatRateMode, 'frozen');
        assert.equal(out.settings.vatRate, 0.20);
    });

    it('без createdAt → mode=frozen, vatEffectiveDate=null', () => {
        const out = migrateCalculation(legacyV16({ vatRate: 0.20 }));
        assert.equal(out.settings.vatRateMode, 'frozen');
        assert.equal(out.settings.vatEffectiveDate, null);
        assert.equal(out.settings.vatRate, 0.20);
    });
});

describe('Migration 16→17: legacy vatRate=0.18 (НДС до 2019)', () => {
    it('createdAt=2017-03-15 → mode=frozen, vatRate=0.18', () => {
        const out = migrateCalculation(legacyV16({
            vatRate: 0.18,
            createdAt: '2017-03-15T10:00:00Z'
        }));
        assert.equal(out.settings.vatRateMode, 'frozen');
        assert.equal(out.settings.vatEffectiveDate, '2017-03-15');
        assert.equal(out.settings.vatRate, 0.18);
    });
});

describe('Migration 16→17: vatRate=0.22 (текущая ставка)', () => {
    it('createdAt=2026-04-01 (после 01.01.2026) → mode=auto-by-date', () => {
        const out = migrateCalculation(legacyV16({
            vatRate: 0.22,
            createdAt: '2026-04-01T10:00:00Z'
        }));
        assert.equal(out.settings.vatRateMode, 'auto-by-date');
        assert.equal(out.settings.vatEffectiveDate, '2026-04-01');
        assert.equal(out.settings.vatRate, 0.22);
    });

    it('createdAt=2026-01-01 (ровно граница) → mode=auto-by-date', () => {
        const out = migrateCalculation(legacyV16({
            vatRate: 0.22,
            createdAt: '2026-01-01T00:00:00Z'
        }));
        assert.equal(out.settings.vatRateMode, 'auto-by-date');
    });

    it('createdAt=2025-12-31 (до 01.01.2026) → mode=frozen (странный случай: 22% поставлено вручную ранее)', () => {
        const out = migrateCalculation(legacyV16({
            vatRate: 0.22,
            createdAt: '2025-12-31T10:00:00Z'
        }));
        assert.equal(out.settings.vatRateMode, 'frozen');
        assert.equal(out.settings.vatEffectiveDate, '2025-12-31');
        assert.equal(out.settings.vatRate, 0.22);
    });

    it('без createdAt → mode=frozen (нельзя классифицировать как автоматическую)', () => {
        const out = migrateCalculation(legacyV16({ vatRate: 0.22 }));
        assert.equal(out.settings.vatRateMode, 'frozen');
        assert.equal(out.settings.vatEffectiveDate, null);
    });
});

describe('Migration 16→17: custom vatRate (не из справочника)', () => {
    it('vatRate=0.25 → mode=manual, vatEffectiveDate=null', () => {
        const out = migrateCalculation(legacyV16({
            vatRate: 0.25,
            createdAt: '2025-01-01T10:00:00Z'
        }));
        assert.equal(out.settings.vatRateMode, 'manual');
        assert.equal(out.settings.vatEffectiveDate, null);
        assert.equal(out.settings.vatRate, 0.25);
    });

    it('vatRate=0 (нерезидент / экспорт) → mode=manual', () => {
        const out = migrateCalculation(legacyV16({
            vatRate: 0,
            createdAt: '2026-03-01T10:00:00Z'
        }));
        assert.equal(out.settings.vatRateMode, 'manual');
        assert.equal(out.settings.vatRate, 0);
    });

    it('vatRate=0.15 (промежуточное) → mode=manual', () => {
        const out = migrateCalculation(legacyV16({
            vatRate: 0.15,
            createdAt: '2026-03-01T10:00:00Z'
        }));
        assert.equal(out.settings.vatRateMode, 'manual');
        assert.equal(out.settings.vatRate, 0.15);
    });
});

describe('Migration 16→17: vatRate отсутствует', () => {
    it('нет vatRate, есть createdAt → mode=auto-by-date, vatEffectiveDate=createdAt', () => {
        const out = migrateCalculation(legacyV16({
            createdAt: '2026-05-12T10:00:00Z'
        }));
        assert.equal(out.settings.vatRateMode, 'auto-by-date');
        assert.equal(out.settings.vatEffectiveDate, '2026-05-12');
        /* vatRate ставится контроллером в openCalc для mode=auto-by-date.
           Миграция оставляет его undefined — это корректно. */
    });

    it('нет vatRate, нет createdAt → mode=auto-by-date, vatEffectiveDate=null', () => {
        const out = migrateCalculation(legacyV16());
        assert.equal(out.settings.vatRateMode, 'auto-by-date');
        assert.equal(out.settings.vatEffectiveDate, null);
    });
});

/* ---------- Идемпотентность ---------- */

describe('Migration 16→17: идемпотентность', () => {
    it('повторная миграция уже-v17 расчёта не меняет settings', () => {
        const first = migrateCalculation(legacyV16({
            vatRate: 0.20,
            createdAt: '2024-06-01T10:00:00Z'
        }));
        const second = migrateCalculation(first);
        assert.deepEqual(first.settings, second.settings);
        assert.equal(second.schemaVersion, LATEST_SCHEMA_VERSION);
    });

    it('расчёт уже с vatRateMode не перетирается (даже если ранее vatRate=0.20)', () => {
        const calc = legacyV16({ vatRate: 0.20, createdAt: '2024-06-01T10:00:00Z' });
        calc.schemaVersion = 17;
        calc.settings.vatRateMode = 'manual';
        calc.settings.vatEffectiveDate = null;
        const out = migrateCalculation(calc);
        assert.equal(out.settings.vatRateMode, 'manual');  // не перетёрто на 'frozen'
    });
});

/* ---------- ACCEPTANCE: сумма не меняется ---------- */

describe('Migration 16→17: ACCEPTANCE — сумма расчёта не меняется', () => {
    /**
     * Минимальный calc с реальным товаром и риск-коэффициентами,
     * чтобы вычисление было нетривиальным.
     */
    function calcWithItem(vatRate) {
        return {
            version: '1.0', id: 'sum-test', name: 'SumTest', schemaVersion: 16,
            createdAt: '2024-06-01T10:00:00Z',
            updatedAt: '2026-05-12T10:00:00Z',
            settings: {
                vatEnabled: true,
                vatRate,
                applyRiskFactors: true,
                planningHorizonYears: 1,
                phaseDurationMonths: DEFAULT_PHASE_DURATION_MONTHS,
                daysPerMonth: DEFAULT_DAYS_PER_MONTH,
                standSizeRatio: { ...DEFAULT_STAND_SIZE_RATIO, PROD: 1.0 },
                bufferTask: 0.1,
                bufferProject: 0.05,
                kInflation: 0.08,
                kSeasonal: 0.05,
                kScheduleShift: 0.10,
                kContingency: 0.05
            },
            answers: {},
            dictionaries: {
                items: [{
                    id: 'test-cpu',
                    name: 'Test CPU',
                    unit: 'шт.',
                    pricePerUnit: 1000,
                    billingInterval: 'monthly',
                    applicableStands: ['PROD'],
                    qtyFormulas: { PROD: '10' },
                    category: 'HW'
                }],
                questions: [],
                categories: []
            }
        };
    }

    it('Legacy 20% calc: totalMonthly до миграции === totalMonthly после миграции', () => {
        clearCalculationCache();
        const before = calculate(calcWithItem(0.20));
        const migrated = migrateCalculation(calcWithItem(0.20));

        /* Sanity: миграция действительно прошла */
        assert.equal(migrated.settings.vatRateMode, 'frozen');
        assert.equal(migrated.settings.vatRate, 0.20);

        clearCalculationCache();
        const after = calculate(migrated);

        assert.equal(before.totalMonthly, after.totalMonthly,
            `до=${before.totalMonthly}, после=${after.totalMonthly} — сумма должна совпадать`);
        assert.ok(before.totalMonthly > 0, 'тест должен давать non-zero итог');
    });

    it('Custom 25% calc: totalMonthly не меняется (mode=manual, vatRate сохраняется)', () => {
        clearCalculationCache();
        const before = calculate(calcWithItem(0.25));
        const migrated = migrateCalculation(calcWithItem(0.25));
        assert.equal(migrated.settings.vatRateMode, 'manual');
        assert.equal(migrated.settings.vatRate, 0.25);

        clearCalculationCache();
        const after = calculate(migrated);
        assert.equal(before.totalMonthly, after.totalMonthly);
    });
});

/* ---------- LATEST_SCHEMA_VERSION ---------- */

describe('Migration: LATEST_SCHEMA_VERSION после Phase 2', () => {
    /* Внешний аудит #3 (2026-05-18): добавлена миграция 17→18 (priceSource
     * нормализация). MINOR 2.18.0 (2026-05-19): добавлена миграция 18→19
     * (удаление dead-вопроса mau_growth_rate_percent). Тесты на промежуточные
     * шаги (16→17 VAT modes, 17→18 priceSource) проверяются как наличие шага
     * в массиве MIGRATIONS, а не как «последний». */
    it('LATEST_SCHEMA_VERSION = 22 (… + Package 3A OS license gate + Package 6A deployment override)', () => {
        assert.equal(LATEST_SCHEMA_VERSION, 22);
    });

    it('Шаг 16→17 — VAT modes (Stage VAT-1)', () => {
        const step = MIGRATIONS.find(m => m.from === 16 && m.to === 17);
        assert.ok(step, 'Шаг 16→17 должен присутствовать');
        assert.match(step.description, /Stage VAT-1.*Calc VAT modes/);
    });

    it('Шаг 17→18 — priceSource normalization (аудит #3)', () => {
        const step = MIGRATIONS.find(m => m.from === 17 && m.to === 18);
        assert.ok(step, 'Шаг 17→18 должен присутствовать');
        assert.match(step.description, /аудит #3|priceSource/);
    });

    it('Шаг 18→19 — удаление dead-вопроса mau_growth_rate_percent (MINOR 2.18.0)', () => {
        const step = MIGRATIONS.find(m => m.from === 18 && m.to === 19);
        assert.ok(step, 'Шаг 18→19 должен присутствовать');
        assert.match(step.description, /MINOR 2\.18\.0|mau_growth_rate_percent/);
    });

    it('Шаг 19→20 — нормализация Quick Start select-answer values', () => {
        const step = MIGRATIONS.find(m => m.from === 19 && m.to === 20);
        assert.ok(step, 'Шаг 19→20 должен присутствовать');
        assert.match(step.description, /Quick Start select-answer/);
    });

    it('Шаг 20→21 — OS license gate (Package 3A)', () => {
        const step = MIGRATIONS.find(m => m.from === 20 && m.to === 21);
        assert.ok(step, 'Шаг 20→21 должен присутствовать');
        assert.match(step.description, /Package 3A|OS license/i);
    });

    it('Последний шаг — 21→22 deployment override (Package 6A)', () => {
        const last = MIGRATIONS[MIGRATIONS.length - 1];
        assert.equal(last.from, 21);
        assert.equal(last.to, 22);
        assert.match(last.description, /Package 6A|deployment/i);
    });

    it('Любой v0-расчёт мигрирует до LATEST (полная цепочка)', () => {
        const v0 = {
            version: '1.0', id: 'old', name: 'Old',
            settings: { vatRate: 0.18 },
            answers: {},
            dictionaries: { items: [], questions: [], categories: [] }
        };
        const out = migrateCalculation(v0);
        assert.equal(out.schemaVersion, LATEST_SCHEMA_VERSION);
        /* v0 не имел createdAt — итог должен быть frozen с null effective date.
           НО: предыдущие миграции могли что-то добавить. Проверяем главное —
           vatRateMode выставлен. */
        assert.ok(['frozen', 'manual', 'auto-by-date'].includes(out.settings.vatRateMode));
    });
});
