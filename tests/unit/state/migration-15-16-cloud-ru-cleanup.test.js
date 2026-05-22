/**
 * Sprint 4 Stage 4.5.1: миграция v15→v16 — cloud_ru cleanup.
 *
 * Hot-fix дубля: entry `cloud_ru` (бывший alias на sbercloud) удалён из
 * PROVIDER_OVERLAYS. Расчёты с persisted `settings.provider === 'cloud_ru'`
 * должны быть переписаны на 'sbercloud' (overlay-prices идентичны — alias всегда
 * возвращал SberCloud prices).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateCalculation, LATEST_SCHEMA_VERSION } from '../../../js/state/migrations.js';

describe('Migration v15→v16: cloud_ru → sbercloud cleanup', () => {
    it('Расчёт с settings.provider="cloud_ru" получает provider="sbercloud"', () => {
        const calc = {
            id: 'c1',
            schemaVersion: 15,
            settings: { provider: 'cloud_ru', applyRiskFactors: true, vatEnabled: true },
            scenarios: [{ id: 's1', label: 'Базовый', wizard: null, answers: {}, answersMeta: {} }],
            activeScenarioId: 's1',
            answers: {},
            answersMeta: {},
            wizard: null,
            view: { disabledStands: [] },
            dictionaries: { questions: [], items: [] }
        };
        const migrated = migrateCalculation(calc);
        assert.equal(migrated.settings.provider, 'sbercloud',
            'cloud_ru → sbercloud (overlay-prices идентичны, поведение не меняется).');
        assert.equal(migrated.schemaVersion, LATEST_SCHEMA_VERSION,
            'schemaVersion обновлён до 16+.');
    });

    it('Расчёт с settings.provider="sbercloud" не трогается', () => {
        const calc = {
            id: 'c2',
            schemaVersion: 15,
            settings: { provider: 'sbercloud', applyRiskFactors: true, vatEnabled: true },
            scenarios: [{ id: 's1', label: 'Базовый', wizard: null, answers: {}, answersMeta: {} }],
            activeScenarioId: 's1',
            answers: {},
            answersMeta: {},
            wizard: null,
            view: { disabledStands: [] },
            dictionaries: { questions: [], items: [] }
        };
        const migrated = migrateCalculation(calc);
        assert.equal(migrated.settings.provider, 'sbercloud',
            'sbercloud остаётся sbercloud.');
    });

    it('Расчёт с settings.provider="yandex" не трогается', () => {
        const calc = {
            id: 'c3',
            schemaVersion: 15,
            settings: { provider: 'yandex', applyRiskFactors: true, vatEnabled: true },
            scenarios: [{ id: 's1', label: 'Базовый', wizard: null, answers: {}, answersMeta: {} }],
            activeScenarioId: 's1',
            answers: {},
            answersMeta: {},
            wizard: null,
            view: { disabledStands: [] },
            dictionaries: { questions: [], items: [] }
        };
        const migrated = migrateCalculation(calc);
        assert.equal(migrated.settings.provider, 'yandex',
            'Другие провайдеры (yandex) миграцией не затрагиваются.');
    });

    it('Расчёт без settings.provider не падает', () => {
        const calc = {
            id: 'c4',
            schemaVersion: 15,
            settings: {},
            scenarios: [{ id: 's1', label: 'Базовый', wizard: null, answers: {}, answersMeta: {} }],
            activeScenarioId: 's1',
            answers: {},
            answersMeta: {},
            wizard: null,
            view: { disabledStands: [] },
            dictionaries: { questions: [], items: [] }
        };
        const migrated = migrateCalculation(calc);
        // settings.provider может быть undefined после v15→v16 — миграция
        // только переписывает явный 'cloud_ru', не создаёт новое поле.
        assert.notEqual(migrated.settings.provider, 'cloud_ru',
            'cloud_ru не должен появиться откуда-то.');
    });

    it('Идемпотентность: повторная миграция не меняет ничего', () => {
        const calc = {
            id: 'c5',
            schemaVersion: 15,
            settings: { provider: 'cloud_ru' },
            scenarios: [{ id: 's1', label: 'Базовый', wizard: null, answers: {}, answersMeta: {} }],
            activeScenarioId: 's1',
            answers: {},
            answersMeta: {},
            wizard: null,
            view: { disabledStands: [] },
            dictionaries: { questions: [], items: [] }
        };
        const m1 = migrateCalculation(calc);
        const m2 = migrateCalculation(m1);
        assert.equal(m2.settings.provider, 'sbercloud');
        assert.equal(m1.schemaVersion, m2.schemaVersion);
    });
});
