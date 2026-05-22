/**
 * Миграция v11 → v12: per-stand clamp standSizeRatio и resourceRatio.
 *
 * Stage 19 (2026-05-19, MINOR 2.19.0): clamp идёт через STAND_RATIO_RANGES,
 * не через жёсткий 1.00. LOAD теперь до 1.20 (capacity-запас под stress);
 * DEV/IFT/PSI остаются ≤ 1.00. PROD = 1.00 эталон.
 *
 * До Stage 19: глобальный clamp до 1.00 (инвариант 13.U11 «стенд ≤ ПРОМ»).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateCalculation } from '../../../js/state/migrations.js';

function legacyV11Calc(overrides = {}) {
    return {
        schemaVersion: 11,
        id: 'l', name: 'Legacy',
        settings: {
            period: 'monthly',
            bufferTask: 0.3, bufferProject: 0.15,
            kInflation: 0.10, kSeasonal: 0, kScheduleShift: 0, kContingency: 0,
            vatEnabled: true, vatRate: 0.20,
            planningHorizonYears: 3, daysPerMonth: 30, phaseDurationMonths: 12,
            standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 1.50, PROD: 1.00 },
            resourceRatio: {
                DEV:  { CPU: 0.16, GPU: 0.16, RAM: 0.16, SSD: 0.16, HDD: 0.16, S3: 0.16 },
                IFT:  { CPU: 0.40, GPU: 0.40, RAM: 0.40, SSD: 0.40, HDD: 0.40, S3: 0.40 },
                PSI:  { CPU: 0.50, GPU: 0.50, RAM: 0.50, SSD: 0.50, HDD: 0.50, S3: 0.50 },
                LOAD: { CPU: 1.50, GPU: 1.20, RAM: 0.80, SSD: 0.80, HDD: 0.80, S3: 0.80 },
                PROD: { CPU: 1.00, GPU: 1.00, RAM: 1.00, SSD: 1.00, HDD: 1.00, S3: 1.00 }
            },
            applyRiskFactors: true,
            ...overrides
        },
        answers: {},
        dictionaries: { items: [], questions: [] }
    };
}

describe('migration v11 → v12: per-stand clamp standSizeRatio (Stage 19)', () => {
    it('LOAD = 1.50 → 1.20 (per-stand max), остальные ≤ 1 не трогаются', () => {
        const m = migrateCalculation(legacyV11Calc());
        assert.equal(m.settings.standSizeRatio.LOAD, 1.20,
            'LOAD clamp до STAND_RATIO_RANGES.LOAD.max = 1.20 (capacity-запас)');
        assert.equal(m.settings.standSizeRatio.DEV, 0.16);
        assert.equal(m.settings.standSizeRatio.IFT, 0.40);
        assert.equal(m.settings.standSizeRatio.PSI, 0.50);
        assert.equal(m.settings.standSizeRatio.PROD, 1.00);
    });

    it('LOAD = 1.20 — точно равен max, не меняется', () => {
        const m = migrateCalculation(legacyV11Calc({
            standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 1.20, PROD: 1.00 }
        }));
        assert.equal(m.settings.standSizeRatio.LOAD, 1.20);
    });

    it('DEV = 5.0 (legacy экстремум) → 1.00 (DEV max)', () => {
        const m = migrateCalculation(legacyV11Calc({
            standSizeRatio: { DEV: 5.0, IFT: 0.40, PSI: 0.50, LOAD: 0.80, PROD: 1.00 }
        }));
        assert.equal(m.settings.standSizeRatio.DEV, 1.00,
            'DEV clamp до STAND_RATIO_RANGES.DEV.max = 1.00 (инвариант для DEV сохранён)');
    });
});

describe('migration v11 → v12: per-stand clamp resourceRatio (Stage 19)', () => {
    it('LOAD.CPU=1.50 → 1.20, LOAD.GPU=1.20 — без изменений, остальные не трогаются', () => {
        const m = migrateCalculation(legacyV11Calc());
        assert.equal(m.settings.resourceRatio.LOAD.CPU, 1.20,
            'LOAD.CPU clamp до LOAD.max=1.20');
        assert.equal(m.settings.resourceRatio.LOAD.GPU, 1.20,
            'LOAD.GPU=1.20 — ровно max, без изменения');
        assert.equal(m.settings.resourceRatio.LOAD.RAM, 0.80);
        assert.equal(m.settings.resourceRatio.LOAD.SSD, 0.80);
        for (const r of ['CPU', 'GPU', 'RAM', 'SSD', 'HDD', 'S3']) {
            assert.equal(m.settings.resourceRatio.PROD[r], 1.00);
        }
        assert.equal(m.settings.resourceRatio.DEV.CPU, 0.16);
        assert.equal(m.settings.resourceRatio.IFT.RAM, 0.40);
        assert.equal(m.settings.resourceRatio.PSI.S3, 0.50);
    });

    it('расчёт без resourceRatio (только standSizeRatio) — миграция не падает', () => {
        const calc = legacyV11Calc();
        delete calc.settings.resourceRatio;
        const m = migrateCalculation(calc);
        assert.equal(m.settings.standSizeRatio.LOAD, 1.20);
    });
});

describe('migration v11 → v12: идемпотентность', () => {
    it('повторный прогон не меняет уже clamp-нутые значения', () => {
        const m1 = migrateCalculation(legacyV11Calc());
        const m2 = migrateCalculation(m1);
        assert.equal(m1.schemaVersion, m2.schemaVersion);
        assert.equal(m1.settings.standSizeRatio.LOAD, m2.settings.standSizeRatio.LOAD);
        assert.equal(m1.settings.resourceRatio.LOAD.CPU, m2.settings.resourceRatio.LOAD.CPU);
    });
});
