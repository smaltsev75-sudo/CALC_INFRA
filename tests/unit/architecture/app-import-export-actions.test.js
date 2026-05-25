import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importCalcAction } from '../../../js/app/importExportActions.js';

function createHarness({ importResult, activeCalc = null, warnings = [] }) {
    const modals = [];
    const tabs = [];
    const snackbarCalls = [];
    const importCalls = [];
    const calcList = {
        importCalcFromFile(opts) {
            importCalls.push(opts);
            return Promise.resolve(
                typeof importResult === 'function'
                    ? importResult(opts, importCalls.length)
                    : importResult
            );
        }
    };
    const store = {
        setActiveTab(tab) { tabs.push(tab); },
        getState() { return { activeCalc }; },
        openModal(type, payload) { modals.push({ type, payload }); }
    };
    const snackbar = {
        success(message) { snackbarCalls.push(['success', message]); },
        warning(message) { snackbarCalls.push(['warning', message]); },
        error(message) { snackbarCalls.push(['error', message]); }
    };
    return {
        modals,
        tabs,
        snackbarCalls,
        importCalls,
        run: () => importCalcAction({
            triggerEvent: null,
            store,
            calcList,
            snackbar,
            withLoadingButton: (_event, fn) => fn(),
            lintFormulas: () => warnings
        })
    };
}

describe('app importExportActions', () => {
    it('показывает JSON-ремонт даже при замечаниях к формулам', async () => {
        const repairs = [{
            fieldId: 'ram_per_vcpu_ratio',
            title: 'Соотношение RAM к CPU',
            value: 4,
            fallbackSource: 'defaultIfUnknown'
        }];
        const activeCalc = {
            dictionaries: {
                items: [{ id: 'broken-item', name: 'Битый ЭК' }],
                questions: []
            }
        };
        const harness = createHarness({
            activeCalc,
            importResult: { ok: true, repairs },
            warnings: [{ itemId: 'broken-item', stand: 'PROD', message: 'нет вопроса' }]
        });

        await harness.run();

        assert.deepEqual(harness.tabs, ['questionnaire']);
        assert.deepEqual(harness.snackbarCalls, [['success', 'Расчёт загружен']]);
        assert.equal(harness.modals.length, 1);
        assert.equal(harness.modals[0].type, 'confirm');
        assert.match(harness.modals[0].payload.title, /Автоисправить безопасное/);
        assert.match(harness.modals[0].payload.message, /Соотношение RAM к CPU/);
        assert.match(harness.modals[0].payload.message, /замечания к формулам: 1/);

        harness.modals[0].payload.onConfirm();
        assert.equal(harness.modals[1].type, 'assumptionsRegister');
        assert.deepEqual(harness.modals[1].payload.filterFieldIds, ['ram_per_vcpu_ratio']);
    });

    it('сохраняет список ремонтов через duplicate replace/clone flow', async () => {
        const repairs = [{ fieldId: 'cache_size_gb', title: 'Кэш', value: 20 }];
        const harness = createHarness({
            importResult: (opts, callNo) => callNo === 1
                ? {
                    reason: 'duplicate',
                    repairs,
                    preloaded: { id: 'calc-1' },
                    existingName: 'Старый',
                    importedName: 'Новый'
                }
                : { ok: true, repairs: opts._preloadedRepairs || [] }
        });

        await harness.run();

        assert.equal(harness.modals.length, 1);
        assert.equal(harness.modals[0].type, 'duplicateImport');

        await harness.modals[0].payload.onReplace();
        assert.equal(harness.importCalls[1].onDuplicate, 'replace');
        assert.strictEqual(harness.importCalls[1]._preloadedRepairs, repairs);
    });

    it('открывает обязательный Health gate при error после JSON-импорта', async () => {
        const activeCalc = {
            answers: { avg_rps: 80, peak_rps: 50 },
            settings: {},
            dictionaries: { items: [], questions: [] }
        };
        const harness = createHarness({
            activeCalc,
            importResult: { ok: true, repairs: [] }
        });

        await harness.run();

        assert.deepEqual(harness.tabs, ['questionnaire']);
        assert.deepEqual(harness.snackbarCalls, [
            ['success', 'Расчёт загружен'],
            ['warning', 'Расчёт загружен, но Health Check нашёл ошибки']
        ]);
        assert.equal(harness.modals.length, 1);
        assert.equal(harness.modals[0].type, 'calculationHealth');
        assert.equal(harness.modals[0].payload.gate, true);
        assert.equal(harness.modals[0].payload.source, 'jsonImport');
    });
});
