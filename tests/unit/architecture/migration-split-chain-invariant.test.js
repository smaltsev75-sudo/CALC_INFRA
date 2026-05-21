/**
 * Migration invariant: a calculation migrated in two phases must end up
 * identical to the same calculation migrated through the full chain at once.
 *
 * This protects legacy-value conversions from early cleanup steps. Regression
 * example: partial migration to v1 used to run deprecated-question sanitize,
 * deleting `dau_target` before v3→v4 could convert it to DAU share.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateCalculation, MIGRATIONS } from '../../../js/state/migrations.js';
import { getVatRateForDate } from '../../../js/domain/vatRateTable.js';

const clone = value => JSON.parse(JSON.stringify(value));
const VAT_RATE_2025 = getVatRateForDate('2025-01-01');

function legacyCalc() {
    return {
        id: 'split-chain',
        name: 'Split chain',
        schemaVersion: 0,
        createdAt: '2025-06-01T00:00:00Z',
        updatedAt: '2025-06-01T00:00:00Z',
        wizard: null,
        activeScenarioId: 'scenario-existing',
        scenarios: [{
            id: 'scenario-existing',
            label: 'Legacy',
            wizard: null,
            answers: {},
            answersMeta: {}
        }],
        settings: {
            period: 'monthly',
            bufferTask: 0.3,
            bufferProject: 0.15,
            indexation: 0.10,
            currency: 'USD',
            phaseDurationMonths: 6,
            standSizeRatio: { DEV: 0.3, IFT: 0.4, PSI: 0.5, PROD: 0.95, LOAD: 1.5 },
            resourceRatio: { LOAD: { CPU: 1.5, RAM: 0.1 }, PROD: { CPU: 0.8 } },
            aiStandFactor: { DEV: 0, IFT: 0.2, PSI: 0.5, PROD: 0.5, LOAD: 1 },
            provider: 'cloud_ru',
            vatRate: VAT_RATE_2025
        },
        answers: {
            phase_duration_months: 9,
            registered_users_total: 500,
            dau_target: 100,
            mau_target: 300,
            ai_agent_mode: true,
            agent_tool_use_share: null,
            agent_tool_avg_seconds: null,
            agent_complexity: null,
            ai_agent_type: null,
            agent_parallel_specialists: null,
            mau_growth_rate_percent: 12
        },
        answersMeta: {},
        dictionaries: {
            items: [
                {
                    id: 'res-project-risk',
                    name: 'Project risk',
                    unit: 'шт',
                    pricePerUnit: 1,
                    category: 'RESERVES',
                    tariff: 'monthly',
                    applicableStands: ['PROD'],
                    qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1', LOAD: '' }
                },
                {
                    id: 'license-os-per-node',
                    name: 'Лицензия ОС (на узел)',
                    unit: 'шт',
                    pricePerUnit: 100,
                    category: 'LICENSE',
                    tariff: 'annual',
                    priceSource: 'cloud.ru/2026-Q3',
                    applicableStands: ['PROD'],
                    qtyFormulas: { DEV: '', IFT: '', PSI: '', PROD: '1', LOAD: '' }
                }
            ],
            questions: [
                { id: 'dau_target', label: 'DAU' },
                { id: 'mau_target', label: 'MAU' },
                { id: 'mau_growth_rate_percent', label: 'MAU growth' }
            ]
        }
    };
}

test('migration split-chain invariant: partial then resume equals full-chain', () => {
    const legacy = legacyCalc();
    const full = migrateCalculation(clone(legacy));

    for (const stop of MIGRATIONS.slice(0, -1)) {
        const partialMigrations = MIGRATIONS.filter(step => step.to <= stop.to);
        const partial = migrateCalculation(clone(legacy), partialMigrations);
        const split = migrateCalculation(partial);

        assert.deepEqual(split, full, `split at schema v${stop.to} must equal full-chain migration`);
    }
});
