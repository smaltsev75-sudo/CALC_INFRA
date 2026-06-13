import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    getActiveNextStepsAction,
    resetAnswersAction,
    setHealthLastTabAction
} from '../../../js/app/nextStepActions.js';

function makeStore(state) {
    return {
        uiPatches: [],
        getState() { return state; },
        setUi(patch) { this.uiPatches.push(patch); }
    };
}

describe('app/nextStepActions', () => {
    it('getActiveNextStepsAction returns [] when there is no active calc', () => {
        const store = makeStore({ activeCalc: null, ui: { advancedModeEnabled: false } });

        assert.deepEqual(getActiveNextStepsAction({ store }), []);
    });

    it('setHealthLastTabAction persists only string tabs', () => {
        const store = makeStore({});

        setHealthLastTabAction({ tab: 'warning', store });
        setHealthLastTabAction({ tab: null, store });

        assert.deepEqual(store.uiPatches, [{ healthLastTab: 'warning' }]);
    });

    it('resetAnswersAction: backup + reset + undoable-snackbar; undo восстанавливает (T-RISK-5)', () => {
        const active = { answers: { a: 5 }, answersMeta: { a: { source: 'manual' } } };
        const store = makeStore({ activeCalc: active });
        const calls = [];
        const calc = {
            resetAnswers() { calls.push('reset'); },
            restoreAnswers(backup) { calls.push(['restore', backup]); }
        };
        let undoFn = null;
        const snackbar = {
            msg: null,
            showUndoableSnackbar(message, onUndo) { this.msg = message; undoFn = onUndo; }
        };

        resetAnswersAction({ calc, store, snackbar });

        assert.deepEqual(calls, ['reset'], 'сброс выполнен');
        assert.equal(snackbar.msg, 'Ответы сброшены к значениям по умолчанию');
        assert.ok(typeof undoFn === 'function', 'показан undoable-snackbar с колбэком отмены');

        undoFn();
        assert.deepEqual(calls[1], ['restore', { answers: { a: 5 }, answersMeta: { a: { source: 'manual' } } }],
            'undo восстанавливает прежние answers/answersMeta из backup');
    });

    it('resetAnswersAction: нет активного calc → no-op без падения (T-RISK-5)', () => {
        const store = makeStore({ activeCalc: null });
        const calc = { resetAnswers() { throw new Error('не должен вызываться'); } };
        const snackbar = { showUndoableSnackbar() { throw new Error('не должен вызываться'); } };
        assert.doesNotThrow(() => resetAnswersAction({ calc, store, snackbar }));
    });
});
