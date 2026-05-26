/**
 * Точка входа приложения. Связывает store, UI, контроллеры и горячие клавиши.
 * Архитектура слоёв:
 *   ui → controllers → state/store → domain (чистая логика)
 *   services — IO (storage, json, format, markdown)
 *   utils — нижний уровень (constants, escapeHtml, debounce, uuid)
 */

import { store } from './state/store.js';
import * as persist from './state/persistence.js';
import { STORAGE_KEYS, STAND_IDS } from './utils/constants.js';
import * as calcList from './controllers/calcListController.js';
import * as calc from './controllers/calcController.js';
import { flushPendingCommit } from './controllers/calcController.js';
import { evaluateCalculationHealth } from './domain/calculationHealth.js';
import { commitActiveCalc } from './services/calcPersistence.js';
import * as itemCtl from './controllers/itemController.js';
import * as questionCtl from './controllers/questionController.js';
import * as providerCtl from './controllers/providerController.js';
import * as budgetCtl from './controllers/budgetGuardrailsController.js';
import * as memoCtl from './controllers/decisionMemoController.js';
import * as guidedCompletionCtl from './controllers/guidedCompletionController.js';
import * as priceImportCtl from './controllers/priceImportMappingController.js';
import * as costOptimizationCtl from './controllers/costOptimizationPlannerController.js';
import * as healthScoreTrendCtl from './controllers/healthScoreTrendController.js';
import { startCrossTabSync } from './state/crossTabSync.js';
import { subscribe as subscribeCrossTabNotifier } from './state/crossTabNotifier.js';
import { loadReadmeHtml } from './controllers/helpController.js';
import { bindHotkeys } from './controllers/keyboardController.js';
import { mountUi, renderApp } from './ui/index.js';
import * as snackbar from './ui/snackbar.js';
import { findQuestionUsages, lintFormulas } from './domain/validation.js';
import {
    acquireAppInstanceLock,
    releaseAppInstanceLock,
    startAppInstanceHeartbeat
} from './services/appInstanceLock.js';
import { renderInstanceBlockedScreen } from './ui/instanceBlockedScreen.js';
import { withLoadingButton } from './app/loadingButton.js';
import { handleUpdateProviderResult, showOptimizationApplyResult } from './app/toastResults.js';
import { applyThemeAttribute } from './app/theme.js';
import { maybeShowLegacyVatBanner, maybeShowLegacyProviderVatBanner } from './app/vatBanners.js';
import { createRenderScheduler } from './app/renderScheduler.js';
import { installModalHashNavigation } from './app/modalHashNavigation.js';
import { subscribeAppPersistence } from './app/uiPersistenceSubscriber.js';
import { createAppInstanceLockRuntime } from './app/instanceLockRuntime.js';
import { nextCollapsedIds, nextGlobalExpandedIds } from './app/toggleState.js';
import { beginDetailsPrintMode } from './utils/printMode.js';
import {
    importCalcAction,
    exportCalcAction,
    exportStateBundleAction,
    importStateBundleAction,
    exportCsvAction,
    exportComparisonCsvAction
} from './app/importExportActions.js';
import {
    handlePriceImportFileAction,
    applyPriceImportAction,
    importItemPricesAction
} from './app/priceImportActions.js';
import {
    deleteItemAction,
    duplicateItemAction,
    deleteQuestionAction,
    duplicateQuestionAction
} from './app/crudActions.js';
import {
    applyProviderOverrideToActiveCalcAction,
    openProviderHistoryModalAction,
    setDeltaHistoryProviderExpandedAction,
    openProviderAnalyticsModalAction,
    setProviderAnalyticsVisibleCategoriesAction,
    openScenarioComparisonModalAction,
    setScenarioComparisonSelectedProvidersAction,
    restoreProviderOverrideAtAction,
    rollbackProviderOverrideAction,
    applyProviderOverrideToAllCalcsAction
} from './app/providerActions.js';
import {
    printPdfAction,
    printAnswersAction,
    openSummaryFormulaAction
} from './app/printActions.js';
import { focusQuestionAction } from './app/focusQuestionAction.js';
import {
    createCalcAction,
    createCalcFromWizardAction,
    duplicateCalcAction,
    renameCalcAction,
    deleteCalcAction
} from './app/calcListActions.js';
import { chooseVatPolicyAction, cancelVatPolicyChoiceAction } from './app/vatPolicyActions.js';
import {
    switchScenarioAction,
    addScenarioAction,
    duplicateScenarioAction,
    deleteScenarioAction,
    renameScenarioAction,
    openScenarioMenuAction,
    openScenarioRenameAction,
    openScenarioDuplicateAction
} from './app/scenarioActions.js';
import {
    openQuickStartAction,
    openQuickStartForEditAction,
    openQuickStartForActiveScenarioProfileAction,
    openReapplyConfirmAction,
    applyReapplyAction
} from './app/quickStartActions.js';
import {
    getActiveNextStepsAction,
    setHealthLastTabAction,
    resetAnswersAction
} from './app/nextStepActions.js';
import { copyCalculationDiagnosticBundle } from './app/diagnosticActions.js';

function _handleUpdateProviderResult(result) {
    return handleUpdateProviderResult(result, snackbar);
}

function _showOptimizationApplyResult(r) {
    return showOptimizationApplyResult(r, snackbar);
}

/* ---------- Контекст для UI: набор всех действий ---------- */

