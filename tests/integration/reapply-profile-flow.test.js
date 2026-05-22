/**
 * 14.U5: integration-тесты на reapplyProfile (calcController) flow.
 *
 * Сценарии:
 *   1. preserve mode: manual-поля сохраняют значение и meta='manual';
 *      остальные поля переписываются из wizard-профиля с новой meta.
 *   2. overwrite mode: все поля переписываются, manual-метки удалены.
 *   3. Без wizard'а (legacy calc, calc.wizard=null) — no-op, { changed: 0 }.
 *   4. provider и другие settings НЕ меняются ни в одном режиме.
 *   5. Zero manual-полей — preserve и overwrite дают идентичный результат.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();
const { store }  = await import('../../js/state/store.js');
const calcList   = await import('../../js/controllers/calcListController.js');
const calcCtl    = await import('../../js/controllers/calcController.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
});

function setupWizardCalc(industry = 'corporate', scale = 'm') {
    return calcList.createCalcFromWizard('Test', {
        product_type: 'b2b',
        industry, scale,
        geography: 'ru',
        pdn: true,
        activity: 'medium',
        ai_used: false
    });
}

describe('14.U5 reapplyProfile: preserve mode', () => {
    it('manual-поле сохраняет значение и meta="manual"', () => {
        setupWizardCalc();
        // Юзер изменяет 1 поле вручную
        calcCtl.setAnswer('peak_rps', 9999);
        let calc = store.getState().activeCalc;
        assert.equal(calc.answers.peak_rps, 9999);
        assert.equal(calc.answersMeta.peak_rps.source, 'manual');

        // re-apply preserve
        const r = calcCtl.reapplyProfile('preserve');
        calc = store.getState().activeCalc;
        assert.equal(calc.answers.peak_rps, 9999, 'значение сохранено');
        assert.equal(calc.answersMeta.peak_rps.source, 'manual', 'meta остался "manual"');
        assert.ok(r.changed >= 0);
    });

    it('не-manual поле перезаписывается из wizard', () => {
        setupWizardCalc();
        // registered_users_total = 100000 для scale=m (см. SCALE_RULES)
        let calc = store.getState().activeCalc;
        const beforeRegistered = calc.answers.registered_users_total;
        // Меняем ВРУЧНУЮ другое поле, чтобы было хоть одно manual в meta:
        calcCtl.setAnswer('peak_rps', 9999);
        // Имитируем что юзер ничего не правил у registered_users_total —
        // но meta для него = 'scale' от createCalcFromWizard.

        calcCtl.reapplyProfile('preserve');
        calc = store.getState().activeCalc;
        // registered_users_total: НЕ manual — должен переписаться (значение тоже самое,
        // но meta вернётся на 'scale' от wizardToAnswers)
        assert.equal(calc.answers.registered_users_total, beforeRegistered);
        assert.equal(calc.answersMeta.registered_users_total.source, 'scale');
    });
});

describe('14.U5 reapplyProfile: overwrite mode', () => {
    it('manual-поля перезаписываются и теряют метку', () => {
        setupWizardCalc();
        calcCtl.setAnswer('peak_rps', 9999);
        let calc = store.getState().activeCalc;
        assert.equal(calc.answersMeta.peak_rps.source, 'manual');

        calcCtl.reapplyProfile('overwrite');
        calc = store.getState().activeCalc;
        // wizard для scale=m задаёт peak_rps=200 (см. SCALE_RULES)
        assert.notEqual(calc.answers.peak_rps, 9999, 'manual значение перезаписано');
        // meta — больше НЕ 'manual'
        assert.notEqual(calc.answersMeta.peak_rps?.source, 'manual');
    });

    it('manual-метка удалена для всех полей после overwrite', () => {
        setupWizardCalc();
        calcCtl.setAnswer('peak_rps', 1);
        calcCtl.setAnswer('registered_users_total', 2);
        calcCtl.setAnswer('email_per_month', 3);
        let calc = store.getState().activeCalc;
        // 3 manual-метки до re-apply
        const before = Object.values(calc.answersMeta).filter(m => m.source === 'manual').length;
        assert.equal(before, 3);

        calcCtl.reapplyProfile('overwrite');
        calc = store.getState().activeCalc;
        const after = Object.values(calc.answersMeta).filter(m => m.source === 'manual').length;
        assert.equal(after, 0, 'после overwrite manual-меток не должно остаться');
    });
});

describe('14.U5 reapplyProfile: edge cases', () => {
    it('legacy-расчёт без wizard → no-op { changed: 0 }', () => {
        calcList.createCalc('Manual calc');
        const r = calcCtl.reapplyProfile('preserve');
        assert.equal(r.changed, 0);
    });

    it('zero manual-полей: preserve и overwrite эквивалентны', () => {
        const c1 = setupWizardCalc();
        // Берём snapshot до re-apply
        const snap1 = JSON.stringify(store.getState().activeCalc.answers);
        calcCtl.reapplyProfile('preserve');
        const afterPreserve = JSON.stringify(store.getState().activeCalc.answers);

        // Восстанавливаем — создаём такой же расчёт заново (manual=0)
        store.setActiveCalc(null);
        store.setCalcList([]);
        installLocalStorage();
        setupWizardCalc();
        calcCtl.reapplyProfile('overwrite');
        const afterOverwrite = JSON.stringify(store.getState().activeCalc.answers);

        assert.equal(afterPreserve, afterOverwrite,
            'без manual-правок preserve и overwrite дают одинаковый результат');
    });
});

describe('14.U5 reapplyProfile: settings НЕ меняются', () => {
    it('provider и providerSetByWizard сохраняются после preserve', () => {
        setupWizardCalc();
        calcCtl.setProvider('yandex');
        let calc = store.getState().activeCalc;
        assert.equal(calc.settings.provider, 'yandex');
        assert.equal(calc.settings.providerSetByWizard, false);

        calcCtl.setAnswer('peak_rps', 9999);  // нужен ≥1 manual для разнообразия
        calcCtl.reapplyProfile('preserve');
        calc = store.getState().activeCalc;
        assert.equal(calc.settings.provider, 'yandex',
            'provider НЕ должен меняться при re-apply');
        assert.equal(calc.settings.providerSetByWizard, false,
            'флаг providerSetByWizard сохраняется');
    });

    it('vatEnabled, applyRiskFactors сохраняются после overwrite', () => {
        setupWizardCalc();
        calcCtl.setSetting('vatEnabled', false);
        calcCtl.setSetting('applyRiskFactors', false);
        calcCtl.setAnswer('peak_rps', 9999);

        calcCtl.reapplyProfile('overwrite');
        const calc = store.getState().activeCalc;
        assert.equal(calc.settings.vatEnabled, false);
        assert.equal(calc.settings.applyRiskFactors, false);
    });
});
