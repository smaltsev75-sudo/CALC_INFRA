/**
 * PATCH 2.18.2 (внешний аудит #9, 2026-05-19, P1):
 * defense-in-depth для deprecated-вопросов.
 *
 * Изолированный шаг миграции (например, 18→19 удаления `mau_growth_rate_percent`)
 * НЕ срабатывает, если incoming snapshot уже на schemaVersion=19 — а stale id
 * там присутствует (ручная правка JSON, импорт corrupted bundle, баг истории).
 * Динамический repro аудитора получил `VISIBLE_STALE_MAU_GROWTH` ровно из такого
 * сценария.
 *
 * Контракт: `migrateCalculation` должен идемпотентно зачистить ЛЮБОЙ id из
 * `DEPRECATED_QUESTION_IDS` независимо от schemaVersion calc'а.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { migrateCalculation, LATEST_SCHEMA_VERSION } from '../../../js/state/migrations.js';
import { DEPRECATED_QUESTION_IDS } from '../../../js/domain/seed.js';

describe('migrateCalculation: sanitize deprecated questions defensive', () => {
    it('удаляет mau_growth_rate_percent из dictionary при schemaVersion=LATEST (миграция 18→19 пропущена)', () => {
        const calc = {
            id: 'c1',
            name: 'Stale snapshot',
            schemaVersion: LATEST_SCHEMA_VERSION,
            settings: {},
            answers: { mau_growth_rate_percent: 25, registered_users_total: 1000 },
            dictionaries: {
                items: [],
                questions: [
                    { id: 'mau_growth_rate_percent', section: 'business', order: 1, type: 'number', title: 'Stale', defaultValue: 10 },
                    { id: 'registered_users_total',  section: 'business', order: 2, type: 'number', title: 'Live',  defaultValue: 1000 }
                ]
            }
        };

        const migrated = migrateCalculation(calc);

        assert.equal(migrated.schemaVersion, LATEST_SCHEMA_VERSION);
        const ids = migrated.dictionaries.questions.map(q => q.id);
        assert.ok(!ids.includes('mau_growth_rate_percent'), 'stale id должен исчезнуть из dictionary');
        assert.ok(ids.includes('registered_users_total'), 'живой вопрос остаётся');
        assert.equal(migrated.answers.mau_growth_rate_percent, undefined, 'stale answer должен исчезнуть');
        assert.equal(migrated.answers.registered_users_total, 1000, 'живой answer сохранён');
    });

    it('удаляет ВСЕ id из DEPRECATED_QUESTION_IDS независимо от schemaVersion', () => {
        const calc = {
            id: 'c2',
            schemaVersion: LATEST_SCHEMA_VERSION,
            settings: {},
            answers: Object.fromEntries(Array.from(DEPRECATED_QUESTION_IDS).map(id => [id, 'stale'])),
            dictionaries: {
                items: [],
                questions: Array.from(DEPRECATED_QUESTION_IDS).map((id, i) => ({
                    id, section: 'business', order: i + 1, type: 'number', title: id, defaultValue: 0
                }))
            }
        };

        const migrated = migrateCalculation(calc);

        for (const deprecatedId of DEPRECATED_QUESTION_IDS) {
            assert.ok(
                !migrated.dictionaries.questions.some(q => q.id === deprecatedId),
                `dictionary не должен содержать ${deprecatedId}`
            );
            assert.equal(
                migrated.answers[deprecatedId], undefined,
                `answers не должен содержать ${deprecatedId}`
            );
        }
    });

    it('идемпотентен: повторный вызов на уже-очищенном calc не меняет результат', () => {
        const calc = {
            id: 'c3',
            schemaVersion: LATEST_SCHEMA_VERSION,
            settings: {},
            answers: { registered_users_total: 500 },
            dictionaries: {
                items: [],
                questions: [
                    { id: 'registered_users_total', section: 'business', order: 1, type: 'number', title: 'L', defaultValue: 1000 }
                ]
            }
        };
        const first = migrateCalculation(calc);
        const second = migrateCalculation(first);
        assert.deepEqual(second, first);
    });

    it('DEPRECATED_QUESTION_IDS — non-empty frozen Set с известными legacy id', () => {
        assert.ok(DEPRECATED_QUESTION_IDS instanceof Set);
        assert.ok(DEPRECATED_QUESTION_IDS.size >= 3,
            'минимум 3 id: dau_target (12.U18), mau_target (12.U19), mau_growth_rate_percent (2.18.0)');
        assert.ok(DEPRECATED_QUESTION_IDS.has('dau_target'));
        assert.ok(DEPRECATED_QUESTION_IDS.has('mau_target'));
        assert.ok(DEPRECATED_QUESTION_IDS.has('mau_growth_rate_percent'));
    });
});
