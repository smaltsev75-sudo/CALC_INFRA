import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyReapplyAction,
    countManualAnswerMeta,
    openQuickStartAction,
    openQuickStartForActiveScenarioProfileAction,
    openQuickStartForEditAction,
    openReapplyConfirmAction
} from '../../../js/app/quickStartActions.js';

function makeStore(activeCalc, modalState = {}) {
    return {
        modals: [],
        updates: [],
        getState() {
            return {
                activeCalc,
                modals: { reapplyConfirm: {}, ...modalState }
            };
        },
        openModal(name, payload) { this.modals.push([name, payload]); },
        updateActiveCalc(patch) { this.updates.push(patch); }
    };
}

describe('app/quickStartActions', () => {
    it('openQuickStartAction opens the wizard modal', () => {
        const store = makeStore(null);

        openQuickStartAction({ store });

        assert.deepEqual(store.modals, [['quickStart', undefined]]);
    });

    it('openQuickStartForEditAction pre-fills draft from existing wizard', () => {
        const store = makeStore({
            name: 'Calc',
            wizard: { scale: 'm' },
            settings: { provider: 'sbercloud' }
        });

        const draft = openQuickStartForEditAction({ store });

        assert.deepEqual(draft, { scale: 'm', provider: 'sbercloud', name: 'Calc' });
        assert.deepEqual(store.modals[0], ['quickStart', { mode: 'edit', draft }]);
    });

    it('openQuickStartForActiveScenarioProfileAction works for null-wizard scenarios', () => {
        const store = makeStore({
            name: 'Legacy',
            wizard: null,
            settings: { provider: 'vk' }
        });

        const draft = openQuickStartForActiveScenarioProfileAction({ store });

        assert.deepEqual(draft, { provider: 'vk', name: 'Legacy' });
        assert.deepEqual(store.modals[0], ['quickStart', { mode: 'edit', draft }]);
    });

    it('openReapplyConfirmAction skips modal when there are no manual fields', () => {
        const store = makeStore({ answersMeta: { a: { source: 'profile' } } });
        const calls = [];

        const result = openReapplyConfirmAction({
            draftWizard: { scale: 'l' },
            store,
            applyReapply: (mode, draft) => {
                calls.push([mode, draft]);
                return { ok: true };
            }
        });

        assert.deepEqual(result, { ok: true });
        assert.deepEqual(calls, [['overwrite', { scale: 'l' }]]);
        assert.equal(store.modals.length, 0);
    });

    it('openReapplyConfirmAction opens confirm modal when manual fields exist', () => {
        const store = makeStore({
            answersMeta: {
                a: { source: 'manual' },
                b: { source: 'profile' },
                c: { source: 'manual' }
            }
        });

        const result = openReapplyConfirmAction({
            draftWizard: null,
            store,
            applyReapply: () => { throw new Error('must not be called'); }
        });

        assert.deepEqual(result, { manualCount: 2 });
        assert.deepEqual(store.modals[0], ['reapplyConfirm', { manualCount: 2, draftWizard: null }]);
        assert.equal(countManualAnswerMeta(store.getState().activeCalc), 2);
    });

    it('applyReapplyAction writes explicit draft before controller reapply and reports result', () => {
        const store = makeStore(null);
        const snackbar = { calls: [], success(message) { this.calls.push(message); } };
        const calc = {
            reapplyProfile(mode) {
                assert.equal(mode, 'overwrite');
                return { changed: 7 };
            }
        };

        const result = applyReapplyAction({
            mode: 'overwrite',
            explicitDraftWizard: { industry: 'fintech' },
            store,
            calc,
            snackbar
        });

        assert.deepEqual(result, { changed: 7 });
        assert.deepEqual(store.updates, [{ wizard: { industry: 'fintech' } }]);
        assert.equal(snackbar.calls[0], 'Профиль применён (полная перезапись). Изменено полей: 7.');
    });
});
