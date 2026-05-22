import { debounce } from '../utils/debounce.js';
import { CALC_LIST_REFRESH_DEBOUNCE_MS } from '../utils/constants.js';

function shouldSaveObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function createUiPersistenceRules(persist, applyThemeAttribute) {
    return [
        {
            name: 'questionnaireOpenSections',
            read: state => state.ui.questionnaireOpenSections,
            shouldSave: Array.isArray,
            save: value => persist.saveQuestionnaireOpenSections(value)
        },
        {
            name: 'questionnaireSettingsOpen',
            read: state => state.ui.questionnaireSettingsOpen,
            shouldSave: value => typeof value === 'boolean',
            save: value => persist.saveQuestionnaireSettingsOpen(value)
        },
        {
            name: 'questionnaireCollapsedSubgroups',
            read: state => state.ui.questionnaireCollapsedSubgroups,
            shouldSave: shouldSaveObject,
            save: value => persist.saveQuestionnaireCollapsedSubgroups(value)
        },
        {
            name: 'comparisonSort',
            read: state => state.ui.comparisonSort,
            shouldSave: () => true,
            save: value => persist.saveComparisonSort(value)
        },
        {
            name: 'standCardsCatsExpanded',
            read: state => state.ui.standCardsCatsExpanded,
            shouldSave: Array.isArray,
            save: value => persist.saveStandCardsCatsExpanded(value)
        },
        {
            name: 'detailsCollapsedCats',
            read: state => state.ui.detailsCollapsedCats,
            shouldSave: Array.isArray,
            save: value => persist.saveDetailsCollapsedCats(value)
        },
        {
            name: 'comparisonCollapsedCats',
            read: state => state.ui.comparisonCollapsedCats,
            shouldSave: Array.isArray,
            save: value => persist.saveComparisonCollapsedCats(value)
        },
        {
            name: 'itemsCollapsedCats',
            read: state => state.ui.itemsCollapsedCats,
            shouldSave: Array.isArray,
            save: value => persist.saveItemsCollapsedCats(value)
        },
        {
            name: 'questionsCollapsedSecs',
            read: state => state.ui.questionsCollapsedSecs,
            shouldSave: Array.isArray,
            save: value => persist.saveQuestionsCollapsedSecs(value)
        },
        {
            name: 'theme',
            read: state => state.ui.theme,
            shouldSave: value => typeof value === 'string',
            beforeSave: value => applyThemeAttribute(value),
            save: value => persist.saveTheme(value)
        },
        {
            name: 'providerOverlayExpanded',
            read: state => state.ui.providerOverlayExpanded,
            shouldSave: value => typeof value === 'boolean',
            save: value => persist.saveProviderOverlayExpanded(value)
        },
        {
            name: 'healthLastTab',
            read: state => state.ui.healthLastTab,
            shouldSave: value => typeof value === 'string',
            save: value => persist.saveHealthLastTab(value)
        },
        {
            name: 'advancedModeEnabled',
            read: state => state.ui.advancedModeEnabled,
            shouldSave: value => typeof value === 'boolean',
            save: value => persist.saveAdvancedModeEnabled(value)
        }
    ];
}

/**
 * Подписка composition-root'а: рендер, snackbar по persistStatus и сохранение
 * мелкого UI-state. UI-state сохраняется best-effort; если запись вернула
 * false, last-value не сдвигается и следующий store tick попробует снова.
 */
export function subscribeAppPersistence({
    store,
    persist,
    calcList,
    snackbar,
    scheduleRender,
    applyThemeAttribute
}) {
    const initial = store.getState();
    let lastPersistStatus = initial.persistStatus;
    let lastActiveTab = initial.activeTab;
    const rules = createUiPersistenceRules(persist, applyThemeAttribute);
    const lastByRule = new Map(rules.map(rule => [rule.name, rule.read(initial)]));

    // 12.U33: применяем тему сразу на boot, не дожидаясь первого рендера.
    applyThemeAttribute(lastByRule.get('theme'));

    const refreshAfterSave = debounce(() => {
        calcList.refreshCalcList();
    }, CALC_LIST_REFRESH_DEBOUNCE_MS);

    return store.subscribe(state => {
        scheduleRender();

        if (state.persistStatus !== lastPersistStatus) {
            if (state.persistStatus === 'error' && lastPersistStatus !== 'error') {
                snackbar.error(state.persistMessage || 'Не удалось сохранить расчёт');
            }
            if (state.persistStatus === 'saved' && lastPersistStatus !== 'saved') {
                refreshAfterSave();
            }
            lastPersistStatus = state.persistStatus;
        }

        if (state.activeTab !== lastActiveTab) {
            const ok = persist.saveActiveTab(state.activeTab);
            if (ok !== false) lastActiveTab = state.activeTab;
        }

        for (const rule of rules) {
            const value = rule.read(state);
            if (value === lastByRule.get(rule.name)) continue;
            if (!rule.shouldSave(value)) continue;
            if (rule.beforeSave) rule.beforeSave(value);
            const ok = rule.save(value);
            if (ok !== false) lastByRule.set(rule.name, value);
        }
    });
}
