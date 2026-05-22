/**
 * Внешний аудит #5 (2026-05-18, пятый за день).
 *
 * 5 родственных к аудиту #4 silent-failure / rollback / неатомарность
 * пунктов, НЕ покрытых фиксами PATCH 2.17.6:
 *
 *   P1-1  calcPersistence._rollbackCalc + saveCalcList(backup): try/catch
 *         ловит throw, но save* возвращают boolean (false) при quota —
 *         silent. При двойном сбое persistStatus говорит обычное
 *         QUOTA_ERROR_MSG, пользователь не знает, что storage противоречив.
 *   P2-1  deleteItem / deleteQuestion / applyPriceUpdates / importItems.onAccepted /
 *         importQuestions.onAccepted: best-effort commitActiveCalc.
 *         UI показывает «Элемент удалён» с UNDO, на F5 элемент возвращается.
 *   P3-1  providerController.restoreProviderOverrideFromHistory: rollback
 *         current только если backupCurrent существовал. Иначе target
 *         остаётся записан как новый current.
 *   P2-2  guidedCompletionController.rollbackGuidedCompletion: НЕ вызывает
 *         commitActiveCalc, полагается на subscriber autosave. При quota
 *         откат не сохраняется в storage.
 *   P3-2  costOptimizationPlannerController.rollbackOptimizationApply:
 *         игнорирует commitActiveCalc return + чистит lastApplySnapshot.
 *         Пользователь теряет snapshot для retry, F5 возвращает apply.
 *
 * Все тесты должны падать на коде ДО фикса и проходить после.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './storage-mock.js';

installLocalStorage();

const storageMod = await import('../../js/services/storage.js');
const persist = await import('../../js/state/persistence.js');
const { store } = await import('../../js/state/store.js');
const calcPersist = await import('../../js/services/calcPersistence.js');
const itemCtl = await import('../../js/controllers/itemController.js');
const questionCtl = await import('../../js/controllers/questionController.js');
const providerCtl = await import('../../js/controllers/providerController.js');
const guidedCompletionCtl = await import('../../js/controllers/guidedCompletionController.js');
const costOptCtl = await import('../../js/controllers/costOptimizationPlannerController.js');

/* ============================================================
 * helpers — копия из audit-4 (selective per-key quota)
 * ============================================================ */

function installSelectiveQuotaSpy() {
    const data = new Map();
    const failKeys = new Set();
    const ls = {
        get length() { return data.size; },
        key(i) { return Array.from(data.keys())[i] ?? null; },
        getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
        setItem(k, v) {
            const key = String(k);
            if (failKeys.has(key)) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            data.set(key, String(v));
        },
        removeItem(k) { data.delete(String(k)); },
        clear() { data.clear(); }
    };
    Object.defineProperty(globalThis, 'localStorage', {
        value: ls, configurable: true, writable: true
    });
    return {
        ls, data, failKeys,
        fail(key) { failKeys.add(key); },
        unfail(key) { failKeys.delete(key); }
    };
}

beforeEach(() => {
    installLocalStorage();
    storageMod.__resetStorageMode();
    store.setActiveCalc(null);
    store.setCalcList([]);
    store.setPersistStatus('idle');
});

/* ============================================================
 * P1-1: _rollbackCalc проверяет return persist.saveCalc/removeCalc
 * ============================================================ */

function installCounterQuotaSpy() {
    const data = new Map();
    const failKeys = new Set();
    /* failOnAttempt[key]: после N-го setItem на этот ключ начинаем кидать quota.
     * Используется для тестов «step 1 прошёл, rollback упал». */
    const failOnAttempt = new Map();
    const attempts = new Map();
    const ls = {
        get length() { return data.size; },
        key(i) { return Array.from(data.keys())[i] ?? null; },
        getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
        setItem(k, v) {
            const key = String(k);
            const n = (attempts.get(key) || 0) + 1;
            attempts.set(key, n);
            const failFrom = failOnAttempt.get(key);
            if ((failFrom && n >= failFrom) || failKeys.has(key)) {
                const err = new Error('QuotaExceededError');
                err.name = 'QuotaExceededError';
                throw err;
            }
            data.set(key, String(v));
        },
        removeItem(k) { data.delete(String(k)); },
        clear() { data.clear(); }
    };
    Object.defineProperty(globalThis, 'localStorage', {
        value: ls, configurable: true, writable: true
    });
    return {
        ls, data, failKeys, failOnAttempt, attempts,
        fail(key) { failKeys.add(key); },
        failFromAttempt(key, n) { failOnAttempt.set(key, n); }
    };
}

