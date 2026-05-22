# Архитектура — техническая документация

Целевая аудитория — архитекторы, разработчики, тестировщики. Здесь только то, что не выводится из чтения README.md / UserManual.md: устройство кода, потоки данных, паттерны защиты целостности и тестовая инфраструктура.

**Версия 2.20.26** (Pages workflow + scoped tests + provider VAT hardening + desktop tariff alignment). Schema v20.

---

## 1. Стек и инварианты

| Решение | Обоснование |
|---|---|
| **Vanilla HTML / CSS / JS, ES2020+** | Никаких сборщиков, npm-runtime-пакетов, фреймворков. Запуск на любом HTTP-сервере. |
| **ES-модули, `<script type="module">`** | Layer-linter и tree-shaking возможны без bundler'а. |
| **`node:test` встроенный** | Единственная dev-зависимость — Node 18+ (для тестов). Test-runner свой ([tests/run.js](tests/run.js)). |
| **Никаких `eval` / `new Function` / `setTimeout(string)`** | Безопасная CSP: `script-src 'self'`. Формулы qty считаются собственным DSL-парсером ([js/domain/formula/](js/domain/formula/)). |
| **localStorage только** | Без бэкенда, без серверной БД. Атомарность — на уровне приложения через snapshot/rollback. |
| **Эмодзи запрещены в UI** | Inline-SVG из [icons.js](js/ui/icons.js) (Lucide ISC). Линтер: [no-emoji-in-source.test.js](tests/unit/architecture/). |
| **Денежные сравнения через `isZeroMoney(v)`** | EPSILON-tolerance 0.005 ₽ — после 6+ накапливаемых умножений float даёт остатки ≈1e-15. Строгий `=== 0` запрещён. |
| **Layer-linter в CI** | UI ↛ controllers/state, domain ↛ services/state/controllers/ui. Линтер: [layer-imports.test.js](tests/unit/architecture/layer-imports.test.js). |

---

## 2. Шесть слоёв и их обязанности

```
┌──────────────────────────────────────────────────────────────────┐
│  ui/          DOM-рендер. Принимает state → возвращает узлы.     │
│               Не мутирует state напрямую. Все side-effects через │
│               ctx-методы из app.js.                              │
├──────────────────────────────────────────────────────────────────┤
│  controllers/ Оркестровка: события UI → store.update*() →        │
│               services вызовы. Здесь ловятся ошибки и пробрасы-  │
│               ваются в snackbar. Атомарные операции с persist.   │
├──────────────────────────────────────────────────────────────────┤
│  state/       Хранилище. store.js (deepFreeze + revision),       │
│               persistence.js (localStorage IO), migrations.js,   │
│               crossTabSync.js (cross-tab guard).                 │
├──────────────────────────────────────────────────────────────────┤
│  services/    IO и побочные эффекты: storage, json, csv,         │
│               markdown, providerPriceFetch, decisionMemoExport.  │
│               Форматирование / нормализация вынесены в           │
│               *Format / *Normalize helper-модули. Возвращают     │
│               { ok, reason, ... } — не throw для ожидаемых       │
│               ошибок.                                            │
├──────────────────────────────────────────────────────────────────┤
│  domain/      Чистая логика расчёта и DSL. Без DOM, без store,   │
│               без localStorage. Принимает (calc, settings, ...)  │
│               → возвращает данные. Главные модули:               │
│               calculator.js, calcImpact.js, providerOverlay.js,  │
│               calcVersioning.js, validation.js, health checks,   │
│               price import mapping, formula/*.                   │
├──────────────────────────────────────────────────────────────────┤
│  utils/       Низкоуровневые примитивы: constants.js,            │
│               escapeHtml, debounce, lru, freeze, uuid.           │
└──────────────────────────────────────────────────────────────────┘
```

**Поток данных** (одностороннее):

```
event → controller → store.update*() → notify subscribers
                                         ↓
                            rAF render (app.js subscribe)
                                         ↓
                            renderApp() → ui/index.js
```

Подписчик в [app.js](js/app.js) планирует ре-рендер через `requestAnimationFrame` — controllers **никогда** не вызывают `renderApp` напрямую.

### Layer-linter

[tests/unit/architecture/layer-imports.test.js](tests/unit/architecture/layer-imports.test.js) валит CI при попытке импорта в обход слоёв:

- UI не импортирует напрямую `controllers/` или `state/` — всё через ctx-методы из [app.js](js/app.js).
- Domain не импортирует `services/`, `state/`, `controllers/`, `ui/`.
- Controllers могут импортировать `services/`, `state/`, `domain/`, но не `ui/` (только через ctx-обёртки в app.js).

Линтер прогоняется в `npm test`. Для нового UI-файла — автоматически.

### Фасады после модульного рефакторинга

Часть исторически публичных файлов оставлена как **стабильные entry point'ы** для тестов и внешних импортов, а тяжёлая логика вынесена рядом в узкие helper-модули. Правило поддержки: новый код импортирует публичный фасад, если нужен контракт feature целиком; внутренние тесты и соседние модули могут импортировать узкий helper, когда проверяют конкретную ответственность.

| Фасад / entry point | Вынесенные модули | Ответственность |
|---|---|---|
| [js/app.js](js/app.js) | [js/app/](js/app/) | boot, сборка `ctx`, wiring store/UI/controllers; действия `ctx` живут в `app/*Actions.js`, runtime-защиты — в `instanceLockRuntime.js`, `renderScheduler.js`, `uiPersistenceSubscriber.js`. |
| [js/ui/questionnaire.js](js/ui/questionnaire.js) | `questionnaireNumberInput`, `questionnaireSettings`, `questionnaireProviderSettings`, `questionnaireStandSettings`, `questionnaireVatSettings`, `questionnairePercentField` | Главный renderer опросника; поля и группы настроек разделены, чтобы source-grep тесты проверяли конкретные UI-контракты. |
| [js/ui/dashboard.js](js/ui/dashboard.js) | `dashboardAggregates`, `dashboardMetricBlocks`, `dashboardProfileBanner`, `dashboardRiskCard` | Композиция Dashboard без дублирования расчётных агрегатов и баннера профиля. |
| [js/domain/costOptimizationPlanner.js](js/domain/costOptimizationPlanner.js) | `costOptimizationPlannerConfig`, `costOptimizationPlannerShared`, `costOptimizationPlannerPlans` | Публичный draft/apply API планера; specs, plan ranking и shared helpers лежат отдельно. |
| [js/ui/modals/costOptimizationPlannerModal.js](js/ui/modals/costOptimizationPlannerModal.js) | `costOptimizationPlannerModalControls`, `...Format`, `...Levers`, `...Summary` | Модалка планера как thin composition поверх контролов, форматирования, рычагов и summary. |
| [js/domain/validation.js](js/domain/validation.js) | [js/domain/validationFormulaLint.js](js/domain/validationFormulaLint.js) | Валидация структур; lint формул и поиск `Q.*` ссылок вынесены из общего валидатора. |
| [js/domain/calculationHealth.js](js/domain/calculationHealth.js) | [js/domain/calculationHealthChecks.js](js/domain/calculationHealthChecks.js) | Score/group API отдельно от реестра правил health-check. |
| [js/domain/priceImportMapping.js](js/domain/priceImportMapping.js) | `priceImportMappingRows`, `priceImportMappingSuggest` | Build/validate provider JSON отдельно от нормализации строк и suggestion engine. |
| [js/services/providerPriceFetch.js](js/services/providerPriceFetch.js) | [js/services/providerPriceNormalize.js](js/services/providerPriceNormalize.js) | Валидация JSON + history rollback; VAT-normalization — отдельный pure helper. |
| [js/services/decisionMemoExport.js](js/services/decisionMemoExport.js) | [js/services/decisionMemoFormat.js](js/services/decisionMemoFormat.js) | Сборка memo-секций отдельно от Markdown/table/sanitize helpers. |
| [js/domain/wizardProfiles.js](js/domain/wizardProfiles.js) | [js/domain/wizardProfileData.js](js/domain/wizardProfileData.js) | `wizardToAnswers` и compliance API отдельно от frozen profile data. |
| [js/ui/providerPriceSummary.js](js/ui/providerPriceSummary.js) | [js/ui/providerUpdateRow.js](js/ui/providerUpdateRow.js) | Summary/selection helpers отдельно от строки обновления провайдера. |

---

## 3. Data flow на примере «Импорт прайса JSON»

