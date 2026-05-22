/**
 * 14.U4: integration-тесты на provider-flag flow.
 *
 * Сценарии:
 *   - createCalc(name) — новый расчёт без wizard → providerSetByWizard=false.
 *   - createCalcFromWizard(name, wizardInput) → providerSetByWizard=true.
 *   - setProvider(value) → provider обновляется + providerSetByWizard=false
 *     (любая ручная правка в Опроснике сбрасывает «из мастера»).
 *   - setProvider игнорирует невалидное значение (пустую строку, не-строку).
 *   - resetAnswers() НЕ трогает provider и providerSetByWizard
 *     (они в settings, а не в answers).
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

describe('14.U4 createCalc / createCalcFromWizard выставляют providerSetByWizard', () => {
    it('createCalc → providerSetByWizard=false (default sbercloud, manual)', () => {
        calcList.createCalc('Manual calc');
        const calc = store.getState().activeCalc;
        assert.equal(calc.settings.provider, 'sbercloud');
        assert.equal(calc.settings.providerSetByWizard, false);
    });

    it('createCalcFromWizard → providerSetByWizard=true (sbercloud из мастера)', () => {
        calcList.createCalcFromWizard('Wizard calc', {
            product_type: 'b2b', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        const calc = store.getState().activeCalc;
        assert.equal(calc.settings.provider, 'sbercloud');
        assert.equal(calc.settings.providerSetByWizard, true);
    });

    it('createCalcFromWizard с выбранным provider сохраняет его в settings', () => {
        calcList.createCalcFromWizard('Wizard calc', {
            product_type: 'b2b', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false,
            provider: 'yandex'
        });
        const calc = store.getState().activeCalc;
        assert.equal(calc.settings.provider, 'yandex',
            'Quick Start должен создавать расчёт на выбранном провайдере, а не всегда Cloud.ru.');
        assert.equal(calc.settings.providerSetByWizard, true);
        assert.equal(calc.wizard.provider, 'yandex',
            'wizard snapshot должен помнить provider, выбранный в Quick Start.');
    });
});

describe('14.U4 setProvider', () => {
    it('меняет provider + сбрасывает providerSetByWizard в false', () => {
        calcList.createCalcFromWizard('Test', {
            product_type: 'b2b', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        // До правки: флаг true (из мастера)
        assert.equal(store.getState().activeCalc.settings.providerSetByWizard, true);

        calcCtl.setProvider('yandex');
        const calc = store.getState().activeCalc;
        assert.equal(calc.settings.provider, 'yandex');
        assert.equal(calc.settings.providerSetByWizard, false,
            'после ручной правки бейдж должен переключиться в «Вы изменили»');
    });

    it('игнорирует пустую строку', () => {
        calcList.createCalc('Test');
        calcCtl.setProvider('');
        assert.equal(store.getState().activeCalc.settings.provider, 'sbercloud');
    });

    it('игнорирует не-строку', () => {
        calcList.createCalc('Test');
        calcCtl.setProvider(null);
        calcCtl.setProvider(undefined);
        calcCtl.setProvider(42);
        assert.equal(store.getState().activeCalc.settings.provider, 'sbercloud');
    });

    it('no-op без активного расчёта', () => {
        store.setActiveCalc(null);
        calcCtl.setProvider('yandex');
        assert.equal(store.getState().activeCalc, null);
    });
});

describe('14.U4 resetAnswers НЕ трогает provider и providerSetByWizard', () => {
    it('после resetAnswers provider/флаг сохраняются', () => {
        calcList.createCalcFromWizard('Test', {
            product_type: 'b2b', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        // Поменяем вручную → флаг сбросится в false
        calcCtl.setProvider('vk');
        let calc = store.getState().activeCalc;
        assert.equal(calc.settings.provider, 'vk');
        assert.equal(calc.settings.providerSetByWizard, false);

        // Сбросить ответы — provider и флаг должны остаться
        calcCtl.resetAnswers();
        calc = store.getState().activeCalc;
        assert.equal(calc.settings.provider, 'vk',
            'resetAnswers НЕ должен сбрасывать provider (это setting, не answer)');
        assert.equal(calc.settings.providerSetByWizard, false,
            'флаг providerSetByWizard тоже сохраняется');

        // А вот answersMeta — очищен
        assert.deepEqual(calc.answersMeta, {});
    });
});