describe('External audit #5 P1-1: _rollbackCalc проверяет boolean return', () => {
    it('двойной сбой (calc.list-save + оба rollback fail) → persistMessage «перезагрузите»', () => {
        /* Сценарий: commitActiveCalc (rename). Step 1 saveCalc(renamed) — succeed.
         * Step 3 saveCalcList — fail. _rollbackList: saveCalcList(backupList) —
         * fail (calc.list в fail-set). _rollbackCalc: saveCalc(backupCalcSnapshot) —
         * fail (вторая запись calc.<id> через failFromAttempt=2). */
        const spy = installCounterQuotaSpy();
        storageMod.__resetStorageMode();

        const calc = {
            id: 'audit5-p11-1',
            name: 'Original',
            updatedAt: '2026-05-18T10:00:00.000Z',
            schemaVersion: 18,
            settings: {},
            answers: {},
            dictionaries: { items: [], questions: [] }
        };
        /* Seed через прямой spy.data.set — НЕ инкрементирует attempts counter. */
        spy.data.set('calc.' + calc.id, JSON.stringify(calc));
        spy.data.set('calc.list', JSON.stringify(
            [{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]
        ));

        spy.fail('calc.list');                          // list-save и rollback list fail
        spy.failFromAttempt('calc.' + calc.id, 2);      // step 1 ok (attempt 1), rollback fail (attempt 2)

        const renamed = { ...calc, name: 'NewName', updatedAt: '2026-05-18T11:00:00.000Z' };
        const ok = calcPersist.commitActiveCalc(renamed);
        assert.equal(ok, false);

        const state = store.getState();
        assert.equal(state.persistStatus, 'error');
        assert.match(String(state.persistMessage || ''),
            /перезагрузите страницу|расходятся|partial/i,
            'При двойном сбое (save + rollback) persistMessage обязан сигнализировать ' +
            '«состояние памяти ≠ хранилищу, перезагрузите», а не обычное QUOTA_ERROR_MSG. ' +
            'Текущее: ' + String(state.persistMessage));
    });
});

/* ============================================================
 * P2-1: deleteItem / deleteQuestion → {ok:false, reason:'persist'}
 * ============================================================ */

describe('External audit #5 P2-1: deleteItem/deleteQuestion возвращают {ok:false} при quota', () => {
    it('deleteItem при quota → {ok:false, reason:"persist"}', () => {
        const calc = {
            id: 'audit5-p21-1',
            name: 'Test',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            schemaVersion: 18,
            settings: {},
            answers: {},
            dictionaries: {
                items: [{
                    id: 'it-1', name: 'Item 1', unit: 'шт.', pricePerUnit: 100,
                    category: 'HW', resourceClass: 'CPU', billingInterval: 'monthly',
                    vendor: '', description: '',
                    applicableStands: ['PROD'], qtyFormulas: { PROD: '1' }, formulaHelp: ''
                }],
                questions: []
            }
        };
        persist.saveCalc(calc);
        persist.saveCalcList([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]);
        store.setActiveCalc(calc);

        /* Quota на calc.<id> — commit-fail. */
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        spy.data.set('calc.' + calc.id, JSON.stringify(calc));
        spy.data.set('calc.list', JSON.stringify([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]));
        spy.fail('calc.' + calc.id);

        const result = itemCtl.deleteItem('it-1');
        assert.equal(result?.ok, false);
        assert.equal(result?.reason, 'persist');
        assert.match(String(result.message || ''), /quota|хранилищ|сохран|освободите/i);
    });

    it('deleteQuestion при quota → {ok:false, reason:"persist"}', () => {
        const calc = {
            id: 'audit5-p21-2',
            name: 'Test',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            schemaVersion: 18,
            settings: {},
            answers: { q1: 5 },
            dictionaries: {
                items: [],
                questions: [{ id: 'q1', section: 'business', subgroup: '', title: 'Q1', description: '',
                    type: 'number', defaultValue: 0, allowUnknown: true, assumptionRisk: 'low',
                    order: 1, min: 0, max: 100, step: 1 }]
            }
        };
        persist.saveCalc(calc);
        persist.saveCalcList([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]);
        store.setActiveCalc(calc);

        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        spy.data.set('calc.' + calc.id, JSON.stringify(calc));
        spy.data.set('calc.list', JSON.stringify([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]));
        spy.fail('calc.' + calc.id);

        const result = questionCtl.deleteQuestion('q1');
        assert.equal(result?.ok, false);
        assert.equal(result?.reason, 'persist');
    });
});

/* ============================================================
 * P3-1: providerController — clearProviderOverride когда backupCurrent=null
 * ============================================================ */

describe('External audit #5 P3-1: restoreProviderOverrideFromHistory очищает target при backupCurrent=null', () => {
    it('current отсутствует до операции + сбой history-trim → target очищается, current=null', () => {
        const providerId = 'audit5-prov-1';
        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        /* History хранится в едином map по ключу calc.providerOverrideHistory:
         * { <providerId>: [snapshot, ...] }. PROVIDER_OVERLAY_OVERRIDES пустой
         * (нет current до операции — backupCurrent будет null). */
        const historyEntry = {
            appliedAt: '2026-05-18T09:00:00.000Z',
            appliedJSON: { providerId, schemaVersion: 2, pricesIncludeVat: false, items: [] }
        };
        spy.data.set('calc.providerOverrideHistory',
            JSON.stringify({ [providerId]: [historyEntry] }));
        /* calc.providerOverlayOverrides отсутствует → loadProviderOverrides()={}. */

        /* Quota на history-write — restore сначала запишет current (succeed),
         * потом упадёт на trim. */
        spy.fail('calc.providerOverrideHistory');

        const result = providerCtl.restoreProviderOverrideFromHistory(providerId, 0);
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'persist');

        /* КРИТИЧНО: target НЕ должен остаться как current. */
        const overrides = persist.loadProviderOverrides() || {};
        assert.equal(overrides[providerId], undefined,
            'При backupCurrent=null и сбое history-trim target обязан быть очищен через ' +
            'clearProviderOverride, иначе пользователь видит partial state — restore «не удался», ' +
            'но target де-факто стал current.');
    });
});

