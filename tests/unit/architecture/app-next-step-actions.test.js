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

    it('resetAnswersAction delegates to controller and shows success toast', () => {
        const calls = [];
        const calc = { resetAnswers() { calls.push('reset'); } };
        const snackbar = { calls: [], success(message) { this.calls.push(message); } };

        resetAnswersAction({ calc, snackbar });

        assert.deepEqual(calls, ['reset']);
        assert.deepEqual(snackbar.calls, ['Ответы сброшены к значениям по умолчанию']);
    });
});
