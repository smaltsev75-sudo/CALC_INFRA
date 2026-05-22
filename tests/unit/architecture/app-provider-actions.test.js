import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyProviderOverrideToActiveCalcAction,
    applyProviderOverrideToAllCalcsAction,
    openProviderHistoryModalAction,
    setDeltaHistoryProviderExpandedAction,
    rollbackProviderOverrideAction
} from '../../../js/app/providerActions.js';

function createSnackbarSpy() {
    const calls = [];
    return {
        calls,
        success(message) { calls.push(['success', message]); },
        warning(message) { calls.push(['warning', message]); },
        info(message) { calls.push(['info', message]); },
        error(message) { calls.push(['error', message]); }
    };
}

function loadingWrapper(triggerEvent, run) {
    assert.equal(triggerEvent.type, 'click');
    return run();
}

describe('app providerActions', () => {
    it('applyProviderOverrideToActiveCalcAction сообщает stale lock как warning', async () => {
        const snackbar = createSnackbarSpy();
        const result = await applyProviderOverrideToActiveCalcAction({
            triggerEvent: { type: 'click' },
            snackbar,
            withLoadingButton: loadingWrapper,
            providerCtl: {
                applyOverrideToActiveCalc: () => ({
                    ok: false,
                    reason: 'locked-by-other-tab',
                    message: 'занято другой вкладкой'
                })
            }
        });

        assert.equal(result.reason, 'locked-by-other-tab');
        assert.deepEqual(snackbar.calls, [['warning', 'занято другой вкладкой']]);
    });

    it('applyProviderOverrideToAllCalcsAction refreshes list after success', async () => {
        const snackbar = createSnackbarSpy();
        let refreshed = false;

        const result = await applyProviderOverrideToAllCalcsAction({
            triggerEvent: { type: 'click' },
            providerId: 'cloud',
            snackbar,
            withLoadingButton: loadingWrapper,
            calcList: { refreshCalcList() { refreshed = true; } },
            providerCtl: {
                applyOverrideToAllCalcsForProvider: () => ({
                    ok: true,
                    applied: 2,
                    alreadyFresh: 1,
                    errors: []
                })
            }
        });

        assert.equal(result.ok, true);
        assert.equal(refreshed, true);
        assert.deepEqual(snackbar.calls, [['success', 'Расчётов обновлено 2, уже на новом прайсе 1.']]);
    });

    it('rollbackProviderOverrideAction handles base-price restore', async () => {
        const snackbar = createSnackbarSpy();

        await rollbackProviderOverrideAction({
            triggerEvent: { type: 'click' },
            providerId: 'cloud',
            snackbar,
            withLoadingButton: loadingWrapper,
            providerCtl: {
                rollbackProvider: () => ({ ok: true, restored: null })
            }
        });

        assert.deepEqual(snackbar.calls, [[
            'success',
            'Применённый прайс снят. Используются базовые цены провайдера.'
        ]]);
    });

    it('openProviderHistoryModalAction restores persisted expanded ids', () => {
        const modals = [];

        openProviderHistoryModalAction({
            providerId: 'cloud',
            persist: {
                loadDeltaHistoryExpandedProviders: () => ['cloud', 'baremetal']
            },
            store: {
                openModal(name, payload) { modals.push([name, payload]); }
            }
        });

        assert.deepEqual(modals, [[
            'deltaHistory',
            { providerId: 'cloud', expandedIds: ['cloud', 'baremetal'] }
        ]]);
    });

    it('setDeltaHistoryProviderExpandedAction patches modal and persists next ids', () => {
        const patches = [];
        const saved = [];

        setDeltaHistoryProviderExpandedAction({
            providerId: 'baremetal',
            isExpanded: true,
            persist: {
                saveDeltaHistoryExpandedProviders(ids) { saved.push(ids); }
            },
            store: {
                getState: () => ({
                    modals: { deltaHistory: { providerId: 'cloud', expandedIds: ['cloud'] } }
                }),
                patchModal(name, patch) { patches.push([name, patch]); }
            }
        });

        assert.deepEqual(patches, [[
            'deltaHistory',
            { expandedIds: ['cloud', 'baremetal'] }
        ]]);
        assert.deepEqual(saved, [['cloud', 'baremetal']]);
    });
});
