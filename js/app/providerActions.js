export function applyProviderOverrideToActiveCalcAction({
    triggerEvent,
    providerCtl,
    snackbar,
    withLoadingButton
}) {
    return withLoadingButton(triggerEvent, async () => {
        const result = providerCtl.applyOverrideToActiveCalc();
        if (result.ok) {
            const n = result.deltas?.length || 0;
            snackbar.success(
                n > 0
                    ? `Расчёт пересчитан на прайс ${result.version}: изменено цен — ${n}.`
                    : `Расчёт уже на прайсе ${result.version}.`
            );
        } else if (result.reason === 'no-override') {
            snackbar.info('Сначала загрузите обновление прайса.');
        } else if (result.reason === 'locked-by-other-tab') {
            /* Stage 11.3: conflict с update в другой вкладке — warning, не error. */
            snackbar.warning(result.message);
        } else {
            snackbar.error(result.message || 'Не удалось применить прайс.');
        }
        return result;
    });
}

export function openProviderHistoryModalAction({
    providerId,
    store,
    persist
}) {
    const persistedExpanded = persist.loadDeltaHistoryExpandedProviders();
    store.openModal('deltaHistory', {
        providerId: providerId || null,
        expandedIds: persistedExpanded
    });
}

export function setDeltaHistoryProviderExpandedAction({
    providerId,
    isExpanded,
    store,
    persist
}) {
    if (!providerId) return;
    const m = store.getState().modals.deltaHistory;
    const current = Array.isArray(m.expandedIds)
        ? m.expandedIds
        : (m.providerId ? [m.providerId] : []);
    const next = isExpanded
        ? (current.includes(providerId) ? current : [...current, providerId])
        : current.filter(id => id !== providerId);
    store.patchModal('deltaHistory', { expandedIds: next });
    /* best-effort: UI-state persist (accordion state). На сбое следующий
     * клик повторит запись; дефолт после reboot — приемлемый fallback. */
    persist.saveDeltaHistoryExpandedProviders(next);
}

export function openProviderAnalyticsModalAction({
    store,
    persist
}) {
    const persistedVisible = persist.loadProviderAnalyticsVisibleCategories();
    store.openModal('providerAnalytics', {
        sortBy: 'total',
        sortDir: 'asc',
        visibleCategories: persistedVisible
    });
}

export function setProviderAnalyticsVisibleCategoriesAction({
    categories,
    persist
}) {
    /* best-effort: UI-state filter persist. */
    persist.saveProviderAnalyticsVisibleCategories(categories);
}

export function openScenarioComparisonModalAction({
    store,
    persist,
    snackbar
}) {
    const calc = store.getState().activeCalc;
    if (!calc) {
        snackbar.warning('Сначала откройте расчёт.');
        return;
    }
    const persistedSelected = persist.loadScenarioComparisonSelectedProviders();
    const persistedCats = persist.loadProviderAnalyticsVisibleCategories();
    store.openModal('scenarioComparison', {
        selectedProviderIds: persistedSelected,
        visibleCategories: persistedCats
    });
}

export function setScenarioComparisonSelectedProvidersAction({
    providerIds,
    persist
}) {
    /* best-effort: UI-state filter persist. */
    persist.saveScenarioComparisonSelectedProviders(providerIds);
}

export function restoreProviderOverrideAtAction({
    triggerEvent,
    providerId,
    idx,
    providerCtl,
    calcList,
    snackbar,
    withLoadingButton
}) {
    return withLoadingButton(triggerEvent, async () => {
        const result = providerCtl.restoreProviderOverrideFromHistory(providerId, idx);
        if (result.ok) {
            snackbar.success(
                `Прайс восстановлен: ${result.restored.version}.`
                + (result.hasMoreHistory ? ' В истории есть ещё точки.' : '')
            );
            calcList.refreshCalcList();
        } else if (result.reason === 'no-history') {
            snackbar.info('Нет истории для отката.');
        } else if (result.reason === 'invalid-index') {
            snackbar.error('Некорректный индекс истории.');
        } else if (result.reason === 'locked-by-other-tab') {
            snackbar.warning(result.message);
        } else {
            snackbar.error(result.message || 'Не удалось восстановить прайс.');
        }
        return result;
    });
}

export function rollbackProviderOverrideAction({
    triggerEvent,
    providerId,
    providerCtl,
    snackbar,
    withLoadingButton
}) {
    return withLoadingButton(triggerEvent, async () => {
        const result = providerCtl.rollbackProvider(providerId);
        if (result.ok) {
            if (result.restored) {
                snackbar.success(
                    `Прайс возвращён к версии ${result.restored.version}.`
                    + (result.hasMoreHistory ? ' В истории есть ещё одна версия.' : '')
                );
            } else {
                snackbar.success('Применённый прайс снят. Используются базовые цены провайдера.');
            }
        } else if (result.reason === 'no-override') {
            snackbar.info('Нет применённого прайса для отката.');
        } else if (result.reason === 'locked-by-other-tab') {
            snackbar.warning(result.message);
        } else {
            snackbar.error(result.message || 'Не удалось откатить прайс.');
        }
        return result;
    });
}

export function applyProviderOverrideToAllCalcsAction({
    triggerEvent,
    providerId,
    providerCtl,
    calcList,
    snackbar,
    withLoadingButton
}) {
    return withLoadingButton(triggerEvent, async () => {
        const result = providerCtl.applyOverrideToAllCalcsForProvider(providerId);
        if (!result.ok) {
            if (result.reason === 'no-override') {
                snackbar.info('Сначала загрузите обновление прайса.');
            } else if (result.reason === 'locked-by-other-tab') {
                snackbar.warning(result.message);
            } else {
                snackbar.error(result.message || 'Не удалось применить прайс ко всем расчётам.');
            }
            return result;
        }
        const parts = [];
        if (result.applied > 0) parts.push(`обновлено ${result.applied}`);
        if (result.alreadyFresh > 0) parts.push(`уже на новом прайсе ${result.alreadyFresh}`);
        if (result.errors.length > 0) parts.push(`ошибок ${result.errors.length}`);
        const message = parts.length > 0
            ? `Расчётов ${parts.join(', ')}.`
            : `Нет расчётов на провайдере ${providerId}.`;
        if (result.errors.length > 0) {
            snackbar.warning(message);
        } else {
            snackbar.success(message);
        }
        /* Refresh calcList — обновляются totalMonthly после применения. */
        calcList.refreshCalcList();
        return result;
    });
}
