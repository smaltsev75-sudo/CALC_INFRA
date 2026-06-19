/**
 * Package 9B hardening: persisted/corrupt current-schema calculations can
 * bypass UI/import validation and reach calculate() with aiStandFactor > 1.
 * The user-facing paths already reject this; migration clamps legacy/current
 * saved values defensively.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateCalculation, LATEST_SCHEMA_VERSION, MIGRATIONS } from '../../../js/state/migrations.js';
import { DEFAULT_AI_STAND_FACTOR } from '../../../js/utils/constants.js';

const step = MIGRATIONS.find(m => m.from === 22 && m.to === 23);

function calcWithAiStandFactor(aiStandFactor) {
    return {
        id: 'ai-stand-factor-corrupt',
        name: 'AI stand factor corrupt',
        schemaVersion: 22,
        settings: { aiStandFactor },
        answers: {},
        answersMeta: {},
        dictionaries: { items: [], questions: [] }
    };
}

describe('Migration v22 → v23: aiStandFactor clamp defense-in-depth', () => {
    it('registers the migration and bumps latest schema', () => {
        assert.ok(step, 'migration from 22 to 23 must exist');
        assert.ok(LATEST_SCHEMA_VERSION >= 23, `latest schema must be >=23, got ${LATEST_SCHEMA_VERSION}`);
    });

    it('clamps non-PROD aiStandFactor values into 0..1 and locks PROD to 1', () => {
        const migrated = migrateCalculation(calcWithAiStandFactor({
            DEV: -0.25,
            IFT: 0.2,
            PSI: 1.2,
            PROD: 0.4,
            LOAD: 1.5
        }));

        assert.equal(migrated.settings.aiStandFactor.DEV, 0);
        assert.equal(migrated.settings.aiStandFactor.IFT, 0.2);
        assert.equal(migrated.settings.aiStandFactor.PSI, 1);
        assert.equal(migrated.settings.aiStandFactor.PROD, 1);
        assert.equal(migrated.settings.aiStandFactor.LOAD, 1);
    });

    it('fills missing or non-numeric stand values from defaults', () => {
        const migrated = migrateCalculation(calcWithAiStandFactor({
            DEV: 0.05,
            IFT: 'bad',
            PROD: 1
        }));

        assert.equal(migrated.settings.aiStandFactor.DEV, 0.05);
        assert.equal(migrated.settings.aiStandFactor.IFT, DEFAULT_AI_STAND_FACTOR.IFT);
        assert.equal(migrated.settings.aiStandFactor.PSI, DEFAULT_AI_STAND_FACTOR.PSI);
        assert.equal(migrated.settings.aiStandFactor.LOAD, DEFAULT_AI_STAND_FACTOR.LOAD);
        assert.equal(migrated.settings.aiStandFactor.PROD, 1);
    });

    it('is idempotent', () => {
        const once = migrateCalculation(calcWithAiStandFactor({
            DEV: -1,
            IFT: 2,
            PSI: 0.5,
            PROD: 0,
            LOAD: 3
        }));
        const twice = migrateCalculation(once);
        assert.deepEqual(twice, once);
    });
});
