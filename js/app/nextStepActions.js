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

export function resetAnswersAction({ calc, store, snackbar }) {
    /* T-RISK-5 (data-safety review 2026-06-13): сброс ответов теперь обратим —
       снимаем backup ДО сброса и показываем undo-snackbar (симметрично
       deleteItem/deleteQuestion). Раньше сброс был необратим: success-snackbar
       без undo, при том что confirm есть (questionnaire.js), но backup — нет. */
    const active = store.getState().activeCalc;
    if (!active) return;
    const backup = {
        answers: { ...(active.answers || {}) },
        answersMeta: { ...(active.answersMeta || {}) }
    };
    calc.resetAnswers();
    snackbar.showUndoableSnackbar(
        'Ответы сброшены к значениям по умолчанию',
        () => { calc.restoreAnswers(backup); }
    );
}