const ctx = {
    /* Список расчётов */
    setActiveTab(id) { store.setActiveTab(id); },

    /* Stage 17.3: переход на вкладку «Опросник» с фокусом на конкретное поле.
       Используется из Dashboard-блоков (Budget «Указать бюджет»), модалок
       Health Check / Допущения / Реестр допущений (кнопки «Перейти к полю»).
       До этого ctx.focusQuestion отсутствовал — все 4 call-site'а имели
       `typeof === 'function'` guard и молчаливо no-op'или.
       Реализация: setActiveTab('questionnaire') + recentlyChangedKey запускает
       .field-recent + .section-recent CSS-glow и одновременно раскрывает
       секцию-владельца вопроса (читается в openedSections). */
    focusQuestion(questionId) {
        return focusQuestionAction({ questionId, store, snackbar });
    },
    createCalc(name, templateId = null) {
        return createCalcAction({ name, templateId, calcList, store, snackbar });
    },
    /* Stage 4.9/4.14: ctx.openNewCalc удалён вместе с newCalcModal. Создание
       нового расчёта идёт через Quick Start (3 preset'а после Stage 17.2)
       или напрямую через ctx.createCalc(name, null) для пустого расчёта. */
    /* 14.U1: Quick Start Wizard — открыть модалку с 7 макро-вопросами. */
    openQuickStart() {
        return openQuickStartAction({ store });
    },
    listActiveProvidersForQuickStart() {
        return providerCtl.listActiveProvidersForQuickStart();
    },
    getDefaultProviderId() {
        return providerCtl.getDefaultProviderId();
    },
    /* 14.U3: открыть Quick Start в режиме просмотра/изменения параметров активного
       расчёта. Draft предзаполнен из calc.wizard, поле «Название» скрыто, submit
       пока no-op (re-apply придёт в Sprint 2.2 пункте 3 с диалогом сохранения правок). */
    openQuickStartForEdit() {
        return openQuickStartForEditAction({ store });
    },
    /* Stage 18.2 (v2.13.1): открыть Quick Start, чтобы задать профиль активного
       сценария, у которого его сейчас нет (`calc.wizard === null` — обычно
       legacy-сценарии до v2.13.1 или сценарии, явно созданные без профиля).
       Submit пойдёт через openReapplyConfirm → applyReapply('overwrite') —
       контракт edit-mode'а. draft предзаполнен defaultDraft внутри модалки
       (модалка сама подставит PRESETS[0].draft, если draft пустой). */
    openQuickStartForActiveScenarioProfile() {
        return openQuickStartForActiveScenarioProfileAction({ store });
    },
    /* 14.U3: helper-обёртка над snackbar.info для UI-слоя — UI не импортирует snackbar
       напрямую (layer purity), а зовёт через ctx. */
    snackbarInfo(message) { snackbar.info(message); },

    async copyDiagnosticBundle() {
        const state = store.getState();
        if (!state.activeCalc) {
            snackbar.warning('Нет активного расчёта для диагностики.');
            return false;
        }
        const result = await copyCalculationDiagnosticBundle(state.activeCalc, {
            revision: state.calcRevision
        });
        if (result.ok) {
            snackbar.success(
                'Диагностический JSON скопирован. Он локальный и не отправляется автоматически; внутри могут быть параметры расчёта.'
            );
        } else {
            snackbar.error('Не удалось скопировать диагностический JSON в буфер обмена.');
        }
        return result.ok;
    },
    /* 14.U5: открыть диалог подтверждения re-apply профиля.
       draftWizard — новый объект 7 макро-ответов (если юзер поменял их в QS
       edit-mode). Если undefined — re-apply работает по существующему calc.wizard.

       Если manual-полей нет (N=0) — диалог пропускается, сразу выполняем
       overwrite (manual-полей нет значит preserve и overwrite эквивалентны).
       При N>0 — модалка с тремя вариантами (см. reapplyConfirmModal.js). */
    openReapplyConfirm(draftWizard) {
        return openReapplyConfirmAction({
            draftWizard,
            store,
            applyReapply: (mode, draft) => ctx.applyReapply(mode, draft)
        });
    },
    applyReapply(mode, explicitDraftWizard) {
        return applyReapplyAction({ mode, explicitDraftWizard, store, calc, snackbar });
    },
    /* 14.U1: создание расчёта по итогам Quick Start. Вызывается из QuickStart-модалки.
       Аргументы: name (string), wizardInput (объект 7 ответов).

       Stage 18.1.2: больше не показываем success-snackbar — dashboard сам
       отображает результат (новые цифры, имя в TopBar, бейджи «Из профиля»
       на полях опросника). Старый текст «Расчёт создан из профиля «<industry>»»
       перекрывал footer Cost Optimization Planner. */
    createCalcFromWizard(name, wizardInput) {
        const created = createCalcFromWizardAction({ name, wizardInput, calcList, store, snackbar });
        const calc = store.getState().activeCalc;
        if (calc) {
            const health = evaluateCalculationHealth(calc);
            if (health.counts.error > 0) {
                snackbar.warning('Quick Start создал расчёт, но Health Check нашёл ошибки');
                store.openModal('calculationHealth', { gate: true, source: 'quickStart' });
            }
        }
        return created;
    },
    openCalc(id) {
        calcList.openCalc(id);
        store.setActiveTab('questionnaire');
        maybeShowLegacyVatBanner(store, snackbar);
        maybeShowLegacyProviderVatBanner(store, snackbar);
    },
    duplicateCalc(id) {
        return duplicateCalcAction({ id, calcList, snackbar });
    },
    renameCalc(id, currentName) {
        return renameCalcAction({
            id, currentName, calcList, snackbar,
            input: opts => ctx.input(opts)
        });
    },
    deleteCalc(id, name) {
        return deleteCalcAction({
            id, name, calcList, snackbar,
            confirm: opts => ctx.confirm(opts)
        });
    },
    importCalc(triggerEvent) {
        return importCalcAction({
            triggerEvent, store, calcList, snackbar, withLoadingButton, lintFormulas
        });
    },
    exportCalc(triggerEvent) {
        return exportCalcAction({ triggerEvent, calcList, snackbar, withLoadingButton });
    },

    /* Полный экспорт/импорт всего состояния (bundle) */
    exportStateBundle(triggerEvent) {
        return exportStateBundleAction({
            triggerEvent, store, calcList, snackbar, withLoadingButton
        });
    },

    importStateBundle(triggerEvent) {
        return importStateBundleAction({
            triggerEvent, store, calcList, snackbar, withLoadingButton,
            confirm: opts => ctx.confirm(opts)
        });
    },
    exportCsv(triggerEvent) {
        return exportCsvAction({ triggerEvent, store, snackbar, withLoadingButton });
    },
    /* Активный расчёт */
    setName(name)             { calc.setName(name); },
    setSetting(key, value)    { calc.setSetting(key, value); },
    setProvider(value)        { calc.setProvider(value); },
    /* Единственный пользовательский workflow обновления прайса —
       загрузка локального JSON (file-picker → validate → save). */
    updateProviderPricesFromFile(triggerEvent, providerId) {
        return withLoadingButton(triggerEvent, async () => {
            const result = await providerCtl.updateProviderPricesFromFile(providerId);
            return _handleUpdateProviderResult(result);
        });
    },
    clearProviderUpdateStatus(providerId) { providerCtl.clearProviderUpdateStatus(providerId); },
    /* Stage VAT-2 Phase 5: пользователь выбрал политику НДС в vatPolicyChoice
     * modal → закрываем модалку и повторно вызываем validate+save с явной
     * `userVatPolicy`. Допустимые значения: 'net' | 'gross-20' | 'gross-22'. */
    chooseVatPolicy(userVatPolicy) {
        return chooseVatPolicyAction({
            userVatPolicy,
            store,
            providerCtl,
            handleUpdateProviderResult: _handleUpdateProviderResult
        });
    },
    /* Stage VAT-2 Phase 5: пользователь отменил импорт legacy v1 → закрываем
     * модалку, prices без изменений. Никакого toast'а — тихая отмена. */
    cancelVatPolicyChoice() {
        return cancelVatPolicyChoiceAction({ store });
    },
    /* Stage 8.3: применить применённый override к активному расчёту
       (swap dictionary.items + запись calc.providerVersion). Вызывается из
       UI кнопки «Пересчитать на новом прайсе» в блоке провайдера. */
    applyProviderOverrideToActiveCalc(triggerEvent) {
        return applyProviderOverrideToActiveCalcAction({
            triggerEvent, providerCtl, snackbar, withLoadingButton
        });
    },
    /* Stage 8.3: read-only геттеры для UI — UI не импортирует controllers
       напрямую (layer purity), а ходит через ctx. Эти геттеры вызываются на
       каждом render'е, поэтому должны быть дешёвыми. */
    isActiveCalcStale() { return providerCtl.isActiveCalcStale(); },
    getCurrentOverrideVersion(providerId) { return providerCtl.getCurrentOverrideVersion(providerId); },
    /* Stage 9.1: эффективные цены провайдера (frozen ∪ user override) для UI.
       UI не импортирует services/providerPriceResolver напрямую — ходит через ctx
       (UI → services тоже layer violation; allowable путь только через ctx). */
    getEffectivePricesForProvider(providerId) {
        return providerCtl.resolveEffectivePricesForProvider(providerId);
    },
    /* Stage 9.5: read-only геттер для UI — top-of-stack history snapshot.
       Возвращает { appliedJSON, appliedAt } | null. UI рендерит кнопку
       «Откатить на предыдущий прайс» только когда есть snapshot. */
    peekPreviousProviderOverride(providerId) {
        return providerCtl.peekPreviousOverride(providerId);
    },
    /* Stage 10.3: read-only геттеры для DeltaHistoryPanel — current override
       (полный JSON) + список history snapshot'ов. */
    getCurrentProviderOverride(providerId) {
        return providerCtl.getCurrentProviderOverride(providerId);
    },
    getProviderOverrideHistory(providerId) {
        return providerCtl.getProviderOverrideHistory(providerId);
    },
    /* Stage 10.3 + 14.4 (PATCH 2.7.2): открыть модалку «История прайсов».
       providerId передаётся как preselected — UI auto-expand'ит этот блок при
       первом open'е, если пользователь не сохранял свой набор раскрытых блоков.
       После Stage 14.4 модалка всегда рендерится как accordion для всех активных
       провайдеров с историей. expandedIds восстанавливается из localStorage;
       null = «не сохранено» → дефолт = [providerId]. */
    openProviderHistoryModal(providerId) {
        return openProviderHistoryModalAction({ providerId, store, persist });
    },
    /* Stage 14.4: список всех активных провайдеров с историей (current override
       и/или непустая history) для рендера accordion'а. */
    getAllProvidersWithHistory() {
        return providerCtl.getAllProvidersWithHistory();
    },
    /* Stage 14.4: persist раскрытого блока accordion'а. UI вызывает на каждый
       клик по toggle-кнопке провайдера. expandedIds === null означает «снять
       сохранение» (вернуться к дефолту = [providerId]). */
    setDeltaHistoryProviderExpanded(providerId, isExpanded) {
        return setDeltaHistoryProviderExpandedAction({ providerId, isExpanded, store, persist });
    },
    /* Открыть модалку «Прайс-бенчмарк» (read-only сравнение цен провайдеров).
       visibleCategories восстанавливается из localStorage; null = UI применит
       дефолтные колонки для текущего расчёта. */
    openProviderAnalyticsModal() {
        return openProviderAnalyticsModalAction({ store, persist });
    },
    /* Stage 14.1: persist фильтра колонок в localStorage. Вызывается из UI
       при каждом toggle, чтобы F5 не сбрасывал выбор. */
    setProviderAnalyticsVisibleCategories(categories) {
        return setProviderAnalyticsVisibleCategoriesAction({ categories, persist });
    },
    /* Stage 14.5 (PATCH 2.7.3): cross-provider scenario сравнение — модалка
       items × providers для активного calc. */
    openScenarioComparisonModal() {
        return openScenarioComparisonModalAction({ store, persist, snackbar });
    },
    setScenarioComparisonSelectedProviders(providerIds) {
        return setScenarioComparisonSelectedProvidersAction({ providerIds, persist });
    },
    /* Список active провайдеров для UI чекбоксов. */
    listActiveProvidersForComparison() {
        return providerCtl.listActiveProvidersForComparison();
    },
    /* Cross-provider сравнение для активного calc. */
    getCalcCrossProviderComparison(providerIds) {
        const calc = store.getState().activeCalc;
        if (!calc) return { currentProviderId: null, providers: [] };
        return providerCtl.getCalcCrossProviderComparison(calc, providerIds);
    },
    /* Stage 10.4 → 2.20.40: pure-domain агрегатор для cross-provider table.
       UI передаёт effective-цены и, если есть активный расчёт, top-ЭК для
       calc-specific бенчмарка. */
    aggregateProviderPrices(providerIds, effectiveByProvider, benchmarkItems = null) {
        return providerCtl.aggregateProviderPrices(providerIds, effectiveByProvider, benchmarkItems);
    },
    /* Stage 11.1: read-only геттер — заблокирован ли провайдер cross-tab'ом.
       UI рендерит fetch/file кнопки disabled + tooltip «обновляется в другой
       вкладке» когда true. Возвращает boolean (true только если live lock от
       другой вкладки). */
    isProviderLockedByOtherTab(providerId) {
        const locks = store.getState().ui.providerCrossTabLocks || {};
        return Boolean(locks[providerId]);
    },
    /* Универсальный snackbar wrapper для использования из модалок (передаётся
       как ctx.snackbar(text, type) — type: 'success'|'error'|'warning'|'info'). */
    snackbar(text, type = 'info') {
        if (!text) return;
        if (type === 'success') snackbar.success(text);
        else if (type === 'error') snackbar.error(text);
        else if (type === 'warning') snackbar.warning(text);
        else snackbar.info(text);
    },
    /* Stage 10.3: восстановить override на конкретный history-индекс.
       После rollback — toast + refresh calcList (totalMonthly могут поменяться,
       если у calc'ов привязан старый providerVersion). */
    restoreProviderOverrideAt(triggerEvent, providerId, idx) {
        return restoreProviderOverrideAtAction({
            triggerEvent, providerId, idx, providerCtl, calcList, snackbar, withLoadingButton
        });
    },
    /* Stage 9.5: rollback override → предыдущий прайс из history. После
       успешного отката пользователь продолжает работать на старых ценах,
       но calc'и с providerVersion остаются на их применённой версии (могут
       стать stale → появится «Старый прайс» badge). */
    rollbackProviderOverride(triggerEvent, providerId) {
        return rollbackProviderOverrideAction({
            triggerEvent, providerId, providerCtl, snackbar, withLoadingButton
        });
    },
    /* Stage 8.5: применить current override ко ВСЕМ расчётам с этим провайдером.
       После операции — toast c summary («Обновлено N, без изменений M, ошибок K»).
       Использует best-effort iteration: ошибка на одном calc'е не прерывает остальные. */
    applyProviderOverrideToAllCalcs(triggerEvent, providerId) {
        return applyProviderOverrideToAllCalcsAction({
            triggerEvent, providerId, providerCtl, calcList, snackbar, withLoadingButton
        });
    },
    setResourceRatio(stand, resource, value) { calc.setResourceRatio(stand, resource, value); },
    setAiStandFactor(stand, value) { calc.setAiStandFactor(stand, value); },
    /* Stage VAT-1 Phase 4: VAT mode controllers (UI будет подключён в Phase 5). */
    setVatRateMode(mode) { calc.setVatRateMode(mode); },
    setVatEffectiveDate(isoDate) { calc.setVatEffectiveDate(isoDate); },
    setVatRateManual(rate) { calc.setVatRateManual(rate); },
    freezeVatRate() { calc.freezeVatRate(); },
    setAnswer(qid, value) {
        const r = calc.setAnswer(qid, value);
        /* 12.U18: аномалии (например, dau_share > 80%) показываются snackbar'ом.
           Контроллер сам snackbar не вызывает (controllers → ui = layer violation). */
        if (r?.anomaly) {
            const fn = r.anomaly.level === 'warn' ? snackbar.warning : snackbar.info;
            fn(r.anomaly.message);
        }
    },
    acknowledgeHealthFinding(findingId, fieldIds) {
        return calc.acknowledgeHealthFinding(findingId, fieldIds);
    },
    setSearch(tabId, q)       { calc.setSearch(tabId, q); },
    setUi(patch)              { store.setUi(patch); },
    toggleStand(standId) { calc.toggleStand(standId); },
    /* 12.U33: переключатель темы dark ↔ light. Subscriber в boot
       применяет state.ui.theme к <html data-theme="..."> и persist'ит. */
    setTheme(theme)           { calc.setTheme(theme); },
    toggleTheme()             { calc.toggleTheme(); },

    /* Stage 17.2 Phase 3c: режим «Расширенные настройки». При выключении
       автоматически уводит с admin-tab (items/questions) на safe-вкладку. */
    setAdvancedMode(enabled)  { calc.setAdvancedMode(enabled); },
    toggleAdvancedMode()      { calc.toggleAdvancedMode(); },

    /* Sprint 3.0 Stage 2: Scenario CRUD — обёртки над calcController с UI-side
       побочными эффектами (auto-open rename modal после Add, snackbar'ы и пр.). */
    switchScenario(scenarioId) {
        return switchScenarioAction({ scenarioId, calc, snackbar });
    },
    addScenario(label) {
        return addScenarioAction({ label, calc, store });
    },
    duplicateScenario(scenarioId, customLabel = null) {
        return duplicateScenarioAction({ scenarioId, customLabel, calc, snackbar });
    },
    deleteScenario(scenarioId) {
        return deleteScenarioAction({ scenarioId, store, calc, snackbar });
    },
    renameScenario(scenarioId, newLabel) {
        return renameScenarioAction({ scenarioId, newLabel, calc, snackbar });
    },
    openScenarioMenu(scenarioId) {
        return openScenarioMenuAction({ scenarioId, store });
    },
    openScenarioRename(scenarioId) {
        return openScenarioRenameAction({ scenarioId, store });
    },
    /* Stage 4.8: открыть модалку «Дублировать сценарий». draft='' — модалка сама
       подставит default «<label> (копия)» при первом render'е (см.
       scenarioDuplicateModal.js). Это позволяет пользователю либо принять
       default'ный label кликом «Создать копию», либо переписать на своё имя. */
    openScenarioDuplicate(scenarioId) {
        return openScenarioDuplicateAction({ scenarioId, store });
    },
    /* Toggle блока «По категориям» в стенд-карточках дашборда.
     *
     * Хранится как массив sid'ов в state.ui.standCardsCatsExpanded; persist через
     * subscriber → STORAGE_KEYS.STAND_CARDS_CATS_EXPANDED. По умолчанию пусто
     * (все свёрнуты).
     *
     * Семантика: глобальная синхронизация. Один клик на любую карточку
     * (sid передаётся, чтобы не ломать сигнатуру) — раскрывает или сворачивает
     * блок одновременно во ВСЕХ стенд-карточках. Реализовано через массив
     * (а не boolean), чтобы UI остался без изменений: `expandedCats.includes(sid)`
     * → true для всех стендов либо для никого.
     *
     * Решает: пользователь хочет видеть «По категориям» либо везде, либо нигде —
     * чтобы быстро сравнивать стенды одинаковым взглядом, а не открывать пять
     * аккордеонов вручную.
     *
     * Legacy state: если в localStorage частичный массив (раньше раскрывали
     * выборочно) — первый клик глобализует. До клика рендер смешанный, что
     * безопасно: UI просто использует тот же `includes(sid)`. */
    toggleStandCatsExpanded(_standId) {
        const current = store.getState().ui.standCardsCatsExpanded || [];
        store.setUi({ standCardsCatsExpanded: nextGlobalExpandedIds(current, STAND_IDS) });
    },
    /* 12.U27: toggle категории-аккордеона в «Детализации».
     * Хранится как массив СВЁРНУТЫХ category-id в state.ui.detailsCollapsedCats.
     * Дефолт null = все категории свёрнуты — UI на лету разворачивает массив
     * (CATEGORY_IDS-with-items минус та, которую раскрыли). При повторном
     * клике категория снова сворачивается. Persist через subscriber → STORAGE_KEYS.
     *
     * `presentCats` — список category-id с непустыми списками items (передаётся
     * из UI, чтобы не дублировать логику фильтрации). Используется только при
     * первой инициализации массива из null. */
    toggleDetailsCategory(catId, presentCats = null) {
        const current = store.getState().ui.detailsCollapsedCats;
        store.setUi({ detailsCollapsedCats: nextCollapsedIds(current, catId, presentCats) });
    },
    openAssumptionsModal()    {
        // 12.U35: модалка «Реестр допущений» подключена к MODAL_RENDERERS
        // ([js/ui/index.js]). Кнопка-триггер живёт в дашборде (renderAssumptionsBtn).
        store.openModal('assumptions');
    },
    // Stage 15.1 (MINOR 2.8.0): модалка «Качество расчёта» — Health Check.
    openCalculationHealthModal() {
        store.openModal('calculationHealth');
        // Stage 16.5: фиксируем точку trend'а при каждом открытии.
        // Dedup в domain отфильтрует повторные открытия в течение 60s
        // с тем же score+counts.
        healthScoreTrendCtl.recordHealthScoreSnapshot(null, null, 'health_check');
    },
    // Stage 16.5: trend для активного calc — для рендера mini-timeline на дашборде
    // и в Health Check модалке.
    getHealthScoreTrendForActiveCalc() {
        return healthScoreTrendCtl.getHealthScoreTrendForActiveCalc();
    },
    clearHealthScoreTrendForActiveCalc() {
        const ok = healthScoreTrendCtl.clearHealthScoreTrendForActiveCalc();
        if (ok) snackbar.success('История качества очищена');
        return ok;
    },
    // Stage 15.2 (PATCH 2.8.1): Реестр допущений расчёта.
    // filterFieldIds — string[]|null; если задан, модалка показывает только эти поля
    // (cross-link из Health Check finding'а).
    openAssumptionsRegisterModal(filterFieldIds = null) {
        store.openModal('assumptionsRegister', { filterFieldIds });
    },
    // Stage 15.3 (PATCH 2.8.2): Анализ чувствительности — топ-драйверы стоимости.
    openSensitivityAnalysisModal() {
        store.openModal('sensitivity');
    },
    // Stage 18.1 Phase 2 (v2.13.0): План оптимизации стоимости — editable draft.
    // CRUD идёт через costOptimizationPlannerController, который дёргает
    // pure-domain мутации (createDraft / switchLevel / toggleConstraint / ...).
    // F5 теряет draft (runtime-only). Apply/Rollback — Phase 3.
    openCostOptimizationPlannerModal()      { costOptimizationCtl.openCostOptimizationPlannerModal(); },
    closeCostOptimizationPlannerModal()     { costOptimizationCtl.closeCostOptimizationPlannerModal(); },
    setOptimizationLevel(level)             { costOptimizationCtl.setOptimizationLevel(level); },
    toggleOptimizationConstraint(key, value){ costOptimizationCtl.toggleOptimizationConstraint(key, value); },
    setOptimizationViewPeriod(period)       { costOptimizationCtl.setOptimizationViewPeriod(period); },
    toggleOptimizationLeverGroup(groupId)   { costOptimizationCtl.toggleOptimizationLeverGroup(groupId); },
    updateOptimizationDraftValue(fieldId, value) {
        costOptimizationCtl.updateOptimizationDraftValue(fieldId, value);
    },
    removeOptimizationDraftChange(fieldId)  { costOptimizationCtl.removeOptimizationDraftChange(fieldId); },
    resetOptimizationDraft()                { costOptimizationCtl.resetOptimizationDraft(); },
    // Phase 3: apply / rollback / inline high-risk confirm.
    // Controller возвращает result-объект; snackbar поднимается тут (контроллер
    // про UI не знает — layer-linter, см. tests/unit/architecture/layer-imports).
    applyOptimizationDraftAction() {
        const r = costOptimizationCtl.applyOptimizationDraftAction();
        _showOptimizationApplyResult(r);
    },
    confirmOptimizationApply() {
        const r = costOptimizationCtl.confirmOptimizationApply();
        _showOptimizationApplyResult(r);
    },
    cancelOptimizationApplyConfirm() {
        costOptimizationCtl.cancelOptimizationApplyConfirm();
        /* Без snackbar — пользователь видит исчезновение confirm-panel. */
    },
    rollbackOptimizationApply() {
        const r = costOptimizationCtl.rollbackOptimizationApply();
        if (r?.ok) {
            snackbar.info('Изменения плана оптимизации отменены.');
        } else if (r?.reason === 'no_snapshot') {
            snackbar.warning('Нет применённых изменений для отката.');
        } else if (r?.reason === 'persist') {
            /* Внешний аудит #5 (2026-05-18, P3-2): persist-fail. Snapshot
             * не обнулён — пользователь может retry. */
            snackbar.error(r.message || 'Откат не сохранён в хранилище (quota?)');
        }
    },
    // Stage 15.3 (PATCH 2.8.2): сохраняет фильтры модалки анализа чувствительности.
    // filters: { costType: 'opex'|'capex'|'total', categories: string[] }
    setSensitivityFilters(filters) {
        if (!filters || typeof filters !== 'object') return;
        store.setUi({ sensitivityFilters: filters });
    },
    // Stage 15.4 (PATCH 2.8.3): Бюджетные ограничения. Тонкие обёртки над
    // budgetGuardrailsController; модалка зовёт evaluateBudgetGuardrails (тяжёлый
    // путь, под капотом sensitivity), dashboard-карточка — getBudgetGuardrailsSummary
    // (только gap, без sensitivity-перебора).
    openBudgetGuardrailsModal() {
        budgetCtl.openBudgetGuardrailsModal();
    },
    evaluateBudgetGuardrails() {
        return budgetCtl.evaluateBudgetGuardrailsForActiveCalc();
    },
    getBudgetGuardrailsSummary() {
        return budgetCtl.getBudgetGuardrailsSummary();
    },
    // Stage 15.5 (PATCH 2.8.4): Decision Memo — управленческое обоснование расчёта.
    // openDecisionMemoModal — открывает модалку (preview + copy/download).
    // buildDecisionMemo — возвращает { memo, markdown, filename, calcName } для UI.
    // copy/download — IO-обёртки. Snackbar вызывается из модалки.
    openDecisionMemoModal() {
        memoCtl.openDecisionMemoModal();
    },
    buildDecisionMemo() {
        return memoCtl.buildDecisionMemoForActiveCalc();
    },
    async copyDecisionMemo() {
        return memoCtl.copyDecisionMemoForActiveCalc();
    },
    downloadDecisionMemo() {
        return memoCtl.downloadDecisionMemoForActiveCalc();
    },
    // Stage 16.1 (MINOR 2.9.0): мастер уточнения расчёта (Guided Data Completion).
    // Все методы — тонкие обёртки над guidedCompletionController.
    // filterFieldIds — опциональный pre-filter (используется при запуске из
    // Assumptions Register для ограничения мастера конкретными полями).
    openGuidedCompletion(filterFieldIds = null) {
        guidedCompletionCtl.openGuidedCompletion(filterFieldIds);
    },
    applyGuidedAnswer(value) {
        guidedCompletionCtl.applyGuidedAnswer(value);
    },
    skipGuidedStep() {
        guidedCompletionCtl.skipGuidedStep();
    },
    goPrevGuidedStep() {
        guidedCompletionCtl.goPrevGuidedStep();
    },
    finishGuidedCompletion() {
        guidedCompletionCtl.finishGuidedCompletion();
    },
    rollbackGuidedCompletion() {
        const r = guidedCompletionCtl.rollbackGuidedCompletion();
        /* Внешний аудит #5 (2026-05-18, P2): persist-fail при rollback — UI
         * откатан, в storage остались правки мастера. F5 их вернёт. */
        if (r && r.ok === false && r.reason === 'persist') {
            snackbar.error('Откат мастера не сохранён в хранилище (quota?). После перезагрузки правки мастера вернутся.');
        }
    },
    // Stage 16.2 (PATCH 2.9.1): импорт прайса с mapping assistant.
    // Все методы — тонкие обёртки над priceImportMappingController.
    openPriceImportMappingModal() {
        priceImportCtl.openPriceImportMappingModal();
    },
    setPriceImportProvider(providerId) {
        priceImportCtl.setPriceImportProvider(providerId);
    },
    async handlePriceImportFile(file = null) {
        return handlePriceImportFileAction({ file, priceImportCtl, snackbar });
    },
    proceedToMappingStep() {
        priceImportCtl.proceedToMappingStep();
    },
    setPriceImportMapping(rowId, itemId) {
        priceImportCtl.setPriceImportMapping(rowId, itemId);
    },
    validatePriceImport() {
        priceImportCtl.validatePriceImport();
    },
    applyPriceImport() {
        return applyPriceImportAction({ priceImportCtl, snackbar });
    },
    closePriceImportMappingModal() {
        priceImportCtl.closePriceImportMappingModal();
    },
    goPriceImportBack() {
        priceImportCtl.goPriceImportBack();
    },
    // Domain-вычисление подсказок для composite-сводки Dashboard
    // (js/ui/calculationStateSummary.js — Stage 18.2). navigation-only:
    // первый action из списка идёт в блок «Следующий шаг», остальные доступны
    // через те же ctx-методы из других мест UI.
    //
    // Stage 17.4: некоторые targets — advanced-only (sensitivity_analysis).
    // Дефолтный пользователь получает структуру затрат из дашборда (категории
    // + риск-коэффициенты); perturbation-анализ скрыт за «Расширенными
    // настройками» в sidebar. Модалка остаётся доступной из Advanced-IA —
    // фильтр здесь гейтит ТОЛЬКО suggestion-flow в Next Steps.
    getActiveNextSteps() {
        return getActiveNextStepsAction({ store });
    },
    setHealthLastTab(tab) {
        return setHealthLastTabAction({ tab, store });
    },
    resetAnswers() {
        return resetAnswersAction({ calc, snackbar });
    },

    /* CRUD ЭК */
    openItemEditor(it)        { itemCtl.openItemEditor(it); },
    deleteItem(id) {
        return deleteItemAction({ id, store, itemCtl, snackbar, lintFormulas });
    },
    duplicateItem(id) {
        return duplicateItemAction({ id, itemCtl, snackbar });
    },
    exportItems(triggerEvent) {
        return withLoadingButton(triggerEvent, async () => {
            itemCtl.exportItems();
            snackbar.success('Справочник элементов экспортирован');
        });
    },
    importItems(triggerEvent) {
        return withLoadingButton(triggerEvent, async () => {
            const res = await itemCtl.importItems();
            if (res?.ok) snackbar.success(`Импортировано элементов: ${res.accepted}`);
            else if (res?.reason && res.reason !== 'cancelled') snackbar.error('Импорт не выполнен: ' + (res.message || res.reason));
        });
    },
    exportItemPrices(triggerEvent) {
        return withLoadingButton(triggerEvent, async () => {
            const res = await Promise.resolve(itemCtl.exportItemPrices());
            if (res?.ok) snackbar.success(`Цены экспортированы (${res.count} ЭК)`);
            else if (res?.reason === 'empty') snackbar.warning('Справочник пуст — нечего экспортировать');
            else snackbar.error('Не удалось экспортировать цены');
        });
    },
    importItemPrices(triggerEvent) {
        return importItemPricesAction({
            triggerEvent,
            itemCtl,
            store,
            snackbar,
            withLoadingButton,
            confirmAsync: opts => ctx.confirmAsync(opts)
        });
    },

    /* CRUD вопросов */
    openQuestionEditor(q)     { questionCtl.openQuestionEditor(q); },
    deleteQuestion(id) {
        return deleteQuestionAction({
            id,
            store,
            questionCtl,
            snackbar,
            findQuestionUsages,
            commitActiveCalc,
            confirm: opts => ctx.confirm(opts)
        });
    },
    duplicateQuestion(id) {
        return duplicateQuestionAction({ id, questionCtl, snackbar });
    },
    exportQuestions(triggerEvent) {
        return withLoadingButton(triggerEvent, async () => {
            questionCtl.exportQuestions();
            snackbar.success('Справочник вопросов экспортирован');
        });
    },
    importQuestions(triggerEvent) {
        return withLoadingButton(triggerEvent, async () => {
            const res = await questionCtl.importQuestions();
            if (res?.ok) snackbar.success(`Импортировано вопросов: ${res.accepted}`);
            else if (res?.reason && res.reason !== 'cancelled') snackbar.error('Импорт не выполнен: ' + (res.message || res.reason));
        });
    },

    /* Сравнение расчётов */
    addComparisonId(id)        { store.addComparisonId(id); },
    removeComparisonId(id)     { store.removeComparisonId(id); },
    clearComparison()          { store.setComparisonIds([]); },
    /* 12.U28: toggle категории-аккордеона в объединённой таблице «Сравнение».
     * Хранится как массив СВЁРНУТЫХ category-id в state.ui.comparisonCollapsedCats.
     * Дефолт null = ВСЕ категории с items свёрнуты — UI на лету разворачивает массив
     * (`presentCats` минус та, которую раскрыли). При повторном клике категория снова
     * сворачивается. Persist через subscriber → STORAGE_KEYS.COMPARISON_COLLAPSED_CATS.
     *
     * `presentCats` — список category-id с непустыми списками items в выбранных
     * для сравнения расчётах. Используется только при первой инициализации из null. */
    toggleComparisonCategory(catId, presentCats = null) {
        const current = store.getState().ui.comparisonCollapsedCats;
        store.setUi({ comparisonCollapsedCats: nextCollapsedIds(current, catId, presentCats) });
    },
    /* 12.U29: toggle категории-аккордеона во вкладке «Элементы конфигурации».
     * Хранится как массив СВЁРНУТЫХ category-id в state.ui.itemsCollapsedCats.
     * Дефолт null = ВСЕ категории свёрнуты — UI на лету разворачивает массив
     * (presentCats минус та, которую раскрыли). При повторном клике категория
     * снова сворачивается. Persist через subscriber → STORAGE_KEYS.ITEMS_COLLAPSED_CATS.
     *
     * `presentCats` — список category-id с непустыми списками items в текущей
     * выборке (с учётом фильтра поиска). Используется только при первой
     * инициализации массива из null. */
    toggleItemsCategory(catId, presentCats = null) {
        const current = store.getState().ui.itemsCollapsedCats;
        store.setUi({ itemsCollapsedCats: nextCollapsedIds(current, catId, presentCats) });
    },
    /* 12.U29: toggle секции-аккордеона во вкладке «Вопросы».
     * Хранится как массив СВЁРНУТЫХ section-id в state.ui.questionsCollapsedSecs.
     * Дефолт null = ВСЕ секции свёрнуты. Симметрично itemsCategory выше. */
    toggleQuestionsSection(sectionId, presentSecs = null) {
        const current = store.getState().ui.questionsCollapsedSecs;
        store.setUi({ questionsCollapsedSecs: nextCollapsedIds(current, sectionId, presentSecs) });
    },
    exportComparisonCsv(triggerEvent) {
        return exportComparisonCsvAction({
            triggerEvent, store, calcList, snackbar, withLoadingButton
        });
    },

    /* Модалки */
    closeModal(name)          { store.closeModal(name); },
    openHelp()                { store.openModal('help'); },
    openReset()               { store.openModal('reset'); },
    openFormula(itemId)       { store.openModal('formula', { itemId }); },
    openRootCauseReportModal(){ store.openModal('rootCauseReport'); },
    input(opts)               { store.openModal('input', { draft: opts.defaultValue ?? '', ...opts }); },
    /**
     * Патч полезной нагрузки открытой модалки (errors, activeSubTab и т.п.).
     * Используется UI-модалками вместо прямого импорта store — слой ui ↛ state.
     */
    patchModal(name, patch)   { store.patchModal(name, patch); },
    /**
     * Слияние патча с текущим draft модалки (UI-модалки правят draft через эту обёртку).
     * Читает актуальный draft из store, чтобы избежать гонок между рендерами.
     */
    patchModalDraft(name, patch) {
        const cur = store.getState().modals[name];
        if (!cur?.open) return;
        store.patchModal(name, { draft: { ...(cur.draft || {}), ...patch } });
    },

    /* Действия модалок (обёртки над контроллерами / state — ui ↛ controllers/state) */
    saveItem(item)            { return itemCtl.saveItem(item); },
    saveQuestion(q)           { return questionCtl.saveQuestion(q); },
    resetToDefaults()         { calcList.resetToDefaults(); },
    /** Загрузить расчёт по id из persistence через full pipeline (migrate→enrich→applyVatResolver).
     *  Используется UI Comparison / CSV-экспортом / другими read-only потребителями. */
    loadCalcById(id)          { return calcList.loadCalcPrepared(id); },
    /** Содержимое README.md (Markdown → HTML), кэшируется. */
    loadReadmeHtml()          { return loadReadmeHtml(); },
    confirmAsync(opts) {
        return new Promise(resolve => {
            store.openModal('confirm', {
                ...opts,
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false)
            });
        });
    },
    printPdf(triggerEvent) {
        return printPdfAction({ triggerEvent, store, snackbar, withLoadingButton });
    },
    printAnswers(triggerEvent) {
        return printAnswersAction({ triggerEvent, store, snackbar, withLoadingButton });
    },
    /* 13.U6: универсальная обёртка для открытия message-модалки. Используется,
       например, info-кнопками в карточке «Метрики AI / RAG / агентов» — каждая
       метрика и сама секция показывают своё описание через эту обёртку. */
    openMessageModal({ title, message }) {
        store.openModal('message', { title, message });
    },
    openSummaryFormula() {
        return openSummaryFormulaAction({ store });
    },
    openStandDetails() {
        store.setActiveTab('details');
    },
    confirm(opts)             { store.openModal('confirm', opts); },
    refresh()                 { scheduleRender(); }
};

