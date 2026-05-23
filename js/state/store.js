/**
 * Хранилище состояния приложения. Минимальный observable-store с глубоко
 * замороженной копией состояния (deepFreeze) — защита от случайных мутаций.
 *
 * State:
 *   {
 *     activeTab:    string,
 *     calcList:     [{id, name, updatedAt, totalMonthly}],
 *     activeCalc:   Calculation | null,
 *     calcRevision: number,                  // инкрементируется на каждое
 *                                              изменение activeCalc; используется
 *                                              как ключ кэша расчёта
 *     defaultDictionary: { items, questions, settings },
 *     ui: {
 *       searchByTab: { [tabId]: '' },        // поиск per-tab
 *       recentlyChangedKey: string|null
 *     },
 *     // disabledStands перенесены в calc.view.disabledStands —
 *     // это признак конкретного расчёта, чтобы JSON-экспорт переносил вид к адресату.
 *     modals: {
 *       formula:      { open, itemId? },
 *       help:         { open },
 *       confirm:      { open, title?, message?, onConfirm? },
 *       message:      { open, title?, message? },
 *       itemEdit:     { open, draft?, errors?, activeSubTab? },
 *       questionEdit: { open, draft?, errors? },
 *       reset:        { open }
 *     }
 *   }
 */

import { TAB_IDS, DEFAULT_THEME, MAX_COMPARISON_CALCS } from '../utils/constants.js';
import { deepFreeze } from '../utils/freeze.js';

