import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { subscribeAppPersistence } from '../../../js/app/uiPersistenceSubscriber.js';

const BASE_UI = {
    questionnaireOpenSections: null,
    questionnaireSettingsOpen: null,
    questionnaireCollapsedSubgroups: null,
    comparisonSort: null,
    standCardsCatsExpanded: null,
    detailsCollapsedCats: null,
    comparisonCollapsedCats: null,
    itemsCollapsedCats: null,
    questionsCollapsedSecs: null,
    theme: 'dark',
    providerOverlayExpanded: null,
    healthLastTab: null,
    advancedModeEnabled: false
};

function createState(overrides = {}) {
    return {
        persistStatus: 'idle',
        persistMessage: null,
        activeTab: 'calculations',
        ui: { ...BASE_UI },
        ...overrides,
        ui: { ...BASE_UI, ...(overrides.ui || {}) }
    };
}

function createStore(initialState) {
    let state = initialState;
    let listener = null;
    return {
        getState: () => state,
        subscribe(fn) {
            listener = fn;
            return () => { listener = null; };
        },
        emit(nextState) {
            state = nextState;
            listener(state);
        }
    };
}

function createPersist(overrides = {}) {
    const ok = () => true;
    return {
        saveActiveTab: ok,
        saveQuestionnaireOpenSections: ok,
        saveQuestionnaireSettingsOpen: ok,
        saveQuestionnaireCollapsedSubgroups: ok,
        saveComparisonSort: ok,
        saveStandCardsCatsExpanded: ok,
        saveDetailsCollapsedCats: ok,
        saveComparisonCollapsedCats: ok,
        saveItemsCollapsedCats: ok,
        saveQuestionsCollapsedSecs: ok,
        saveTheme: ok,
        saveProviderOverlayExpanded: ok,
        saveHealthLastTab: ok,
        saveAdvancedModeEnabled: ok,
        ...overrides
    };
}

function subscribeWith(overrides = {}) {
    const store = overrides.store || createStore(createState());
    const persist = createPersist(overrides.persist);
    subscribeAppPersistence({
        store,
        persist,
        calcList: { refreshCalcList() {} },
        snackbar: { error() {} },
        scheduleRender: overrides.scheduleRender || (() => {}),
        applyThemeAttribute: overrides.applyThemeAttribute || (() => {})
    });
    return { store, persist };
}

describe('subscribeAppPersistence', () => {
    it('ретраит activeTab save, если persistence вернул false', () => {
        const calls = [];
        const { store } = subscribeWith({
            persist: {
                saveActiveTab(tabId) {
                    calls.push(tabId);
                    return calls.length > 1;
                }
            }
        });

        const next = createState({ activeTab: 'dashboard' });
        store.emit(next);
        store.emit({ ...next, persistMessage: 'unrelated tick' });

        assert.deepEqual(calls, ['dashboard', 'dashboard']);
    });

    it('применяет тему на boot и при смене темы', () => {
        const themes = [];
        const saveCalls = [];
        const { store } = subscribeWith({
            applyThemeAttribute: theme => themes.push(theme),
            persist: {
                saveTheme(theme) {
                    saveCalls.push(theme);
                    return true;
                }
            }
        });

        store.emit(createState({ ui: { theme: 'light' } }));

        assert.deepEqual(themes, ['dark', 'light']);
        assert.deepEqual(saveCalls, ['light']);
    });
});
