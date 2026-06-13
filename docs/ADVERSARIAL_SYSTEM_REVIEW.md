# ADVERSARIAL SYSTEM REVIEW — Калькулятор инфраструктуры

> Состязательный dual-agent протокол: System Reconstruction → Invariants → FMEA → Blast Radius → независимый анализ (Architecture / Code / Security) → Contradiction Detection → Risk Negotiation → Consensus → State-Machine Execution Model → Task Format.
>
> Дата: 2026-06-13. Версия приложения: **2.20.103** (`package.json:3`), schema **20** (`js/state/migrations.js:676`). Режим: **read-only** (код не менялся).
>
> Метод: оркестрирован 16-агентный workflow (4 recon + 3 линзы + 7 FMEA + референи + критик; ~2.25M токенов, 403 tool-use). **Все находки уровня HIGH+ и все новые находки лично перепроверены по `file:line`** (см. §11 «Верификация»). Базовый аудит: [AUDIT_NOTES.md](AUDIT_NOTES.md); план: [REFACTORING_PLAN.md](REFACTORING_PLAN.md).
>
> Дисциплина против фабрикации: каждое утверждение о текущем коде — с `file:line` и пометкой confidence (**proven** = баг в коде сейчас / **likely** / **speculative** = гипотетический break-сценарий by-design). Break-сценарии инвариантов — легитимный инструмент проектирования, помечены явно; **не** выдаются за текущие баги.

---

## ЭТАП 0. Резюме

Система — зрелый, многократно-аудированный offline SPA с однонаправленным реактивным конвейером и сильными защитами данных. Состязательный проход подтвердил отсутствие критических дефектов (потеря данных / RCE / XSS) **в нормальных путях** и выявил один **HIGH** (необратимость миграции — DATA-1) и кластер **MEDIUM/LOW** структурных и контракт-дрейфовых проблем, из которых **наиболее ценная новая находка — RISK-2** (кэш расчёта постоянно обходится из-за `calc.calcRevision === undefined`, тривиальный фикс, заметный perf-эффект).

| Severity | Кол-во | ID |
|----------|--------|-----|
| HIGH | 1 | RISK-1 (DATA-1) |
| MEDIUM | 2 | RISK-2 (cache-revision), RISK-3 (layer blind-spot) |
| LOW | 6 | RISK-4 (daysPerMonth), RISK-5 (resetAnswers), RISK-6 (bundle repairs), RISK-7 (provider validate), RISK-8 (BFCache/onWriteFailed), RISK-9 (cross-tab calc.*) |
| INFO | 3 | RISK-10 (DATA-3), RISK-11 (seed-dup), RISK-12 (ENG-1) |

Новое сверх базового аудита: **RISK-2, RISK-3, RISK-4(+второй локус в калькуляторе), RISK-6, RISK-7, RISK-8, RISK-9** и 3 пробела покрытия (§ЭТАП 6 / critique).

> **Статус исполнения (2026-06-13, risk burn-down → consolidation):** ✅ **RISK-1** (durable pre-migration backup, **hardened до backup-or-abort GATE** после того как diff-review нашёл DATA-SAFETY-1 — best-effort был data-unsafe под partial-quota) и ✅ **RISK-2** (calcRevision cache contract) ИСПОЛНЕНЫ по TDD (full suite **5568 pass / 0 fail**, syntax+sanity green; не закоммичено). Доменные решения владельца: **G1** (второй локус `calculator.js:492`) закрыт как *intentional divergence* — нормализованная нагрузочная модель «30 дней», не зависит от `settings.daysPerMonth`; **RISK-9** — *accepted design limitation* (принцип: «`calc.*` consistency через single-writer lock, не distributed sync»). Детали и остаток — в [REFACTORING_PLAN.md §14](REFACTORING_PLAN.md).

---

## ЭТАП 1. System Reconstruction (4 модели)

### 1.1. Execution Flow Graph

Однонаправленный реактивный конвейер с **двумя независимыми таймлайнами** (рендер vs persist):

```
DOM-событие (el on* listener, per-node)             js/ui/dom.js:59-63
   → ctx.<method>  (~193 тонких диспетчера)          js/app.js:128-893
      → controller / app-action                       js/controllers/*, js/app/*
         → domain (чистая логика)                      js/domain/*
            → store.update*  (deepFreeze + _notify)    js/state/store.js:296-331
               → ЕДИНСТВЕННЫЙ subscriber               js/app/uiPersistenceSubscriber.js:97-145
                  ├─ scheduleRender (rAF-коалесинг)     js/app/renderScheduler.js:1-10
                  └─ best-effort UI-state persist (13 правил)

ПАРАЛЛЕЛЬНО (таймлайн данных расчёта):
   controller.commit() → persistStatus='pending' + debounce(RECALC_DEBOUNCE_MS)  js/controllers/calcController.js:47-56
      → commitActiveCalc → _atomicCalcAndListWrite (атомарная запись calc.<id> + calc.list)  js/services/calcPersistence.js:65-211
         → writeJson → localStorage   js/services/storage.js:97-127
```

Три уровня батчинга: (1) rAF-коалесинг рендера; (2) debounce автосейва; (3) debounce `refreshCalcList` на переходе `persistStatus→'saved'`. **Нет глобальной делегации событий** — listeners вешаются per-node в render и GC'ятся с эфемерным DOM (паттерн §12). Все записи в storage идут через единственный `writeJson`; ключи знают только `storage.js` + `persistence.js`.

**Слабые места модели:** см. RISK-1 (перезапись при миграции), а также: best-effort UI-state persist может тихо расходиться с памятью под quota без `persistStatus='error'` (`uiPersistenceSubscriber.js:136-143` — тема/вкладка/аккордеоны не сигналят сбой); `scheduleRender` — голый `requestAnimationFrame` без fallback (`renderScheduler.js:6`); «saved»-индикатор decoupled от отрендеренного (два сложенных debounce).

### 1.2. State Ownership Map

State живёт в 5 ярусах:

