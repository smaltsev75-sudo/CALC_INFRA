export function openQuickStartAction({ store }) {
    store.openModal('quickStart');
}

export function openQuickStartForEditAction({ store }) {
    const calc = store.getState().activeCalc;
    if (!calc?.wizard) return null;
    const draft = { ...calc.wizard, provider: calc.settings?.provider, name: calc.name };
    store.openModal('quickStart', { mode: 'edit', draft });
    return draft;
}

export function openQuickStartForActiveScenarioProfileAction({ store }) {
    const calc = store.getState().activeCalc;
    if (!calc) return null;
    const draft = calc.wizard
        ? { ...calc.wizard, provider: calc.settings?.provider, name: calc.name }
        : { provider: calc.settings?.provider, name: calc.name };
    store.openModal('quickStart', { mode: 'edit', draft });
    return draft;
}

export function countManualAnswerMeta(calc) {
    const meta = calc?.answersMeta || {};
    let manualCount = 0;
    for (const item of Object.values(meta)) {
        if (item?.source === 'manual') manualCount++;
    }
    return manualCount;
}

export function openReapplyConfirmAction({ draftWizard, store, applyReapply }) {
    const calc = store.getState().activeCalc;
    if (!calc) return null;
    const manualCount = countManualAnswerMeta(calc);
    if (manualCount === 0) {
        return applyReapply('overwrite', draftWizard);
    }
    store.openModal('reapplyConfirm', { manualCount, draftWizard });
    return { manualCount };
}

export function applyReapplyAction({ mode, explicitDraftWizard, store, calc, snackbar }) {
    const fromModal = store.getState().modals.reapplyConfirm.draftWizard;
    const draftWizard = explicitDraftWizard ?? fromModal;
    if (draftWizard) {
        store.updateActiveCalc({ wizard: { ...draftWizard } });
    }
    const result = calc.reapplyProfile(mode);
    const noun = mode === 'preserve' ? 'с сохранением правок' : 'полная перезапись';
    snackbar.success(`Профиль применён (${noun}). Изменено полей: ${result.changed}.`);
    return result;
}
