/**
 * Sprint 4 Stage 4.5: re-apply preserve mode + scenario switch.
 *
 * Сценарий-инвариант:
 *   1. Calc с двумя сценариями A и B.
 *   2. В A — manual override на field X (значение OVERRIDE_VAL, meta='manual').
 *   3. Switch на B → root перезагружается из scenarios[B] (X имеет meta='profile' / без manual).
 *   4. Reapply preserve в B — wizard переписывает X новым значением.
 *   5. Switch обратно на A — root перезагружается из scenarios[A].
 *   6. Field X в A ВСЁ ЕЩЁ имеет OVERRIDE_VAL и meta='manual'.
 *
 * Это подтверждает что preserve mode НЕ затрагивает manual-метки в неактивных
 * сценариях (mirror-pattern даёт per-scenario изоляцию).
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

let store, calcList, calcCtl;

before(async () => {
    installLocalStorage();
    store = (await import('../../js/state/store.js')).store;
    calcList = await import('../../js/controllers/calcListController.js');
    calcCtl = await import('../../js/controllers/calcController.js');
});

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
});

describe('Sprint 4 Stage 4.5: preserve mode + scenario switch инвариант', () => {
    it('Manual override в A сохраняется при switch на B → reapply → switch назад', () => {
        // 1. Создаём calc через wizard (A = scenarios[0])
        const wiz = { product_type: 'b2b', industry: 'corporate', scale: 'm',
                      geography: 'ru', pdn: true, activity: 'medium', ai_used: false };
        const c = calcList.createCalcFromWizard('AB-test', wiz);
        store.setActiveCalc(c);
        const aId = c.scenarios[0].id;

        // 2. Manual override в A на peak_rps
        calcCtl.setAnswer('peak_rps', 9999);
        let st = store.getState().activeCalc;
        assert.equal(st.answers.peak_rps, 9999, 'A: peak_rps = 9999');
        assert.equal(st.answersMeta.peak_rps?.source, 'manual', 'A: meta = manual');
        const aAfterOverride = st.scenarios.find(s => s.id === aId);
        assert.equal(aAfterOverride.answers.peak_rps, 9999, 'A scenario: peak_rps mirror=9999');
        assert.equal(aAfterOverride.answersMeta.peak_rps?.source, 'manual', 'A scenario: meta=manual');

        // 3. Дублируем A → создаётся B (копия с manual override). API контроллера
        //    возвращает { scenarioId } (не { ok, scenarioId }).
        const dupRes = calcCtl.duplicateScenario(aId);
        assert.ok(dupRes && dupRes.scenarioId, 'duplicate A → копия с manual override');
        const bIdReal = dupRes.scenarioId;

        st = store.getState().activeCalc;
        assert.equal(st.activeScenarioId, bIdReal, 'после duplicate активный = копия');
        assert.equal(st.answers.peak_rps, 9999, 'B (копия): peak_rps скопирован = 9999');
        assert.equal(st.answersMeta.peak_rps?.source, 'manual', 'B (копия): meta=manual');

        // 4. Сбросим override в B через reapply 'overwrite' — manual-метка уйдёт.
        calcCtl.reapplyProfile('overwrite');
        st = store.getState().activeCalc;
        const bScen = st.scenarios.find(s => s.id === bIdReal);
        assert.notEqual(bScen.answersMeta.peak_rps?.source, 'manual',
            'B после overwrite: meta больше не manual');

        // 5. Switch обратно в A
        calcCtl.switchScenario(aId);
        st = store.getState().activeCalc;
        assert.equal(st.activeScenarioId, aId, 'активный = A');

        // 6. INVARIANT: A сохранил свой manual override
        assert.equal(st.answers.peak_rps, 9999, 'A после switch back: peak_rps=9999');
        assert.equal(st.answersMeta.peak_rps?.source, 'manual', 'A после switch back: meta=manual');

        // И mirror в scenarios[A] всё ещё содержит manual
        const aFinal = st.scenarios.find(s => s.id === aId);
        assert.equal(aFinal.answersMeta.peak_rps?.source, 'manual',
            'A scenarios[]: meta=manual сохранилось — изоляция per-scenario работает');
    });

    it('Reapply preserve в активном scenario не затрагивает другие сценарии', () => {
        const wiz = { product_type: 'b2b', industry: 'corporate', scale: 'm',
                      geography: 'ru', pdn: true, activity: 'medium', ai_used: false };
        const c = calcList.createCalcFromWizard('isolation', wiz);
        store.setActiveCalc(c);
        const aId = c.scenarios[0].id;

        // Manual в A
        calcCtl.setAnswer('peak_rps', 7777);

        // Дублируем для создания B (после duplicate активный = B)
        const dup = calcCtl.duplicateScenario(aId);
        const bId = dup.scenarioId;
        assert.equal(store.getState().activeCalc.activeScenarioId, bId,
            'после duplicate активный = B');

        // В B перезатираем peak_rps другим manual'ом
        calcCtl.setAnswer('peak_rps', 5555);

        let st = store.getState().activeCalc;
        const bScenAfterSet = st.scenarios.find(s => s.id === bId);
        assert.equal(bScenAfterSet.answers.peak_rps, 5555, 'B: peak_rps=5555 (B-manual)');

        // Reapply preserve в B — manual в B должен сохраниться
        calcCtl.reapplyProfile('preserve');
        st = store.getState().activeCalc;
        const bAfterReapply = st.scenarios.find(s => s.id === bId);
        assert.equal(bAfterReapply.answers.peak_rps, 5555,
            'B preserve: manual peak_rps=5555 сохранён');
        assert.equal(bAfterReapply.answersMeta.peak_rps?.source, 'manual',
            'B preserve: meta=manual сохранён');

        // A не затронут — у A был свой manual peak_rps=7777
        const aAfterReapply = st.scenarios.find(s => s.id === aId);
        assert.equal(aAfterReapply.answers.peak_rps, 7777,
            'A: manual peak_rps=7777 не затронут reapply в B');
        assert.equal(aAfterReapply.answersMeta.peak_rps?.source, 'manual',
            'A: meta=manual не затронут reapply в B');
    });
});
