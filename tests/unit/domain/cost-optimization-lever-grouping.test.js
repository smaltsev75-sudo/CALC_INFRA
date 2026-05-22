/**
 * Stage 18.1.1 — lever grouping (domain).
 *
 * Контракт:
 *   - OPTIMIZATION_LEVER_GROUPS: 6 групп в фиксированном порядке.
 *   - getLeverGroupId: маппит LEVER_SPEC.category → groupId.
 *   - recomputeOptimizationDraft.preview.savingByGroup — per-group саvings:
 *     `preview.savingByGroup[gid]` = beforeTotal − calculate(clone-only-this-group).
 *   - groupOptimizationLevers возвращает массив всех 6 групп (даже empty/blocked),
 *     с levers, changedCount, totalSavingRub, maxRiskLevel, blocked, blockedReason.
 *   - constraintKey=off → blocked=true, blockedReason set, levers=[].
 *   - non_prod категория мапится в groupId='infrastructure' (rename).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    OPTIMIZATION_LEVER_GROUPS,
    getLeverGroupId,
    createOptimizationDraft,
    updateOptimizationDraftValue,
    groupOptimizationLevers,
    DEFAULT_LEVEL,
    PLAN_IDS
} from '../../../js/domain/costOptimizationPlanner.js';
import { buildSeedDictionaries, SEED_SETTINGS, defaultAnswersFrom } from '../../../js/domain/seed.js';

function makeCalc(overrides = {}) {
    const dict = buildSeedDictionaries();
    const answers = { ...defaultAnswersFrom(dict.questions), ...(overrides.answers || {}) };
    const settings = { ...SEED_SETTINGS, provider: 'sbercloud', ...(overrides.settings || {}) };
    return {
        id: 'group-test',
        name: 'group-test',
        version: '1.0',
        schemaVersion: 16,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings,
        answers,
        answersMeta: {},
        wizard: null,
        view: { disabledStands: [] },
        dictionaries: dict
    };
}

describe('OPTIMIZATION_LEVER_GROUPS — vocabulary', () => {
    it('массив из 6 групп с заданным порядком', () => {
        const ids = OPTIMIZATION_LEVER_GROUPS.map(g => g.id);
        assert.deepEqual(ids,
            ['infrastructure', 'reliability', 'retention', 'ai', 'risk', 'planning']);
    });

    it('каждая группа имеет title, description, constraintKey?', () => {
        for (const g of OPTIMIZATION_LEVER_GROUPS) {
            assert.ok(typeof g.title === 'string' && g.title.length > 0, `${g.id} has title`);
            assert.ok(typeof g.description === 'string' && g.description.length > 0,
                `${g.id} has description`);
            assert.ok(g.constraintKey === null || typeof g.constraintKey === 'string',
                `${g.id} has constraintKey or null`);
        }
    });

    it('planning имеет constraintKey=null (не блокируется ограничениями)', () => {
        const planning = OPTIMIZATION_LEVER_GROUPS.find(g => g.id === 'planning');
        assert.equal(planning.constraintKey, null);
    });

    it('блокируемые группы имеют constraintEnableLabel для inline-кнопки', () => {
        for (const g of OPTIMIZATION_LEVER_GROUPS) {
            if (g.constraintKey) {
                assert.ok(typeof g.constraintEnableLabel === 'string'
                    && g.constraintEnableLabel.length > 0,
                    `${g.id}: constraintEnableLabel`);
            }
        }
    });
});

describe('getLeverGroupId — category → group mapping', () => {
    it('non_prod → infrastructure', () => {
        assert.equal(getLeverGroupId({ category: 'non_prod' }), 'infrastructure');
    });

    it('остальные category мапятся в одноимённый groupId', () => {
        assert.equal(getLeverGroupId({ category: 'risk' }),        'risk');
        assert.equal(getLeverGroupId({ category: 'planning' }),    'planning');
        assert.equal(getLeverGroupId({ category: 'reliability' }), 'reliability');
        assert.equal(getLeverGroupId({ category: 'retention' }),   'retention');
        assert.equal(getLeverGroupId({ category: 'ai' }),          'ai');
    });

    it('неизвестная category → null', () => {
        assert.equal(getLeverGroupId({ category: 'mystery' }), null);
        assert.equal(getLeverGroupId(null), null);
        assert.equal(getLeverGroupId({}), null);
    });
});

describe('recomputeOptimizationDraft — preview.savingByGroup', () => {
    it('пустой draft → savingByGroup со всеми группами в 0', () => {
        const calc = makeCalc();
        const draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        const sbg = draft.preview.savingByGroup;
        assert.ok(sbg, 'savingByGroup присутствует');
        for (const g of OPTIMIZATION_LEVER_GROUPS) {
            assert.equal(sbg[g.id], 0, `${g.id} saving = 0`);
        }
    });

    it('изменение в infrastructure (LOAD-стенд) → savingByGroup.infrastructure > 0', () => {
        const calc = makeCalc();
        let draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        draft = updateOptimizationDraftValue(draft, 'setting:standSizeRatio.LOAD', 0.5, calc);
        assert.ok(draft.preview.savingByGroup.infrastructure > 0,
            'infrastructure saving > 0');
        assert.equal(draft.preview.savingByGroup.risk, 0,
            'risk saving = 0 (no risk-group changes)');
        assert.equal(draft.preview.savingByGroup.ai, 0,
            'ai saving = 0');
    });

    it('сумма savingByGroup НЕ обязана = savingMonthly (multiplicative interactions)', () => {
        /* Это документация эффекта, не равенство — sanity что значения существуют. */
        const calc = makeCalc();
        let draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        draft = updateOptimizationDraftValue(draft, 'setting:standSizeRatio.LOAD', 0.5, calc);
        draft = updateOptimizationDraftValue(draft, 'setting:bufferTask', 0.05, calc);
        const total = draft.preview.savingMonthly;
        const groupSum = Object.values(draft.preview.savingByGroup).reduce((a, b) => a + b, 0);
        assert.ok(total > 0);
        assert.ok(groupSum > 0);
        /* total и groupSum обычно близки, но могут расходиться из-за мультипликаторов;
           не проверяем равенство — это feature, не bug. */
    });
});