Сложный сценарий с тремя источниками отказов (file-picker, валидация, persist) и cross-tab защитой. После Stage 17.2 это единственный путь обновления прайса (bundled fetch и bulk-update удалены).

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Пользователь жмёт «Загрузить JSON» в Опроснике                          │
│  (renderProviderUpdateRow — providerUpdateRow.js)                       │
│  Альтернатива: «Импорт CSV/JSON» → мастер маппинга                      │
│  (priceImportMappingController, Stage 16.2)                             │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓
   ctx.updateProviderPricesFromFile(triggerEvent, providerId)
   (app.js) → withLoadingButton (кнопка disabled + spinner)
                                ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  providerController.updateProviderPricesFromFile(providerId, opts)      │
│  ① _enterUpdate(providerId)                                             │
│     • check state.ui.providerOverlayUpdate[providerId].status==='loading'│
│     • check isProviderLockedByOtherTab(providerId)                      │
│     • acquireProviderLock(providerId) → пишет в                         │
│       STORAGE_KEYS.PROVIDER_TAB_LOCKS                                   │
│     • setUpdateStatus(providerId, { status: 'loading' })                │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓
   try { …                                            } finally {
                                ↓                       _exitUpdate(providerId)
┌─────────────────────────────────────────────────────────────────────────┐
│  ② pickFile('.json,application/json') — file-picker (cancel = idle)      │
│  ③ readJsonFile(file) → parse JSON                                       │
│  ④ validateProviderPriceJson(data, providerId) → schema + shape         │
│  ⑤ snapshot текущего override → loadProviderOverrides()[providerId]     │
│  ⑥ saveProviderOverride(providerId, validated)                          │
│  ⑦ pushProviderOverrideHistory(providerId, snapshot) если был prior     │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓
   при ошибке любого шага — { ok:false, reason, message } без записи
                                ↓
   setUpdateStatus(providerId, { status: 'success'|'error', … })
   } finally { releaseProviderLock(providerId) }
                                ↓
   storage-event на других вкладках:
   • crossTabSync.handleStorageEvent → state.ui.providerCrossTabUpdated
   • crossTabNotifier.subscribe → snackbar.info('Прайс обновлён в другой вкладке')
                                ↓
   ⚠ В текущей вкладке override применён к storage, НО calc.providerVersion
     не обновлён автоматически — пользователь жмёт «Пересчитать на новом
     прайсе» в UI (ctx.applyOverrideToActiveCalc или applyOverrideToAllCalcs).
     Это сознательное решение Stage 11.4: F5-safe + предсказуемость.
                                ↓
┌─────────────────────────────────────────────────────────────────────────┐
│  applyOverrideToActiveCalc                                              │
│  • _conflictCheckCrossTab → если другая вкладка обновляет, abort        │
│  • effective = getEffectivePricesForProvider(providerId)                │
│  • newItems = applyOverrideToItems(calc.dictionaries.items, effective)  │
│  • deltas = computePriceDeltas(oldItems, newItems)                      │
│  • store.updateActiveCalc({ dictionaries, providerVersion })            │
│  • commitActiveCalc → атомарный persist 2 ключей                        │
└─────────────────────────────────────────────────────────────────────────┘
                                ↓
   subscribe в app.js → rAF render → дашборд показывает новые числа
```

**Stage 17.2 cleanup**: удалены `updateProviderPrices` (router), `updateProviderPricesFromFetch` (bundled JSON fetch) и `updateMultipleProviderPrices` (bulk). Соответствующие UI-кнопки «Обновить с сервера» в Опроснике и «Обновить выбранных (N)» в Прайс-бенчмарке убраны как ложные обещания интернет-обновления.

---

## 4. Ключевые паттерны защиты целостности

### 4.1 Atomic update двух ключей localStorage

`commitActiveCalc(calc)` ([calcPersistence.js](js/services/calcPersistence.js)) записывает два ключа:

1. `STORAGE_KEYS.CALC_PREFIX + calc.id` — сам расчёт.
2. `STORAGE_KEYS.CALC_LIST` — мета-список всех расчётов (id, name, totalMonthly, updatedAt).

Если первый записался, а второй нет (quota), `commitActiveCalc` делает **best-effort откат** первого. Прямая пара `saveCalc + saveCalcList` в обход обёртки — нарушение контракта, layer-linter его ловит.

Аналогичный паттерн для bundle-импорта ([bundleExport.js](js/services/bundleExport.js)): atomic backup всех расчётов перед перезаписью; если хоть один не мигрирует, состояние не меняется.

### 4.2 deepFreeze + revision

Весь state в [store.js](js/state/store.js) хранится глубоко замороженным. Любая «мутация» — создание нового объекта и пере-`deepFreeze`. Попытка прямого присваивания (`state.activeCalc.foo = ...`) бросает `TypeError: Cannot assign to read only property` — это сигнал заменить на `store.updateActiveCalc({ foo })`.

`calcRevision` инкрементируется при каждом изменении активного расчёта; используется как ключ LRU-кэша в [calculator.js](js/domain/calculator.js).

### 4.3 Cross-tab race protection (Stage 11)

Когда у пользователя открыто несколько вкладок:

- **Tab-ID** — UUID в `sessionStorage`, persist пока вкладка живёт; F5 не теряет id; разные вкладки получают разные id.
- **Lock map** — `STORAGE_KEYS.PROVIDER_TAB_LOCKS = { [providerId]: { tabId, startedAt } }` в localStorage.
- **TTL = 60 секунд** (`PROVIDER_TAB_LOCK_TTL_MS`). Если lock старше — считаем «вкладка-владелец крашнулась», игнорируем.
- **Конфликт-guard** проверяется в 4 mutate-операциях: `_enterUpdate` (fetch/file), `applyOverrideToActiveCalc`, `applyOverrideToAllCalcsForProvider`, `restoreProviderOverrideFromHistory`.
- **storage-event** в других вкладках → `crossTabSync.handleStorageEvent` → `state.ui.providerCrossTabLocks` / `providerCrossTabUpdated` → toast через `crossTabNotifier`.

Lock — это **UX hint, не data-integrity guard**. При race conditions последний writer в localStorage побеждает, оба сходятся на финальном override (pricing JSON идемпотентен).

### 4.4 Delta-pill (Stage 9.1)

Точечный visual diff цены между frozen-default и applied override. Computed:

```js
const pct = ((effective - frozen) / frozen) * 100;
const deltaPct = Math.abs(pct) < 0.1 ? 0 : pct;  // 0.1% — float-noise filter
```

CSS-классы:
- `.delta-pill--up` (warning, рост = негативно для пользователя; цены выросли).
- `.delta-pill--down` (accent, падение = позитивно).

Используется в Опроснике (provider summary), в Прайс-бенчмарке, в History-модалке, в per-row preview.

### 4.5 Glow подсветка (3 уровня)

Транзиентная подсветка точки и контекста изменения в Опроснике:

- `.field-recent` — поле, в котором пользователь только что изменил значение (Stage 12.U1).
- `.questionnaire-subgroup-recent` — подгруппа, содержащая изменённое поле (Stage 12.5 / PATCH 2.6.4).
- `.section-recent` — родительская секция (Stage 6.6.B / PATCH 2.4.22).

Триггер — `state.ui.recentlyChangedKey`, выставляется в `setAnswer` / `setSetting` / `setProvider` / `setResourceRatio` / `setAiStandFactor`. CSS animation 1.2s ease на каждом уровне; `prefers-reduced-motion` обнуляет animation.

### 4.6 Snapshot + rollback override (Stage 9.5)

При каждом успешном save нового override предыдущий идёт в history-стек:

```js
STORAGE_KEYS.PROVIDER_OVERRIDE_HISTORY = {
    [providerId]: [
        { appliedJSON, appliedAt },  // newest first
        ...
    ]
}
```

Лимит — `PROVIDER_OVERRIDE_HISTORY_LIMIT = 3` (UI ≤ 1 кнопка отката, localStorage не растёт бесконечно).

Восстановление на индекс N: `restoreProviderOverrideFromHistory(providerId, idx)` — git-reset-hard семантика, все записи 0..idx-1 (более новые) удаляются вместе с current, target становится current, history[idx+1..] сохраняется как «прошлое».

### 4.7 Calculation Diff (Stage 17.1 → internal-only с Stage 17.2)

Pure domain [calculationDiff.js](js/domain/calculationDiff.js) принимает пару snapshot'ов calc и возвращает `{ answers[], settings[], scenarios { added, removed, changed }, provider, totals }`. Используется внутри domain-слоя как фундамент для будущих этапов (preview перед apply, approved↔current diff в review workflow).

Stage 17.2 удалил user-facing UI этой фичи — модалку и controller. Остался только pure-domain утилитный helper, без точек входа в UI. См. [DECISIONS.md → Stage 17.2](DECISIONS.md) для обоснования.

### 4.8 Cost Optimization Planner draft / apply / rollback (Stage 18.1, v2.13.0 — обновлён 18.1.1 в v2.14.0)

Планер построен как **draft-flow с явной mutation-границей** — пользователь редактирует **черновик**, видит preview через clone+calculate, и только при явном Apply изменения уходят в `activeCalc`. Это **не** возрождение «mutation playbooks»: правки делает пользователь руками, apply — отдельное действие.

**4 слоя + модульные фасады:**

```
domain/costOptimizationPlanner.js                  — публичный pure draft/apply API
domain/costOptimizationPlannerConfig.js            — levels, constraints, lever specs
domain/costOptimizationPlannerShared.js            — clone/read/group shared helpers
domain/costOptimizationPlannerPlans.js             — legacy plan/ranking/summarize API
controllers/costOptimizationPlannerController.js   — единственная mutation-boundary
ui/modals/costOptimizationPlannerModal.js          — composition root модалки
ui/modals/costOptimizationPlannerModal*.js         — controls / levers / summary / format helpers
ui/calculationStateSummary.js                      — entry point в планер из composite-сводки Dashboard
```

**Draft жизненный цикл:**

```
createOptimizationDraft({ calc, level }) → { level, constraints, touchedConstraints,
                                              baseSnapshot, changes:{}, preview, validation }