const initialState = deepFreeze({
    activeTab: 'calculations',
    calcList: [],
    activeCalc: null,
    calcRevision: 0,
    defaultDictionary: { items: [], questions: [], settings: {} },
    persistStatus: 'idle',           // 'idle' | 'pending' | 'saved' | 'error'
    persistMessage: null,
    comparisonIds: [],               // ID расчётов, выбранных для сравнения (≤ 4)
    ui: {
        searchByTab: {},
        recentlyChangedKey: null,
        // Опросник (Этап 12.U1): какие секции раскрыты + раскрыта ли панель «Параметры расчёта».
        // null = «ещё не инициализировано» — opensFor выберет дефолт (первая секция, settings свёрнут).
        questionnaireOpenSections: null,
        questionnaireSettingsOpen: null,
        // Сравнение (12.U25): сортировка постатейной таблицы по индикаторам колонки.
        // { columnIndex: 0..3, direction: 'asc' (g→y→r) | 'desc' (r→y→g) } или null = без сортировки.
        comparisonSort: null,
        // Дашборд (12.U25-fix-17): какие стенд-карточки раскрыли блок «По категориям».
        // null = «ещё не сохранено» (дефолт = всё свёрнуто). Массив string[] sid'ов после первой настройки.
        standCardsCatsExpanded: null,
        // Детализация (12.U27): свёрнутые категории-аккордеоны.
        // null = «ещё не сохранено» (дефолт = ВСЕ категории свёрнуты — UI развёртывает массив на лету).
        // Массив string[] category-id после первой настройки.
        detailsCollapsedCats: null,
        // Сравнение (12.U28): свёрнутые категории-аккордеоны в объединённой таблице.
        // null = «ещё не сохранено» (дефолт = ВСЕ категории с items свёрнуты — UI развёртывает массив на лету).
        // Массив string[] category-id после первой настройки.
        comparisonCollapsedCats: null,
        // Элементы (12.U29): свёрнутые категории-аккордеоны во вкладке «Элементы конфигурации».
        // null = «ещё не сохранено» (дефолт = ВСЕ категории свёрнуты — UI разворачивает массив на лету).
        // Массив string[] category-id после первой настройки.
        itemsCollapsedCats: null,
        // Вопросы (12.U29): свёрнутые секции-аккордеоны во вкладке «Вопросы».
        // null = «ещё не сохранено» (дефолт = ВСЕ секции свёрнуты).
        // Массив string[] section-id после первой настройки.
        questionsCollapsedSecs: null,
        // 12.U33: тема приложения — 'dark' | 'light'. На boot восстанавливается
        // из localStorage (calcListController.initFromStorage); если в storage
        // ничего нет — DEFAULT_THEME ('dark', обратная совместимость).
        theme: DEFAULT_THEME,
        // Stage 17.2 Phase 3c: режим «Расширенные настройки». При false
        // в Sidebar скрыта группа «Администрирование» (вкладки «Элементы» /
        // «Вопросы»). Восстанавливается из STORAGE_KEYS.ADVANCED_MODE_ENABLED
        // в initFromStorage. Дефолт false (PO-flow).
        advancedModeEnabled: false,
        // 14.U9: раскрыт ли блок «Сводка тарифов overlay» в Опроснике.
        // null = ещё не сохранено (дефолт = свёрнут).
        providerOverlayExpanded: null,
        // Stage 8.2: статус операции «Обновить прайс» per-provider.
        // Map<providerId, { status: 'idle'|'loading'|'success'|'error', message?, version? }>.
        // Не persist'ится: после F5 кнопка возвращается в idle (loading-состояние теряется,
        // но операция идемпотентна — пользователь повторно жмёт «Обновить»).
        providerOverlayUpdate: {},
        // Stage 11.1: cross-tab locks от других вкладок. Производное состояние
        // (derived) от STORAGE_KEYS.PROVIDER_TAB_LOCKS — обновляется через
        // storage-event в crossTabSync.handleStorageEvent. UI кнопок «Обновить
        // прайс» проверяет: locks[providerId] есть → блокируем + tooltip.
        // Содержит ТОЛЬКО чужие locks; свои не дублируем (свои отслеживает
        // providerOverlayUpdate.status === 'loading').
        // Структура: { [providerId]: { tabId, startedAt: ISO } }
        providerCrossTabLocks: {},
        // Stage 11.1: уведомления о cross-tab обновлениях override'ов. Каждая
        // запись помечает «другая вкладка применила прайс vX в момент Y».
        // UI subscriber в Stage 11.2 покажет toast и сбросит запись.
        // Структура: { [providerId]: { version, timestamp, at: ISO } }
        providerCrossTabUpdated: {},
        // Stage 15.1 (MINOR 2.8.0): последняя открытая severity-вкладка в модалке
        // «Качество расчёта». null = «не было сохранено» — UI выберет первую
        // непустую секцию по приоритету severity.
        healthLastTab: null,
        // Stage 15.3 (PATCH 2.8.2): фильтры модалки «Анализ чувствительности».
        // null = «не сохранено» → UI применит DEFAULT_SENSITIVITY_FILTERS.
        // Структура: { costType: 'opex'|'capex'|'total', categories: string[] }.
        sensitivityFilters: null,
        // Stage 16.1 (MINOR 2.9.0): transient-state мастера дозаполнения.
        // null = мастер не активен. При openGuidedCompletion заполняется
        // объектом { active, startScore, snapshot, plan, currentIndex,
        // completedStepIds, skippedStepIds }. Skip-семантика — только
        // текущая сессия мастера: при finish/rollback обнуляется.
        // НЕ persist'ится в localStorage (по решению lock-in #5).
        guidedCompletion: null,
        // Stage 16.2 (PATCH 2.9.1): transient-state мастера импорта прайса.
        // null = модалка не открыта. При openPriceImportMappingModal заполняется
        // { step, providerId, fileName, kind, rows, normalizedRows, mappings,
        //   suggestions, validationResult, applyResult, error }.
        // НЕ persist'ится — только текущая сессия модалки.
        priceImport: null
    },
    modals: {
        formula:         { open: false },
        help:            { open: false },
        confirm:         { open: false },
        message:         { open: false },
        input:           { open: false },
        itemEdit:        { open: false },
        questionEdit:    { open: false },
        reset:           { open: false },
        assumptions:     { open: false },
        // 11.1.4: подтверждение при импорте расчёта с уже существующим id
        // (вместо silent uuid rename).
        duplicateImport: { open: false },
        // Stage 4.9/4.14: модалка «Новый расчёт» удалена. Создание нового
        // расчёта теперь идёт только через Quick Start (4-й preset «Пустой
        // расчёт» создаёт пустой calc через ctx.createCalc(name, null)).
        // Этап 13.U3: выбор формата перед PDF-выгрузкой ответов опросника.
        printAnswersOptions: { open: false },
        // PATCH 2.20.49: выбор состава PDF для вкладки «Детализация».
        detailsPrintOptions: { open: false },
        // PATCH 2.20.51: корневые причины бюджета открываются отдельным окном
        // из Детализации. Runtime-only, в PDF не выводится.
        rootCauseReport: { open: false },
        // Этап 14.U1: Quick Start Wizard — 7 макро-вопросов → автозаполнение опросника.
        quickStart:      { open: false },
        // Этап 14.U5: подтверждение re-apply профиля. Содержит manualCount —
        // число полей, которые юзер изменил вручную (нужно для текста диалога).
        reapplyConfirm:  { open: false, manualCount: 0 },
        // Sprint 3.0 Stage 2: меню действий для scenario-вкладки (Rename / Duplicate / Delete).
        // scenarioId — id вкладки, которую пользователь кликнул через kebab «⋯».
        scenarioMenu:    { open: false, scenarioId: null },
        // Sprint 3.0 Stage 2: ввод нового label для scenario (Add → auto-open сразу
        // после создания; Rename — открывается из scenarioMenu).
        scenarioRename:  { open: false, scenarioId: null, draft: '' },
        // Sprint 4 Stage 4.8: ввод label для копии при «Дублировать сценарий».
        // scenarioId — id источника копирования; draft — пользовательское имя
        // (по умолчанию — «<source.label> (копия)»).
        scenarioDuplicate: { open: false, scenarioId: null, draft: '' },
        // Stage 10.3: модалка «История прайсов провайдера» — current + до 3
        // history snapshot'ов с delta-summary и rollback кнопками.
        // Stage 14.4 (PATCH 2.7.2): расширена до multi-provider accordion'а:
        //   providerId    — preselected (auto-expand при первом open). Может быть
        //                   null при глобальном entry point (когда добавим).
        //   expandedIds   — string[] | null. null = «не сохранено» → UI применит
        //                   дефолт = [providerId] если providerId задан, иначе [].
        //                   Массив = явно сохранённый пользователем выбор (persist).
        deltaHistory: { open: false, providerId: null, expandedIds: null },
        // Stage 10.4 → 2.20.40: «Прайс-бенчмарк» — providers × top-ЭК активного
        // расчёта; без активного расчёта остаётся fallback по базовым категориям.
        // visibleCategories — фильтр колонок; null = UI применяет дефолт.
        providerAnalytics: {
            open: false,
            sortBy: 'total',
            sortDir: 'asc',
            visibleCategories: null
        },
        // Stage 14.5 (PATCH 2.7.3): cross-provider scenario сравнение для активного calc.
        //   selectedProviderIds — string[]|null. null = «не сохранено» → UI применит
        //                          дефолт (все active providers). F5-safe через
        //                          persist.saveScenarioComparisonSelectedProviders.
        //   visibleCategories   — legacy поле от Stage 14.5, оставлено для обратной
        //                          совместимости сохранённого состояния.
        scenarioComparison: { open: false, selectedProviderIds: null,
            visibleCategories: null },
        // Stage 15.1 (MINOR 2.8.0): модалка «Качество расчёта» — список findings
        // по severity-вкладкам с переходом к связанным полям опросника.
        calculationHealth: { open: false },
        // Stage 15.2 (PATCH 2.8.1): Реестр допущений расчёта.
        // filterFieldIds — string[]|null — pre-filter из Health Check finding'а
        // (кнопка «Допущения» в finding-card открывает модалку с ограниченным набором).
        assumptionsRegister: { open: false, filterFieldIds: null },
        // Stage 15.3 (PATCH 2.8.2): Анализ чувствительности — top-драйверы стоимости.
        sensitivity: { open: false },
        // Stage 15.4 (PATCH 2.8.3): Бюджетные ограничения — gap CAPEX/OPEX vs target,
        // top-причины и рекомендации (последние читаются из sensitivity-results).
        budgetGuardrails: { open: false },
        // Stage 15.5 (PATCH 2.8.4): Decision Memo — управленческое обоснование расчёта,
        // markdown preview + copy/download. Контекст собирается ctx.buildDecisionMemo()
        // из health/assumptions/sensitivity/budgetGuardrails.
        decisionMemo: { open: false },
        // Stage 16.1 (MINOR 2.9.0): мастер дозаполнения (Guided Data Completion).
        // open=true → UI рендерит модалку, читая state.ui.guidedCompletion для
        // plan/currentIndex/snapshot. open=false → transient state сбрасывается
        // в null контроллером (finishGuidedCompletion / rollbackGuidedCompletion).
        guidedCompletion: { open: false },
        // Stage 16.2 (PATCH 2.9.1): импорт прайса с mapping assistant'ом.
        // Transient state живёт в state.ui.priceImport (kind/rows/mappings/...);
        // open=true только указывает, рендерить ли модалку. Очистка state —
        // контроллером closePriceImportMappingModal.
        priceImportMapping: { open: false },
        // Stage 18.1 (MINOR 2.13.0): План оптимизации стоимости — рабочее окно
        // с draft + apply + rollback. Runtime-only, без persist в localStorage.
        //   draft               — модель редактирования: { level, constraints,
        //                         touchedConstraints, baseSnapshot, changes,
        //                         preview, validation } (см. costOptimizationPlanner.js).
        //   lastApplySnapshot   — снимок calc (settings/answers/answersMeta) до
        //                         последнего apply. Живёт до закрытия модалки или
        //                         следующего apply; используется для session rollback.
        costOptimizationPlanner: { open: false, draft: null, lastApplySnapshot: null },
        /* Stage VAT-2 Phase 5: VAT-policy choice для legacy v1 import без
         * vatPolicy metadata. providerId — провайдер импорта; preloaded —
         * parsed JSON, который пользователь выбрал (хранится до закрытия
         * модалки для повторного вызова validateProviderPriceJson с явным
         * userVatPolicy). Runtime-only, без STORAGE_KEYS. */
        vatPolicyChoice: { open: false, providerId: null, preloaded: null }
    }
});

