/**
 * Внешний аудит #17 (2026-05-19, семнадцатый за серию).
 *
 *   P1 — deleteQuestion удалял ответ только из root.answers. scenarios[*].answers
 *        оставались с stale-ключом → switchScenario копировал его обратно в root,
 *        «удалённый» вопрос воскресал. Формулы доверяют любому ключу Q.
 *
 *   P2.a — saveQuestion/importQuestions добавляли default только в root.answers,
 *          не в scenarios[*].answers. validateCalculation, buildStateBundle,
 *          validateBundle считали bundle валидным; switchScenario потом удалял
 *          новый key из root.
 *
 *   P2.b — clean checkout / git archive не запускал npm test (tests/run.js
 *          gitignored) и npm run bump (scripts/ gitignored). Architecture-tests
 *          импортировали tests/_helpers/ — тоже gitignored.
 *
 *   P3 — UI bundle export warning писал «ошибок миграции/чтения» для всех
 *        reason. После audit-16 появился reason='validation' — UI лгал.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const calcListCtl = await import('../../js/controllers/calcListController.js');
const questionCtl = await import('../../js/controllers/questionController.js');
const calcCtl = await import('../../js/controllers/calcController.js');
const { store } = await import('../../js/state/store.js');
const { LATEST_SCHEMA_VERSION } = await import('../../js/state/migrations.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setPersistStatus('idle');
    store.setDefaultDictionary({ items: [], questions: [] });
});

describe('Audit #17 P1 — deleteQuestion очищает scenarios[*].answers', () => {
    it('удалённый вопрос не воскрешает после switchScenario', () => {
        const calc = calcListCtl.createCalc('P1 delete');
        assert.ok(calc);
        // Добавляем вопрос.
        questionCtl.saveQuestion({
            id: 'audit_delete_q', section: 'business', subgroup: '',
            title: 'D', description: '', recommendation: '', impact: '',
            type: 'number', defaultValue: 4,
            allowUnknown: true, assumptionRisk: 'low',
            order: 100, min: 0, max: 100, step: 1
        });
        // Дублируем scenario чтобы был неактивный.
        const state = store.getState().activeCalc;
        store.setActiveCalc({
            ...state,
            scenarios: [
                ...(state.scenarios || []),
                {
                    id: 's2-stale', label: 'Stale',
                    answers: { ...state.answers, audit_delete_q: 4 }
                }
            ]
        });
        // Удаляем вопрос.
        const r = questionCtl.deleteQuestion('audit_delete_q');
        assert.equal(r.ok, true);
        const after = store.getState().activeCalc;
        // root и ВСЕ scenarios не имеют audit_delete_q.
        assert.ok(!('audit_delete_q' in after.answers),
            'root.answers очищен');
        for (let i = 0; i < after.scenarios.length; i++) {
            assert.ok(!('audit_delete_q' in (after.scenarios[i].answers || {})),
                `scenarios[${i}].answers не должен содержать удалённый ключ`);
        }
    });
});

describe('Audit #17 P2.a — saveQuestion default во ВСЕ scenarios', () => {
    it('новый вопрос с defaultValue=7 → во всех scenarios появляется ответ', () => {
        const calc = calcListCtl.createCalc('P2a save');
        // Добавим второй scenario.
        const state = store.getState().activeCalc;
        store.setActiveCalc({
            ...state,
            scenarios: [
                ...(state.scenarios || []),
                { id: 's2', label: 'B', answers: { ...state.answers } }
            ]
        });
        // saveQuestion с defaultValue=7.
        const r = questionCtl.saveQuestion({
            id: 'audit_mirror_q', section: 'business', subgroup: '',
            title: 'M', description: '', recommendation: '', impact: '',
            type: 'number', defaultValue: 7,
            allowUnknown: true, assumptionRisk: 'low',
            order: 100, min: 0, max: 100, step: 1
        });
        assert.equal(r.ok, true);
        const after = store.getState().activeCalc;
        assert.equal(after.answers.audit_mirror_q, 7, 'root');
        assert.ok(after.scenarios.length >= 2, 'два scenarios');
        for (let i = 0; i < after.scenarios.length; i++) {
            assert.equal(after.scenarios[i].answers.audit_mirror_q, 7,
                `scenarios[${i}].answers должен содержать default=7`);
        }
    });

    it('switchScenario после saveQuestion не теряет новый вопрос', () => {
        const calc = calcListCtl.createCalc('P2a switch');
        const state = store.getState().activeCalc;
        const s2id = 's2-switch';
        store.setActiveCalc({
            ...state,
            scenarios: [
                ...(state.scenarios || []),
                { id: s2id, label: 'B', answers: { ...state.answers } }
            ]
        });
        questionCtl.saveQuestion({
            id: 'mq', section: 'business', subgroup: '',
            title: 'M', description: '', recommendation: '', impact: '',
            type: 'number', defaultValue: 7,
            allowUnknown: true, assumptionRisk: 'low',
            order: 100, min: 0, max: 100, step: 1
        });
        // switchScenario на s2.
        calcCtl.switchScenario(s2id);
        const after = store.getState().activeCalc;
        assert.equal(after.answers.mq, 7,
            'switchScenario не должен потерять новый question.default');
    });
});

describe('Audit #17 P3 — UI reason mapping', () => {
    /* Косвенная проверка через source-grep: bundle UI должен иметь явный case
     * для reason='validation'. Полный e2e тест UI смысла нет (snackbar не
     * рендерим в test environment). */
    it('bundle export UI различает reason="validation" в bundle.errors', () => {
        const src = readFileSync(
            join(process.cwd(), 'js', 'app', 'importExportActions.js'),
            'utf8'
        );
        assert.ok(/reasons\.validation/.test(src),
            'bundle export UI обязан группировать по reason=validation для bundle.errors');
        assert.ok(/невалид\./.test(src),
            'bundle export UI обязан явно писать "невалид." для validation-причины');
    });
});
