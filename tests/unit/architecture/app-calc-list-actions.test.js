import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createCalcAction,
    createCalcFromWizardAction,
    duplicateCalcAction,
    renameCalcAction,
    deleteCalcAction
} from '../../../js/app/calcListActions.js';

function createSnackbarSpy() {
    const calls = [];
    return {
        calls,
        success(message) { calls.push(['success', message]); },
        error(message) { calls.push(['error', message]); },
        showUndoableSnackbar(message, undo) { calls.push(['undo', message, undo]); }
    };
}

describe('app calcListActions', () => {
    it('createCalcAction защищает от double-click и не создаёт второй расчёт', () => {
        const snackbar = createSnackbarSpy();
        const created = [];
        const tabs = [];
        const calcList = {
            createCalc(name, templateId) {
                created.push([name, templateId]);
                return { id: `calc-${created.length}` };
            }
        };
        const store = { setActiveTab(tab) { tabs.push(tab); } };

        const first = createCalcAction({
            name: 'A',
            templateId: null,
            calcList,
            store,
            snackbar,
            now: 1000
        });
        const second = createCalcAction({
            name: 'B',
            templateId: null,
            calcList,
            store,
            snackbar,
            now: 1200
        });

        assert.equal(first.id, 'calc-1');
        assert.equal(second, null);
        assert.deepEqual(created, [['A', null]]);
        assert.deepEqual(tabs, ['questionnaire']);
    });

    it('createCalcFromWizardAction показывает quota-error без перехода на dashboard', () => {
        const snackbar = createSnackbarSpy();
        const tabs = [];

        const result = createCalcFromWizardAction({
            name: 'Wizard',
            wizardInput: {},
            now: 2000,
            calcList: { createCalcFromWizard: () => null },
            store: { setActiveTab(tab) { tabs.push(tab); } },
            snackbar
        });

        assert.equal(result, null);
        assert.equal(tabs.length, 0);
        assert.equal(snackbar.calls[0][0], 'error');
    });

    it('duplicateCalcAction не рапортует success при quota fail', () => {
        const snackbar = createSnackbarSpy();

        duplicateCalcAction({
            id: 'calc-1',
            now: 3000,
            snackbar,
            calcList: { duplicateCalc: () => null }
        });

        assert.equal(snackbar.calls[0][0], 'error');
    });

    it('renameCalcAction trims input and reports persist fail', () => {
        const snackbar = createSnackbarSpy();
        const renamed = [];
        let inputPayload;

        renameCalcAction({
            id: 'calc-1',
            currentName: 'Old',
            snackbar,
            input: opts => { inputPayload = opts; },
            calcList: {
                renameCalc(id, name) {
                    renamed.push([id, name]);
                    return { ok: false, message: 'quota' };
                }
            }
        });
        inputPayload.onConfirm('  New  ');

        assert.equal(inputPayload.defaultValue, 'Old');
        assert.deepEqual(renamed, [['calc-1', 'New']]);
        assert.deepEqual(snackbar.calls, [['error', 'quota']]);
    });

    it('deleteCalcAction restores from undo only when delete succeeded', () => {
        const snackbar = createSnackbarSpy();
        let confirmPayload;
        const backup = { id: 'calc-1' };
        let restored = false;

        deleteCalcAction({
            id: 'calc-1',
            name: 'Calc',
            snackbar,
            confirm: opts => { confirmPayload = opts; },
            calcList: {
                snapshotCalc: () => backup,
                deleteCalc: () => ({ ok: true }),
                restoreCalc(calc) {
                    restored = calc === backup;
                    return true;
                }
            }
        });
        confirmPayload.onConfirm();
        snackbar.calls[0][2]();

        assert.equal(confirmPayload.danger, true);
        assert.equal(restored, true);
        assert.deepEqual(snackbar.calls.at(-1), ['success', 'Расчёт восстановлен']);
    });
});