/* ============================================================
 * P2-2: guidedCompletion rollback вызывает commitActiveCalc + проверяет
 * ============================================================ */

describe('External audit #5 P2-2: rollbackGuidedCompletion явно persist + проверяет return', () => {
    it('snapshot восстановлен И calc.<id> в storage соответствует snapshot', () => {
        const calc = {
            id: 'audit5-p22-1',
            name: 'GC Test',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            schemaVersion: 18,
            settings: { applyRiskFactors: true },
            answers: { q1: 5 },
            answersMeta: {},
            dictionaries: { items: [], questions: [] }
        };
        persist.saveCalc(calc);
        persist.saveCalcList([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]);
        store.setActiveCalc(calc);

        /* Симулируем активный мастер: установим ui.guidedCompletion с snapshot. */
        store.setUi({
            guidedCompletion: {
                active: true,
                startScore: 50,
                snapshot: {
                    answers: { q1: 5 },
                    answersMeta: {},
                    settings: { applyRiskFactors: true }
                },
                plan: { steps: [], totalSteps: 0, sourceCounts: {} },
                currentIndex: 0,
                completedStepIds: [],
                skippedStepIds: []
            }
        });
        store.openModal('guidedCompletion');

        /* Применим «правки мастера» в store (обходим setAnswer чтобы не зависеть
         * от формулы каскада — нам важна сама механика rollback). */
        store.updateActiveCalc({ answers: { q1: 99 } });
        /* В storage ещё calc с q1=5. После updateActiveCalc storage не тронут. */

        /* Меняем calc в storage напрямую — имитируем что мастер успел
         * persist'нуть q1=99 раньше. */
        const dirtyCalc = { ...calc, answers: { q1: 99 } };
        persist.saveCalc(dirtyCalc);

        /* Теперь rollback должен ВЕРНУТЬ q1=5 И в storage. */
        const result = guidedCompletionCtl.rollbackGuidedCompletion();
        assert.equal(result?.ok, true);

        /* После rollback в storage calc.<id>.answers.q1 === 5 (snapshot), не 99. */
        const stored = persist.loadCalc(calc.id);
        assert.ok(stored);
        assert.equal(stored.answers.q1, 5,
            'rollbackGuidedCompletion должен явно вызвать commitActiveCalc(snapshot) — ' +
            'без этого storage остаётся с применёнными мастером правками, F5 их возвращает.');
    });

    it('persist-fail при rollback → возвращает {ok:false, reason:"persist"}', () => {
        const calc = {
            id: 'audit5-p22-2',
            name: 'GC Test 2',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            schemaVersion: 18,
            settings: {},
            answers: { q1: 5 },
            answersMeta: {},
            dictionaries: { items: [], questions: [] }
        };
        persist.saveCalc(calc);
        persist.saveCalcList([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]);
        store.setActiveCalc(calc);

        store.setUi({
            guidedCompletion: {
                active: true, startScore: 50,
                snapshot: { answers: { q1: 5 }, answersMeta: {}, settings: {} },
                plan: { steps: [], totalSteps: 0, sourceCounts: {} },
                currentIndex: 0, completedStepIds: [], skippedStepIds: []
            }
        });
        store.openModal('guidedCompletion');

        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        spy.data.set('calc.' + calc.id, JSON.stringify(calc));
        spy.data.set('calc.list', JSON.stringify([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]));
        spy.fail('calc.' + calc.id);

        const result = guidedCompletionCtl.rollbackGuidedCompletion();
        assert.equal(result?.ok, false);
        assert.equal(result?.reason, 'persist');
    });
});

