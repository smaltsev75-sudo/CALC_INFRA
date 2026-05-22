/**
 * Migration v18 → v19 (MINOR 2.18.0, 2026-05-19): удаление dead-вопроса
 * `mau_growth_rate_percent`.
 *
 * Контекст: вопрос был добавлен как «perspective-input для будущей фичи
 * прогноза бюджета на год N+1» (см. миграцию 12.U19 v4→v5 — удаление родственного
 * mau_target по тем же причинам, и комментарий в seed.js: «Поле НЕ участвует
 * в текущем расчёте OPEX»). Фича прогноза за 12+ месяцев не появилась, а поле
 * продолжало занимать место в Опроснике, спрашиваться в Quick Start и засеивать
 * 30%/15%/5% значения в wizardProfiles и templates — без влияния на цифры. Поле
 * также прямо предупреждало пользователя «это поле сейчас НЕ участвует в
 * расчёте текущего OPEX» — что разрушительно для доверия к инструменту.
 *
 * Симметрично 12.U19: миграция удаляет поле из calc.answers И из
 * calc.dictionaries.questions (для legacy-расчётов с сохранённым snapshot
 * вопросов).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateCalculation, LATEST_SCHEMA_VERSION } from '../../../js/state/migrations.js';

describe('Migration v18 → v19 — удаление mau_growth_rate_percent', () => {
    it('шаг 18→19 сохраняется в цепочке миграций', () => {
        assert.ok(LATEST_SCHEMA_VERSION >= 19,
            'после добавления шага 18→19 LATEST должна быть не ниже 19');
    });

    it('answers.mau_growth_rate_percent удаляется', () => {
        const calc = {
            schemaVersion: 18,
            answers: { mau_growth_rate_percent: 30, users_total: 1000 },
            settings: {},
            dictionaries: { items: [], questions: [] }
        };
        const result = migrateCalculation(calc);
        assert.equal(result.schemaVersion, LATEST_SCHEMA_VERSION, 'schemaVersion обновлена');
        assert.equal(result.answers.mau_growth_rate_percent, undefined,
            'поле должно быть удалено');
        assert.equal(result.answers.users_total, 1000,
            'другие ответы должны остаться нетронутыми');
    });

    it('dictionaries.questions: вопрос с id=mau_growth_rate_percent отфильтрован', () => {
        const calc = {
            schemaVersion: 18,
            answers: {},
            settings: {},
            dictionaries: {
                items: [],
                questions: [
                    { id: 'mau_growth_rate_percent', title: 'Прогноз роста' },
                    { id: 'users_total', title: 'Всего пользователей' },
                    { id: 'peak_rps', title: 'Пиковая нагрузка' }
                ]
            }
        };
        const result = migrateCalculation(calc);
        const ids = result.dictionaries.questions.map(q => q.id);
        assert.deepEqual(ids, ['users_total', 'peak_rps'],
            'mau_growth_rate_percent должен исчезнуть из snapshot, остальные сохраняются');
    });

    it('идемпотентность: если поля нет в answers — миграция не падает', () => {
        const calc = {
            schemaVersion: 18,
            answers: { users_total: 500 },
            settings: {},
            dictionaries: { items: [], questions: [] }
        };
        const result = migrateCalculation(calc);
        assert.equal(result.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.equal(result.answers.users_total, 500);
    });

    it('идемпотентность: повторный запуск migrate на уже мигрированном — no-op', () => {
        const calc = {
            schemaVersion: 18,
            answers: { mau_growth_rate_percent: 50, dau_share_of_registered_percent: 20 },
            settings: {},
            dictionaries: { items: [], questions: [{ id: 'mau_growth_rate_percent' }] }
        };
        const once = migrateCalculation(calc);
        const twice = migrateCalculation(once);
        assert.equal(twice.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.equal(twice.answers.mau_growth_rate_percent, undefined);
        assert.equal(twice.answers.dau_share_of_registered_percent, 20);
        assert.equal(twice.dictionaries.questions.length, 0);
    });

    it('legacy v17 проходит ВСЮ цепочку 17→18→19', () => {
        const calc = {
            schemaVersion: 17,
            answers: { mau_growth_rate_percent: 80 },
            settings: {},
            dictionaries: {
                items: [{ id: 'cpu-vcpu-shared', priceSource: 'cloud.ru/2026-Q3' }],
                questions: [{ id: 'mau_growth_rate_percent' }]
            }
        };
        const result = migrateCalculation(calc);
        assert.equal(result.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.equal(result.answers.mau_growth_rate_percent, undefined,
            'v18→v19 удалил поле');
        assert.equal(result.dictionaries.items[0].priceSource, 'provider',
            'v17→v18 нормализовал priceSource');
        assert.equal(result.dictionaries.items[0].priceSourceRef, 'cloud.ru/2026-Q3',
            'оригинальный source сохранён в priceSourceRef');
    });

    it('dictionaries отсутствует (defensive) — миграция не падает', () => {
        const calc = {
            schemaVersion: 18,
            answers: { mau_growth_rate_percent: 30 },
            settings: {}
            // dictionaries намеренно отсутствует
        };
        const result = migrateCalculation(calc);
        assert.equal(result.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.equal(result.answers.mau_growth_rate_percent, undefined);
    });
});
