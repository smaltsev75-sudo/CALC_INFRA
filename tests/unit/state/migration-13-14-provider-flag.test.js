/**
 * 14.U4: миграция v13→v14 — добавляем calc.settings.providerSetByWizard.
 *
 * Контракт:
 *   - wizard != null → providerSetByWizard=true (расчёт создан Quick Start'ом,
 *     provider пришёл из мастера автоматически).
 *   - wizard == null → providerSetByWizard=false (legacy/manual; в их время
 *     wizard'а не было, provider был дефолтным).
 *   - Если флаг УЖЕ есть (повторная миграция) — НЕ перезаписываем (идемпотентность).
 *   - calc.settings.provider остаётся из v13 (default 'sbercloud').
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateCalculation, LATEST_SCHEMA_VERSION } from '../../../js/state/migrations.js';

function v13Calc({ wizard, provider = 'sbercloud', providerSetByWizard }) {
    const calc = {
        id: 'test',
        version: '1.0',
        schemaVersion: 13,
        wizard,
        answersMeta: {},
        answers: {},
        settings: { provider }
    };
    if (providerSetByWizard !== undefined) {
        calc.settings.providerSetByWizard = providerSetByWizard;
    }
    return calc;
}

describe('14.U4 migration v13→v14: providerSetByWizard', () => {
    it('wizard-расчёт (wizard !== null) → providerSetByWizard=true', () => {
        const calc = v13Calc({
            wizard: { product_type: 'b2b', industry: 'corporate', scale: 'm',
                      geography: 'ru', pdn: true, activity: 'medium', ai_used: false }
        });
        const m = migrateCalculation(calc);
        assert.equal(m.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.equal(m.settings.providerSetByWizard, true);
        assert.equal(m.settings.provider, 'sbercloud');
    });

    it('legacy-расчёт (wizard === null) → providerSetByWizard=false', () => {
        const calc = v13Calc({ wizard: null });
        const m = migrateCalculation(calc);
        assert.equal(m.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.equal(m.settings.providerSetByWizard, false);
    });

    it('legacy без поля wizard вообще → providerSetByWizard=false (defensive)', () => {
        const calc = {
            id: 'test',
            version: '1.0',
            schemaVersion: 13,
            answers: {},
            settings: { provider: 'sbercloud' }
        };
        const m = migrateCalculation(calc);
        assert.equal(m.schemaVersion, LATEST_SCHEMA_VERSION);
        assert.equal(m.settings.providerSetByWizard, false);
    });

    it('идемпотентность: повторная миграция не перезаписывает явно заданный флаг', () => {
        /* Сценарий: пользователь на v14 поменял провайдера вручную → флаг false.
           При повторной миграции (например, после import'а) флаг должен остаться
           false, даже если wizard != null. */
        const calc = v13Calc({
            wizard: { product_type: 'b2b', industry: 'corporate', scale: 'm',
                      geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
            providerSetByWizard: false
        });
        const m = migrateCalculation(calc);
        assert.equal(m.settings.providerSetByWizard, false,
            'явно заданное false НЕ должно перезаписаться');
    });

    it('provider остаётся прежним (миграция трогает только флаг)', () => {
        const calc = v13Calc({ wizard: null, provider: 'sbercloud' });
        const m = migrateCalculation(calc);
        assert.equal(m.settings.provider, 'sbercloud');
    });
});