| Ярус | Где | Writer | Reader | Риск |
|------|-----|--------|--------|------|
| In-memory root | `store._state` (deepFreeze) `store.js:296-299` | только методы `Store` | все render/controller через `getState()` | — |
| Активный расчёт + зеркало | `activeCalc` ↔ `scenarios[active]` `scenarios.js:29-40` | `calcController.commit()` → `syncActiveScenarioFromRoot` | calculator, UI | mirror-divergence (speculative, `scenarios.js:141-143`) |
| Persisted calc | `calc.<id>` (localStorage) `persistence.js:21-29` | `_atomicCalcAndListWrite` | `loadCalc`/boot | **last-writer-wins по id, нет CAS** |
| UI-state ключи (~20) | localStorage | best-effort subscriber | `initFromStorage` | тихий сбой под quota |
| Module-level кэши | `_resultCache` (calculator.js:503), `_cache` (formula/cache.js:14), `storage._probedOk` | их модули | их модули | глобальные синглтоны |

**Слабые места:** RISK-2 (calc.calcRevision всегда undefined → cache bypass, **proven**, `budgetGuardrails.js:100`); RISK-8 (BFCache re-acquire без re-init, `instanceLockRuntime.js:45-56`); `calcRevision` — store-глобальный, не per-calc (теоретический alias LRU-ключа `${id}#${revision}`, speculative); undo-backup элемента живёт только в замыкании snackbar (не персистится, `crudActions.js:9`).

### 1.3. Data Lifecycle Model

```
CREATE   → makeNewCalculation (schemaVersion=CURRENT сразу, scenarios[0])  calcListController.js:35-135 ; commitNewCalc. БЕЗ validateCalculation.
VALIDATE → АСИММЕТРИЧНО: validateCalculation ТОЛЬКО на trust-boundary —
           file import (calcListController.js:499) и bundle (bundleExport.js:111,184).
           createCalc / updateActiveCalc / autosave — БЕЗ валидации.
MUTATE   → store.updateActiveCalc (immutable patch + calcRevision++)  store.js:323-331 ; commit() debounced.
PERSIST  → _atomicCalcAndListWrite: backup обоих ключей → saveCalc → saveCalcList →
           rollback обоих при сбое, persistStatus='error'  calcPersistence.js:65-211.
MIGRATE  → лениво при load: prepareLoadedCalc → migrateCalculation (атомарный per-step
           deep-copy + downgrade-guard)  migrations.js:696-739. commitMigratedCalc
           ПЕРЕЗАПИСЫВАЕТ исходный calc.<id>  calcListController.js:759-770.  ← RISK-1
RESTORE  → undo-snackbar (backup в замыкании, raw snapshot)  calcListActions.js:112-134 ;
           bundle import (atomic backup in-memory)  bundleExport.js:287-455.
```

**Слабые места:** RISK-1 (HIGH, перезапись без durable backup); валидация асимметрична (RISK-7 родственно); bundle-rollback может оставить partial-state при quota и на rollback-записи (`bundleExport.js:395-433`, inherent localStorage no-transaction limit); delete-undo backup эфемерен (теряется при reload/закрытии в окне отмены).

### 1.4. Dependency Graph

Слои `ui → controllers → state → domain` (+ `services`/`utils` как leaves). **Enforcement частичный**: `layer-imports.test.js:62-72` жёстко запрещает только `ui↛{controllers,state}`, `controllers↛ui`, `domain↛{ui,controllers,state,services}`. Зелёный.

**Слабые места (RISK-3):** `app/` и `services/` **не обходятся** walkJs (`layer-imports.test.js:25-27,76-78`) — нет ни одного правила. Реально: UI импортирует `domain` (67×) и `services` (37×) напрямую (не линтуется); `services` импортируют `../state/` (`calcPersistence.js:31-32` → store, `bundleExport.js:23-25`, `loadedCalc.js:29`, `providerPriceResolver.js:21`, `providerPriceFetch.js:41`). Docstring `store.js:5-7` заявляет строгую цепочку, которой тесты **не** обеспечивают. Плюс RISK-11 (дубль seed-дефолтов в `migrations.js:381-382` ради разрыва цикла).

---

## ЭТАП 2. Invariant System (финальные согласованные инварианты)

Статусы: **enforced** (есть автоматический guard), **partial** (guard узкий), **violated** (нарушается в коде), **+ BREAK** (сценарий, который ломает инвариант).

