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
            totalMonthly: 2_007_426,
            totalAnnual: 24_089_113,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 67_279, LICENSE: 473_635, TRAFFIC: 26_507, SERVICES: 1_440_005, RESERVES: 0, SECURITY: 0, AI: 0 }
        }
    },
    {
        id: 'startup_b2b_s',
        wizard: { product_type: 'b2b', industry: 'corporate', scale: 's', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            totalMonthly: 2_885_514,
            totalAnnual: 34_626_165,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 108_040, LICENSE: 963_447, TRAFFIC: 33_134, SERVICES: 1_568_788, RESERVES: 0, SECURITY: 212_105, AI: 0 }
        }
    },
    {
        id: 'smb_b2b_m',
        wizard: { product_type: 'b2b', industry: 'corporate', scale: 'm', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            totalMonthly: 5_074_463,
            totalAnnual: 60_893_551,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 306_473, LICENSE: 1_846_250, TRAFFIC: 106_029, SERVICES: 2_198_819, RESERVES: 0, SECURITY: 616_891, AI: 0 }
        }
    },
    {
        id: 'edtech_b2c_m_ai',
        wizard: { product_type: 'b2c', industry: 'edtech', scale: 'm', geography: 'ru', pdn: true, activity: 'high', ai_used: true },
        expected: {
            totalMonthly: 32_711_217,
            totalAnnual: 392_534_605,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 957_246, LICENSE: 1_834_844, TRAFFIC: 205_431, SERVICES: 3_228_949, RESERVES: 0, SECURITY: 785_419, AI: 25_699_328 }
        }
    },
    {
        id: 'consumer_b2c_l_ai_global',
        wizard: { product_type: 'b2c', industry: 'consumer', scale: 'l', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            totalMonthly: 152_215_105,
            totalAnnual: 1_826_581_262,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 26_484_794, LICENSE: 5_255_296, TRAFFIC: 9_244_399, SERVICES: 28_645_659, RESERVES: 0, SECURITY: 1_446_108, AI: 81_138_850 }
        }
    },
    {
        id: 'fintech_b2b_m',
        wizard: { product_type: 'b2b', industry: 'fintech', scale: 'm', geography: 'ru', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            totalMonthly: 12_682_756,
            totalAnnual: 152_193_069,
            topCategory: 'LICENSE',
            byCategoryMonthly: { HW: 876_796, LICENSE: 3_923_740, TRAFFIC: 86_149, SERVICES: 3_480_337, RESERVES: 2_176_825, SECURITY: 2_138_910, AI: 0 }
        }
    },
    {
        id: 'b2g_m_ru_cis',
        wizard: { product_type: 'b2g', industry: 'corporate', scale: 'm', geography: 'ru_cis', pdn: true, activity: 'medium', ai_used: false },
        expected: {
            totalMonthly: 6_671_443,
            totalAnnual: 80_057_311,
            topCategory: 'SERVICES',
            byCategoryMonthly: { HW: 306_473, LICENSE: 1_846_250, TRAFFIC: 159_043, SERVICES: 2_562_208, RESERVES: 675_869, SECURITY: 1_121_598, AI: 0 }
        }
    },
    {
        id: 'enterprise_b2c_xl_ai_global',
        wizard: { product_type: 'b2c', industry: 'consumer', scale: 'xl', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            totalMonthly: 710_757_245,
            totalAnnual: 8_529_086_937,
            topCategory: 'HW',
            byCategoryMonthly: { HW: 257_893_702, LICENSE: 12_085_596, TRAFFIC: 46_221_993, SERVICES: 134_102_280, RESERVES: 0, SECURITY: 5_648_622, AI: 254_805_053 }
        }
    },
    {
        id: 'regulated_b2g_fintech_xl_ai_global',
        wizard: { product_type: 'b2g', industry: 'fintech', scale: 'xl', geography: 'global', pdn: true, activity: 'high', ai_used: true },
        expected: {
            totalMonthly: 588_692_264,
            totalAnnual: 7_064_307_170,
            topCategory: 'AI',
            byCategoryMonthly: { HW: 51_482_313, LICENSE: 16_984_903, TRAFFIC: 6_474_392, SERVICES: 163_457_989, RESERVES: 2_176_825, SECURITY: 7_463_136, AI: 340_652_705 }
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