updateOptimizationDraftValue(draft, fieldId, value, calc) → новый draft + новое preview
switchOptimizationDraftLevel(draft, newLevel, calc)         → defaults для untouched, touched оставлены
toggleOptimizationDraftConstraint(draft, key, value, calc)  → отметка touched, pruning changes
```

Все мутаторы **pure**: возвращают новый draft, не трогают `calc`. Preview считается через `clone + calculate(clone, null)` и складывается в `draft.preview`.

**Apply / rollback boundary** живёт в `controllers/costOptimizationPlannerController.js`. Это **единственное** место, где из планера выполняются изменения активного расчёта.

- `applyOptimizationDraftAction()`:
  1. `draftHasHighRisk(draft)` → если да, `patchModal({ confirming: true })` (inline-confirmation rendering в той же модалке, без вложенного `confirm`-диалога).
  2. Иначе `_runApply()`.
- `_runApply()`:
  1. `domainApplyDraft(draft, calc)` → `{ ok, patches, snapshot, preview }`.
  2. `_dispatchPatches(patches)` — каждый patch проходит через стандартные `calcCtl.setSetting / setAnswer`. Debounced commit штатный.
  3. `lastApplySnapshot = result.snapshot` — для отката.
  4. `draft.changes = {}`, `recomputeOptimizationDraft(draft, updatedCalc)` — preview против нового базиса.
- `rollbackOptimizationApply()`:
  1. Читает `lastApplySnapshot`.
  2. `store.updateActiveCalc({ settings, answers, answersMeta })` + `commitActiveCalc(persisted)`. Минует setSetting/setAnswer (snapshot уже валиден, cascade-логика не нужна).
  3. Свежий `createOptimizationDraft` на восстановленном calc; level и touched-constraints сохраняются.
  4. `lastApplySnapshot = null`.

**Инварианты, защищённые архитектурными тестами** ([stage-18-1-cost-optimization-planner-guardrails.test.js](tests/unit/architecture/stage-18-1-cost-optimization-planner-guardrails.test.js)):

- domain без store / services / localStorage / setAnswer / setSetting;
- UI без прямых controllers / state-импортов; UI не зовёт setSetting / setAnswer / updateActiveCalc / commitActiveCalc;
- `setSetting / setAnswer` в controller'е вызываются **только** внутри `_dispatchPatches` / `_runApply`;
- `commitActiveCalc` вызывается **только** в `rollbackOptimizationApply`;
- `open / setLevel / toggleConstraint / updateValue / removeChange / reset / cancelConfirm` — none of them мутируют activeCalc (статический grep по AST-функциям);
- controller не возвращает snackbar напрямую — возвращает `{ ok, applied, savingPercent, reason }`, snackbar показывает `app.js` через `_showOptimizationApplyResult`;
- inline-confirmation НЕ открывает вложенную `confirm`-модалку;
- SLA-options берутся из `dictionaries.questions[id='sla_target'].options` — никакого hardcode;
- никаких терминов «Применить план» / «Автооптимизировать» / «What-if» / «Optimization Playbook».

**Что НЕ persist'ится** (4а / 8б из спека):

| Сущность | Где живёт | После F5 |
|---|---|---|
| draft | `state.modals.costOptimizationPlanner.draft` | теряется |
| lastApplySnapshot | `state.modals.costOptimizationPlanner.lastApplySnapshot` | теряется |
| touchedConstraints | внутри draft | теряется |

Никакой schema-миграции. `applyOptimizationDraft` пишет в calc через штатные сеттеры — изменения переживают F5 как обычные ручные правки в Опроснике.

**touched/defaults гибрид** ([costOptimizationPlanner.js → switchOptimizationDraftLevel](js/domain/costOptimizationPlanner.js)):

- При первом `openModal` — `createOptimizationDraft` копирует `LEVEL_DEFAULT_CONSTRAINTS[level]`.
- Toggle constraint → `touchedConstraints[key] = true`.
- Switch level → для каждого key: если **touched** — оставляем; иначе — берём из дефолтов нового уровня.

Это компромисс между «уровень полностью задаёт ограничения» (предсказуемо, но неудобно для опытных пользователей) и «уровень и ограничения независимы» (гибко, но непредсказуемо при первом выборе).

#### Stage 18.1.1 extension — lever grouping + view-controls (v2.14.0)

Добавлено три domain-API экспорта в [costOptimizationPlanner.js](js/domain/costOptimizationPlanner.js):

- **`OPTIMIZATION_LEVER_GROUPS`** — 6 групп компромисса (`infrastructure / reliability / retention / ai / risk / planning`) с `title / description / constraintKey / constraintEnableLabel`. Это пользовательский слой группировки поверх существующего `LEVER_SPEC.category`.
- **`CATEGORY_TO_GROUP`** — внутренний мост `category → groupId`. Сделано через мост, не через rename `category` field, чтобы избежать миграции данных и сохранить совместимость с draft.changes из предыдущих сессий.
- **`groupOptimizationLevers(calc, draft)`** — возвращает массив всех 6 групп **всегда** (даже empty / blocked) с `{ levers, changedCount, availableLeverCount, totalSavingRub, maxRiskLevel, blocked, blockedReason, hasAnyApplicableSpec }`. UI рендерит accordion из этого массива.

**Per-group saving — точный расчёт через `preview.savingByGroup`:**

```
recomputeOptimizationDraft(draft, calc):
  beforeTotal = calculate(calc).totalMonthly
  afterTotal  = calculate(cloneWithAllChanges).totalMonthly
  savingMonthly = before - after                                    // общий

  для каждой группы с >=1 change:
    groupAfter = calculate(cloneWithOnlyThisGroupChanges).totalMonthly
    savingByGroup[gid] = before - groupAfter                        // per-group
```

≤6 дополнительных `calculate()` при полностью заполненном draft (по одному на каждую группу с правками). Debounced 200ms через `RECOMPUTE_DEBOUNCE_MS`. **Сумма по группам ≠ общему saving** — из-за мультипликативных взаимодействий (`buffers × inflation × VAT`). Документировано тестом.

**Accordion state — runtime-only:**

| Сущность | Где живёт | После F5 |
|---|---|---|
| openGroups | `state.modals.costOptimizationPlanner.openGroups: string[]` | теряется |
| viewPeriod | `state.modals.costOptimizationPlanner.viewPeriod: 'daily'\|'monthly'\|'annual'` | теряется (но seed'ится из `state.ui.dashboardPeriod`) |

Controller:
- `toggleOptimizationLeverGroup(groupId)` — idempotent add/remove.
- `setOptimizationViewPeriod(period)` — whitelist через `PERIOD_IDS.includes`.

**Blocked-группы UX** — для constraint-gated групп header — статичный `<div>` (не button), body виден всегда с причиной + inline-кнопкой `«Разрешить ...»` → `ctx.toggleOptimizationConstraint(group.constraintKey, true)`. **Кнопка только снимает constraint, не применяет правки** — это короткий путь снять блок без скролла к блоку «Ограничения».

**Кросс-модалочный hardening — preserve scrollTop при re-render** ([js/ui/index.js → renderModals](js/ui/index.js)):

```
renderModals(state, ctx):
  scrollSnapshot = новая Map<name, scrollTop>           // 1. snapshot
  для overlay в _modalsRoot.children где остаётся открытым:
    scrollSnapshot.set(overlay.dataset.modalName, body.scrollTop)

  replace(_modalsRoot, null)                            // 2. полный пересоздаваемый

  для (name, overlay) в новом rendered:
    overlay.dataset.modalName = name
    appendChild(overlay)
    body.scrollTop = scrollSnapshot.get(name) || 0      // 3. восстановление
