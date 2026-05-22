/**
 * 14.U2: regression-тесты на трекинг происхождения ответов через answersMeta.
 *
 * Контракт:
 *   - Любой setAnswer(id, value) с НЕпустым value → answersMeta[id] = { source: 'manual' }.
 *   - setAnswer(id, null/''/[]) → answersMeta[id] УДАЛЕНА (бейдж рядом с пустым полем
 *     не нужен).
 *   - При cascade-сбросе master-toggle (id=false) зависимые поля null'ятся И их
 *     answersMeta УДАЛЯЕТСЯ (cascade — не пользовательская правка).
 *   - При cascade-восстановлении (master=true → дочерние получают seed-defaults)
 *     answersMeta зависимых УДАЛЯЕТСЯ (это автоматическое восстановление, не manual).
 *   - resetAnswers() → answersMeta = {} (всё в seed-state).
 *   - createCalc() — новый расчёт без wizard'а: answersMeta = {} (бейджей нет).
 *   - createCalcFromWizard() — answersMeta заполнен sources из wizardToAnswers
 *     (scale / profile / wizard / sla_preset / compliance и т.д.).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

installLocalStorage();
const { store }  = await import('../../../js/state/store.js');
const calcList   = await import('../../../js/controllers/calcListController.js');
const calcCtl    = await import('../../../js/controllers/calcController.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
});

describe('14.U2 source-meta tracking: setAnswer', () => {
    it('новый расчёт без wizard → answersMeta = {}', () => {
        calcList.createCalc('Test');
        const calc = store.getState().activeCalc;
        assert.deepEqual(calc.answersMeta, {},
            'createCalc должен инициализировать answersMeta пустым объектом');
    });

    it('setAnswer на boolean true → meta[id] = { source: "manual" }', () => {
        calcList.createCalc('Test');
        calcCtl.setAnswer('ai_llm_used', true);
        const meta = store.getState().activeCalc.answersMeta;
        assert.deepEqual(meta.ai_llm_used, { source: 'manual' });
    });

    it('setAnswer на number → meta[id] = { source: "manual" }', () => {
        calcList.createCalc('Test');
        calcCtl.setAnswer('registered_users_total', 100000);
        const meta = store.getState().activeCalc.answersMeta;
        assert.deepEqual(meta.registered_users_total, { source: 'manual' });
    });

    it('setAnswer на null (Не знаю) → meta[id] УДАЛЁН (бейдж не нужен)', () => {
        calcList.createCalc('Test');
        calcCtl.setAnswer('registered_users_total', 50000);  // сначала ставим
        calcCtl.setAnswer('registered_users_total', null);   // потом null
        const meta = store.getState().activeCalc.answersMeta;
        assert.equal(meta.registered_users_total, undefined,
            'meta должна быть удалена при null-значении');
    });

    it('setAnswer на пустую строку → meta[id] УДАЛЁН', () => {
        calcList.createCalc('Test');
        calcCtl.setAnswer('ai_hosting_mode', 'external_api');
        calcCtl.setAnswer('ai_hosting_mode', '');
        const meta = store.getState().activeCalc.answersMeta;
        assert.equal(meta.ai_hosting_mode, undefined);
    });

    it('setAnswer на пустой массив (multiselect cleared) → meta[id] УДАЛЁН', () => {
        calcList.createCalc('Test');
        calcCtl.setAnswer('peak_months', [1, 2]);
        calcCtl.setAnswer('peak_months', []);
        const meta = store.getState().activeCalc.answersMeta;
        assert.equal(meta.peak_months, undefined);
    });

    it('setAnswer false на boolean (master OFF) → meta[id] = "manual" (false — валидный ответ)', () => {
        calcList.createCalc('Test');
        calcCtl.setAnswer('pdn_152fz', false);
        const meta = store.getState().activeCalc.answersMeta;
        assert.deepEqual(meta.pdn_152fz, { source: 'manual' },
            'явное "Нет" — это пользовательский ответ, бейдж "Вы изменили" уместен');
    });
});

describe('14.U2 source-meta: cascade при OFF/ON master-toggle', () => {
    it('cascade при выключении master (LLM=false) → meta зависимых УДАЛЕНА', () => {
        calcList.createCalc('Test');
        calcCtl.setAnswer('ai_llm_used', true);
        // Заполняем зависимое поле — meta становится 'manual'
        calcCtl.setAnswer('ai_users_share', 30);
        let meta = store.getState().activeCalc.answersMeta;
        assert.deepEqual(meta.ai_users_share, { source: 'manual' });

        // Выключаем master: каскадный null + meta зависимых удаляется
        calcCtl.setAnswer('ai_llm_used', false);
        meta = store.getState().activeCalc.answersMeta;
        const answers = store.getState().activeCalc.answers;
        assert.equal(answers.ai_users_share, null,
            'зависимое поле обнулено каскадом');
        assert.equal(meta.ai_users_share, undefined,
            'meta зависимого должна быть удалена (cascade ≠ manual)');
        // Сам master = false → manual (это пользовательское «Нет»)
        assert.deepEqual(meta.ai_llm_used, { source: 'manual' });
    });

    it('cascade при включении master (LLM=true) → meta восстановленных дочерних УДАЛЕНА', () => {
        calcList.createCalc('Test');
        // Сначала установим master=true (и сразу выключим, чтобы получить null + чистое meta)
        calcCtl.setAnswer('ai_llm_used', true);
        calcCtl.setAnswer('ai_llm_used', false);
        // Включаем master — должно автовосстановить defaults у null-полей
        calcCtl.setAnswer('ai_llm_used', true);
        const meta = store.getState().activeCalc.answersMeta;
        const answers = store.getState().activeCalc.answers;
        // ai_users_share должен получить seed-default (если он есть в seed)
        // и meta для него НЕ должно быть установлено в 'manual'.
        if (answers.ai_users_share !== null && answers.ai_users_share !== undefined) {
            assert.equal(meta.ai_users_share, undefined,
                'автовосстановление seed-default ≠ manual, meta должна быть пустой');
        }
    });
});

describe('14.U2 source-meta: resetAnswers', () => {
    it('resetAnswers → answersMeta = {} (все бейджи исчезают)', () => {
        calcList.createCalc('Test');
        calcCtl.setAnswer('ai_llm_used', true);
        calcCtl.setAnswer('registered_users_total', 100000);
        calcCtl.setAnswer('peak_rps', 500);
        let meta = store.getState().activeCalc.answersMeta;
        assert.ok(Object.keys(meta).length >= 3, 'meta должна содержать ≥3 записи');

        calcCtl.resetAnswers();
        meta = store.getState().activeCalc.answersMeta;
        assert.deepEqual(meta, {}, 'resetAnswers должен очистить answersMeta полностью');
    });
});

describe('14.U2 source-meta: createCalcFromWizard заполняет meta', () => {
    it('wizard-расчёт имеет meta с разными source значениями', () => {
        calcList.createCalcFromWizard('Test', {
            product_type: 'b2b',
            industry: 'corporate',
            scale: 'm',
            geography: 'ru',
            pdn: true,
            activity: 'medium',
            ai_used: false
        });
        const meta = store.getState().activeCalc.answersMeta;
        assert.ok(meta.product_type, 'product_type должен иметь meta');
        assert.equal(meta.product_type.source, 'wizard');

        // scale-driven поле
        assert.ok(meta.registered_users_total, 'registered_users_total должен иметь meta');
        assert.equal(meta.registered_users_total.source, 'scale');

        // derived поле (pcu_target = registered × dau% × pcu_share)
        assert.ok(meta.pcu_target, 'pcu_target должен иметь meta');
        assert.equal(meta.pcu_target.source, 'derived');
    });

    it('после wizard-fill пользовательская правка перетирает meta в "manual"', () => {
        calcList.createCalcFromWizard('Test', {
            product_type: 'b2b',
            industry: 'corporate',
            scale: 'm',
            geography: 'ru',
            pdn: true,
            activity: 'medium',
            ai_used: false
        });
        // До правки — source 'scale'
        let meta = store.getState().activeCalc.answersMeta;
        assert.equal(meta.registered_users_total.source, 'scale');

        // Правим вручную — source становится 'manual'
        calcCtl.setAnswer('registered_users_total', 999999);
        meta = store.getState().activeCalc.answersMeta;
        assert.equal(meta.registered_users_total.source, 'manual');
    });
});
