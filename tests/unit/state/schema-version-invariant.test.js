/**
 * Regression-тест к 12.U31 (Code Review Followup, Subagent B P2-7):
 * `CURRENT_SCHEMA_VERSION` (literal в constants.js) и `LATEST_SCHEMA_VERSION`
 * (computed из массива MIGRATIONS) обязаны совпадать.
 *
 * Иначе при добавлении следующей миграции (7→8) разработчик может забыть bump
 * literal в constants.js. Тогда `persistence.setSchemaVersion(CURRENT=7)` будет
 * считать legacy v7 актуальной версией и не запустит свежие миграции на boot.
 * Поломка проявится только в production через downgrade-защиту (Этап 11.3.2).
 *
 * Также инвариант: миграции идут строго from=N → to=N+1 без gap'ов от 0 до LATEST.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from '../../../js/state/migrations.js';
import { CURRENT_SCHEMA_VERSION } from '../../../js/utils/constants.js';

describe('Schema version: CURRENT === LATEST (один источник истины)', () => {
    it('CURRENT_SCHEMA_VERSION (constants) === LATEST_SCHEMA_VERSION (migrations)', () => {
        assert.equal(CURRENT_SCHEMA_VERSION, LATEST_SCHEMA_VERSION,
            `CURRENT_SCHEMA_VERSION=${CURRENT_SCHEMA_VERSION} ≠ ` +
            `LATEST_SCHEMA_VERSION=${LATEST_SCHEMA_VERSION}. ` +
            'Bump literal в constants.js должен идти параллельно с добавлением миграции.');
    });

    it('MIGRATIONS строго N → N+1 от 0 до LATEST без пропусков', () => {
        for (let i = 0; i < MIGRATIONS.length; i++) {
            const step = MIGRATIONS[i];
            assert.equal(step.from, i,
                `MIGRATIONS[${i}].from должно быть ${i}, фактически ${step.from}`);
            assert.equal(step.to, i + 1,
                `MIGRATIONS[${i}].to должно быть ${i + 1}, фактически ${step.to}`);
        }
        assert.equal(LATEST_SCHEMA_VERSION, MIGRATIONS.length,
            'LATEST = последний step.to = MIGRATIONS.length');
    });
});