export class Store {
    constructor() {
        this._state = initialState;
        this._listeners = new Set();
        this._silent = false;
    }

    getState() {
        return this._state;
    }

    subscribe(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    /**
     * 12.U32 #2: количество активных подписчиков. Публичный геттер для
     * leak-detection в long-running session — если число растёт между
     * rerender'ами, кто-то зарегистрировал subscribe без unsubscribe.
     * Используется integration-тестом store-no-leak.test.js.
     */
    getSubscriberCount() {
        return this._listeners.size;
    }

    _notify() {
        if (this._silent) return;
        // Снимаем снапшот списка подписчиков перед итерацией: если подписчик
        // во время своего вызова добавит/удалит другого подписчика, мы не
        // должны вызвать только что добавленного (он подписался на следующие
        // нотификации) и не должны падать на изменении Set во время for-of.
        // (10.2.5)
        for (const fn of [...this._listeners]) {
            try {
                fn(this._state);
            } catch (err) {
                // Один subscriber не должен ломать остальных (11.1.2).
                // Логируем в console.error (developer-level). НЕ устанавливаем
                // persistStatus='error' — это другая семантика (про запись).
                if (typeof console !== 'undefined' && console.error) {
                    console.error('Store subscriber threw:', err);
                }
            }
        }
    }

    /**
     * Транзакция: несколько последовательных setState без промежуточных нотификаций.
     */
    batch(fn) {
        const prev = this._silent;
        this._silent = true;
        try { fn(); }
        finally {
            this._silent = prev;
            this._notify();
        }
    }

    /**
     * Базовый setter — заменяет верхний уровень и глубоко замораживает.
     */
    _set(patch) {
        this._state = deepFreeze({ ...this._state, ...patch });
        this._notify();
    }

    /* ---------- Действия ---------- */

    setActiveTab(tabId) {
        if (!TAB_IDS.includes(tabId)) return;
        this._set({ activeTab: tabId });
    }

    setCalcList(list) {
        this._set({ calcList: list.slice() });
    }

    setActiveCalc(calc) {
        this._set({
            activeCalc: calc ? { ...calc } : null,
            calcRevision: this._state.calcRevision + 1
        });
    }

    /**
     * Обновить активный расчёт через мерж-патч (плоский) или функцию-редьюсер.
     * Инкрементирует calcRevision (для инвалидации кэша расчёта).
     */
    updateActiveCalc(patchOrFn) {
        if (!this._state.activeCalc) return;
        const patch = typeof patchOrFn === 'function' ? patchOrFn(this._state.activeCalc) : patchOrFn;
        const next = { ...this._state.activeCalc, ...patch, updatedAt: new Date().toISOString() };
        this._set({
            activeCalc: next,
            calcRevision: this._state.calcRevision + 1
        });
    }

    setDefaultDictionary(dict) {
        const next = {
            items: (dict.items || []).slice(),
            questions: (dict.questions || []).slice()
        };
        // settings опциональны — если переданы, копируем shallow.
        if (dict.settings && typeof dict.settings === 'object') {
            next.settings = { ...dict.settings };
        } else {
            next.settings = { ...(this._state.defaultDictionary?.settings || {}) };
        }
        this._set({ defaultDictionary: next });
    }

    setUi(patch) {
        this._set({ ui: { ...this._state.ui, ...patch } });
    }

    setPersistStatus(status, message = null) {
        this._set({ persistStatus: status, persistMessage: message });
    }

    /**
     * Установить список id расчётов для вкладки сравнения. Не более
     * MAX_COMPARISON_CALCS расчётов (визуально перегружено),
     * пустой список → пустое сравнение.
     */
    setComparisonIds(ids) {
        const list = Array.isArray(ids) ? ids.slice(0, MAX_COMPARISON_CALCS) : [];
        this._set({ comparisonIds: list });
    }

    addComparisonId(id) {
        if (!id) return;
        const current = this._state.comparisonIds;
        if (current.includes(id) || current.length >= MAX_COMPARISON_CALCS) return;
        this._set({ comparisonIds: [...current, id] });
    }

    removeComparisonId(id) {
        this._set({ comparisonIds: this._state.comparisonIds.filter(x => x !== id) });
    }

    /**
     * Установить поисковый запрос для конкретной вкладки.
     */
    setSearchForTab(tabId, query) {
        const next = { ...this._state.ui.searchByTab, [tabId]: String(query || '') };
        this._set({ ui: { ...this._state.ui, searchByTab: next } });
    }

    /* ---------- Модалки ---------- */

    openModal(name, payload = {}) {
        const modals = { ...this._state.modals, [name]: { open: true, ...payload } };
        this._set({ modals });
    }

    /**
     * Обновить полезную нагрузку открытой модалки (draft, errors и т.п.) —
     * не закрывая её и не меняя open=true.
     */
    patchModal(name, patch) {
        const current = this._state.modals[name];
        if (!current?.open) return;
        const modals = { ...this._state.modals, [name]: { ...current, ...patch } };
        this._set({ modals });
    }

    closeModal(name) {
        const modals = { ...this._state.modals, [name]: { open: false } };
        this._set({ modals });
    }

    closeAllModals() {
        const modals = {};
        for (const k of Object.keys(this._state.modals)) modals[k] = { open: false };
        this._set({ modals });
    }
}

export const store = new Store();
