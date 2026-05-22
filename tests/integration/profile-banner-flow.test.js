/**
 * 14.U3: integration-тесты на flow «дашборд-баннер ↔ Quick Start edit-mode».
 *
 * Сценарии:
 *   1. createCalcFromWizard → calc.wizard заполнен, calc.answersMeta содержит
 *      sources — баннер должен отображаться с правильным labels.
 *   2. createCalc (без wizard) → calc.wizard === null — баннер НЕ должен отображаться.
 *   3. ctx.openQuickStartForEdit() устанавливает state.modals.quickStart с
 *      mode='edit' и draft = calc.wizard.
 *   4. Параметризация — несколько комбинаций product_type × industry × scale ×
 *      geography → counts.profile + counts.scale > 0, calc.wizard содержит входные
 *      значения дословно.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();
const { store }  = await import('../../js/state/store.js');
const calcList   = await import('../../js/controllers/calcListController.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
    /* Закрываем все модалки между тестами — store singleton, а quickStart
       мог остаться открытым после предыдущего теста openModal. */
    store.closeModal('quickStart');
});

describe('14.U3 banner data: createCalcFromWizard выставляет calc.wizard', () => {
    const SAMPLES = [
        { type: 'b2b',      industry: 'corporate', scale: 'm',  geo: 'ru',     label: 'B2B × Corporate × M × RU' },
        { type: 'b2c',      industry: 'consumer',  scale: 'l',  geo: 'global', label: 'B2C × Consumer × L × Global' },
        { type: 'internal', industry: 'corporate', scale: 'xs', geo: 'ru',     label: 'Internal × Corporate × XS × RU' },
        { type: 'b2g',      industry: 'fintech',   scale: 'xl', geo: 'ru',     label: 'B2G × FinTech × XL × RU' },
        { type: 'b2c',      industry: 'edtech',    scale: 's',  geo: 'ru_cis', label: 'B2C × EdTech × S × RU+CIS' }
    ];

    for (const sample of SAMPLES) {
        it(`${sample.label} → calc.wizard содержит вход дословно`, () => {
            calcList.createCalcFromWizard('Test', {
                product_type: sample.type,
                industry: sample.industry,
                scale: sample.scale,
                geography: sample.geo,
                pdn: true,
                activity: 'medium',
                ai_used: false
            });
            const calc = store.getState().activeCalc;
            assert.ok(calc.wizard, 'calc.wizard должен быть заполнен');
            assert.equal(calc.wizard.product_type, sample.type);
            assert.equal(calc.wizard.industry,     sample.industry);
            assert.equal(calc.wizard.scale,        sample.scale);
            assert.equal(calc.wizard.geography,    sample.geo);
            assert.equal(calc.wizard.pdn,          true);
            assert.equal(calc.wizard.activity,     'medium');
            assert.equal(calc.wizard.ai_used,      false);

            // answersMeta должен содержать ≥1 запись с source=scale (registered_users_total)
            const meta = calc.answersMeta || {};
            const sources = Object.values(meta).map(v => v.source);
            assert.ok(sources.includes('scale'), 'должна быть хотя бы одна запись source=scale');
        });
    }
});

describe('14.U3 banner data: createCalc без wizard → calc.wizard = null', () => {
    it('обычный createCalc оставляет calc.wizard = null (баннер не показывается)', () => {
        calcList.createCalc('Manual calc');
        const calc = store.getState().activeCalc;
        assert.equal(calc.wizard, null,
            'createCalc без wizard должен оставлять calc.wizard = null');
    });
});

describe('14.U3 ctx.openQuickStartForEdit', () => {
    /* openQuickStartForEdit живёт в app.js как метод ctx. Здесь дублируем его
       логику, чтобы протестировать без полной инициализации app.js (который
       вешает event-листенеры на window/document). Проверяем: store.openModal
       с mode='edit' и draft из calc.wizard. */
    it('активный wizard-расчёт → openModal(quickStart, {mode:"edit", draft})', () => {
        calcList.createCalcFromWizard('Test', {
            product_type: 'b2b',
            industry: 'fintech',
            scale: 'm',
            geography: 'ru',
            pdn: true,
            activity: 'medium',
            ai_used: false
        });

        // Воспроизводим логику ctx.openQuickStartForEdit (см. app.js)
        const calc = store.getState().activeCalc;
        if (calc && calc.wizard) {
            store.openModal('quickStart', {
                mode: 'edit',
                draft: { ...calc.wizard, name: calc.name }
            });
        }

        const m = store.getState().modals.quickStart;
        assert.equal(m.open,  true);
        assert.equal(m.mode,  'edit');
        assert.equal(m.draft.industry,     'fintech');
        assert.equal(m.draft.product_type, 'b2b');
        assert.equal(m.draft.scale,        'm');
        assert.equal(m.draft.geography,    'ru');
        assert.equal(m.draft.pdn,          true);
        assert.equal(m.draft.activity,     'medium');
        assert.equal(m.draft.ai_used,      false);
        assert.equal(m.draft.name,         'Test');
    });

    it('legacy-расчёт (calc.wizard=null) → openQuickStartForEdit no-op', () => {
        calcList.createCalc('Manual calc');
        const calc = store.getState().activeCalc;
        // Логика ctx.openQuickStartForEdit (см. app.js): если !calc.wizard — ранний return
        if (calc && calc.wizard) {
            store.openModal('quickStart', { mode: 'edit', draft: calc.wizard });
        }
        const m = store.getState().modals.quickStart;
        assert.equal(m.open, false, 'модалка не должна открываться без wizard');
    });
});