```

Применимо ко **всем** модалкам, не только cost-optimization. Без этого fix'а любая state-мутация внутри большой модалки (toggle accordion, edit lever, draft keystroke) сбрасывала скролл в 0 — «прыжок наверх» при каждом клике.

---

## 5. Persistence и версионирование

### STORAGE_KEYS — единый whitelist

Все ключи localStorage через `STORAGE_KEYS` в [constants.js](js/utils/constants.js). Hardcoded литералы запрещены — линтер [storage-whitelist.test.js](tests/unit/services/storage-whitelist.test.js).

Главные ключи:

| Ключ | Содержит |
|---|---|
| `CALC_LIST` | Мета-список всех расчётов (id, name, totalMonthly, updatedAt). |
| `CALC_PREFIX` + id | Сам расчёт (settings, answers, dictionaries, view). |
| `ACTIVE_CALC` | id последнего активного расчёта (для F5). |
| `ACTIVE_TAB` | Последняя открытая вкладка. |
| `THEME` | `'dark'` \| `'light'`. |
| `PROVIDER_OVERLAY_OVERRIDES` | Map<providerId, AppliedJSON> — текущий applied override. |
| `PROVIDER_OVERRIDE_HISTORY` | Map<providerId, Array<{appliedJSON, appliedAt}>>, newest first, лимит 3. |
| `PROVIDER_TAB_LOCKS` | Cross-tab lock map (Stage 11.1, TTL 60s). |
| Десяток UI-state ключей | Свёрнутые секции/категории, открытые подгруппы и т.п. |

`resetAll()` / `listKeys()` в [storage.js](js/services/storage.js) фильтруют через `Object.values(STORAGE_KEYS)` — добавление нового ключа автоматически охватывается.

### Schema migrations

[migrations.js](js/state/migrations.js) — массив `MIGRATIONS` шагов `from → to`. Текущая версия — **20** (`CURRENT_SCHEMA_VERSION` re-export от `LATEST_SCHEMA_VERSION`).

Применяются:
- При загрузке из localStorage (boot).
- При импорте JSON / bundle.

Контракты шага миграции:
- `step.run(calc)` — мутирует **глубокую копию**, не оригинал.
- **Идемпотентность** — повторный запуск даёт тот же результат.
- Покрывается тестами в [migrations.test.js](tests/unit/state/migrations.test.js).

`MigrationError` — отдельный класс. Контроллеры (`openCalc`/`initFromStorage`/`importCalcFromFile`) ловят его специально и отдают `{ ok:false, reason:'migration', errors: [...] }`. `applyStateBundle` делает atomic backup/rollback — если хоть один calc не мигрирует, состояние не меняется.

Downgrade-миграция (`schemaVersion > LATEST`) бросает `MigrationError` (защита от порчи данных при откате версии приложения).

Schema v20 — совместимая нормализация Quick Start-ответов: legacy значения
select/multiselect (`ru_cis`, numeric `pdn_category`, JSON-строка
`peak_months`, старые AI tier/sensitivity aliases) приводятся к актуальным
option-id из seed-вопросов в `calc.answers` и `scenarios[*].answers`. Формулы,
прайсы и bundle major не меняются; цель шага — чтобы ранее созданные wizard
расчёты проходили `validateCalculation` и участвовали в active/bundle
import-export без пропусков.

### APP_VERSION sync

`APP_VERSION` в [constants.js](js/utils/constants.js) и `package.json` "version" — два источника правды, синхронизируются вручную. Линтер [app-version-sync.test.js](tests/unit/architecture/app-version-sync.test.js) валит CI при расхождении.

Политика bump'а:

| Часть | Когда инкрементируется |
|---|---|
| MAJOR | Breaking change формата bundle (= bump `BUNDLE_MAJOR`), удалена вкладка/функция. |
| MINOR | Новая видимая фича или новый persistent-контракт расчёта. |
| PATCH | Багфиксы, рефакторинг, мелкие UX-правки, compatibility-миграции без нового формата данных. |

---

## 6. Системная формула и DSL

```
costFinal = costBase × (applyRisks ? riskTotal : 1) × vatMul
costBase  = qty × pricePerUnit × billingIntervalMul
riskTotal = bufferFactor × inflationMul × seasonalMul × scheduleMul × contingencyMul
vatMul    = vatEnabled ? (1 + vatRate) : 1   // независимая от рисков ось
```

Где какие коэффициенты применяются — в шапке [calculator.js](js/domain/calculator.js) и в `ctx.openSummaryFormula()` (UI помощник). При изменении модели — обновлять оба места.

### DSL-парсер qty

`qty` для каждой пары (item × stand) считается через **собственный безопасный DSL** (не `eval`):

- Парсер: [parser.js](js/domain/formula/parser.js) (рекурсивный спуск, AST).
- Кэш AST: [cache.js](js/domain/formula/cache.js).
- Вычислитель: [evaluator.js](js/domain/formula/evaluator.js). Whitelist: `min/max/round/ceil/floor/abs/clamp/if`.
- Идентификаторы:
  - `Q.<id>` — ответ на вопрос (одноуровневый).
  - `S.<param>` или `S.<param>.<sub>...` — настройка расчёта (многоуровневый dot-доступ).
  - `STAND` — текущий стенд как строка.
- Лимит глубины — `FORMULA_MAX_DEPTH = 64`. Глубже — `FormulaError`, не RangeError браузера.

Defensive линтер [evaluator-no-globals.test.js](tests/unit/architecture/evaluator-no-globals.test.js): evaluator остаётся pure — никаких `globalThis`, `window`, `document`, `localStorage`, `eval`, `new Function`, `setTimeout(string)`.

### Per-resource standSizeRatio (Stage 12.U12)

Для item с полем `dashboardResource` (CPU/GPU/RAM/SSD/HDD/S3) `buildContext` подменяет общий `S.standSizeRatio.<STAND>` на per-resource override. Магический подход (вариант B) выбран ради того, чтобы НЕ переписывать 32 формулы в seed.

### Инвариант стендов (Stage 13.U11 + Stage 19)

PROD = 1.00 принудительно. DEV/IFT/PSI для `standSizeRatio` и
`resourceRatio` остаются долей от ПРОМ и ограничены 1.00. LOAD/НТ — отдельный
capacity-стенд для stress testing: он может быть до 1.20, чтобы искать пределы
системы выше предполагаемой промышленной нагрузки. `aiStandFactor` ограничен
1.00 для всех стендов, включая LOAD, потому что это доля AI-нагрузки от
prod-эквивалента, а не capacity-запас. Защита в 4 точках (defense-in-depth):
- UI-input через `STAND_RATIO_RANGES[stand].max`.
- Setter `setResourceRatio` через per-stand guard.
- Validator через per-stand range, а не общий потолок 1.00.
- Миграция v11→v12 clamp legacy state по `STAND_RATIO_RANGES`.

Линтеры: [stand-le-prod-invariant.test.js](tests/unit/architecture/stand-le-prod-invariant.test.js), [invariant-load-le-prod.test.js](tests/unit/domain/).

---

## 7. UI: иммутабельная отрисовка через `el()` и `replace()`

[js/ui/dom.js](js/ui/dom.js) предоставляет минимальный helper:

```js
el('div', {
    class: ['foo', isActive && 'is-active'],   // массив с фильтрацией falsy
    text: 'plain text',                         // safe — escaped
    trustedHtml: trustedHtml(svgString),        // только для SVG-icons / markdown
    attrs: { type: 'button', 'aria-label': '…' },
    onClick: e => ctx.foo(e),
    onInput: e => ctx.bar(e.target.value)
}, child1, child2, ...)
```

Запреты:
- `style:` с user-input (Q.*, answers.*, item.name) — линтер [style-no-user-input.test.js](tests/unit/architecture/style-no-user-input.test.js). Защита от CSS-injection при `style-src 'unsafe-inline'`.
- `el(..., { html: ... })` — бросает. Только `trustedHtml(...)` для доверенных строк (SVG, renderMarkdown).

`replace(node, newChild)` — ре-маунт корневого узла. UI пересоздаётся целиком на каждое изменение state; identity-сохранение фокуса — через `data-focus-key` и captureFocus/restoreFocus.

### Модальные окна

Реестр: [ui/index.js](js/ui/index.js) → `MODAL_ORDER` + `MODAL_RENDERERS`. Каждая модалка имеет:
- Запись в `state.modals.<name>` в [store.js](js/state/store.js) (open: false + draft, payload, errors).
- Render-функцию `renderXxxModal(state, ctx)` → overlay либо null.
- Триггер `ctx.openXxxModal(payload)` → `store.openModal(name, payload)`.
- Закрытие `ctx.closeModal(name)` или `store.closeModal(name)`.

Зарегистрированных модалок 28 (на 2.20.26): message, confirm, duplicateImport, input, quickStart, reset, help, printAnswersOptions, assumptions, assumptionsRegister, calculationHealth, sensitivity, budgetGuardrails, decisionMemo, costOptimizationPlanner, guidedCompletion, formula, itemEdit, questionEdit, reapplyConfirm, scenarioMenu, scenarioRename, scenarioDuplicate, deltaHistory, providerAnalytics, priceImportMapping, scenarioComparison, vatPolicyChoice. Helper-файлы рядом с модалками (`baseModal`, `quickStartModel`, `costOptimizationPlannerModal*`) не входят в `MODAL_ORDER`.

Удалены в Stage 17.2: `recommendedActions` (заменён блоком «Следующие шаги» на Дашборде), `calculationDiff` (UI убран; pure-domain helper остался — см. п. 4.7).

---

## 8. Тестирование

### Структура

```
tests/
├── run.js                    # кастомный runner (рекурсивно ищет *.test.js)
├── unit/
│   ├── domain/               # чистый расчёт, DSL, validation
│   ├── state/                # store, persistence, migrations, crossTabSync
│   ├── controllers/
│   ├── services/
│   ├── ui/                   # source-grep тесты + DOM-mock smoke
│   └── architecture/         # layer-linter, no-emoji, no-toiso-slice, …
├── integration/              # storage-mock + полный controller path
└── _helpers/
    └── source.js             # stripCssComments / stripJsComments / ruleBody