| ID | Инвариант | Статус | BREAK-сценарий (file:line) |
|----|-----------|--------|----------------------------|
| INV-1 | Только storage.js знает физ. ключи localStorage; всё пишет через `persist.*→writeJson` | **partial** | `layer-imports.test.js` ловит cross-layer import, но **прямой `localStorage.setItem`** в любом файле тест не матчит (сканирует только import-выражения) |
| INV-2 | Миграция расчёта обратима: до-миграционный JSON восстановим | **violated** | Нет enforcement. `commitMigratedCalc` перезаписывает тот же `calc.<id>` (`calcListController.js:759-770`→`persistence.js:26-29`). Шаг с латентным data-loss (не throw) → оригинал затёрт. = RISK-1 |
| INV-3 | Запись пары (calc.<id>, calc.list) атомарна с rollback | **enforced** | Double-fault: если на rollback `saveCalc(backup)` тоже упрётся в quota → честный сигнал «перезагрузите», авто-recovery нет (inherent localStorage no-transaction) `calcPersistence.js:118-123` |
| INV-4 | Persist-fail активного расчёта всегда виден (`persistStatus='error'`) | **enforced** | Путь персиста вне whitelist `persist-save-checked.test.js`. `resetAnswers` — пример (RISK-5): debounced commit с игнор-return, success-snackbar показан до возможного error |
| INV-6 | Расчёт из будущей версии схемы отвергается (`schemaVersion > LATEST`) | **partial** | `incomingVersion` берётся только если `Number.isFinite` (`migrations.js:702`). JSON без числового `schemaVersion` → трактуется как 0 → прогон через все миграции, минуя downgrade-guard |
| INV-7 | Импорт bundle атомарен (validate-prepare-apply-rollback) | **partial** | Шаг remove (`bundleExport.js:346`) до записи новых; при quota на записи И на rollback — старые удалены, не восстановлены. Hard-interruption (kill вкладки) между remove и rollback — JS-rollback не выполнится |
| INV-8 | Один writer над storage (single-instance lock до I/O) | **partial** | (1) BFCache `handlePageshow` без `initFromStorage` (RISK-8); (2) `onWriteFailed` не подключён в `runtime.start` (`instanceLockRuntime.js:24-31`) → quota mid-session тихо протухает lock; (3) `crossTabSync` не слушает `calc.*` (RISK-9) |
| INV-9 | Все load-path расчёта проходят единый `prepareLoadedCalc` | **partial** | `snapshotCalc` (`calcListController.js:370-372`) для undo возвращает RAW `loadCalc` в обход pipeline (by design, round-trip fidelity) — 5-й путь чтения, не покрыт тестом 4-путей |
| INV-10 | `runMigrations()` — вестигиальный no-op; реальная миграция per-calc | **enforced** | Maintainer-trap (RISK-10): будущий dev добавит глобальную миграцию в `runMigrations`, не зная о per-calc → конфликт двух версионирований |
| INV-SEC-1 | `renderMarkdown` XSS-safe: escape до парсинга + URL allow-list | **enforced** | Будущая правка переместит `inline()` до `escapeHtml`, или ослабит `SAFE_URL_RE` до deny-list. Эмпирически: `java&#x73;cript:` → fails allow-list |
| INV-SEC-2 | Только branded `trustedHtml()` ставит innerHTML | **enforced** | Renderer обернёт user-markdown в `trustedHtml(renderMarkdown(x))` И INV-SEC-1 сломан — brand аттестует claim вызывающего, не фактическую безопасность |
| INV-SEC-5 | Calc-данные доверяются только после `validateCalculation` | **violated** | Enforced только на import/bundle. `commitActiveCalc`/`applyOverrideToActiveCalc` (`providerController.js:591`)/`createCalc` персистят без валидации. Битый `providerOverlayOverrides` несёт невалид. `pricePerUnit` в расчёт (RISK-7) |
| INV-CODE-1 | Для любого периода total = Σ(CAPEX+OPEX) на той же карточке | **violated** | `daysPerMonth != 30`: total daily = `totalMonthly/daysPerMonth` (`calculator.js:725-726`), а CAPEX/OPEX/risk daily = `×(1/30)` (`dashboard.js:90`). = RISK-4 |
| INV-CODE-4 | Деление/модуло в формулах не даёт NaN/Infinity | **enforced** | by-design: `/0→0` (`evaluator.js:140,144`), помечено disputed (семантическая ловушка, не баг) |
| INV-CODE-5 | Рекурсия evaluate терминирует в FORMULA_MAX_DEPTH (64) | **enforced** | Парсер (не evaluator) без depth-guard; глубокие скобки → нативный RangeError, перехвачен `getAst` try/catch (`cache.js:28-29`). Сломается если будущий путь вызовет `parseFormula` в обход `getAst` |

---

## ЭТАП 3. FMEA-lite (по критическим зонам)

Сжато; полный разбор — в исходных данных workflow. **DEFENDED** = защищено существующим кодом, ломается только в редком окне; **PROVEN** = подтверждённый дефект; **HYPOTHESIS** = break-сценарий by-design.

### Зона A — Boot: миграция + commit
| Mode | Класс | Trigger | Data impact | Detection | Recovery |
|------|-------|---------|-------------|-----------|----------|
| Перезапись исходного JSON при логически-неверной (не падающей) миграции | HYPOTHESIS→RISK-1 | старый schemaVersion + шаг с латентным data-loss | исходник затёрт безвозвратно | тихо (нет error-banner) | нет авто; только свой JSON-экспорт до апдейта |
| Quota при commit мигрированного | DEFENDED | localStorage у лимита | данные целы, activeCalcId=null | `persistStatus='error'` + инструкция (`calcListController.js:762-764`) | освободить место + F5 |
| Будущая версия → downgrade-guard | DEFENDED | schemaVersion>LATEST | данные целы | error-banner с причиной | обновить приложение |
| Double-fault rollback на Шаге-3 | DEFENDED | quota на write+rollback | calc мигрирован, list stale | дифф. error «перезагрузите» | hard-reload + JSON |

### Зона B — Storage quota / private-mode
| Mode | Класс | Заметка |
|------|-------|---------|
| Quota после probe → autosave fail | DEFENDED | `persistStatus='error'` + snackbar; **но snackbar без throttle** → шквал error при активном редактировании (`snackbar.js`) |
| Private-mode → memory fallback | DEFENDED (запись честно false) | **cross-tab sync молча мёртв** (memory Map не шлёт storage-event); `_probedOk` не пере-пробится в production |

### Зона C — Destructive CRUD
| Mode | Класс | Заметка |
|------|-------|---------|
| resetAnswers безвозвратно теряет ответы при persist-fail | PROVEN→RISK-5 | нет backup/undo, return commit() игнор, success-snackbar всегда (`calcController.js:288-303`) |
| resetToDefaults partial при двойном сбое | DEFENDED | order-инверсия + rollback + дифф-сигнал (`calcListController.js:617-650`) |
| deleteItem/Question рассинхрон calc↔defaultDictionary при сбое 2-й записи | DEFENDED частично | `{ok:true}` отражает только commitActiveCalc; справочник по умолчанию stale (косметика) |

### Зона D — Concurrency
| Mode | Класс | Заметка |
|------|-------|---------|
| Heartbeat write-fail проглатывается → lock протухает 90s | PROVEN wiring-gap→RISK-8 | `onWriteFailed` реализован (`appInstanceLock.js:251-252`) но не подключён (`instanceLockRuntime.js:24-31`) |
| Cross-tab защита calc.* только на lock | HYPOTHESIS→RISK-9 | `RELEVANT_KEYS` без calc.* (`crossTabSync.js:180-184`); при обходе lock — last-writer-wins без merge |
| BFCache re-acquire без re-init → stale calc перезапишет внешнюю правку | HYPOTHESIS→RISK-8 | `handlePageshow` без `initFromStorage` (`instanceLockRuntime.js:45-56`) |
| Undo-backup эфемерен (замыкание snackbar) | DEFENDED частично | при reload/blocked-state в окне отмены — backup потерян, calc уже removeKey'нут |

