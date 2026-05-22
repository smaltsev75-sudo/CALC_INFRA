/**
 * Golden scenarios for the calculation engine.
 *
 * These tests intentionally pin exact rounded totals for representative
 * Quick Start profiles. When formulas, prices, VAT, or risk coefficients
 * change intentionally, update these snapshots together with release notes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { wizardToAnswers } from '../../../js/domain/wizardProfiles.js';
import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import { CATEGORY_IDS } from '../../../js/utils/constants.js';

const BASE_CALC_DATE = '2026-05-22T00:00:00Z';

const GOLDEN_SCENARIOS = Object.freeze([
    {
        id: 'internal_xs',
        wizard: { product_type: 'internal', industry: 'corporate', scale: 'xs', geography: 'ru', pdn: false, activity: 'low', ai_used: false },
        expected: {
            totalMonthly: 1_586_432,
            totalAnnual: 19_037_185,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 67_605, LICENSE: 473_635, TRAFFIC: 26_509, SERVICES: 1_018_684, RESERVES: 0, SECURITY: 0, AI: 0 }
        }
    },
    {
        id: 'startup_b2b_s',
        wizard: { product_type: 'b2b', industry: 'corporate', scale: 's', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            totalMonthly: 2_351_826,
            totalAnnual: 28_221_916,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 107_629, LICENSE: 963_447, TRAFFIC: 26_509, SERVICES: 1_147_467, RESERVES: 0, SECURITY: 106_775, AI: 0 }
        }
    },
    {
        id: 'smb_b2b_m',
        wizard: { product_type: 'b2b', industry: 'corporate', scale: 'm', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            totalMonthly: 4_199_205,
            totalAnnual: 50_390_464,
            topCategory: 'LICENSE',
            byCategoryMonthly: { HW: 303_130, LICENSE: 1_846_250, TRAFFIC: 79_526, SERVICES: 1_551_034, RESERVES: 0, SECURITY: 419_265, AI: 0 }
        }
    },
    {
        id: 'edtech_b2c_m_ai',
        wizard: { product_type: 'b2c', industry: 'edtech', scale: 'm', geography: 'ru', pdn: true, activity: 'high', ai_used: true },
        expected: {
            totalMonthly: 30_851_444,
            totalAnnual: 370_217_322,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 850_571, LICENSE: 1_834_844, TRAFFIC: 79_526, SERVICES: 1_964_982, RESERVES: 0, SECURITY: 419_265, AI: 25_702_255 }
        }
    },
    {
        id: 'consumer_b2c_l_ai_global',
        wizard: { product_type: 'b2c', industry: 'consumer', scale: 'l', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            totalMonthly: 123_134_837,
            totalAnnual: 1_477_618_042,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 24_126_448, LICENSE: 5_255_296, TRAFFIC: 331_358, SERVICES: 7_545_377, RESERVES: 0, SECURITY: 859_874, AI: 85_016_483 }
        }
    },
    {
        id: 'fintech_b2b_m',
        wizard: { product_type: 'b2b', industry: 'fintech', scale: 'm', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            totalMonthly: 8_569_571,
            totalAnnual: 102_834_856,
            topCategory: 'LICENSE',
            byCategoryMonthly: { HW: 770_806, LICENSE: 3_923_740, TRAFFIC: 79_526, SERVICES: 2_040_820, RESERVES: 631_981, SECURITY: 1_122_698, AI: 0 }
        }
    },
    {
        id: 'b2g_m_ru_cis',
        wizard: { product_type: 'b2g', industry: 'corporate', scale: 'm', geography: 'ru_cis', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            totalMonthly: 5_657_151,
            totalAnnual: 67_885_814,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 303_130, LICENSE: 1_846_250, TRAFFIC: 79_526, SERVICES: 1_872_291, RESERVES: 631_981, SECURITY: 923_972, AI: 0 }
        }
    },
    {
        id: 'enterprise_b2c_xl_ai_global',
        wizard: { product_type: 'b2c', industry: 'consumer', scale: 'xl', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            totalMonthly: 581_345_565,
            totalAnnual: 6_976_146_779,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 239_312_063, LICENSE: 12_085_596, TRAFFIC: 1_597_147, SERVICES: 32_361_178, RESERVES: 0, SECURITY: 3_507_244, AI: 292_482_337 }
        }
    }
]);

function buildCalcFromWizard(wizard) {
    const dictionaries = buildSeedDictionaries();
    const baseAnswers = defaultAnswersFrom(dictionaries.questions);
    const { answers } = wizardToAnswers(wizard);
    return {
        id: `golden-${wizard.product_type}-${wizard.scale}`,
        name: 'golden scenario',
        version: '1.0',
        schemaVersion: 19,
        createdAt: BASE_CALC_DATE,
        updatedAt: BASE_CALC_DATE,
        settings: { ...SEED_SETTINGS },
        answers: { ...baseAnswers, ...answers },
        dictionaries
    };
}

function roundedByCategory(result) {
    return Object.fromEntries(
        CATEGORY_IDS.map(cat => [cat, Math.round(result.byCategory[cat] || 0)])
    );
}

function topCategory(result) {
    return CATEGORY_IDS
        .map(cat => [cat, result.byCategory[cat] || 0])
        .sort((a, b) => b[1] - a[1])[0][0];
}

describe('golden scenarios: Quick Start расчёты', () => {
    for (const scenario of GOLDEN_SCENARIOS) {
        it(`${scenario.id}: totals and category breakdown match snapshot`, () => {
            clearCalculationCache();
            const result = calculate(buildCalcFromWizard(scenario.wizard));

            assert.equal(Math.round(result.totalMonthly), scenario.expected.totalMonthly);
            assert.equal(Math.round(result.totalAnnual), scenario.expected.totalAnnual);
            assert.equal(topCategory(result), scenario.expected.topCategory);
            assert.deepEqual(roundedByCategory(result), scenario.expected.byCategoryMonthly);
        });
    }
});