/* ============================================================
 * P3-2: costOptimization rollback сохраняет snapshot при persist-fail
 * ============================================================ */

describe('External audit #5 P3-2: rollbackOptimizationApply сохраняет lastApplySnapshot при persist-fail', () => {
    it('persist-fail → {ok:false, reason:"persist"} И lastApplySnapshot не обнулён', () => {
        const calc = {
            id: 'audit5-p32-1',
            name: 'CO Test',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            schemaVersion: 18,
            settings: { bufferTask: 0.15, bufferProject: 0.10, kInflation: 0.07,
                kSeasonal: 0.10, kScheduleShift: 0.10, kContingency: 0.05,
                applyRiskFactors: true, vatEnabled: true, vatRate: 0.22,
                vatRateMode: 'manual', vatEffectiveDate: null,
                planningHorizonYears: 3, phaseDurationMonths: 12,
                provider: 'manual',
                standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 0.80, PROD: 1.00 } },
            answers: {},
            answersMeta: {},
            dictionaries: { items: [], questions: [] }
        };
        persist.saveCalc(calc);
        persist.saveCalcList([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]);
        store.setActiveCalc(calc);

        /* Симулируем модалку с lastApplySnapshot — имитируем «уже было apply». */
        const fakeSnapshot = {
            settings: { ...calc.settings, bufferTask: 0.05 /* «было до apply» */ },
            answers: {},
            answersMeta: {}
        };
        store.openModal('costOptimizationPlanner', {
            draft: {
                level: 'ambitious', constraints: {}, touchedConstraints: {},
                changes: {}, preview: { savingPercent: 0, savingByGroup: {} }
            },
            lastApplySnapshot: fakeSnapshot,
            viewPeriod: 'month',
            openGroups: []
        });

        const spy = installSelectiveQuotaSpy();
        storageMod.__resetStorageMode();
        spy.data.set('calc.' + calc.id, JSON.stringify(calc));
        spy.data.set('calc.list', JSON.stringify([{ id: calc.id, name: calc.name, updatedAt: calc.updatedAt }]));
        spy.fail('calc.' + calc.id);

        const result = costOptCtl.rollbackOptimizationApply();
        assert.equal(result?.ok, false);
        assert.equal(result?.reason, 'persist');

        /* lastApplySnapshot НЕ должен быть обнулён — пользователь должен иметь retry. */
        const modal = store.getState().modals.costOptimizationPlanner;
        assert.ok(modal?.lastApplySnapshot,
            'rollbackOptimizationApply при persist-fail НЕ должен обнулять lastApplySnapshot. ' +
            'Иначе пользователь теряет snapshot и не может retry, F5 возвращает apply.');
        assert.equal(modal.lastApplySnapshot.settings.bufferTask, 0.05,
            'lastApplySnapshot сохранён с прежним содержимым.');
    });
});