describe('groupOptimizationLevers', () => {
    it('возвращает массив из 6 групп даже если в draft нет changes', () => {
        const calc = makeCalc();
        const draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        const groups = groupOptimizationLevers(calc, draft);
        assert.equal(groups.length, 6);
        assert.deepEqual(groups.map(g => g.id),
            ['infrastructure', 'reliability', 'retention', 'ai', 'risk', 'planning']);
    });

    it('infrastructure содержит LOAD/PSI/IFT/DEV levers', () => {
        const calc = makeCalc();
        const draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        const infra = groupOptimizationLevers(calc, draft).find(g => g.id === 'infrastructure');
        const specIds = infra.levers.map(l => l.leverSpecId).sort();
        assert.deepEqual(specIds, ['dev_ratio', 'ift_ratio', 'load_ratio', 'psi_ratio']);
    });

    it('risk группа содержит buffer/contingency/schedule_shift', () => {
        const calc = makeCalc();
        const draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        const risk = groupOptimizationLevers(calc, draft).find(g => g.id === 'risk');
        const specIds = risk.levers.map(l => l.leverSpecId).sort();
        assert.deepEqual(specIds,
            ['buffer_project', 'buffer_task', 'k_contingency', 'k_schedule_shift']);
    });

    it('reliability — заблокирована при allowReliabilityTradeoff=false', () => {
        const calc = makeCalc();
        const draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        /* AMBITIOUS default — allowReliabilityTradeoff=false, SLA группа заблокирована. */
        const rel = groupOptimizationLevers(calc, draft).find(g => g.id === 'reliability');
        assert.equal(rel.blocked, true);
        assert.ok(rel.blockedReason && rel.blockedReason.length > 0);
        assert.equal(rel.levers.length, 0,
            'у заблокированной группы levers пустые (constraint-gate)');
    });

    it('reliability — НЕ blocked при allowReliabilityTradeoff=true', () => {
        const calc = makeCalc();
        let draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        draft = { ...draft, constraints: { ...draft.constraints, allowReliabilityTradeoff: true } };
        const rel = groupOptimizationLevers(calc, draft).find(g => g.id === 'reliability');
        assert.equal(rel.blocked, false);
        assert.equal(rel.blockedReason, null);
    });

    it('changedCount растёт по группе при добавлении change', () => {
        const calc = makeCalc();
        let draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        let groups = groupOptimizationLevers(calc, draft);
        assert.equal(groups.find(g => g.id === 'infrastructure').changedCount, 0);
        draft = updateOptimizationDraftValue(draft, 'setting:standSizeRatio.LOAD', 0.5, calc);
        groups = groupOptimizationLevers(calc, draft);
        assert.equal(groups.find(g => g.id === 'infrastructure').changedCount, 1);
    });

    it('totalSavingRub > 0 для группы с change', () => {
        const calc = makeCalc();
        let draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        draft = updateOptimizationDraftValue(draft, 'setting:standSizeRatio.LOAD', 0.5, calc);
        const infra = groupOptimizationLevers(calc, draft).find(g => g.id === 'infrastructure');
        assert.ok(infra.totalSavingRub > 0, 'infra saving > 0');
        const risk = groupOptimizationLevers(calc, draft).find(g => g.id === 'risk');
        assert.equal(risk.totalSavingRub, 0, 'risk saving = 0 (no changes)');
    });

    it('maxRiskLevel = high для reliability lever (если разблокирована)', () => {
        const calc = makeCalc();
        let draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        draft = { ...draft, constraints: { ...draft.constraints, allowReliabilityTradeoff: true } };
        const rel = groupOptimizationLevers(calc, draft).find(g => g.id === 'reliability');
        if (rel.levers.length > 0) {
            assert.equal(rel.maxRiskLevel, 'high', 'SLA spec.risk = high');
        }
    });

    it('maxRiskLevel = low для infrastructure levers', () => {
        const calc = makeCalc();
        const draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        const infra = groupOptimizationLevers(calc, draft).find(g => g.id === 'infrastructure');
        assert.equal(infra.maxRiskLevel, 'low');
    });

    it('каждый lever получает groupId-поле', () => {
        const calc = makeCalc();
        const draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        const groups = groupOptimizationLevers(calc, draft);
        for (const g of groups) {
            for (const l of g.levers) {
                assert.equal(l.groupId, g.id, `${l.leverSpecId}.groupId === ${g.id}`);
            }
        }
    });

    it('hasAnyApplicableSpec=true для всех 6 групп (в seed-модели каждая группа имеет spec\'и)', () => {
        const calc = makeCalc();
        const draft = createOptimizationDraft({ calc, level: PLAN_IDS.AMBITIOUS });
        const groups = groupOptimizationLevers(calc, draft);
        for (const g of groups) {
            assert.equal(g.hasAnyApplicableSpec, true, `${g.id} — есть хотя бы 1 spec`);
        }
    });
});
