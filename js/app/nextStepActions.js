import { ADVANCED_ONLY_NEXT_STEP_TARGETS } from '../utils/constants.js';
import { buildRecommendedActions } from '../domain/recommendedActions.js';

export function getActiveNextStepsAction({ store }) {
    const calc = store.getState().activeCalc;
    if (!calc) return [];
    const all = buildRecommendedActions(calc);
    const advancedMode = !!store.getState().ui.advancedModeEnabled;
    if (advancedMode) return all;
    return all.filter(action => !ADVANCED_ONLY_NEXT_STEP_TARGETS.includes(action.target));
}

export function setHealthLastTabAction({ tab, store }) {
    if (typeof tab !== 'string') return;
    store.setUi({ healthLastTab: tab });
}

export function resetAnswersAction({ calc, snackbar }) {
    calc.resetAnswers();
    snackbar.success('Ответы сброшены к значениям по умолчанию');
}
