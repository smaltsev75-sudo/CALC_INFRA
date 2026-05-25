import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from '../../../js/domain/calculator.js';
import { evaluateCalculationHealth } from '../../../js/domain/calculationHealth.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import {
    ACTIVITY_LABELS,
    GEOGRAPHY_LABELS,
    INDUSTRY_PROFILES,
    SCALE_RULES
} from '../../../js/domain/wizardProfileData.js';
import { wizardToAnswers } from '../../../js/domain/wizardProfiles.js';
import { STAND_IDS } from '../../../js/utils/constants.js';

const PRODUCT_TYPES = ['internal', 'b2b', 'b2c', 'b2g'];
const CORE_RESOURCES = ['CPU', 'RAM', 'SSD'];

function aggregateByResource(calc, result, resource) {
    const ids = calc.dictionaries.items
        .filter(item => item.dashboardResource === resource)
        .map(item => item.id);
    const out = {};
    for (const stand of STAND_IDS) {
        out[stand] = ids.reduce((sum, id) =>
            sum + (Number(result.items[id]?.stands?.[stand]?.qty) || 0), 0);
    }
    return out;
}

describe('Quick Start calculation contract', () => {
    it('все Quick Start-комбинации дают финитный расчёт без health error и базовых провалов CPU/RAM/SSD', () => {
        const dictionaries = buildSeedDictionaries();
        let checked = 0;

        for (const product_type of PRODUCT_TYPES) {
            for (const industry of Object.keys(INDUSTRY_PROFILES)) {
                for (const scale of Object.keys(SCALE_RULES)) {
                    for (const geography of Object.keys(GEOGRAPHY_LABELS)) {
                        for (const activity of Object.keys(ACTIVITY_LABELS)) {
                            for (const pdn of [false, true]) {
                                for (const ai_used of [false, true]) {
                                    const wizard = wizardToAnswers({
                                        product_type,
                                        industry,
                                        scale,
                                        geography,
                                        pdn,
                                        activity,
                                        ai_used
                                    });
                                    const calc = {
                                        id: `quickstart-${checked}`,
                                        name: 'Quick Start invariant',
                                        schemaVersion: 12,
                                        createdAt: '2026-05-25T00:00:00.000Z',
                                        updatedAt: '2026-05-25T00:00:00.000Z',
                                        settings: structuredClone(SEED_SETTINGS),
                                        answers: {
                                            ...defaultAnswersFrom(dictionaries.questions),
                                            ...wizard.answers,
                                            target_capex_rub: 1
                                        },
                                        answersMeta: wizard.answersMeta,
                                        dictionaries,
                                        view: {}
                                    };

                                    const result = calculate(calc);
                                    const health = evaluateCalculationHealth(calc);
                                    const errors = health.findings.filter(f => f.severity === 'error');

                                    assert.equal(errors.length, 0,
                                        `Quick Start health errors for ${JSON.stringify({ product_type, industry, scale, geography, activity, pdn, ai_used })}: ${errors.map(e => e.id).join(', ')}`);
                                    assert.ok(Number.isFinite(result.totalMonthly), 'totalMonthly должен быть финитным');
                                    assert.ok(result.totalMonthly >= 0, 'totalMonthly не должен быть отрицательным');

                                    for (const item of dictionaries.items) {
                                        for (const stand of item.applicableStands || []) {
                                            const cell = result.items[item.id]?.stands?.[stand];
                                            assert.ok(cell, `${item.id}/${stand}: нет ячейки результата`);
                                            assert.equal(cell.error, null, `${item.id}/${stand}: ${cell.error}`);
                                            assert.ok(Number.isFinite(cell.qty), `${item.id}/${stand}: qty не финитный`);
                                            assert.ok(cell.qty >= 0, `${item.id}/${stand}: qty отрицательный`);
                                        }
                                    }

                                    for (const resource of CORE_RESOURCES) {
                                        const qty = aggregateByResource(calc, result, resource);
                                        for (const stand of STAND_IDS) {
                                            assert.ok(qty[stand] > 0,
                                                `${resource}/${stand} должен быть > 0 для ${JSON.stringify({ product_type, industry, scale, geography, activity, pdn, ai_used })}`);
                                        }
                                    }

                                    checked++;
                                }
                            }
                        }
                    }
                }
            }
        }

        assert.equal(checked, 3840);
    });
});
