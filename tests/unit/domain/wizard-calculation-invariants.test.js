/**
 * Calculation invariants across the full Quick Start matrix.
 *
 * wizard-profiles.test.js proves that wizardToAnswers() produces valid answers.
 * This file goes one layer deeper: every valid Quick Start combination must also
 * be calculable end-to-end without numeric anomalies or aggregate drift.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import {
    INDUSTRY_PROFILES,
    PRODUCT_TYPE_OVERRIDES,
    wizardToAnswers
} from '../../../js/domain/wizardProfiles.js';
import {
    CATEGORY_IDS,
    COST_TYPE_IDS,
    DEFAULT_DAYS_PER_MONTH,
    MONTHS_PER_YEAR,
    STAND_IDS
} from '../../../js/utils/constants.js';

const EPS = 0.01;
const CALC_CREATED_AT = '2026-05-22T00:00:00Z';
const SCALES = Object.freeze(['xs', 's', 'm', 'l', 'xl']);
const GEOGRAPHIES = Object.freeze(['ru', 'ru_cis', 'global']);
const ACTIVITIES = Object.freeze(['low', 'medium', 'high']);
const PRODUCT_TYPES = Object.keys(PRODUCT_TYPE_OVERRIDES);
const INDUSTRIES = Object.keys(INDUSTRY_PROFILES);

const dictionaries = buildSeedDictionaries();
const baseAnswers = defaultAnswersFrom(dictionaries.questions);
const resultCache = new Map();

function scenarioKey(wizard) {
    return [
        wizard.product_type,
        wizard.industry,
        wizard.scale,
        wizard.geography,
        wizard.pdn ? 'pdn' : 'no-pdn',
        wizard.activity,
        wizard.ai_used ? 'ai' : 'no-ai'
    ].join('|');
}

function allWizardScenarios() {
    const scenarios = [];
    for (const product_type of PRODUCT_TYPES) {
        for (const industry of INDUSTRIES) {
            for (const scale of SCALES) {
                for (const geography of GEOGRAPHIES) {
                    for (const pdn of [false, true]) {
                        for (const activity of ACTIVITIES) {
                            for (const ai_used of [false, true]) {
                                scenarios.push({ product_type, industry, scale, geography, pdn, activity, ai_used });
                            }
                        }
                    }
                }
            }
        }
    }
    return scenarios;
}

function close(actual, expected, message, eps = EPS) {
    assert.ok(Math.abs(actual - expected) <= eps,
        `${message}: expected ${expected}, got ${actual}, delta=${Math.abs(actual - expected)}`);
}

function sum(values) {
    return values.reduce((acc, value) => acc + value, 0);
}

function assertFiniteNonNegative(value, label) {
    assert.equal(Number.isFinite(value), true, `${label} must be finite`);
    assert.ok(value >= 0, `${label} must be non-negative, got ${value}`);
}

function calculateWizardScenario(wizard) {
    const key = scenarioKey(wizard);
    if (resultCache.has(key)) return resultCache.get(key);

    const { answers } = wizardToAnswers(wizard);
    clearCalculationCache();
    const result = calculate({
        id: `wizard-invariant-${key}`,
        name: `wizard invariant ${key}`,
        version: '1.0',
        schemaVersion: 20,
        createdAt: CALC_CREATED_AT,
        updatedAt: CALC_CREATED_AT,
        settings: { ...SEED_SETTINGS },
        answers: { ...baseAnswers, ...answers },
        dictionaries
    });
    resultCache.set(key, result);
    return result;
}

function assertResultInvariants(result, label) {
    const days = Number(SEED_SETTINGS.daysPerMonth) || DEFAULT_DAYS_PER_MONTH;

    assertFiniteNonNegative(result.totalMonthly, `${label}.totalMonthly`);
    close(result.totalAnnual, result.totalMonthly * MONTHS_PER_YEAR, `${label}.totalAnnual`);
    close(result.totalDaily, result.totalMonthly / days, `${label}.totalDaily`);
    close(result.totalMonthly, sum(STAND_IDS.map(sid => result.stands[sid].totalMonthly)), `${label}.sum(stands)`);
    close(result.totalMonthly, sum(CATEGORY_IDS.map(cat => result.byCategory[cat] || 0)), `${label}.sum(categories)`);
    close(result.totalMonthly, sum(COST_TYPE_IDS.map(type => result.byCostType[type] || 0)), `${label}.sum(cost types)`);
    close(result.totalMonthly, sum(Object.values(result.byBillingInterval || {})), `${label}.sum(billing intervals)`);

    for (const stand of STAND_IDS) {
        const bucket = result.stands[stand];
        assertFiniteNonNegative(bucket.totalMonthly, `${label}.${stand}.totalMonthly`);
        close(bucket.totalAnnual, bucket.totalMonthly * MONTHS_PER_YEAR, `${label}.${stand}.totalAnnual`);
        close(bucket.totalMonthly, sum(bucket.items.map(cell => cell.costFinal)), `${label}.${stand}.sum(items)`);
        close(bucket.totalMonthly, sum(CATEGORY_IDS.map(cat => bucket.byCategory[cat] || 0)), `${label}.${stand}.sum(categories)`);
        close(bucket.totalMonthly, sum(COST_TYPE_IDS.map(type => bucket.byCostType[type] || 0)), `${label}.${stand}.sum(cost types)`);

        for (const cell of bucket.items) {
            assert.equal(cell.error, null, `${label}.${stand}.${cell.itemId} formula error`);
            assertFiniteNonNegative(cell.qty, `${label}.${stand}.${cell.itemId}.qty`);
            assertFiniteNonNegative(cell.costBase, `${label}.${stand}.${cell.itemId}.costBase`);
            assertFiniteNonNegative(cell.costFinal, `${label}.${stand}.${cell.itemId}.costFinal`);
            assert.ok(cell.riskBreakdown && Number.isFinite(cell.riskBreakdown.total),
                `${label}.${stand}.${cell.itemId}.riskBreakdown.total must be finite`);
            assert.ok(cell.riskBreakdown.total > 0,
                `${label}.${stand}.${cell.itemId}.riskBreakdown.total must be positive`);
        }
    }

    for (const [itemId, item] of Object.entries(result.items)) {
        close(item.totalMonthly, sum(STAND_IDS.map(stand => item.stands[stand].costFinal)),
            `${label}.${itemId}.totalMonthly = sum(stands)`);
        close(item.totalAnnual, item.totalMonthly * MONTHS_PER_YEAR,
            `${label}.${itemId}.totalAnnual`);
    }
}

describe('wizard calculation invariants: full Quick Start matrix', () => {
    const scenarios = allWizardScenarios();

    it('all 2880 wizard combinations calculate without numeric anomalies or aggregate drift', () => {
        assert.equal(scenarios.length, 2880);
        for (const wizard of scenarios) {
            assertResultInvariants(calculateWizardScenario(wizard), scenarioKey(wizard));
        }
    });

    it('scale growth is monotonic inside every fixed wizard context', () => {
        for (const product_type of PRODUCT_TYPES) {
            for (const industry of INDUSTRIES) {
                for (const geography of GEOGRAPHIES) {
                    for (const pdn of [false, true]) {
                        for (const activity of ACTIVITIES) {
                            for (const ai_used of [false, true]) {
                                let previous = -Infinity;
                                for (const scale of SCALES) {
                                    const total = calculateWizardScenario({
                                        product_type, industry, scale, geography, pdn, activity, ai_used
                                    }).totalMonthly;
                                    assert.ok(total + EPS >= previous,
                                        `scale totals must be monotonic for ${product_type}|${industry}|${geography}|pdn=${pdn}|${activity}|ai=${ai_used}`);
                                    previous = total;
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    it('AI-enabled profile is never cheaper than the same profile without AI', () => {
        for (const product_type of PRODUCT_TYPES) {
            for (const industry of INDUSTRIES) {
                for (const scale of SCALES) {
                    for (const geography of GEOGRAPHIES) {
                        for (const pdn of [false, true]) {
                            for (const activity of ACTIVITIES) {
                                const base = calculateWizardScenario({
                                    product_type, industry, scale, geography, pdn, activity, ai_used: false
                                }).totalMonthly;
                                const withAi = calculateWizardScenario({
                                    product_type, industry, scale, geography, pdn, activity, ai_used: true
                                }).totalMonthly;
                                assert.ok(withAi + EPS >= base,
                                    `AI profile must not reduce cost for ${product_type}|${industry}|${scale}|${geography}|pdn=${pdn}|${activity}`);
                            }
                        }
                    }
                }
            }
        }
    });

    it('wider geography is never cheaper than narrower geography', () => {
        for (const product_type of PRODUCT_TYPES) {
            for (const industry of INDUSTRIES) {
                for (const scale of SCALES) {
                    for (const pdn of [false, true]) {
                        for (const activity of ACTIVITIES) {
                            for (const ai_used of [false, true]) {
                                const ru = calculateWizardScenario({
                                    product_type, industry, scale, geography: 'ru', pdn, activity, ai_used
                                }).totalMonthly;
                                const ruCis = calculateWizardScenario({
                                    product_type, industry, scale, geography: 'ru_cis', pdn, activity, ai_used
                                }).totalMonthly;
                                const global = calculateWizardScenario({
                                    product_type, industry, scale, geography: 'global', pdn, activity, ai_used
                                }).totalMonthly;
                                assert.ok(ruCis + EPS >= ru,
                                    `ru_cis must not be cheaper than ru for ${product_type}|${industry}|${scale}|pdn=${pdn}|${activity}|ai=${ai_used}`);
                                assert.ok(global + EPS >= ruCis,
                                    `global must not be cheaper than ru_cis for ${product_type}|${industry}|${scale}|pdn=${pdn}|${activity}|ai=${ai_used}`);
                            }
                        }
                    }
                }
            }
        }
    });
});
