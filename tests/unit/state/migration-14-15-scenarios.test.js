/**
 * Sprint 3.0 Stage 1: тесты миграции v14 → v15 (scenarios[] + activeScenarioId).
 *
 * Контракт миграции:
 *   - Legacy calc (v14, без scenarios) получает scenarios=[{id, label='Базовый',
 *     wizard, answers, answersMeta}] и activeScenarioId=scenarios[0].id.
 *   - Root mirror (calc.wizard / answers / answersMeta) ОСТАЁТСЯ — calculator.js
 *     и UI читают его напрямую.
 *   - Идемпотентность: повторная миграция (или уже-мигрированный JSON-импорт)
 *     не дублирует scenarios.
 *   - Защита от полу-выполненных миграций: scenarios без activeScenarioId →
 *     activeScenarioId восстанавливается из scenarios[0].id.
 *   - schemaVersion бампается до 15 (LATEST_SCHEMA_VERSION).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateCalculation, LATEST_SCHEMA_VERSION, MIGRATIONS } from '../../../js/state/migrations.js';

/* Изоляция: для проверки контракта именно миграции 14→15 используем подмножество
   шагов, отрезая будущие миграции (например, Stage VAT-1 добавила 16→17, которая
   расширяет settings). DI через параметр _migrations в migrateCalculation. */
const MIGRATIONS_UP_TO_15 = MIGRATIONS.filter(s => s.to <= 15);

