/**
 * Reconciliation invariant: три источника total budget и per-EK qty должны
 * совпадать до десятой копейки на любом валидном calc:
 *
 *   1. Calc-card (refreshCalcList → calculate(migrated).totalMonthly)
 *   2. Dashboard (calculate(calc) → applyStandFilter → totalMonthly)
 *   3. Details (Σ items[i].stands[s].costFinal по активным s)
 *
 * Дополнительно: aggregateResources qty (Dashboard «Объёмы ресурсов»)
 * совпадает с Σ EK qty где `dashboardResource === label`.
 *
 * Семантика disabledStands:
 *   - disabledStands=[] — все три источника обязаны совпадать.
 *   - disabledStands≠[] — calc-card показывает raw total (включая отключённые),
 *     Dashboard/Details — filtered. Это design choice: calc-card = «стоимость
 *     проекта целиком», Dashboard/Details = «текущий выбор пользователя».
 *     Разница ровно = сумма отключённых стендов.
 *
 * Этот тест защищает пользовательский кейс v2.20.72 (Акселератор — новый
 * продукт Start), где все три view должны сходиться, а также общий
 * контракт reconciliation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate, buildContext } from '../../js/domain/calculator.js';
import { applyStandFilter } from '../../js/domain/standsFilter.js';
import { aggregateResources } from '../../js/ui/dashboardAggregates.js';
import { buildSeedDictionaries } from '../../js/domain/seed.js';

const STAND_IDS = ['DEV','IFT','PSI','PROD','LOAD'];

function buildUserScenarioCalc(overrides = {}) {
    const dict = buildSeedDictionaries();
    return {
        id: 'reconcile-test',
        name: 'Reconcile fixture',
        schemaVersion: 20,
        settings: {
            period: 'monthly',
            phaseDurationMonths: 12,
            kInflation: 0.1,
            kSeasonal: 0,
            kScheduleShift: 0.05,
            kContingency: 0.05,
            bufferTask: 0.1,
            bufferProject: 0.1,
            vatEnabled: true,
            vatRate: 0.22,
            planningHorizonYears: 1,
            daysPerMonth: 30,
            standSizeRatio: { DEV: 0.2, IFT: 0.4, PSI: 0.5, LOAD: 1, PROD: 1 },
            aiStandFactor:  { DEV: 0.02, IFT: 0.05, PSI: 0.1, LOAD: 1, PROD: 1 },
            applyRiskFactors: false,
            ...(overrides.settings || {})
        },
        answers: {
            ai_llm_used: true,
            ai_hosting_mode: 'external_api',
            ai_model_tier: 'heavy',
            registered_users_total: 500,
            dau_share_of_registered_percent: 0.7,
            ai_users_share: 75,
            ai_requests_per_user_day: 30,
            ai_avg_input_tokens: 3000,
            ai_avg_output_tokens: 500,
            ai_caching_share: 30,
            ...(overrides.answers || {})
        },
        dictionaries: dict,
        view: { disabledStands: [], ...(overrides.view || {}) }
    };
}

describe('Reconciliation: Calc-card ↔ Dashboard ↔ Details', () => {
    it('disabledStands=[]: все три источника total совпадают до сотой копейки', () => {
        const calc = buildUserScenarioCalc();
        const result = calculate(calc);
        const filtered = applyStandFilter(result, []);

        const cardMonthly = result.totalMonthly;
        const dashMonthly = filtered.totalMonthly;
        const detailsByStands = STAND_IDS.reduce((s, sid) => s + (result.stands[sid]?.totalMonthly || 0), 0);
        const detailsByItems = Object.values(result.items).reduce((s, item) =>
            s + STAND_IDS.reduce((sum, sid) => sum + (item.stands[sid]?.costFinal || 0), 0), 0);

        assert.ok(cardMonthly > 0, 'sanity: card monthly должен быть > 0');
        assert.ok(Math.abs(cardMonthly - dashMonthly) < 0.01,
            `card monthly (${cardMonthly}) != dash monthly (${dashMonthly})`);
        assert.ok(Math.abs(cardMonthly - detailsByStands) < 0.01,
            `card monthly (${cardMonthly}) != Σ stands (${detailsByStands})`);
        assert.ok(Math.abs(cardMonthly - detailsByItems) < 0.01,
            `card monthly (${cardMonthly}) != Σ items×stands (${detailsByItems})`);
    });

    it('каждый item.totalMonthly == Σ item.stands[s].costFinal по всем стендам', () => {
        const calc = buildUserScenarioCalc();
        const result = calculate(calc);

        for (const [itemId, item] of Object.entries(result.items)) {
            const sumOverStands = STAND_IDS.reduce((s, sid) => s + (item.stands[sid]?.costFinal || 0), 0);
            assert.ok(Math.abs(item.totalMonthly - sumOverStands) < 0.01,
                `Item ${itemId}: totalMonthly=${item.totalMonthly}, Σstands=${sumOverStands}`);
        }
    });

    it('каждый stand.totalMonthly == Σ items[i].stands[s].costFinal по всем EK', () => {
        const calc = buildUserScenarioCalc();
        const result = calculate(calc);

        for (const sid of STAND_IDS) {
            const sumOverItems = Object.values(result.items)
                .reduce((s, item) => s + (item.stands[sid]?.costFinal || 0), 0);
            assert.ok(Math.abs(result.stands[sid].totalMonthly - sumOverItems) < 0.01,
                `Stand ${sid}: totalMonthly=${result.stands[sid].totalMonthly}, Σitems=${sumOverItems}`);
        }
    });

    it('Dashboard «Объёмы ресурсов» qty == Σ EK qty по dashboardResource label', () => {
        const calc = buildUserScenarioCalc();
        const result = calculate(calc);
        const applyRisks = calc.settings.applyRiskFactors !== false;
        const resources = aggregateResources(result, calc.dictionaries.items, [], applyRisks, calc.answers);

        for (const label of ['CPU', 'GPU', 'RAM', 'SSD', 'HDD', 'S3']) {
            const dashQty = resources.total[label]?.qty || 0;
            let ekSum = 0;
            for (const item of calc.dictionaries.items) {
                if (item.dashboardResource !== label) continue;
                const itemRes = result.items[item.id];
                if (!itemRes) continue;
                for (const sid of STAND_IDS) {
                    const baseQty = itemRes.stands[sid]?.qty || 0;
                    const br = itemRes.stands[sid]?.riskBreakdown;
                    const capacityMul = (applyRisks && br)
                        ? br.bufferFactor * br.seasonalMul * br.scheduleMul * br.contingencyMul
                        : 1;
                    ekSum += baseQty * capacityMul;
                }
            }
            assert.ok(Math.abs(dashQty - ekSum) < 0.01,
                `Resource ${label}: dashboard=${dashQty}, ΣEK=${ekSum}`);
        }
    });

    it('disabledStands=[DEV]: Dashboard/Details = filtered, calc-card = raw (документированный design choice)', () => {
        const calc = buildUserScenarioCalc({ view: { disabledStands: ['DEV'] } });
        const result = calculate(calc);
        const filtered = applyStandFilter(result, ['DEV']);

        const cardMonthly = result.totalMonthly;        // raw — calc-card
        const dashMonthly = filtered.totalMonthly;      // filtered — dashboard
        const devContribution = result.stands.DEV.totalMonthly;

        // Card-vs-Dash: разница ровно равна вкладу DEV
        const delta = cardMonthly - dashMonthly;
        assert.ok(Math.abs(delta - devContribution) < 0.01,
            `card−dash (${delta}) должно равняться вкладу DEV (${devContribution})`);

        // Dashboard ↔ Details: оба читают filtered по активным стендам
        const activeStands = STAND_IDS.filter(s => s !== 'DEV');
        const detailsByStands = activeStands.reduce((s, sid) => s + (result.stands[sid]?.totalMonthly || 0), 0);
        assert.ok(Math.abs(dashMonthly - detailsByStands) < 0.01,
            `Dashboard (${dashMonthly}) != Σ active stands (${detailsByStands})`);
    });

    it('Reconciliation сохраняется при applyRiskFactors=true', () => {
        const calc = buildUserScenarioCalc({ settings: { applyRiskFactors: true } });
        const result = calculate(calc);
        const filtered = applyStandFilter(result, []);

        const detailsByItems = Object.values(result.items).reduce((s, item) =>
            s + STAND_IDS.reduce((sum, sid) => sum + (item.stands[sid]?.costFinal || 0), 0), 0);

        assert.ok(Math.abs(result.totalMonthly - filtered.totalMonthly) < 0.01);
        assert.ok(Math.abs(result.totalMonthly - detailsByItems) < 0.01);
    });

    it('User-сценарий (Акселератор Start, registered=500/dau=0.7/heavy LLM): card == dash == details', () => {
        // Зафиксированный сценарий пользователя — регрессионная защита.
        const calc = buildUserScenarioCalc();
        const result = calculate(calc);
        const filtered = applyStandFilter(result, []);

        const detailsByStands = STAND_IDS.reduce((s, sid) => s + (result.stands[sid]?.totalMonthly || 0), 0);

        assert.equal(Math.round(result.totalMonthly * 100), Math.round(filtered.totalMonthly * 100),
            'card.totalMonthly == filtered.totalMonthly (до копейки)');
        assert.equal(Math.round(result.totalMonthly * 100), Math.round(detailsByStands * 100),
            'card.totalMonthly == Σ stands.totalMonthly (до копейки)');
    });
});