### Зона E — External ingestion (bundle/JSON)
| Mode | Класс | Заметка |
|------|-------|---------|
| Bundle тихо чинит null/string-ответы без диалога | PROVEN→RISK-6 | `{ calc, error }` отбрасывает `repairs[]` (`bundleExport.js:309-310`); per-calc путь показывает диалог |
| Нет durable pre-apply backup (только in-memory) | DATA-1-adjacent | при kill вкладки между remove(346) и rollback — потеря всего; confirm лишь советует экспорт |
| Каждый calc deep-мигрируется 2-3× за импорт | PERF proven | double-pass validate+apply + findIndex re-run; синхронный deep-copy блокирует main thread на больших bundle (cap 50 МБ) |
| Same-version-with-extra-semantics обходит guard | HYPOTHESIS | inherent limit major-gating; митигация — bump LATEST при смене семантики |

### Зона F — DSL формулы
| Mode | Класс | Заметка |
|------|-------|---------|
| `/0`→0 тихо | by-design (disputed) | покрыто тестом как намеренное (`evaluator.js:140`); семантическая ловушка для UX |
| Глубокая рекурсия evaluate | DEFENDED | FORMULA_MAX_DEPTH=64 (`evaluator.js:96-98`), тест 64/65/70 |
| Stack-overflow **парсера** | DEFENDED косвенно | `getAst` try/catch ловит RangeError (`cache.js:28-29`); **нет parser-side depth-guard и invariant-теста**; ломается если `parseFormula` вызовут в обход `getAst` |
| Огромное-но-конечное qty | PROVEN (узко) | нет sanity-cap на величину результата формулы; абсурдные суммы выглядят валидно; достижимо через tamper/import |

### Зона G — Provider price overlay
| Mode | Класс | Заметка |
|------|-------|---------|
| override записан, history-snapshot нет (quota на 2-й ключ) | DEFENDED | явный сигнал «отметка отката не сохранена» (`providerController.js:279-288`) |
| rollback НЕ пересчитывает применённые расчёты | by-design (может читаться как баг) | calc остаётся на старом providerVersion → stale-индикатор; ручной «Пересчитать» |
| bulk-apply частичный при quota | DEFENDED | каждый calc атомарен (нет orphan); «смешанный набор»; идемпотентный повтор |
| resolver вливает невалид. pricePerUnit | PROVEN→RISK-7 | `providerPriceResolver.js:62-68` без числовой валидации; не exploitable (same-origin) |

---

## ЭТАП 4. Blast Radius (для HIGH+ и ключевых)

| Risk | Affected modules | Affected data | Affected UI | Recovery complexity |
|------|------------------|---------------|-------------|---------------------|
| **RISK-1** (HIGH) | calcListController.initFromStorage/openCalc, calcPersistence, migrations, persistence.saveCalc | 1× `calc.<id>` (активный на boot; non-active — лениво при openCalc, разнесено во времени); при bundle-interruption — весь localStorage | Дашборд/Детализация/Сравнение/Memo активного расчёта | **Высокая** — нет авто-recovery для логически-неверной миграции; только свой JSON до апдейта |
| **RISK-2** (MEDIUM) | dashboard (двойной item×stand traversal/кадр), budgetGuardrails, decisionMemoController, sensitivityAnalysisModal (~98 uncached `calculate()`/ре-рендер) | нет (данные корректны) | jank дашборда + модалок Budget/Memo/Sensitivity | **Тривиальная** — `state.calcRevision` вместо `calc.calcRevision` |
| **RISK-3** (MEDIUM) | будущий код в `app/` и `services/` | нет (структурный) | нет | Профилактика — расширить layer-rules |
| **RISK-4** (LOW) | dashboard daily-вид + (новый локус) calculator.js:492 AI-demand qty | qty AI-токенов (все периоды) + daily breakdown | daily CAPEX/OPEX/risk не сходятся с total; AI-объёмы | Средняя — единый источник daysPerMonth + доменное решение |
| **RISK-5** (LOW) | calcController.resetAnswers, nextStepActions | `calc.answers`+`answersMeta`+зеркало scenario | Опросник/Дашборд/Детализация | Средняя — confirm есть, undo/backup нет |
| **RISK-8** (LOW) | instanceLockRuntime, appInstanceLock, все calc.<id> при гонке | 1× calc при BFCache+TTL-окне | blocked-screen с задержкой | Частичная — F5 |

---

## ЭТАП 5. Independent Agent Analysis (3 линзы — кратко)

Три линзы работали независимо (без координации), затем согласованы (§6–8).

