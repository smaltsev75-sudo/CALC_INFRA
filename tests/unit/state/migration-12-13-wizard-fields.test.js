/**
 * Тесты миграции v12→13 (этап 14.U1).
 *
 * Добавляет 3 поля для Quick Start Wizard:
 *   - calc.wizard         (null для legacy, объект 7 ответов для wizard-расчётов)
 *   - calc.answersMeta    (пустой объект для legacy)
 *   - calc.settings.provider (default 'sbercloud')
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateCalculation, MIGRATIONS, LATEST_SCHEMA_VERSION } from '../../../js/state/migrations.js';

const STEP = MIGRATIONS.find(m => m.from === 12 && m.to === 13);

describe('Миграция v12→13: Quick Start Wizard fields', () => {
    it('legacy расчёт без wizard-полей получает null/пустой default', () => {
        const calc = {
            schemaVersion: 12,
            id: 'legacy',
            settings: { kInflation: 1.06 },
            answers: { peak_rps: 100 }
        };
        const migrated = migrateCalculation(calc);
        assert.strictEqual(migrated.wizard, null, 'wizard должен стать null');
        assert.deepStrictEqual(migrated.answersMeta, {}, 'answersMeta — пустой объект');
        assert.strictEqual(migrated.settings.provider, 'sbercloud', 'provider — sbercloud');
        // Sprint 3.0 Stage 1 поднял до 15. Тест robust к будущим bump'ам.
        assert.strictEqual(migrated.schemaVersion, LATEST_SCHEMA_VERSION);
    });

    it('расчёт с уже существующим wizard-объектом не трогается', () => {
        const wizard = { product_type: 'b2b', industry: 'fintech', scale: 'm' };
        const calc = {
            schemaVersion: 12,
            id: 'wiz',
            settings: { kInflation: 1.06 },
            answers: {},
            wizard
        };
        const migrated = migrateCalculation(calc);
        assert.deepStrictEqual(migrated.wizard, wizard);
    });

    it('answersMeta не перезаписывает существующий объект', () => {
        const meta = { peak_rps: { source: 'profile' } };
        const calc = {
            schemaVersion: 12,
            id: 'meta',
            settings: { kInflation: 1.06 },
            answers: { peak_rps: 100 },
            answersMeta: meta
        };
        const migrated = migrateCalculation(calc);
        assert.deepStrictEqual(migrated.answersMeta, meta);
    });

    it('явно заданный provider не перезаписывается на sbercloud', () => {
        const calc = {
            schemaVersion: 12,
            id: 'prov',
            settings: { kInflation: 1.06, provider: 'yandex' },
            answers: {}
        };
        const migrated = migrateCalculation(calc);
        assert.strictEqual(migrated.settings.provider, 'yandex');
    });

    it('идемпотентность: повторный run не меняет calc', () => {
        const calc = {
            schemaVersion: 12,
            id: 'idem',
            settings: {},
            answers: {}
        };
        const once = migrateCalculation(calc);
        const twice = migrateCalculation(once);
        assert.deepStrictEqual(once.wizard, twice.wizard);
        assert.deepStrictEqual(once.answersMeta, twice.answersMeta);
        assert.strictEqual(once.settings.provider, twice.settings.provider);
    });

    it('step.run прямой вызов: добавляет 3 поля', () => {
        const calc = { settings: {} };
        STEP.run(calc);
        assert.strictEqual(calc.wizard, null);
        assert.deepStrictEqual(calc.answersMeta, {});
        assert.strictEqual(calc.settings.provider, 'sbercloud');
    });

    it('step.run на пустом calc {} — создаёт settings и наполняет', () => {
        const calc = {};
        STEP.run(calc);
        assert.ok(calc.settings);
        assert.strictEqual(calc.settings.provider, 'sbercloud');
        assert.strictEqual(calc.wizard, null);
        assert.deepStrictEqual(calc.answersMeta, {});
    });
});

describe('Миграция v12→13: интеграция с migrateCalculation', () => {
    it('LATEST_SCHEMA_VERSION ≥ 13 (14.U4 поднял до 14)', async () => {
        const { LATEST_SCHEMA_VERSION } = await import('../../../js/state/migrations.js');
        assert.ok(LATEST_SCHEMA_VERSION >= 13,
            `LATEST_SCHEMA_VERSION должен быть ≥13, получено ${LATEST_SCHEMA_VERSION}`);
    });

    it('расчёт schemaVersion=11 проходит через всю цепочку миграций', () => {
        const calc = {
            schemaVersion: 11,
            id: 'multi',
            settings: { kInflation: 1.06, standSizeRatio: { LOAD: 1.20 } },
            answers: {}
        };
        const migrated = migrateCalculation(calc);
        // 11→12: LOAD=1.20 = STAND_RATIO_RANGES.LOAD.max (Stage 19), без clamp.
        // До Stage 19: clamp до 1.00 (общий инвариант).
        assert.strictEqual(migrated.settings.standSizeRatio.LOAD, 1.20);
        // 12→13: добавлены wizard-поля
        assert.strictEqual(migrated.wizard, null);
        assert.strictEqual(migrated.settings.provider, 'sbercloud');
        // 13→14: providerSetByWizard выставлен (legacy → false, т.к. wizard=null)
        assert.strictEqual(migrated.settings.providerSetByWizard, false);
        // 14→15: scenarios[0] создан, activeScenarioId установлен
        assert.ok(Array.isArray(migrated.scenarios) && migrated.scenarios.length === 1);
        assert.strictEqual(migrated.activeScenarioId, migrated.scenarios[0].id);
        assert.strictEqual(migrated.schemaVersion, LATEST_SCHEMA_VERSION);
    });
});