describe('14→15: легаси calc получает scenarios[0] + activeScenarioId', () => {
    const v14legacy = {
        schemaVersion: 14,
        id: 'test-calc-1',
        name: 'Test',
        wizard: { product_type: 'B2B', industry: 'IT', scale: 'M' },
        answers: { peak_rps: 100, dau_share_of_registered_percent: 5 },
        answersMeta: { peak_rps: { source: 'manual' } },
        settings: { provider: 'sbercloud', providerSetByWizard: true },
        view: { disabledStands: [] },
        dictionaries: { items: [], questions: [] }
    };

    it('schemaVersion бампается до LATEST_SCHEMA_VERSION', () => {
        const m = migrateCalculation(v14legacy);
        assert.equal(m.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.ok(LATEST_SCHEMA_VERSION >= 15, 'Sprint 3.0 поднимает schema до >= 15');
    });

    it('создаётся scenarios[0] с label "Базовый"', () => {
        const m = migrateCalculation(v14legacy);
        assert.ok(Array.isArray(m.scenarios));
        assert.equal(m.scenarios.length, 1);
        assert.equal(m.scenarios[0].label, 'Базовый');
    });

    it('scenarios[0].wizard равен root.wizard', () => {
        const m = migrateCalculation(v14legacy);
        assert.deepEqual(m.scenarios[0].wizard, v14legacy.wizard);
    });

    it('scenarios[0].answers — клон root.answers (не разделённая ссылка)', () => {
        const m = migrateCalculation(v14legacy);
        assert.deepEqual(m.scenarios[0].answers, v14legacy.answers);
        assert.notEqual(m.scenarios[0].answers, m.answers, 'клон, не та же ссылка');
    });

    it('scenarios[0].answersMeta — клон root.answersMeta', () => {
        const m = migrateCalculation(v14legacy);
        assert.deepEqual(m.scenarios[0].answersMeta, v14legacy.answersMeta);
    });

    it('activeScenarioId = scenarios[0].id', () => {
        const m = migrateCalculation(v14legacy);
        assert.equal(m.activeScenarioId, m.scenarios[0].id);
        assert.ok(typeof m.scenarios[0].id === 'string' && m.scenarios[0].id.length > 0);
    });

    it('root.wizard / root.answers / root.answersMeta остаются как mirror', () => {
        const m = migrateCalculation(v14legacy);
        assert.deepEqual(m.wizard, v14legacy.wizard);
        assert.deepEqual(m.answers, v14legacy.answers);
        assert.deepEqual(m.answersMeta, v14legacy.answersMeta);
    });

    it('settings / view / dictionaries не переезжают в scenario (остаются глобальными)', () => {
        /* Изоляция от будущих миграций: проверяем контракт ТОЛЬКО до v15. */
        const m = migrateCalculation(v14legacy, MIGRATIONS_UP_TO_15);
        assert.deepEqual(m.settings, v14legacy.settings);
        assert.deepEqual(m.view, v14legacy.view);
        assert.equal(m.scenarios[0].settings, undefined);
        assert.equal(m.scenarios[0].view, undefined);
    });
});

describe('14→15: пограничные кейсы', () => {
    it('calc без wizard (legacy без 14.U1) → scenarios[0].wizard = null', () => {
        const calc = {
            schemaVersion: 14,
            id: 'no-wizard',
            name: 'Manual',
            answers: { peak_rps: 50 },
            answersMeta: {},
            settings: { provider: 'sbercloud' },
            view: { disabledStands: [] },
            dictionaries: { items: [], questions: [] }
        };
        const m = migrateCalculation(calc);
        assert.equal(m.scenarios[0].wizard, null);
    });

    it('calc с пустым answers → scenarios[0].answers = {}', () => {
        const calc = {
            schemaVersion: 14,
            id: 'empty-answers',
            name: 'Empty',
            wizard: null,
            answers: {},
            answersMeta: {},
            settings: { provider: 'sbercloud' },
            view: { disabledStands: [] },
            dictionaries: { items: [], questions: [] }
        };
        const m = migrateCalculation(calc);
        assert.deepEqual(m.scenarios[0].answers, {});
    });
});

describe('14→15: идемпотентность', () => {
    it('повторная миграция уже-мигрированного calc не дублирует scenarios', () => {
        const calc = {
            schemaVersion: 14,
            id: 'idempotent',
            name: 'Test',
            wizard: null,
            answers: {},
            answersMeta: {},
            settings: { provider: 'sbercloud' },
            view: { disabledStands: [] },
            dictionaries: { items: [], questions: [] }
        };
        const m1 = migrateCalculation(calc);
        const m2 = migrateCalculation(m1);
        assert.equal(m2.scenarios.length, 1, 'после повторного прогона по-прежнему один scenario');
        assert.equal(m2.scenarios[0].id, m1.scenarios[0].id, 'id не пересоздаётся');
        assert.equal(m2.activeScenarioId, m1.activeScenarioId);
    });

    it('calc с scenarios но без activeScenarioId → восстанавливается из scenarios[0].id', () => {
        const calc = {
            schemaVersion: 14,
            id: 'half-migrated',
            scenarios: [{ id: 'pre-existing-id', label: 'Custom', wizard: null, answers: {}, answersMeta: {} }],
            // activeScenarioId намеренно отсутствует
            wizard: null,
            answers: {},
            answersMeta: {},
            settings: { provider: 'sbercloud' },
            view: { disabledStands: [] },
            dictionaries: { items: [], questions: [] }
        };
        const m = migrateCalculation(calc);
        assert.equal(m.activeScenarioId, 'pre-existing-id');
        assert.equal(m.scenarios.length, 1);
    });

    it('calc с scenarios И activeScenarioId совпадающим — не трогаем (true no-op)', () => {
        const calc = {
            schemaVersion: 14,
            id: 'fully-pre-migrated',
            scenarios: [
                { id: 's1', label: 'A', wizard: null, answers: { x: 1 }, answersMeta: {} },
                { id: 's2', label: 'B', wizard: null, answers: { x: 2 }, answersMeta: {} }
            ],
            activeScenarioId: 's2',
            wizard: null,
            answers: { x: 2 },
            answersMeta: {},
            settings: { provider: 'sbercloud' },
            view: { disabledStands: [] },
            dictionaries: { items: [], questions: [] }
        };
        const m = migrateCalculation(calc);
        assert.equal(m.scenarios.length, 2, 'оба scenario сохранены');
        assert.equal(m.activeScenarioId, 's2', 'активный сохранён');
        assert.equal(m.scenarios[0].id, 's1');
        assert.equal(m.scenarios[1].id, 's2');
    });
});

describe('14→15: миграция работает в цепочке (v0 → v15)', () => {
    it('очень старый calc проходит все миграции и получает scenarios', () => {
        const v0 = {
            id: 'ancient',
            name: 'Ancient',
            answers: {},
            settings: { currency: 'RUB' }, // v0 имел currency, который удалит миграция v1→v2
            dictionaries: { items: [], questions: [] }
        };
        const m = migrateCalculation(v0);
        assert.equal(m.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.ok(Array.isArray(m.scenarios) && m.scenarios.length === 1,
            'после полной цепочки миграций получили scenarios[0]');
        assert.equal(m.activeScenarioId, m.scenarios[0].id);
    });
});
