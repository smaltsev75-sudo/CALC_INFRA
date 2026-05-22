import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    addScenarioAction,
    deleteScenarioAction,
    duplicateScenarioAction,
    openScenarioDuplicateAction,
    openScenarioRenameAction,
    renameScenarioAction,
    switchScenarioAction
} from '../../../js/app/scenarioActions.js';

function makeSnackbar() {
    return {
        calls: [],
        info(message) { this.calls.push(['info', message]); },
        success(message) { this.calls.push(['success', message]); }
    };
}

function makeStore(activeCalc = { scenarios: [] }) {
    return {
        modals: [],
        getState() { return { activeCalc }; },
        openModal(name, payload) { this.modals.push([name, payload]); }
    };
}

describe('app/scenarioActions', () => {
    it('switchScenarioAction delegates to controller and shows toast only on real switch', () => {
        const snackbar = makeSnackbar();
        const calc = {
            switchScenario(id) {
                assert.equal(id, 's2');
                return { switched: true };
            }
        };

        const result = switchScenarioAction({ scenarioId: 's2', calc, snackbar });

        assert.deepEqual(result, { switched: true });
        assert.deepEqual(snackbar.calls, [['info', 'Сценарий переключён']]);
    });

    it('addScenarioAction opens rename modal for a created scenario', () => {
        const store = makeStore();
        const calc = {
            addScenario(label) {
                assert.equal(label, 'Новый');
                return { scenarioId: 's-new' };
            }
        };

        addScenarioAction({ label: 'Новый', calc, store });

        assert.equal(store.modals.length, 1);
        assert.equal(store.modals[0][0], 'scenarioRename');
        assert.deepEqual(store.modals[0][1], { scenarioId: 's-new', draft: '' });
    });

    it('duplicateScenarioAction forwards custom label and reports success', () => {
        const snackbar = makeSnackbar();
        const calc = {
            duplicateScenario(id, customLabel) {
                assert.equal(id, 'base');
                assert.equal(customLabel, 'С GPU');
                return { scenarioId: 'copy' };
            }
        };

        duplicateScenarioAction({ scenarioId: 'base', customLabel: 'С GPU', calc, snackbar });

        assert.deepEqual(snackbar.calls, [['success', 'Сценарий дублирован']]);
    });

    it('deleteScenarioAction opens confirm modal and deletes only after confirm', () => {
        const store = makeStore({
            scenarios: [{ id: 's1', label: 'База' }]
        });
        const snackbar = makeSnackbar();
        const deleted = [];
        const calc = {
            deleteScenario(id) {
                deleted.push(id);
                return { removed: true };
            }
        };

        const scenario = deleteScenarioAction({ scenarioId: 's1', store, calc, snackbar });

        assert.equal(scenario.label, 'База');
        assert.equal(deleted.length, 0);
        assert.equal(store.modals[0][0], 'confirm');
        assert.equal(store.modals[0][1].danger, true);

        store.modals[0][1].onConfirm();

        assert.deepEqual(deleted, ['s1']);
        assert.deepEqual(snackbar.calls, [['success', 'Сценарий удалён']]);
    });

    it('rename and open helpers keep modal payloads thin', () => {
        const store = makeStore({
            scenarios: [{ id: 's1', label: 'Текущий' }]
        });
        const snackbar = makeSnackbar();
        const calc = {
            renameScenario(id, label) {
                assert.equal(id, 's1');
                assert.equal(label, 'Новый label');
                return { renamed: true };
            }
        };

        renameScenarioAction({ scenarioId: 's1', newLabel: 'Новый label', calc, snackbar });
        openScenarioRenameAction({ scenarioId: 's1', store });
        openScenarioDuplicateAction({ scenarioId: 's1', store });

        assert.deepEqual(snackbar.calls, [['success', 'Сценарий переименован']]);
        assert.equal(store.modals[0][0], 'scenarioRename');
        assert.deepEqual(store.modals[0][1], { scenarioId: 's1', draft: 'Текущий' });
        assert.equal(store.modals[1][0], 'scenarioDuplicate');
        assert.deepEqual(store.modals[1][1], { scenarioId: 's1', draft: '' });
    });
});