```

### Команды

```bash
npm test                  # все тесты, параллельно через node:test, spec-репортер
npm run test:quick        # быстрый unit-slice
npm run test:architecture # architecture/source guards
npm run test:ui           # UI unit/source smoke
npm run test:integration  # integration-сценарии
npm run test:watch        # watch-режим (node --watch)
npm run smoke:desktop     # Playwright desktop suite (smoke + UI/domain + real user flows)
npm run smoke:published   # короткий smoke GitHub Pages build на /CALC_INFRA/
npm run syntax-check      # node --check на всех js/**/*.js
npm run prices:freshness:check # provider freshness report sync
npm run pages:build       # собрать .pages-dist для Pages workflow
node --test tests/unit/domain/calculator.test.js                 # один файл
node tests/run.js tests/unit/domain tests/unit/services           # scoped runner
node --test --test-name-pattern="riskFactor" tests/...            # один тест
```

Sanity-check скрипт ([scripts/sanity-report.mjs](scripts/sanity-report.mjs)): прогоняет калькулятор на 3 профилях (Startup / SMB / Enterprise), пишет [SANITY_REPORT.md](SANITY_REPORT.md) через `npm run sanity` или проверяет актуальность через `npm run sanity:check`. Для более жёсткого контроля расчётных цифр есть golden-сценарии Quick Start в [golden-scenarios.test.js](tests/unit/domain/golden-scenarios.test.js): они закрепляют ожидаемые totalMonthly, totalAnnual, topCategory и byCategoryMonthly для 9 профилей, включая регулируемый B2G FinTech XL + AI. Инварианты всей Quick Start матрицы живут в [wizard-calculation-invariants.test.js](tests/unit/domain/wizard-calculation-invariants.test.js): 2880 комбинаций проходят production `calculate()` с проверкой aggregate drift, NaN/Infinity, отрицательных сумм, monotonic scale/geography и AI >= non-AI. Полезно после правок прайсов или формул.

Provider freshness report ([scripts/provider-freshness-report.mjs](scripts/provider-freshness-report.mjs)): пишет [PROVIDER_FRESHNESS_REPORT.md](PROVIDER_FRESHNESS_REPORT.md) через `npm run prices:freshness` или проверяет актуальность через `npm run prices:freshness:check`. Отчёт строится из `js/data/providers-bundled.generated.js`, фиксирует timestamp/age/version/SKU-count/VAT confidence и подсвечивает `STALE`, `STUB`, `ASSUMED_VAT`.

### Виды тестов

| Вид | Назначение | Пример |
|---|---|---|
| **Unit (domain)** | Чистая логика без IO, golden snapshots и матричные инварианты расчётов | [calculator.test.js](tests/unit/domain/calculator.test.js), [golden-scenarios.test.js](tests/unit/domain/golden-scenarios.test.js), [wizard-calculation-invariants.test.js](tests/unit/domain/wizard-calculation-invariants.test.js) |
| **Unit (state)** | Migrations, store-mutations | [migrations.test.js](tests/unit/state/migrations.test.js) |
| **Unit (controller)** | Через mock store, без UI | [calcController.test.js](tests/unit/controllers/) |
| **Unit (services)** | Storage, json, csv с mock localStorage | [csvImport.test.js](tests/unit/services/) |
| **Unit (UI source-grep)** | Регресс-якоря на класс / селектор / контракт без рендеринга | [stage-16-6-recommended-actions.test.js](tests/unit/ui/) |
| **Unit (UI smoke)** | Все ui/-модули импортируются параллельно под минимальным DOM-mock'ом | [ui-modules-smoke.test.js](tests/unit/ui/) |
| **Architecture** | Layer-linter, версии, A11y, no-emoji, no-toiso-slice | [layer-imports.test.js](tests/unit/architecture/) |
| **Integration** | Полный controller-path с installLocalStorage | [calc-persistence-atomicity.test.js](tests/integration/) |
| **Desktop browser smoke/regression** | Реальный Chromium/Chrome-рендер критичных desktop-сцен, console/overflow checks, UI↔domain сверка Dashboard/Details, реальные user-flow клики Quick Start/Sidebar/Опросник/Dashboard CTA, disabled-стенды, risk/VAT, active/bundle JSON import-export-reset, scenario tabs, provider VAT policy import, Decision Memo download, PDF print routing, screenshots и PNG-signal visual regression | [desktop-smoke.spec.js](tests/e2e/desktop-smoke.spec.js), [desktop-regression.spec.js](tests/e2e/desktop-regression.spec.js), [desktop-user-flow.spec.js](tests/e2e/desktop-user-flow.spec.js), [desktop-data-management.spec.js](tests/e2e/desktop-data-management.spec.js), [desktop-export-print.spec.js](tests/e2e/desktop-export-print.spec.js), [desktop-visual-regression.spec.js](tests/e2e/desktop-visual-regression.spec.js) |
| **Published smoke** | GitHub Pages build на base path `/CALC_INFRA/`: версия в sidebar, Quick Start, Dashboard, Детализация, Сравнение, console/overflow checks, HTTP 4xx/5xx diagnostics with URL | [published-smoke.spec.js](tests/e2e/published-smoke.spec.js), [smoke-published.mjs](scripts/smoke-published.mjs) |

Для Playwright user-flow используются `data-testid` только на стабильных
desktop-контрактах: навигация, Quick Start, переключатели Dashboard, настройки
Опросника, scenario tabs, file import/export buttons, print/export buttons и CTA модалок. Не
привязывать E2E к декоративным CSS-классам, когда есть смысловой test id;
CSS-классы остаются допустимы для табличных DOM-readers, которые сверяют
конкретную отрисованную структуру.

Playwright helpers используют module imports через `new URL('js/...', document.baseURI)`, а не абсолютный `/js/...`. Это обязательный контракт для GitHub Pages: published build живёт под `/CALC_INFRA/`, поэтому абсолютный root-path сломал бы smoke на проде.

### CI

GitHub Actions workflow [ci.yml](.github/workflows/ci.yml) разделён на два
job'а:
- `unit-and-sanity`: Node 24, `npm ci --ignore-scripts`, `npm test`,
  `npm run syntax-check`, `npm run sanity:check`,
  `npm run prices:freshness:check`, `npm run pages:build`,
  `git diff --check`.
- `desktop-smoke`: Node 24, `npx playwright install --with-deps chromium`,
  `npm run smoke:desktop`; на failure загружает `.playwright-mcp/test-results`.

Workflow использует Node 24-aware action majors: `actions/checkout@v6`,
`actions/setup-node@v6`, `actions/upload-artifact@v7`. Это убирает warning GitHub
Actions о deprecated Node.js 20 runtime внутри самих actions.

GitHub Pages публикуется отдельным workflow
[pages.yml](.github/workflows/pages.yml): `actions/configure-pages@v6`,
`actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5`. Artifact
`.pages-dist` собирается из tracked static-файлов через `npm run pages:build`
и содержит `.nojekyll`. Pages source должен быть `GitHub Actions`
(`build_type=workflow`), а не legacy deploy-from-branch.

Локально Playwright по умолчанию использует системный Chrome
(`PLAYWRIGHT_CHANNEL=chrome`), а в CI — bundled Chromium, установленный
Playwright job'ом. При необходимости канал можно переопределить через
`PLAYWRIGHT_CHANNEL`. Для проверки уже опубликованной сборки используется
`PLAYWRIGHT_BASE_URL` без локального `webServer`; `npm run smoke:published`
ставит его в `https://smaltsev75-sudo.github.io/CALC_INFRA/`. Published smoke
по умолчанию запускается с `PLAYWRIGHT_PUBLISHED_RETRIES=1`; для строгого
одноразового прогона можно задать `PLAYWRIGHT_PUBLISHED_RETRIES=0`.