- **AGENT-A (Architecture):** 10 инвариантов + 5 находок. Главное: INV-2 violated (RISK-1), layer blind-spot (RISK-3/ARCH-2), асимметрия валидации (ARCH-4), дубль seed-дефолтов (ARCH-5), calcRevision контракт-дрейф (ARCH-1, LOW).
- **AGENT-B (Code-execution):** 5 инвариантов + 3 находки, все **proven**. Главное: CODE-2 (calcRevision cache-bypass, MEDIUM — детальная perf-квантификация), CODE-1 (daysPerMonth 1/30, LOW), CODE-3 (SCHEMA_VERSION write-return игнор, INFO).
- **AGENT-C (Security/Adversarial):** 5 инвариантов + 3 находки. Главное: SEC-1 (provider resolver без числовой валидации, LOW, **не exploitable** в threat-model offline SPA), SEC-2 (BFCache stale, LOW), SEC-3 (длина формулы не short-circuit'ит до `getAst`, но RangeError перехвачен — **не DoS**, INFO). Проверены entry points: file import / paste / URL / storage-event / clipboard — XSS-векторы (entity/tab/case/quote) нейтрализованы allow-list'ом.

---

## ЭТАП 6. Contradiction Detection

| # | Расхождение | Разрешение |
|---|-------------|------------|
| 1 | calcRevision severity: ARCH=LOW vs CODE=MEDIUM | **MEDIUM** (RISK-2). Code-линза детальнее квантифицировала горячий путь (двойной traversal/кадр + ~98 пересчётов в модалках); корректность не страдает → не HIGH |
| 2 | BFCache stale: ARCH-3 и SEC-2 — дубликат | Слиты в **RISK-8** (LOW). Одинаковый file:line/механизм/confidence |
| 3 | Provider validate: SEC-1 (proven path) vs ARCH-4 (широкий класс) | Слиты в **RISK-7** (LOW). Security-формулировка основная (конкретный путь), ARCH-4 — класс |
| 4 | daysPerMonth: «баг сейчас» vs «латентный» | **LOW** (RISK-4). Формула неверна (proven), но достижимо только через import (нет settings-UI, подтверждено грепом) |
| 5 | Bundle repairs-drop: «потеря данных» vs «тихий ремонт» | **LOW** (RISK-6). Calc применяется (не ломается), но provenance теряется + асимметрия с per-calc |
| 6 | DSL `/0→0`: by-design vs ловушка | **Не риск.** DSL-линза сама пометила «не баг»; зафиксировано в disputed как намеренный trade-off (правило §4: не выдавать by-design за баг) |

---

## ЭТАП 7. Risk Negotiation Protocol (примеры разрешения)

```
RISK-1 (миграция перезаписывает исходник)
  Architecture: HIGH (INV-2 violated, нет enforcement)
  FMEA Zone-A: trigger гипотетический (логически-неверная не-падающая миграция)
  Disputed: HIGH при speculative trigger?
  → FINAL: HIGH
  → Reason: severity = impact × recoverability, НЕ только вероятность. Blast =
    безвозвратная потеря + отсутствие ЛЮБОГО durable backup-канала (DATA-2)
    делают последствие катастрофическим даже при низкой вероятности trigger.
    Atomic per-step + downgrade-guard защищают ТОЛЬКО от throw/future-version.

RISK-2 (calcRevision cache-bypass)
  Architecture: LOW (корректность цела)   Code: MEDIUM (горячий путь, ~98 пересчётов)
  → FINAL: MEDIUM
  → Reason: консервативная из двух; verified грепом (revision всегда null);
    perf-эффект на горячем пути дашборда + jank модалок реален; фикс тривиален.

RISK-4 (daysPerMonth 1/30)
  Code: proven FACT (формула расходится)   Reachability: только import (нет UI)
  → FINAL: LOW (+ открытый вопрос по второму локусу calculator.js:492 —
    demand-month vs billing-days семантика, требует доменного решения).
```

---

## ЭТАП 8. Consensus System Model

### 8.1. Agreed system model
Однонаправленный реактивный SPA, два таймлайна (render rAF / persist debounce), единый storage-gateway, per-calc ленивая миграция, single-instance lock + частичный cross-tab sync. Модель устойчива в нормальных путях; деградации сосредоточены на (а) необратимости миграции, (б) контракт-дрейфе кэша, (в) узких concurrency/quota-окнах, (г) асимметрии валидации внутреннего vs внешнего state.

### 8.2. Final Risk Register

| ID | Severity | Заголовок | FACT (file:line) |
|----|----------|-----------|------------------|
| **RISK-1** | HIGH | Миграция активного расчёта перезаписывает исходный JSON без durable pre-migration backup | calcListController.js:759-770; persistence.js:21-29; migrations.js:710,719-726 |
| **RISK-2** | MEDIUM | `calc.calcRevision` всегда undefined → result/sensitivity-кэш постоянно обходится (4 потребителя) | store.js:39,315,329; budgetGuardrails.js:100; budgetGuardrailsController.js:27; decisionMemoController.js:45; sensitivityAnalysisModal.js:40 |
| **RISK-3** | MEDIUM | Layer-enforcement не покрывает `app/` и `services/`; services→state инверсия проходит молча | layer-imports.test.js:25-27,76-78; calcPersistence.js:31-32; bundleExport.js:23-25 |
| **RISK-4** | LOW | Daily breakdown расходится с total при `daysPerMonth!=30` (хардкод `1/30`) **+ второй локус** в калькуляторе (AI-demand `×30`, все периоды) | dashboard.js:90 (+3 копии); calculator.js:725-726; **calculator.js:492** |
| **RISK-5** | LOW | `resetAnswers` затирает ответы без backup/undo, return commit() игнорируется, success-snackbar всегда | calcController.js:288-303; nextStepActions.js:18-21; questionnaire.js:283 |
| **RISK-6** | LOW | Bundle-import тихо чинит null/string-ответы без диалога ремонта (асимметрия с per-calc) | bundleExport.js:309-310; importExportActions.js:74-100,190-199 |
| **RISK-7** | LOW | Provider-override resolver вливает цены без числовой ре-валидации; commit минует validateCalculation | providerPriceResolver.js:62-68; calcVersioning.js:51-57; providerController.js:591 |
| **RISK-8** | LOW | BFCache re-acquire без `initFromStorage` + `onWriteFailed` не подключён → stale/lost-update | instanceLockRuntime.js:24-31,45-56; appInstanceLock.js:251-252 |
| **RISK-9** | LOW | Cross-tab защита calc.* только на single-instance lock (нет storage-event sync для calc) | crossTabSync.js:180-184; persistence.js:26-28 |
| **RISK-10** | INFO | `runMigrations()` — вестигиальный no-op (DATA-3), ловушка двойного версионирования | persistence.js:541,548-553; calcListController.js:676 |
| **RISK-11** | INFO | Дубль seed-дефолтов в `migrations.js` ради разрыва цикла — maintenance-hazard | migrations.js:381-382; seed.js:42-44 |
| **RISK-12** | INFO | Нет lint/typecheck в pipeline защиты (ENG-1) | нет eslint/tsconfig/jsconfig; package.json:8-30 |

### 8.3. Disputed Items Log
1. RISK-2 severity (ARCH LOW vs CODE MEDIUM) → MEDIUM; остаётся: фактическая задержка не профилирована (оценка, не бенчмарк).
2. RISK-4: proven FACT, но reachable только через import → LOW; станет видимым при появлении UI-редактора daysPerMonth.
3. DSL `/0→0`: by-design, не включён в register; остаётся UX-ловушкой (сознательный trade-off).
4. RISK-1 confidence: enforcement отсутствует (proven), конкретный trigger гипотетический → HIGH по impact×recoverability.
5. RISK-6: «потеря» vs «детерминированный ремонт» → LOW.
6. `onWriteFailed` wiring-gap (proven, `instanceLockRuntime.js:23-31`) vs cascade (speculative) → свёрнуто в RISK-8.

### 8.4. Дополнительные пробелы (критик полноты)
- **G1 — daysPerMonth второй локус (DATA-level):** `calculator.js:492` хардкодит `DEFAULT_DAYS_PER_MONTH` для AI-объёмов, тогда как billing использует `settings.daysPerMonth` → несогласованность в qty токенов **во всех периодах** (не только daily/UI). Требует доменного решения (demand-«календарный месяц» vs billing-«активные дни»). Поднимает реальную тяжесть RISK-4 выше LOW при наличии редактора.
- **G2 — нет invariant-теста на согласованность period-scaling** UI↔calculator и на единый источник daysPerMonth (4 копии `1/30`: dashboard.js:90, dashboardMetricBlocks.js:18, dashboardRiskCard.js:17, costOptimizationPlannerModalFormat.js:26).
- **G3 — mobile/responsive e2e отсутствует:** единственный chromium 1365×768 (`playwright.config.js:24`), 0% покрытия <768px, нет инварианта `scrollWidth ≤ innerWidth`. (Оговорка: проект не PWA — это coverage-gap, не нарушение требования.)
- **G4 — `reuseExistingServer: true` без identity-check** (`playwright.config.js:37`) → риск false-GREEN на постороннем сервере (`~/.claude/CLAUDE.md §6.ter.4`).
- **G5 — snackbar без throttle** при quota-цикле автосейва → шквал error-снекбаров (`snackbar.js`).

---

## ЭТАП 9. State Machine Execution Model

```
SAFE_BASELINE → INSTRUMENTED → DATA_PROTECTED → ARCH_REFACTORED → UI_STABILIZED → RELEASE_READY
```

| Фаза | Содержит | Gate выхода (ВСЕ условия) |
|------|----------|----------------------------|
| **SAFE_BASELINE** | реальный прогон `npm test` + `smoke:desktop`; зафиксировать stdout как эталон | tests green; baseline-метрики записаны; ни одной правки кода |
| **INSTRUMENTED** | T0.1 ESLint, T0.2 checkJs, T0.3 characterization golden, **T-G2** invariant-тест period-scaling, **T-RISK-3** layer-rules для app/+services/ | lint+typecheck green; новые guard-тесты green; rollback = удалить конфиги (изменений рантайма нет) |
| **DATA_PROTECTED** | **RISK-1** pre-migration backup; **DATA-2** авто-бэкап/экспорт; **RISK-5** undo/backup для resetAnswers; **RISK-7** числовая валидация в resolver | тест «сбойная миграция → восстановимо» green; нет HIGH unresolved; rollback per-task ниже |
| **ARCH_REFACTORED** | **CODE-1** декомпозиция ctx; **CODE-2** split seed.js; **RISK-2** фикс calcRevision; **RISK-10** убрать no-op; **RISK-11** дубль seed | публичный `ctx` неизменен; все тесты green; perf дашборда не хуже baseline |
| **UI_STABILIZED** | **RISK-4**(+G1) единый daysPerMonth; **RISK-6** repairs в bundle; **RISK-8/9** concurrency wiring; **G3** mobile e2e; **G5** snackbar throttle | overflow-инвариант green; нет regressions; rollback per-task |
| **RELEASE_READY** | docs (SECURITY/CHANGELOG), релиз-чеклист, bump | все линии защиты green (§3.bis); метрики из реального прогона |

**Gate между фазами (обязательно):** (1) tests green из реального прогона; (2) нет нарушений инвариантов (§2); (3) rollback задачи проверен; (4) нет нерешённых HIGH-рисков, введённых фазой.

---

## ЭТАП 10. Task Format (execution-ready)

> Каждая задача: ID · TYPE · SEVERITY · FACT (file:line) · MECHANISM · IMPACT · BLAST RADIUS · FIX STRATEGY · ROLLBACK STRATEGY · TEST STRATEGY. Все — read-only план; реальные правки только после согласования.

### T-RISK-1 · Pre-migration durable backup
- **TYPE:** data-resilience · **SEVERITY:** HIGH
- **FACT:** `calcListController.js:759-770` (commitMigratedCalc), `persistence.js:21-29` (saveCalc overwrite by id), `migrations.js:710,719-726` (atomicity только от throw).
- **MECHANISM:** при `needsPersist` мигрированный calc пишется поверх того же `calc.<id>`; до-миграционный JSON исчезает; шаг с латентным data-loss (не throw) необратим.
- **IMPACT:** безвозвратная потеря данных пользователя при обновлении приложения.
- **BLAST RADIUS:** 1× активный calc на boot (non-active — лениво при openCalc); при bundle-interruption — весь localStorage.
- **FIX STRATEGY:** перед первым commit мигрированной версии писать снимок `calc.<id>.bak.<fromVersion>` (best-effort, не блокировать при quota); чистить после N успешных запусков; учесть в `isAppKey`/`resetAll` (`storage.js:158-166`).
- **ROLLBACK STRATEGY:** удалить запись бэкап-ключа + восстановить старую ветку commit; изменение аддитивно (новый ключ), откат тривиален.
- **TEST STRATEGY:** unit с DI бросающего/портящего шага (`migrateCalculation(input, _migrations)`), assert «исходный JSON восстановим из .bak»; интеграционный roundtrip.

### T-RISK-2 · Fix calcRevision cache-bypass
- **TYPE:** correctness/perf contract-drift · **SEVERITY:** MEDIUM
- **FACT:** `calc.calcRevision` undefined (пишется только на store-root: `store.js:39,315,329`); читается ошибочно в `budgetGuardrails.js:100`, `budgetGuardrailsController.js:27`, `decisionMemoController.js:45`, `sensitivityAnalysisModal.js:40`.
- **MECHANISM:** `calc.calcRevision ?? null` → revision=null → `calculate()` всегда пересчитывает (`calculator.js:537`); sensitivity-memo guard всегда false → ~98 полных `calculate()` на ре-рендер.
- **IMPACT:** perf-деградация горячего пути дашборда + jank модалок; корректность не страдает; вводящий в заблуждение комментарий (`budgetGuardrails.js:99`).
- **BLAST RADIUS:** dashboard, Budget/Decision-Memo/Sensitivity модалки. Данные — нет.
- **FIX STRATEGY:** передавать `store.getState().calcRevision` (как `dashboard.js:136`) вместо `calc.calcRevision`; убрать вводящий комментарий. Решить, нужен ли стабильный кэш в этих 4 путях (если calc передаётся без store-контекста — прокинуть revision аргументом).
- **ROLLBACK STRATEGY:** вернуть `calc.calcRevision ?? null` (1-строчные правки в 4 файлах).
- **TEST STRATEGY:** unit «при двух идентичных вызовах `calculate` возвращается кэш-инстанс»; счётчик вызовов calculate в sensitivity-memo (1, не N).

### T-RISK-3 · Layer-rules для app/ и services/
- **TYPE:** architecture enforcement · **SEVERITY:** MEDIUM
- **FACT:** `layer-imports.test.js:25-27,76-78` обходит только UI/CONTROLLERS/DOMAIN; services→state: `calcPersistence.js:31-32`, `bundleExport.js:23-25`, `loadedCalc.js:29`, `providerPriceResolver.js:21`.
- **MECHANISM:** glue-слой `app/` и `services/` без правил → эрозия слоёв накапливается невидимо.
- **IMPACT:** структурная деградация во времени, CI не ловит (не runtime-баг сейчас).
- **BLAST RADIUS:** будущий код в `app/`/`services/`.
- **FIX STRATEGY:** добавить явные правила: `services↛{ui,controllers}` (state-импорт легитимен для IO, но `services↛store-mutation` стоит сделать осознанным), `app/` без циклов; зафиксировать разрешённые рёбра в тесте + docstring.
- **ROLLBACK STRATEGY:** удалить новые тест-кейсы (нет изменений рантайма).
- **TEST STRATEGY:** расширить `layer-imports.test.js` (walkJs на app/ + services/), зелёный на текущем коде или с явным whitelist обоснованных рёбер.

### T-RISK-4 · Единый источник daysPerMonth (+ G1, G2)
- **TYPE:** data consistency · **SEVERITY:** LOW (повышается при появлении UI-редактора)
- **FACT:** `dashboard.js:90` (+`dashboardMetricBlocks.js:18`, `dashboardRiskCard.js:17`, `costOptimizationPlannerModalFormat.js:26`) хардкод `1/30`; `calculator.js:725-726` total через `daysPerMonth`; **`calculator.js:492`** AI-demand `×DEFAULT_DAYS_PER_MONTH`.
- **MECHANISM:** display-breakdown и AI-qty используют константу 30, а total/billing — `settings.daysPerMonth` → расхождение.
- **IMPACT:** daily CAPEX/OPEX/risk не сходятся с total; AI-объёмы несогласованы во всех периодах.
- **BLAST RADIUS:** дашборд daily; AI-токены qty → totalMonthly/Annual.
- **FIX STRATEGY:** `periodMul('daily') = 1/(settings.daysPerMonth||30)` через общий helper (устранить 4 копии); **доменное решение** по `calculator.js:492`: demand-«месяц 30» намеренно ≠ billing-«daysPerMonth»? — если да, задокументировать; если нет, читать `settings.daysPerMonth`.
- **ROLLBACK STRATEGY:** вернуть константу `1/30` в helper (одно место).
- **TEST STRATEGY:** invariant-тест (G2): для `daysPerMonth ∈ {20,28,31}` — `CAPEX_daily+OPEX_daily ≈ total_daily`; тест на единственный источник константы.

### T-RISK-5 · resetAnswers → confirm+undo+backup контракт
- **TYPE:** data-safety symmetry · **SEVERITY:** LOW
- **FACT:** `calcController.js:288-303` (нет backup, игнор-return), `nextStepActions.js:18-21` (success всегда), confirm есть `questionnaire.js:283`.
- **MECHANISM:** debounced commit с проигнорированным return; success-snackbar до возможного persist-fail; нет undo.
- **IMPACT:** при успешном persist — ответы затёрты безвозвратно; при quota — F5 восстановит (но пользователь не знает).
- **BLAST RADIUS:** `calc.answers`+`answersMeta`+зеркало scenario.
- **FIX STRATEGY:** backup answers → undo-snackbar (как `deleteItem`); вернуть `{ok,reason}`; показывать success только при ok.
- **ROLLBACK STRATEGY:** вернуть текущую реализацию (изолированная функция).
- **TEST STRATEGY:** unit «persist-fail → error, не success»; «undo восстанавливает прежние answers».

### T-RISK-6 · Протянуть repairs[] в bundle-import
- **TYPE:** UX/data-provenance · **SEVERITY:** LOW
- **FACT:** `bundleExport.js:309-310` отбрасывает `repairs`; per-calc путь `importExportActions.js:74-100` показывает диалог.
- **MECHANISM:** `{ calc, error }` деструктуризация теряет `repairs[]` из `prepareLoadedCalc`.
- **IMPACT:** ответы тихо подменены дефолтами, итоги меняются без уведомления.
- **BLAST RADIUS:** все calc импортированного bundle.
- **FIX STRATEGY:** агрегировать `repairs[]` через `importStateBundleFromFile` → пост-импорт диалог (зеркало `handleImportResult`).
- **ROLLBACK STRATEGY:** вернуть деструктуризацию `{ calc, error }`.
- **TEST STRATEGY:** unit «bundle с null-ответом → repairs surfaced»; симметрия с per-calc.

### T-RISK-7 · Числовая валидация provider-override на apply
- **TYPE:** defense-in-depth · **SEVERITY:** LOW (не exploitable)
- **FACT:** `providerPriceResolver.js:62-68` (только структурная проверка), `calcVersioning.js:51-57`, `providerController.js:591` (commit без validateCalculation).
- **MECHANISM:** невалид. `pricePerUnit` (-500/NaN/'abc') из storage течёт в расчёт; `toNum` coerce → тихо неверный/отрицательный итог.
- **IMPACT:** тихо некорректные суммы из stored-override (same-origin = уже полный контроль, не privilege escalation).
- **BLAST RADIUS:** активный calc с применённым override.
- **FIX STRATEGY:** применить числовую валидацию (как на import-пути `validateProviderPriceJson`) в resolver/apply.
- **ROLLBACK STRATEGY:** убрать проверку (аддитивна).
- **TEST STRATEGY:** unit «override с pricePerUnit=-500/NaN → отвергнут/clamp + сигнал».

### T-RISK-8 · Concurrency wiring (onWriteFailed + BFCache re-init)
- **TYPE:** concurrency/data-safety · **SEVERITY:** LOW
- **FACT:** `instanceLockRuntime.js:24-31` (start без onWriteFailed), `:45-56` (handlePageshow без initFromStorage); `appInstanceLock.js:251-252` (callback реализован).
- **MECHANISM:** quota mid-session → heartbeat write-fail тихо проглатывается → lock протухает 90s; BFCache restore держит stale calc.
- **IMPACT:** lost-update calc при гонке двух экземпляров через TTL/BFCache-окно.
- **BLAST RADIUS:** 1× calc; redко (lock сужает).
- **FIX STRATEGY:** подключить `onWriteFailed` в `runtime.start` (→ blocked/banner); вызывать `calcList.initFromStorage()` в `handlePageshow`.
- **ROLLBACK STRATEGY:** вернуть только `onLost` / убрать re-init.
- **TEST STRATEGY:** lifecycle-тест «heartbeat write-fail → onWriteFailed вызван»; «pageshow persisted → initFromStorage вызван».

### T-RISK-9 · Cross-tab calc.* (документировать или sync)
- **TYPE:** concurrency · **SEVERITY:** LOW
- **FACT:** `crossTabSync.js:180-184` (RELEVANT_KEYS без calc.*); `persistence.js:26-28` (last-writer-wins по id).
- **MECHANISM:** при обходе lock — две вкладки пишут calc.<id> без merge/конфликт-детекта.
- **IMPACT:** тихая last-writer-wins потеря правок.
- **BLAST RADIUS:** все calc.<id> при двух live-writer'ах.
- **FIX STRATEGY:** либо storage-event listener на calc.* с toast/reload-предложением, либо явно задокументировать «lock — единственная защита calc.*» (by-design) + усилить lock (T-RISK-8).
- **ROLLBACK STRATEGY:** n/a (профилактика/доки).
- **TEST STRATEGY:** при выборе sync — тест «внешняя запись calc.<id> → toast/inval»; иначе — doc-only.

### T-RISK-10/11/12 · DATA-3 / seed-dup / ENG-1
- **RISK-10 (INFO):** удалить вестигиальный `runMigrations`/`SCHEMA_VERSION` (`persistence.js:541,548-553`; `calcListController.js:676`) или задокументировать как зарезервированный. ROLLBACK: вернуть функцию. TEST: grep отсутствия осиротевших вызовов.
- **RISK-11 (INFO):** импортировать seed-дефолты из общего leaf-модуля вместо дубля (`migrations.js:381-382`) ИЛИ invariant-тест синхронности. TEST: тест «дефолты migrations == seed».
- **RISK-12 (INFO):** ESLint (eqeqeq, no-unused-vars) + `checkJs` через jsconfig (см. REFACTORING_PLAN T0.1/T0.2).

### T-G3 · Mobile/responsive e2e + T-G4 server identity-check
- **G3 (LOW):** добавить узкий viewport project (напр. 768/1024) + инвариант `scrollWidth ≤ innerWidth` (`playwright.config.js:24`). TEST: новый e2e-project green.
- **G4 (LOW):** перед `reuseExistingServer` проверять сигнатуру приложения (HTTP GET + уникальный `<title>`), fail-fast при чужом listener (`playwright.config.js:37`). TEST: тест отказа при отсутствии сигнатуры.

### T-G5 · Throttle snackbar при quota-цикле
- **LOW:** throttle error-snackbar (раз в ~30s) в quota-пути автосейва, чтобы при активном редактировании не было шквала (`snackbar.js`, потребитель `uiPersistenceSubscriber.js:121-123`). TEST: «N быстрых persist-fail → 1 snackbar».

---

## ЭТАП 11. Верификация (дисциплина против фабрикации)

Скептик-фаза workflow дала **0 вердиктов** (на момент анализа ни одна находка не была HIGH; референи поднял RISK-1 до HIGH постфактум). Поэтому **все HIGH+ и новые находки перепроверены вручную** по `file:line`:

| Находка | Статус верификации | Доказательство |
|---------|--------------------|----------------|
| RISK-1 перезапись миграции | ✅ confirmed | calcListController.js:759-770 + persistence.js:26-29 (overwrite by id) |
| RISK-2 calc.calcRevision undefined | ✅ confirmed | grep: запись только store.js:39,315,329; чтение `calc.calcRevision` в 4 файлах; budgetGuardrails.js:99-100 |
| RISK-3 layer blind-spot | ✅ confirmed | layer-imports.test.js:25-27,76-78; grep services→../state/ (7 мест) |
| RISK-4 daily 1/30 | ✅ confirmed | dashboard.js:90 vs calculator.js:725-726 |
| RISK-4 второй локус (G1) | ✅ confirmed (с доменным нюансом) | calculator.js:492 `×DEFAULT_DAYS_PER_MONTH` |
| RISK-5 resetAnswers | ✅ confirmed | calcController.js:288-303 (нет backup, игнор-return) |
| RISK-6 bundle repairs drop | ✅ confirmed | bundleExport.js:309-310 |
| RISK-8 onWriteFailed dead | ✅ confirmed | appInstanceLock.js:251-252 (реализован) vs instanceLockRuntime.js:24-31 (не подключён) |
| 4 копии periodMul 1/30 | ✅ confirmed | dashboard.js:90, dashboardMetricBlocks.js:18, dashboardRiskCard.js:17, costOptimizationPlannerModalFormat.js:26 |

**Скорректированные утверждения агентов (false-positive контроль, §4):** первичная гипотеза «resetAnswers без confirm» → опровергнута (confirm есть, `questionnaire.js:283`); реальная проблема — отсутствие undo (RISK-5 LOW, не HIGH). DSL `/0→0` — не включён в register (by-design, помечен disputed). Severity RISK-1 — HIGH по impact×recoverability при speculative trigger (явно зафиксировано в disputed).

**Что НЕ проверялось динамически:** реальный прогон `npm test`/Playwright/браузер (read-only режим). Метрики — из инвентаря и кода runner'а. Перед SAFE_BASELINE рекомендуется живой прогон.

---

## ЭТАП 12. Связь с базовыми документами

| Этот документ | AUDIT_NOTES.md / REFACTORING_PLAN.md |
|---------------|--------------------------------------|
| RISK-1 | = DATA-1 / T1.1 |
| RISK-5 | уточняет UX-1 / T4.1 |
| RISK-10 | = DATA-3 / T2.3 |
| RISK-12 | = ENG-1 / T0.1-0.2 |
| RISK-2, RISK-3, RISK-4(+G1), RISK-6, RISK-7, RISK-8, RISK-9, G2-G5 | **новые** — добавить в план (см. обновление REFACTORING_PLAN) |
