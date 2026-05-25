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
            totalMonthly: 1_581_696,
            totalAnnual: 18_980_351,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 62_870, LICENSE: 473_635, TRAFFIC: 26_507, SERVICES: 1_018_684, RESERVES: 0, SECURITY: 0, AI: 0 }
        }
    },
    {
        id: 'startup_b2b_s',
        wizard: { product_type: 'b2b', industry: 'corporate', scale: 's', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            totalMonthly: 2_353_716,
            totalAnnual: 28_244_597,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 102_893, LICENSE: 963_447, TRAFFIC: 33_134, SERVICES: 1_147_467, RESERVES: 0, SECURITY: 106_775, AI: 0 }
        }
    },
    {
        id: 'smb_b2b_m',
        wizard: { product_type: 'b2b', industry: 'corporate', scale: 'm', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            totalMonthly: 4_271_938,
            totalAnnual: 51_263_260,
            topCategory: 'LICENSE',
            byCategoryMonthly: { HW: 290_935, LICENSE: 1_846_250, TRAFFIC: 106_029, SERVICES: 1_551_038, RESERVES: 0, SECURITY: 477_686, AI: 0 }
        }
    },
    {
        id: 'edtech_b2c_m_ai',
        wizard: { product_type: 'b2c', industry: 'edtech', scale: 'm', geography: 'ru', pdn: true, activity: 'high', ai_used: true },
        expected: {
            totalMonthly: 30_941_749,
            totalAnnual: 371_300_992,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 759_474, LICENSE: 1_834_844, TRAFFIC: 205_431, SERVICES: 1_964_986, RESERVES: 0, SECURITY: 477_686, AI: 25_699_328 }
        }
    },
    {
        id: 'consumer_b2c_l_ai_global',
        wizard: { product_type: 'b2c', industry: 'consumer', scale: 'l', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            totalMonthly: 117_942_835,
            totalAnnual: 1_415_314_015,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 20_930_391, LICENSE: 5_255_296, TRAFFIC: 9_244_399, SERVICES: 7_545_381, RESERVES: 0, SECURITY: 918_295, AI: 74_049_073 }
        }
    },
    {
        id: 'fintech_b2b_m',
        wizard: { product_type: 'b2b', industry: 'fintech', scale: 'm', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            totalMonthly: 8_544_618,
            totalAnnual: 102_535_412,
            topCategory: 'LICENSE',
            byCategoryMonthly: { HW: 680_805, LICENSE: 3_923_740, TRAFFIC: 86_149, SERVICES: 2_040_824, RESERVES: 631_981, SECURITY: 1_181_120, AI: 0 }
        }
    },
    {
        id: 'b2g_m_ru_cis',
        wizard: { product_type: 'b2g', industry: 'corporate', scale: 'm', geography: 'ru_cis', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            totalMonthly: 5_782_899,
            totalAnnual: 69_394_784,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 290_935, LICENSE: 1_846_250, TRAFFIC: 159_043, SERVICES: 1_872_295, RESERVES: 631_981, SECURITY: 982_394, AI: 0 }
        }
    },
    {
        id: 'enterprise_b2c_xl_ai_global',
        wizard: { product_type: 'b2c', industry: 'consumer', scale: 'xl', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            totalMonthly: 539_202_122,
            totalAnnual: 6_470_425_463,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 207_402_031, LICENSE: 12_085_596, TRAFFIC: 46_221_993, SERVICES: 32_361_182, RESERVES: 0, SECURITY: 3_565_665, AI: 237_565_655 }
        }
    },
    {
        id: 'regulated_b2g_fintech_xl_ai_global',
        wizard: { product_type: 'b2g', industry: 'fintech', scale: 'xl', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            totalMonthly: 284_212_112,
            totalAnnual: 3_410_545_340,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 40_281_242, LICENSE: 16_984_903, TRAFFIC: 6_474_392, SERVICES: 112_523_803, RESERVES: 631_981, SECURITY: 4_535_651, AI: 102_780_138 }
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