### Source-grep helpers (TDD-якорь)

Многие тесты анализируют исходник как текст (selector → CSS rule, factor in render-функции, regex по структуре). [tests/_helpers/source.js](tests/_helpers/source.js):

```js
import { stripCssComments, stripJsComments, ruleBody, extractAtMediaBody }
    from '../../_helpers/source.js';

// Снимает /* ... */ и // — литерал в комментарии не даёт false-pass.
const css = stripCssComments(read('css/forms.css'));

// Body одного CSS-правила без комментариев.
const rule = ruleBody(read('css/forms.css'), '.delta-pill--up');

// Body @media-блока.
const reduced = extractAtMediaBody(read('css/forms.css'),
    'prefers-reduced-motion: reduce');
```

Без этих helpers тест может пройти когда правило удалено, а литерал случайно остался в комментарии.

После модульного рефакторинга source-grep тесты должны читать **файл-владелец поведения**, а не исторический фасад. Примеры: проверки number-input читают [questionnaireNumberInput.js](js/ui/questionnaireNumberInput.js), provider update row — [providerUpdateRow.js](js/ui/providerUpdateRow.js), app wiring — соответствующий `js/app/*Actions.js`. Если переносите функцию в новый модуль, сначала обновите тестовый источник, затем переносите код.

### Sweep-линтеры (важные регресс-защиты)

| Линтер | Защита |
|---|---|
| [layer-imports.test.js](tests/unit/architecture/layer-imports.test.js) | UI ↛ controllers/state, domain ↛ services/state/UI |
| [storage-whitelist.test.js](tests/unit/services/) | localStorage ключи только через `STORAGE_KEYS` |
| [style-no-user-input.test.js](tests/unit/architecture/) | `style:` без user-input (CSS-injection) |
| [evaluator-no-globals.test.js](tests/unit/architecture/) | DSL-evaluator без `globalThis`/`eval`/`Function` |
| [a11y-focus.test.js](tests/unit/architecture/) | `outline: none` без замены запрещён (WCAG 2.4.7) |
| [touch-targets.test.js](tests/unit/architecture/) | На pointer:coarse — кнопки ≥44×44 (WCAG 2.5.5) |
| [items-wrap-overflow.test.js](tests/unit/ui/) | Запрет `overflow: auto/hidden` на ancestor sticky-thead таблиц (3 жертвы за историю проекта) |
| [stand-le-prod-invariant.test.js](tests/unit/architecture/) + [invariant-load-le-prod.test.js](tests/unit/domain/) | DEV/IFT/PSI не превосходят ПРОМ; LOAD допускает capacity до 1.20; AI-factor ≤ 1.00 |
| [app-version-sync.test.js](tests/unit/architecture/) | `APP_VERSION` ↔ `package.json.version` |
| [seed-formulas.test.js](tests/unit/domain/) | Каждая qty-формула 36 ЭК парсится и вычисляется в финитное ≥0 число |
| [no-emoji-in-source.test.js](tests/unit/architecture/) | Эмодзи только в .md и комментариях, не в `text:` UI-узлов |
| Линтер `toISOString().slice(0, N)` | Замена на `dateForFilename` / `formatDate*` |

### TDD workflow

Принятая практика для нового функционала и багфиксов:

1. **Тест**, воспроизводящий желаемое поведение (фейлится без фикса).
2. **Фикс / реализация** минимальная.
3. **Проверка**: `npm test` + ручная browser-проверка для UI.
4. **Документация** — обновление DECISIONS.md / CLAUDE.md, если меняется контракт.

---

## 9. Карта папок

```
/
├── index.html                # boot, CSP в <meta>
├── css/
│   ├── base.css              # CSS-переменные, темизация [data-theme]
│   ├── forms.css             # формы, опросник, провайдеры, sim-модалка
│   ├── tables.css            # детализация, элементы, вопросы
│   ├── dashboard.css
│   ├── comparison.css
│   ├── sidebar.css
│   ├── modals.css
│   ├── components.css        # buttons, pills, accordion
│   └── print.css             # @media print overrides
├── js/
│   ├── app.js                # boot + ctx composition root
│   ├── app/                  # extracted ctx-actions + runtime helpers
│   │   ├── *Actions.js       # calc-list, provider, price-import, scenario, quick-start
│   │   ├── renderScheduler.js, loadingButton.js, toastResults.js
│   │   ├── instanceLockRuntime.js, uiPersistenceSubscriber.js
│   │   └── theme.js, vatBanners.js, modalHashNavigation.js
│   ├── ui/                   # рендер
│   │   ├── index.js          # renderApp, MODAL_ORDER, MODAL_RENDERERS
│   │   ├── dom.js            # el(), replace(), trustedHtml(), infoIcon()
│   │   ├── icons.js          # Lucide line-SVG
│   │   ├── focus.js          # captureFocus / restoreFocus / trapTabIn
│   │   ├── snackbar.js       # toast-стек с типами и progress
│   │   ├── sidebar.js, header.js
│   │   ├── calcList.js, questionnaire.js, dashboard.js
│   │   ├── questionnaire*.js         # number input + settings/provider/VAT/stands helpers
│   │   ├── dashboard*.js             # aggregates, metrics, profile banner, risk card
│   │   ├── details.js, detailsSections.js, comparison.js
│   │   ├── itemsTab.js, questionsTab.js
│   │   ├── providerPriceSummary.js, providerUpdateRow.js
│   │   ├── vatBadge.js, comparisonIndicators.js
│   │   └── modals/                   # 28 registered modals + helper partials
│   ├── controllers/
│   │   ├── calcController.js, calcListController.js
│   │   ├── itemController.js, questionController.js
│   │   ├── providerController.js     # fetch / file / sim / history / analytics
│   │   ├── helpController.js, keyboardController.js
│   ├── state/
│   │   ├── store.js                  # observable, deepFreeze, modals
│   │   ├── persistence.js            # localStorage IO functions
│   │   ├── migrations.js             # schema migration steps
│   │   ├── crossTabSync.js           # tab-id, lock-map, storage-event handler
│   │   ├── crossTabNotifier.js       # subscriber-based toast
│   ├── services/
│   │   ├── storage.js                # readJson/writeJson + quota guard
│   │   ├── json.js, csvExport.js, csvImport.js, markdown.js, format.js
│   │   ├── calcPersistence.js        # atomic 2-key обёртки CRUD
│   │   ├── bundleExport.js           # full export-import + atomic rollback
│   │   ├── decisionMemoExport.js, decisionMemoFormat.js
│   │   ├── providerPriceFetch.js     # validate + history rollback
│   │   ├── providerPriceNormalize.js # VAT entry → net normalization
│   │   └── providerPriceResolver.js  # frozen ∪ override → effective
│   ├── domain/
│   │   ├── calculator.js             # главная формула, билд контекста
│   │   ├── calcImpact.js             # what-if simulation (13.3)
│   │   ├── calcVersioning.js         # applyOverrideToItems, deltas, isCalcStale
│   │   ├── providerOverlay.js, providerAnalytics.js
│   │   ├── seed.js                   # 36 ЭК + 80+ вопросов + DEFAULT_SETTINGS
│   │   ├── validation.js, validationFormulaLint.js
│   │   ├── calculationHealth.js, calculationHealthChecks.js
│   │   ├── costOptimizationPlanner*.js
│   │   ├── priceImportMapping*.js
│   │   ├── costType.js               # CAPEX/OPEX классификатор
│   │   ├── withoutRisks.js, scenarios.js
│   │   ├── wizardProfiles.js, wizardProfileData.js
│   │   └── formula/                  # parser + cache + evaluator (DSL)
│   └── utils/
│       ├── constants.js              # APP_VERSION, STORAGE_KEYS, лимиты, ставки
│       ├── escapeHtml.js, debounce.js, lru.js, freeze.js, uuid.js
└── tests/                            # см. секцию 8
```

---

## 10. Где искать дополнительный контекст

- [DECISIONS.md](DECISIONS.md) — журнал ключевых решений по этапам (главный источник истины для контекста). Читать перед нетривиальной правкой.
- [CLAUDE.md](CLAUDE.md) — обзор архитектуры + накопленные ловушки (DOM/CSS, domain, state, A11y).
- [UI_PRODUCTION_PATTERNS.md](UI_PRODUCTION_PATTERNS.md) — META-обобщение Stage 8 (PDF print, alignment, override-hunt). 8 паттернов с сигналами / анти-паттернами / правильными подходами.
- [SANITY_REPORT.md](SANITY_REPORT.md) — последние числа калькулятора на 3 профилях.
- [ТЗ.md](ТЗ.md) — исходное ТЗ заказчика.

