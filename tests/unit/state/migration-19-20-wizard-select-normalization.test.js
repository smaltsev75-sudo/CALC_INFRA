import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateCalculation, LATEST_SCHEMA_VERSION, MIGRATIONS } from '../../../js/state/migrations.js';

const STEP = MIGRATIONS.find(m => m.from === 19 && m.to === 20);

describe('Migration v19 → v20 — Quick Start select-answer normalization', () => {
    it('миграция зарегистрирована последним шагом', () => {
        assert.ok(STEP, 'миграция 19→20 должна существовать');
        assert.equal(LATEST_SCHEMA_VERSION, 20);
        assert.equal(MIGRATIONS[MIGRATIONS.length - 1].to, 20);
    });

    it('нормализует root.answers и scenarios[*].answers к актуальным option ids', () => {
        const calc = {
            id: 'legacy-wizard-selects',
            name: 'Legacy wizard selects',
            version: '1.0',
            schemaVersion: 19,
            settings: {},
            answers: {
                audience_geography: 'ru_cis',
                peak_months: '[8, 9, 12]',
                pdn_category: 3,
                ai_model_tier: 'medium',
                ai_data_sensitivity: 'high'
            },
            scenarios: [
                {
                    id: 's1',
                    label: 'Базовый',
                    wizard: null,
                    answers: {
                        audience_geography: 'ru_cis',
                        peak_months: [8, 9, 12],
                        pdn_category: 2,
                        ai_model_tier: 'large',
                        ai_data_sensitivity: 'medium'
                    },
                    answersMeta: {}
                }
            ],
            activeScenarioId: 's1',
            dictionaries: { items: [], questions: [] }
        };

        const migrated = migrateCalculation(calc);

        assert.equal(migrated.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.equal(migrated.answers.audience_geography, 'cis');
        assert.deepEqual(migrated.answers.peak_months, ['aug', 'sep', 'dec']);
        assert.equal(migrated.answers.pdn_category, '3');
        assert.equal(migrated.answers.ai_model_tier, 'mid');
        assert.equal(migrated.answers.ai_data_sensitivity, 'pdn');
        assert.equal(migrated.scenarios[0].answers.audience_geography, 'cis');
        assert.deepEqual(migrated.scenarios[0].answers.peak_months, ['aug', 'sep', 'dec']);
        assert.equal(migrated.scenarios[0].answers.pdn_category, '2');
        assert.equal(migrated.scenarios[0].answers.ai_model_tier, 'heavy');
        assert.equal(migrated.scenarios[0].answers.ai_data_sensitivity, 'confidential');
    });

    it('не трогает уже корректные значения', () => {
        const calc = {
            id: 'current-wizard-selects',
            name: 'Current wizard selects',
            version: '1.0',
            schemaVersion: 19,
            settings: {},
            answers: {
                pdn_category: 'none',
                ai_model_tier: 'frontier',
                ai_data_sensitivity: 'internal'
            },
            scenarios: [],
            dictionaries: { items: [], questions: [] }
        };

        const migrated = migrateCalculation(calc);

        assert.equal(migrated.answers.pdn_category, 'none');
        assert.equal(migrated.answers.ai_model_tier, 'frontier');
        assert.equal(migrated.answers.ai_data_sensitivity, 'internal');
    });
});