/* ---------- Render scheduler (rAF) ---------- */

const scheduleRender = createRenderScheduler(() => renderApp(store.getState(), ctx));

/* ---------- Bootstrapping ---------- */

/* ---------- Single-instance lock (Stage 19.x) ----------
 * Защищаем пользователя от потери расчётов при одновременном запуске
 * нескольких экземпляров приложения на одном компьютере. Версия НЕ
 * участвует в логике допуска — блокируем любой второй запуск
 * (см. js/services/appInstanceLock.js).
 *
 * Lock-проверка ОБЯЗАНА быть до initFromStorage и любых persist-подписок,
 * иначе заблокированный экземпляр успеет прочитать calc.* и закрепить
 * stale-state в собственном in-memory store. */
const appInstanceLockRuntime = createAppInstanceLockRuntime({
    storageKey: STORAGE_KEYS.APP_INSTANCE_LOCK,
    acquireAppInstanceLock,
    releaseAppInstanceLock,
    startAppInstanceHeartbeat,
    renderInstanceBlockedScreen
});

/* Внешний аудит «Жёсткая проверка» (2026-05-20, P1#2): storage-listener
 * вешается ОДИН раз и до acquire — закрывает gap между existing-check и
 * write-then-readback (если другая вкладка успеет вставить свой ownerId
 * сразу после нашего read-back). До acquire runtime ещё без ownerId и
 * listener silent-no-op'ит; после acquire — реагирует на overtake. */