---

## Calculation State Summary (Stage 18.2)

**Файл**: [js/ui/calculationStateSummary.js](js/ui/calculationStateSummary.js).

Композитный Dashboard-блок, объединяющий бывшие 4 отдельные карточки (Готовность / Качество / Бюджет / Следующие шаги) в один управленческий status-блок.

### Принципы

- **Presentation-only composition.** Никакой собственной domain-логики, никаких ctx-мутаций. Все данные читаются из существующих источников.
- **Reuse без дублирования**:
  - `evaluateCalculationReadiness(calc)` — verdict / blockers / warnings.
  - `evaluateCalculationHealth(calc)` — score / counts.
  - `ctx.getBudgetGuardrailsSummary()` — gap CAPEX/OPEX.
  - `ctx.getActiveNextSteps()[0]` — top action.
- **No new domain state, no new persistence, no migration.** Schema не меняется.

### Layout

```
header  (title + 3 badge: readiness / quality / budget)
verdict (одна строка)
diagnostics (2 строки grid: Качество расчёта / Бюджет)
next-step (один embedded primary CTA)
```

### Маппинг state

Helper `deriveSummaryState(readiness, health)` возвращает `green` / `yellow` / `red`:

- `green` — `verdict='ready'` (нет блокеров).
- `red`   — `verdict='empty'` ИЛИ есть severe blocker (`health_errors` / `health_score_low`).
- `yellow` — `verdict='needs_clarification'` без severe blockers (например, только `budget_missing`).

### TARGET_DISPATCH

Тот же декларативный маппинг target → ctx-метод, что был в `nextSteps.js` (Stage 17.2). Применяется к первому action из `getActiveNextSteps()` для primary CTA. Полный список:
- `guided_completion`, `assumptions_register`, `sensitivity_analysis`, `budget_guardrails`, `price_import_mapping`, `scenario_comparison`, `decision_memo`, `health_check`, `cost_optimization_planner`.

### Linter

[tests/unit/architecture/stage-17-7-regression-pack.test.js](tests/unit/architecture/stage-17-7-regression-pack.test.js) проверяет, что каждый `ALLOWED_TARGET` из `recommendedActions.js` имеет route в TARGET_DISPATCH composite-сводки. [tests/unit/ui/stage-17-3-dashboard-cta-dedup.test.js](tests/unit/ui/stage-17-3-dashboard-cta-dedup.test.js) гарантирует, что navigation-CTA (openAssumptionsRegisterModal / openSensitivityAnalysisModal / openDecisionMemoModal / openBudgetGuardrailsModal) живут только в одном Dashboard-блоке — composite-сводке.

### Cost Optimization teaser (Stage 18.2.x)

После Stage 18.2.x отдельная Dashboard-карточка `renderCostOptimizationBlock` (бывший `js/ui/costOptimizationPlanner.js`) удалена. Entry point в planner-модалку встроен в composite-сводку как secondary-action — функция `renderCostOptimizationTeaser(nextStep, ctx)` в [js/ui/calculationStateSummary.js](js/ui/calculationStateSummary.js).

**Conditional CTA-dedup.** Если `nextStep.target === 'cost_optimization_planner'` (planner уже primary next-step), teaser-кнопка не рендерится — остаётся короткий note «План оптимизации доступен в «Следующем шаге» выше». Это сохраняет инвариант «один target = один CTA на Dashboard» (Stage 17.3).

**Domain / контроллер / модалка** — не тронуты. PLAN_TIERS, applyOptimizationDraft, ctx.openCostOptimizationPlannerModal и весь Apply/Rollback/Confirm flow остаются как были.

## VAT Rate History and VAT Modes (Stage VAT-1, MINOR 2.15.0)

**Главный инвариант.** НДС — time-versioned параметр РФ (18% до 2018-12-31, 20% 2019..2025, 22% с 01.01.2026). Единственный source of truth для ставок — модуль [js/domain/vatRateTable.js](js/domain/vatRateTable.js). НДС применяется ровно один раз в [calculator.js](js/domain/calculator.js)#riskFactor через `vatMul = vatEnabled ? (1 + settings.vatRate) : 1`. НДС НЕ является risk-coefficient — `riskBreakdown.total` его не включает (12.U20 + VAT-1).

### Domain modules

| Модуль | Назначение |
|---|---|
| [vatRateTable.js](js/domain/vatRateTable.js) | `VAT_RATE_HISTORY` (история ставок) + helpers: `getVatRateForDate(date)`, `getCurrentVatRate()`, `getVatPeriodCrossings(startDate, horizonYears)`, `isoDateOf(date)`, `todayIso()`. Domain-чистый, не импортирует ничего из проекта (только `Date` API). |
| [vatResolver.js](js/domain/vatResolver.js) | `resolveVatSettingsForCalc(calc) → { vatRate, vatEffectiveDate, vatRateMode }` (pure, не мутирует) + `applyVatResolver(calc) → calc` (возвращает либо тот же объект — no-op для frozen/manual, либо shallow-clone settings с обновлёнными VAT-полями для auto-by-date). |

### Data model

Три поля у `calc.settings` (после миграции 16→17):

```text
vatRateMode      : 'auto-by-date' | 'manual' | 'frozen'
vatEffectiveDate : string ISO YYYY-MM-DD | null
vatRate          : number (доля, например 0.22)
```

Старое поле `vatEnabled: boolean` сохранено как ось «учитывать НДС / нет» — независимая от mode.

### Modes

| Режим | Семантика | Когда меняется vatRate |
|---|---|---|
| **`auto-by-date`** | Ставка пересчитывается из справочника по `vatEffectiveDate` при каждом `openCalc`. Дефолт для новых calc. | При смене `vatEffectiveDate` (через UI или после обновления справочника). |
| **`manual`** | Пользователь явно задал особую ставку (нерезидент / экспорт / льгота). `vatEffectiveDate = null`. | Только через `setVatRateManual(rate)`. |
| **`frozen`** | Бюджет согласован, ставка зафиксирована — обновления приложения / справочника не должны менять сумму. `vatEffectiveDate` хранит дату фиксации. | Только через явный `setVatRateMode('auto-by-date'/'manual')` или `setVatRateManual(rate)`. |

### Flow

**`openCalc(id)`** ([calcListController.js](js/controllers/calcListController.js)):
```text
loadCalc(id)
  → migrateCalculation(stored)  // 0..16 → 17 если нужно
  → enrichLegacyDictionaryWithAgentSeed(calc)
  → applyVatResolver(calc)      // VAT-1 Phase 3
  → if schemaChanged || vatChanged: commitMigratedCalc(calc)
  → store.setActiveCalc(calc)
```

