/**
 * Внешний аудит #18 (2026-05-19, восемнадцатый за серию).
 *
 *   P1 (covered by graceful skip — invariant): 5 maintainer-only тестов теперь
 *        тихо скипаются при отсутствии fixtures.
 *
 *   P2 (covered by \r?\n regex fix — invariant): atomic-rollback-invariant
 *        работает на Windows CRLF.
 *
 *   P3 — deleteQuestion не чистил answersMeta. После switchScenario meta
 *        возвращалась в root. Bundle проходил валидацию, но orphan meta
 *        оставалась в экспорте.
 *
 * Этот файл — runtime-проверка P3 (CRUD-операция меняет state в ожидаемом
 * направлении). Source-grep invariant для P3 в seed-settings-migrations-invariant.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const calcListCtl = await import('../../js/controllers/calcListController.js');
const questionCtl = await import('../../js/controllers/questionController.js');
const { store } = await import('../../js/state/store.js');

beforeEach(() => {
    installLocalStorage();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setPersistStatus('idle');
    store.setDefaultDictionary({ items: [], questions: [] });
});

describe('Audit #18 P3 — deleteQuestion чистит answersMeta', () => {
    it('root.answersMeta[qid] удаляется при deleteQuestion', () => {
        const calc = calcListCtl.createCalc('P3 meta');
        // Создаём вопрос.
        questionCtl.saveQuestion({
            id: 'audit_meta_q', section: 'business', subgroup: '',
            title: 'M', description: '', recommendation: '', impact: '',
            type: 'number', defaultValue: 4,
            allowUnknown: true, assumptionRisk: 'low',
            order: 100, min: 0, max: 100, step: 1
        });
        // Вручную добавим answersMeta для этого вопроса (имитируем wizard-source).
        const state = store.getState().activeCalc;
        store.setActiveCalc({
            ...state,
            answersMeta: { ...(state.answersMeta || {}), audit_meta_q: { source: 'manual' } }
        });
        // Удаляем вопрос.
        const r = questionCtl.deleteQuestion('audit_meta_q');
        assert.equal(r.ok, true);
        const after = store.getState().activeCalc;
        assert.ok(!('audit_meta_q' in (after.answersMeta || {})),
            `root.answersMeta должен очиститься: ${JSON.stringify(after.answersMeta)}`);
    });

    it('scenarios[*].answersMeta[qid] удаляется при deleteQuestion', () => {
        const calc = calcListCtl.createCalc('P3 meta scenarios');
        questionCtl.saveQuestion({
            id: 'audit_sc_meta_q', section: 'business', subgroup: '',
            title: 'M', description: '', recommendation: '', impact: '',
            type: 'number', defaultValue: 4,
            allowUnknown: true, assumptionRisk: 'low',
            order: 100, min: 0, max: 100, step: 1
        });
        // Добавляем сценарий со stale meta.
        const state = store.getState().activeCalc;
        store.setActiveCalc({
            ...state,
            scenarios: [
                ...(state.scenarios || []),
                {
                    id: 's2-meta', label: 'Stale',
                    answers: { ...state.answers },
                    answersMeta: { audit_sc_meta_q: { source: 'manual' } }
                }
            ]
        });
        const r = questionCtl.deleteQuestion('audit_sc_meta_q');
        assert.equal(r.ok, true);
        const after = store.getState().activeCalc;
        for (let i = 0; i < after.scenarios.length; i++) {
            const meta = after.scenarios[i].answersMeta || {};
            assert.ok(!('audit_sc_meta_q' in meta),
                `scenarios[${i}].answersMeta должен очиститься: ${JSON.stringify(meta)}`);
        }
    });

    it('после switchScenario meta удалённого вопроса не воскресает в root', async () => {
        const calcCtl = await import('../../js/controllers/calcController.js');
        const calc = calcListCtl.createCalc('P3 meta switch');
        questionCtl.saveQuestion({
            id: 'rev_meta_q', section: 'business', subgroup: '',
            title: 'M', description: '', recommendation: '', impact: '',
            type: 'number', defaultValue: 4,
            allowUnknown: true, assumptionRisk: 'low',
            order: 100, min: 0, max: 100, step: 1
        });
        const s2id = 's2-switch-meta';
        const state = store.getState().activeCalc;
        store.setActiveCalc({
            ...state,
            answersMeta: { ...(state.answersMeta || {}), rev_meta_q: { source: 'manual' } },
            scenarios: [
                ...(state.scenarios || []),
                {
                    id: s2id, label: 'B',
                    answers: { ...state.answers },
                    answersMeta: { rev_meta_q: { source: 'manual' } }
                }
            ]
        });
        // Удаляем.
        questionCtl.deleteQuestion('rev_meta_q');
        // Переключаем scenario.
        calcCtl.switchScenario(s2id);
        const after = store.getState().activeCalc;
        assert.ok(!('rev_meta_q' in (after.answersMeta || {})),
            `после switchScenario root.answersMeta не должен содержать удалённый key: ${JSON.stringify(after.answersMeta)}`);
    });
});
