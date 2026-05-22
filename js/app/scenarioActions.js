export function switchScenarioAction({ scenarioId, calc, snackbar }) {
    const result = calc.switchScenario(scenarioId);
    if (result?.switched) {
        snackbar.info('Сценарий переключён');
    }
    return result;
}

export function addScenarioAction({ label, calc, store }) {
    const result = calc.addScenario(label);
    if (result?.scenarioId) {
        /* UX-выбор пользователя (3а): сразу после Add открываем модалку
           Rename — пользователь обычно хочет назвать сценарий. */
        store.openModal('scenarioRename', { scenarioId: result.scenarioId, draft: '' });
    }
    return result;
}

export function duplicateScenarioAction({ scenarioId, customLabel = null, calc, snackbar }) {
    const result = calc.duplicateScenario(scenarioId, customLabel);
    if (result?.scenarioId) {
        snackbar.success('Сценарий дублирован');
    }
    return result;
}

export function deleteScenarioAction({ scenarioId, store, calc, snackbar }) {
    const activeCalc = store.getState().activeCalc;
    const scenario = activeCalc?.scenarios?.find(s => s.id === scenarioId);
    if (!scenario) return null;

    const label = scenario.label || 'без названия';
    store.openModal('confirm', {
        title: 'Удалить сценарий?',
        message: `Сценарий «${label}» и его ответы будут удалены безвозвратно. Глобальные настройки расчёта (НДС, провайдер, риски) сохранятся.`,
        confirmLabel: 'Удалить',
        danger: true,
        onConfirm: () => {
            const result = calc.deleteScenario(scenarioId);
            if (result?.removed) {
                snackbar.success('Сценарий удалён');
            }
            return result;
        }
    });
    return scenario;
}

export function renameScenarioAction({ scenarioId, newLabel, calc, snackbar }) {
    const result = calc.renameScenario(scenarioId, newLabel);
    if (result?.renamed) {
        snackbar.success('Сценарий переименован');
    }
    return result;
}

export function openScenarioMenuAction({ scenarioId, store }) {
    store.openModal('scenarioMenu', { scenarioId });
}

export function openScenarioRenameAction({ scenarioId, store }) {
    const activeCalc = store.getState().activeCalc;
    const scenario = activeCalc?.scenarios?.find(s => s.id === scenarioId);
    store.openModal('scenarioRename', {
        scenarioId,
        draft: scenario?.label || ''
    });
}

export function openScenarioDuplicateAction({ scenarioId, store }) {
    store.openModal('scenarioDuplicate', { scenarioId, draft: '' });
}