function handleInstanceLockStorageEvent(e) {
    appInstanceLockRuntime.handleStorageEvent(e);
}

/* Внешний аудит «Жёсткая проверка» (2026-05-20, P1#1): pagehide
 * освобождает lock (releaseOnExit), но при BFCache страница не закрывается,
 * а замораживается. На возврат через History (Back/Forward) приходит
 * `pageshow` с `persisted=true` — наш state в JS уцелел, но lock в
 * storage уже не наш. Без этого handler'а две вкладки могут одновременно
 * считаться владельцами после BFCache-restore. Re-acquire здесь
 * восстанавливает инвариант. */
function handleInstanceLockPageshow(e) {
    appInstanceLockRuntime.handlePageshow(e);
}

function handleBeforePrint() {
    if (store.getState().activeTab === 'details') {
        beginDetailsPrintMode();
    }
}

function boot() {
    mountUi();

    /* Storage- и pageshow-listener'ы вешаем ПЕРВЫМИ, до acquire.
     * P1#2: см. handleInstanceLockStorageEvent.
     * P1#1: см. handleInstanceLockPageshow. */
    window.addEventListener('storage', handleInstanceLockStorageEvent);
    window.addEventListener('pageshow', handleInstanceLockPageshow);

    // Single-instance lock — ДО любых чтений/записей в storage.
    const lockResult = acquireAppInstanceLock();
    if (!lockResult.ok) {
        renderInstanceBlockedScreen(lockResult);
        return;
    }

    // Heartbeat: обновляем lastSeenAt, чтобы lock не считался stale.
    // Если другой экземпляр перехватил lock (reason='lost') — переходим
    // в blocked-state и прекращаем рабочий UX.
    appInstanceLockRuntime.start(lockResult.ownerId);

    // Загрузить состояние из localStorage
    calcList.initFromStorage();

    subscribeAppPersistence({
        store,
        persist,
        calcList,
        snackbar,
        scheduleRender,
        applyThemeAttribute
    });

    // Глобальные горячие клавиши
    bindHotkeys();
    window.addEventListener('beforeprint', handleBeforePrint);

    // Stage 11.1: cross-tab listener — реагируем на изменения провайдер-стораджа
    // в других вкладках (locks, overrides). В node-окружении (тесты) — no-op.
    startCrossTabSync(store);

    // Stage 11.2: subscriber, который следит за derived state (locks/updated)
    // и показывает toast'ы. Передаём snackbar-namespace целиком; helper сам
    // выбирает .info / .success в зависимости от события.
    subscribeCrossTabNotifier(store, snackbar);

    // Первый рендер
    scheduleRender();

    // Глобальная обработка ошибок (для безопасной диагностики)
    window.addEventListener('error', e => {
        console.error('Unhandled error:', e.error);
        snackbar.error('Произошла внутренняя ошибка. Подробности — в консоли (F12).');
    });

    // Этап 11.1.3 + 12.U25-fix-11: при закрытии вкладки/окна — сброс отложенного
    // автосейва. `beforeunload` ненадёжен (особенно при Cmd+Q/закрытии окна
    // через X-кнопку, в bfcache, на мобильных). Добавлены `pagehide` и
    // `visibilitychange` (state='hidden') — спецификация прямо рекомендует их
    // как современную замену beforeunload для автосейв-сценариев. flush —
    // идемпотентный no-op при пустой очереди, дублирующие вызовы безопасны.
    const flushOnExit = () => flushPendingCommit();
    window.addEventListener('beforeunload', flushOnExit);
    window.addEventListener('pagehide', flushOnExit);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushOnExit();
    });

    /* Stage 19.x: на закрытие окна освобождаем single-instance lock и
     * останавливаем heartbeat — чтобы следующий запуск не ждал TTL=90с. */
    const releaseOnExit = () => appInstanceLockRuntime.release();
    window.addEventListener('beforeunload', releaseOnExit);
    window.addEventListener('pagehide', releaseOnExit);

    /* Stage 19.x: cross-tab detection через storage-event перенесён в
     * handleInstanceLockStorageEvent и подписывается ДО acquire — см.
     * P1#2 fix выше. Здесь раньше было дублирующее addEventListener. */

    installModalHashNavigation(document);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}