**`createCalc(name)`** ([calcListController.js#makeNewCalculation](js/controllers/calcListController.js)):
```text
const now = new Date()
createdAt = now.toISOString()
vatEffectiveDate = isoDateOf(now)            // согласовано с createdAt (одна Date-инстанция)
vatRate = getVatRateForDate(vatEffectiveDate)
settings = { ...SEED_SETTINGS, vatRateMode: 'auto-by-date', vatEffectiveDate, vatRate, ... }
```

**Calc-resolver не зависит от module-load time**: `today` берётся в момент создания calc, не на загрузке `seed.js`.

### Controller methods (Phase 4)

В [calcController.js](js/controllers/calcController.js) — 4 setters, проброшены в `ctx` через [app.js](js/app.js):

- `setVatRateMode(mode)` — переключение. `auto-by-date` пересчитывает rate из справочника; `manual` обнуляет `vatEffectiveDate`; `frozen` фиксирует текущий rate.
- `setVatEffectiveDate(iso)` — только для `auto-by-date`; пересчитывает rate.
- `setVatRateManual(rate)` — принимает долю `[0, 1]`. **`setVatRateManual(22)` отвергается** как `> 1` — никакой скрытой нормализации `/100`.
- `freezeVatRate()` — переключение в `frozen` без пересчёта.

Все методы — silent no-op на невалидном входе (стиль `setResourceRatio` / `setAiStandFactor` / `setProvider`).

### UI (Phase 5)

5 точек:

1. **Опросник**: бейдж режима (`Авто 22% · 2026-05-12` / `Вручную 18%` / `Заморожено 20%, 2024-06-01`) + 3 кнопки «Авто» / «Вручную» / «Заморозить» — [questionnaire.js#renderVatModeBadgeAndActions](js/ui/questionnaire.js).
2. **Multi-period warning** в Опроснике: если `getVatPeriodCrossings(vatEffectiveDate, planningHorizonYears).length > 0` — non-blocking `<div class="vat-multiperiod-warning">` с текстом «Расчёт пересекает …». Текст строится из `crossings.map(...)` динамически (никаких hardcoded дат/процентов).
3. **Legacy frozen snackbar** ([app.js#maybeShowLegacyVatBanner](js/app.js)): один раз за сессию для расчётов с `vatRateMode='frozen'` И `createdAt < currentRate.from`. **Session-only** через `state.ui.shownLegacyVatBanners[calcId]` — БЕЗ STORAGE_KEYS, БЕЗ persistence (после reboot снова показывается).
4. **Decision Memo** ([decisionMemoExport.js#buildSummarySection](js/services/decisionMemoExport.js)): строка `НДС: 22% (авто, дата ставки: дд.мм.гггг)` / `(заморожено, дата фиксации: дд.мм.гггг)` / `(вручную)` или `НДС: не учитывается` при `vatEnabled=false`.
5. **Сравнение** ([comparison.js#renderComparisonVatChip + renderComparisonVatWarning](js/ui/comparison.js)): VAT chip `НДС 22% · авто` под именем каждого calc + warning chip `Ставки НДС различаются — итоги не сопоставимы напрямую` над таблицей при unique-rates > 1.

CSS — на theme tokens без BEM-параллели: `.vat-mode-badge[-auto/-manual/-frozen]`, `.vat-mode-actions`, `.vat-multiperiod-warning`, `.comparison-vat-chip`, `.comparison-vat-warning`. Print-сбросы: `.vat-mode-actions { display: none }`, background/foreground pair для остальных.

### Migration 16→17

Шаг в [migrations.js](js/state/migrations.js) использует `VAT_RATE_HISTORY` динамически — без хардкоженных дат. При добавлении новой ставки (например 2028-01-01: 22 → 24) логика миграции продолжит работать без правок.

Классификация legacy calc:
- `vatRate ∈ historical [0.18, 0.20]` → `mode='frozen'`, `vatEffectiveDate=createdAt || null`. **Сумма НЕ меняется** (acceptance-тест регрессии).
- `vatRate=0.22 + createdAt ≥ 2026-01-01` → `mode='auto-by-date'`.
- `vatRate=0.22 + createdAt < 2026-01-01 \|\| отсутствует` → `mode='frozen'` (защитный default).
- `vatRate` не в справочнике (например 0.25) → `mode='manual'`.
- `vatRate` отсутствует → `mode='auto-by-date'`, `vatEffectiveDate=createdAt`.

### Linter и archetectural guards

[vat-rate-no-literals.test.js](tests/unit/architecture/vat-rate-no-literals.test.js):
- Runtime JS не содержит `0.18/0.20/0.22` вне whitelisted `js/domain/vatRateTable.js`.
- Контекст-фильтр `\bvat\w*\b|НДС` отличает VAT-литерал от случайных совпадений (`LOAD.min=0.20` для standSizeRatio, `floor=0.20` в optimizer'е, `m=0.20` в wizard scale).
- `constants.js` НЕ экспортирует `DEFAULT_VAT_RATE` (удалён в Phase 6).
- Runtime JS не импортирует удалённый `DEFAULT_VAT_RATE`.
- `utils/constants.js` НЕ импортирует `domain/vatRateTable.js` (layer-direction).

[vat-phase5-architecture.test.js](tests/unit/architecture/vat-phase5-architecture.test.js):
- Legacy banner — session-only, никаких `STORAGE_KEYS.LEGACY_VAT`.
- UI vat-блоки используют только ctx-методы.
- Нет фраз «риск НДС» / «VAT risk» в UI.

### Boundaries

VAT-1 решает **calculator-side** модель НДС (история, режимы, миграция). Провайдерская сторона решена **отдельным Stage VAT-2** (см. ниже).

- Blended VAT для multi-period horizon — warning есть, weighted-average по месяцам нет (отложено).

---

## Provider prices and VAT normalization (Stage VAT-2, MINOR 2.16.0)

VAT-2 решает **provider-side** double-VAT: provider JSON хранит net/gross, runtime приводит к net, calculator применяет НДС ровно один раз.

### Главный инвариант

```text
Внутри калькулятора все provider prices хранятся БЕЗ НДС (net).
НДС применяется ровно один раз — через calc.settings.vatRate в риск-формуле.
```

### Data flow

```text
data/providers/sbercloud-latest.json
data/providers/yandex-latest.json     ← source of truth для maintainer
data/providers/vk-latest.json
        │
        ↓ npm run generate:providers (scripts/generate-providers-bundled.js)
        │
js/data/providers-bundled.generated.js  ← runtime source, закоммичен, ESM
        │
        ↓ import { BUNDLED_PROVIDER_PRICES }
        │
js/domain/providerOverlay.js#buildOverlayPricesFromBundled(providerId)
        │   pricePerUnit = pricePerUnitNet (canonical для downstream)
        │   pricePerUnitGross / vatRate / vatPolicyConfidence — meta для UI
        │
        ↓ PROVIDER_OVERLAYS[providerId].prices
        ↓
js/services/providerPriceResolver.js#getEffectivePricesForProvider
        │   user override > bundled net > SEED fallback
        │
        ↓
js/domain/calculator.js
        costBase = qty × pricePerUnit (= net)
        costFinal = costBase × vatMul     (vatMul применён РОВНО один раз)
        vatMul = vatEnabled ? (1 + calc.vatRate) : 1
```

### Provider JSON schema v2 (пример sbercloud)

```json
{
    "schemaVersion": 2,
    "providerId": "sbercloud",
    "version": "2026-Q3",
    "timestamp": "2026-05-09T19:30:00.000Z",
    "source": "Cloud.ru Evolution договорные тарифы 2026-Q3",
    "vatPolicy": {
        "pricesIncludeVat": true,
        "vatRateIncluded": 0.22,
        "confidence": "verified"
    },
    "prices": {
        "cpu-vcpu-shared": {
            "pricePerUnitGross": 712,
            "pricePerUnitNet": 583.61,
            "vatRate": 0.22,
            "vendor": "Cloud.ru (Evolution Compute, regular VM)",
            "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.1 версия 260316 ..."
        }
    }
}
```

### vatPolicy.confidence

`vatPolicy` валидируется строго: разрешены только `pricesIncludeVat`,
`vatRateIncluded`, `confidence`; `pricesIncludeVat` обязан быть boolean, при
`pricesIncludeVat=true` нужен `vatRateIncluded` как доля в `[0, 1]`.

| Value | Семантика | Текущий пример |
|---|---|---|
| `verified` | Source-of-truth — официальные договорные приложения / verified API | sbercloud (Cloud.ru Q3-2026) |
| `source-level` | Публичные тарифы провайдера (price-list page) | yandex (yandex.cloud/pricing) |
| `assumed` | Realistic-stub / синтетика, не верифицирована | vk (placeholder Q3-2026) |
| `user-declared` | Пользователь явно указал политику через `vatPolicyChoiceModal` (legacy v1 import) | — runtime only |

Свежесть bundled-прайсов контролируется отдельно от runtime health-check:
[PROVIDER_FRESHNESS_REPORT.md](PROVIDER_FRESHNESS_REPORT.md) генерируется из
`BUNDLED_PROVIDER_PRICES` и входит в CI через `npm run prices:freshness:check`.
Это maintainer-gate: пользовательский UI всё ещё показывает stale/stub findings
в Health Check, а репозиторий дополнительно фиксирует текущий статус bundle до
релиза.

### Constants

- `PROVIDER_PRICE_SCHEMA_VERSION = 2` — версия JSON-схемы. При bump до 3 — добавить route в `validateProviderPriceJson`.
- `EPSILON_VAT_CONSISTENCY = 0.01` — допуск проверки `abs(gross - net × (1 + vatRate))`. Отдельная константа, не переиспользуется `EPSILON_KOPECK` (источник может округлять net/gross независимо).
- `BUNDLE_MAJOR = 3` — bundle содержит provider JSON v2. Bundle-2.x и bundle-1.x остаются читаемыми (backward compat через migrateCalculation).
- `BUNDLE_VERSION = 'bundle-3.0'` — формат, в который пишется новый export.

### Что НЕ входит в VAT-2

- VAT-2 НЕ мигрирует старые `calc.dictionaries.items[].pricePerUnit` снапшоты (Q7). Пользователь видит non-blocking banner при openCalc legacy расчёта; CTA «Перейти к тарифам» только раскрывает provider summary, без auto-apply.
- VAT-2 НЕ меняет `calculator.js` формулу — `vatMul` применяется ровно один раз поверх `pricePerUnit` (= net).
- VAT-2 НЕ делает blended VAT для multi-period horizon.
- VAT-2 НЕ парсит `priceSource` для VAT-policy detection (защита от silent guessing).
