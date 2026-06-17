/**
 * Stage 5A — архитектурные инварианты ekClass (forcing function).
 *
 * Эти инварианты — НЕ описательные, а защитные. Они ловят класс ошибок, который
 * иначе вернётся в следующем аудите:
 *   I1 (completeness) — каждый SEED_ITEM имеет валидный ekClass.
 *   I2 (prod-derived ⟺ S.prod*) — двунаправленный guard цикла: только DR-ЭК
 *      читают агрегат объёма ПРОМ, и любой, кто его читает, обязан быть помечен
 *      prod-derived (иначе новый ЭК тихо войдёт в пере-расчёт без декларации).
 *   I3 (prod-derived ⟹ нет dashboardResource) — DR-ЭК исключён из источников
 *      агрегата S.prod* ⇒ self-reference невозможен по построению.
 *   I4 (constant ⟹ нет ссылок) — константа действительно литеральна.
 *   I5 (ai-driven ⟹ ссылается на AI-вход) — класс соответствует формуле.
 *
 * При добавлении ЭК, читающего S.prod* без ekClass='prod-derived', — CI падает.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SEED_ITEMS } from '../../../js/domain/seed.js';
import { EKCLASS_IDS, STAND_IDS } from '../../../js/utils/constants.js';
import { getAst, isAstError } from '../../../js/domain/formula/cache.js';
import { collectReferences } from '../../../js/domain/formula/evaluator.js';

const PROD_SETTINGS = new Set(['prodComputeVcpu', 'prodRamGb', 'prodStorageTb']);
const AI_QUESTION_PREFIXES = ['ai_', 'rag_', 'agent_'];
const AI_SETTING_ROOTS = new Set([
    'aiModelTierFactor', 'aiRequestsPerMonth', 'aiInputTokensEffective',
    'agentStepFactor', 'agentToolFactor'
]);

/** Собрать ссылки формул ЭК по всем применимым стендам. */
function collectItemRefs(item) {
    const questions = new Set();
    const settingRoots = new Set();
    const applicable = new Set(item.applicableStands || STAND_IDS);
    for (const stand of STAND_IDS) {
        if (!applicable.has(stand)) continue;
        const src = item.qtyFormulas?.[stand];
        const ast = getAst(src);
        if (ast === null || isAstError(ast)) continue;
        const refs = collectReferences(ast);
        for (const q of refs.questions) questions.add(q);
        for (const s of refs.settings) settingRoots.add(String(s).split('.')[0]);
    }
    return { questions, settingRoots };
}

function refsProdSetting(settingRoots) {
    for (const r of settingRoots) if (PROD_SETTINGS.has(r)) return true;
    return false;
}

function refsAiInput(questions, settingRoots) {
    for (const q of questions) {
        if (AI_QUESTION_PREFIXES.some(p => q.startsWith(p))) return true;
    }
    for (const r of settingRoots) if (AI_SETTING_ROOTS.has(r)) return true;
    return false;
}

describe('Stage 5A ekClass — I1 completeness', () => {
    it('каждый SEED_ITEM имеет валидный ekClass', () => {
        const bad = SEED_ITEMS
            .filter(it => !EKCLASS_IDS.includes(it.ekClass))
            .map(it => `${it.id}: ${JSON.stringify(it.ekClass)}`);
        assert.deepEqual(bad, [], `ЭК без валидного ekClass: ${bad.join(', ')}`);
    });
});

describe('Stage 5A ekClass — I2 prod-derived ⟺ S.prod*', () => {
    it('каждый prod-derived ссылается хотя бы на один S.prod*', () => {
        const bad = SEED_ITEMS
            .filter(it => it.ekClass === 'prod-derived')
            .filter(it => !refsProdSetting(collectItemRefs(it).settingRoots))
            .map(it => it.id);
        assert.deepEqual(bad, [], `prod-derived без ссылки на S.prod*: ${bad.join(', ')}`);
    });
    it('каждый, кто ссылается на S.prod*, помечен prod-derived', () => {
        const bad = SEED_ITEMS
            .filter(it => refsProdSetting(collectItemRefs(it).settingRoots))
            .filter(it => it.ekClass !== 'prod-derived')
            .map(it => `${it.id} (${it.ekClass})`);
        assert.deepEqual(bad, [], `ссылается на S.prod*, но не prod-derived: ${bad.join(', ')}`);
    });
});

describe('Stage 5A ekClass — I3 prod-derived ⟹ нет dashboardResource (cycle-safety)', () => {
    it('prod-derived ЭК не участвует в источниках агрегата S.prod*', () => {
        const bad = SEED_ITEMS
            .filter(it => it.ekClass === 'prod-derived')
            .filter(it => it.dashboardResource)
            .map(it => `${it.id} (dashboardResource=${it.dashboardResource})`);
        assert.deepEqual(bad, [], `prod-derived с dashboardResource: ${bad.join(', ')}`);
    });
});

describe('Stage 5A ekClass — I4 constant ⟹ нет ссылок', () => {
    it('constant-ЭК имеет формулу-литерал (нет Q.* и S.*)', () => {
        const bad = SEED_ITEMS
            .filter(it => it.ekClass === 'constant')
            .filter(it => {
                const { questions, settingRoots } = collectItemRefs(it);
                return questions.size > 0 || settingRoots.size > 0;
            })
            .map(it => it.id);
        assert.deepEqual(bad, [], `constant со ссылками: ${bad.join(', ')}`);
    });
});

describe('Stage 5A ekClass — I5 ai-driven ⟹ ссылается на AI-вход', () => {
    it('каждый ai-driven ссылается на Q.ai_/rag_/agent_ или S.ai*', () => {
        const bad = SEED_ITEMS
            .filter(it => it.ekClass === 'ai-driven')
            .filter(it => {
                const { questions, settingRoots } = collectItemRefs(it);
                return !refsAiInput(questions, settingRoots);
            })
            .map(it => it.id);
        assert.deepEqual(bad, [], `ai-driven без AI-входа: ${bad.join(', ')}`);
    });
});
