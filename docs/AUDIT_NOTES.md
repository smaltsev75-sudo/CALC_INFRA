# AUDIT_NOTES — Технический аудит проекта «Калькулятор инфраструктуры»

> Дата: 2026-06-13. Режим: **read-only** (код не менялся). Версия приложения на момент аудита: **2.20.103** (`package.json:3`), schema version: **20** (`js/state/migrations.js:676`).
>
> Принцип отчёта: каждое утверждение подтверждено фактом из кода с указанием `file:line`, либо явно помечено как **допущение**. Находки, которые не удалось подтвердить чтением кода, не включены.
>
> Сопутствующий документ — [REFACTORING_PLAN.md](REFACTORING_PLAN.md) (план по фазам, ссылается на ID находок ниже).

---

## 0. Резюме

Проект — зрелое, hardened production-приложение. Это **не** монолит-черновик: чистая слоистая архитектура, защита от XSS на уровне DOM-builder, AST-парсер вместо `eval`, атомарные миграции с downgrade-защитой, order-инверсия в CRUD при quota, ~4500 тест-кейсов и 77 архитектурных invariant-тестов. **Критических дефектов (потеря данных / RCE / XSS / отсутствие отката там, где он обязателен) в ходе аудита не обнаружено.**

Найденные проблемы — преимущественно уровня **Средний/Низкий**: устойчивость данных к сбойной миграции и к единственной точке хранения (localStorage), отсутствие линтера/типизатора, асимметрия «страховочной сетки» у разных destructive-действий, крупные файлы (`seed.js`, `app.js`), вестигиальный дубль механизма версий схемы, и организация документации.

### Топ-5 рисков

| # | ID | Риск | Критичность |
|---|----|------|-------------|
| 1 | DATA-1 | На boot мигрированный расчёт **перезаписывает** исходный JSON без pre-migration бэкапа → сбойная миграция = необратимая потеря данных пользователя при обновлении | Высокий |
| 2 | DATA-2 | Единственная точка хранения — `localStorage` одного профиля браузера; нет авто-бэкапа/экспорта; очистка данных браузера = полная потеря | Высокий |
| 3 | ENG-1 | Нет линтера / форматтера / type-check (`checkJs`) — целый класс ошибок (unused/`==`/тени/опечатки в JSDoc-API) не ловится автоматически | Средний |
| 4 | UX-1 | Асимметрия страховочной сетки destructive-действий (confirm/undo/backup присутствуют в разном составе) | Средний |
| 5 | CODE-1/2 | Крупные файлы-агрегаторы: `app.js` (1029 строк, ctx ~150+ методов), `seed.js` (4607 строк, данные+логика) | Средний |

---

## 1. Паспорт проекта

| Параметр | Значение | Доказательство |
|----------|----------|----------------|
| **Среда** | Vanilla ES2022 SPA, offline, запуск через локальный HTTP-сервер или `file://`. **НЕ** Electron / NW.js / Tauri / PWA | `index.html:100` (`<script type="module" src="js/app.js">`); нет `manifest.json` / `sw.js` / service-worker (поиск дал 0) |
| **Хранилище** | `localStorage` с memory-fallback и кэшем probe; quota сигнализируется через `writeJson → false`. Один backend, нет IndexedDB / файлового бэкапа | `js/services/storage.js:43-127`; ключи централизованы (`STORAGE_KEYS`), `isAppKey` whitelist `storage.js:158-166` |
| **Слой доступа к данным** | `js/state/persistence.js` (load/save по ключам) поверх `services/storage.js`; нормализация и защита от corrupt-input | `persistence.js:11-553` (typeof-guards в каждом loader'е) |
| **Сеть** | 1 реальный `fetch` (`UserManual.md`, `cache:'no-cache'`); `navigator.clipboard.writeText` для copy. **Никаких внешних API.** Прайсы провайдеров грузятся из локального file-picker, не из сети | `js/controllers/helpController.js:21`; `js/services/clipboard.js:8-13`; `app.js:282-289` (комментарий «загрузка локального JSON») |
| **Формулы (DSL)** | Собственный лексер + рекурсивный спуск → AST. **Без `eval` / `new Function`** | `js/domain/formula/parser.js:1-303` |
| **Сборка** | Бандлера нет. npm-скрипты. `pages:build` генерит копию в `.pages-dist/` | `package.json:8-30`; `scripts/build-pages-dist.mjs` |
| **Тесты** | `node:test` (parallel, `concurrency:true`) + Playwright (desktop chromium) | `tests/run.js:55-68`; `playwright.config.js` |
| **CI** | GitHub Actions: unit+syntax+sanity+freshness+quantity-audit+pages-build+whitespace, отдельный desktop-smoke | `.github/workflows/ci.yml:12-78` |
| **Объём кода** | 191 JS-файл / ~51 048 строк; 10 CSS / ~14 049 строк | `find js -name '*.js' \| wc -l`; `wc -l css/*.css` |
| **Тесты (объём)** | 397 тест-файлов (338 unit + 42 integration + 17 e2e); ~4500 кейсов | `find tests`; `tests/run.js:60` (комментарий «1082 suites / 4536 tests») |
| **Зависимости** | 0 runtime-deps; 1 dev-dep (`@playwright/test`) | `package.json:34-36`; `node_modules` = `@playwright`, `playwright`, `playwright-core` |
| **Лицензия** | Кастомная (`LICENSE`), `private:true` | `package.json:6-7` |

### Карта архитектуры (фактическая)

```
ui/ (рендер, modals/)  →  controllers/  →  state/ (store + persistence)  →  domain/ (чистая логика, formula/)
                                              ↑
                          services/ (IO: storage, csv, markdown, clipboard, bundle, …)
                          utils/ (constants, escapeHtml, freeze, uuid, debounce, lru, …)
```
Поток: `event → ctx → controller → store.update() → rAF render + persist`. State глубоко заморожен (`deepFreeze`), модалки в state, revision-cache (`calcRevision`). Слои защищены архитектурными invariant-тестами (`tests/unit/architecture/`). Источник: `js/app.js:1-7`, `js/state/store.js:35-414`, ТЗ §6.

### Крупнейшие файлы (для оценки риска ревью)

| Файл | Строк |
|------|-------|
| `js/domain/seed.js` | 4607 |
| `js/utils/constants.js` | 1482 |
| `js/ui/questionnaire.js` | 1053 |
| `js/app.js` | 1029 |
| `js/domain/costOptimizationPlanner.js` | 932 |
| `css/dashboard.css` | 4967 |
| `css/forms.css` | 2909 |

---

## 2. Сильные стороны (подтверждено чтением; НЕ требуют правок)

Фиксируются явно, чтобы план не «изобретал» уже сделанное и не понижал зрелые решения.

| Область | Что сделано | Доказательство |
|---------|-------------|----------------|
| **XSS** | Branding-обёртка `trustedHtml()`; plain-string в `innerHTML` **бросает исключение**; `props.html` запрещён | `js/ui/dom.js:44-77`, `137-142` |
| **XSS (Markdown)** | Полное экранирование до обработки + allow-list URL (`http(s)/#/mailto`) | `js/services/markdown.js:13-19`, `59-219` |
| **RCE** | AST-парсер DSL, без `eval`/`new Function` | `js/domain/formula/parser.js:23-25` |
| **CSP** | Строгая политика; `script-src 'self'` (без `unsafe-inline`); honest-комментарий про `frame-ancestors` (работает только как HTTP-заголовок) | `index.html:35`, `24-33` |
| **Целостность данных (CRUD)** | Order-инверсия «write critical → remove last» + rollback + quota-сигнал в `resetToDefaults` | `js/controllers/calcListController.js:628-669` |
| **Миграции** | 20 версионированных шагов, атомарный per-step deep-copy, downgrade-защита, `MigrationError` | `js/state/migrations.js:696-739` |
| **Storage robustness** | Probe-кэш, раздельный read/write storage, явный `false` при memory-fallback (не лжёт «сохранено») | `js/services/storage.js:24-127` |
| **Undo/backup** | `deleteCalc`/`deleteItem`/`deleteQuestion` — backup + undo-snackbar + честная обработка persist-fail | `js/app/calcListActions.js:98-138`, `js/app/crudActions.js:1-149` |
| **Concurrency** | Single-instance lock + cross-tab sync (storage-event, BFCache pageshow re-acquire) | `js/app.js:910-936`, `944-963` |
| **A11y** | focus-trap, capture/restore фокуса по `data-focus-key`, live-regions (`role=status/alert`, `aria-modal`) | `js/ui/focus.js:24-92`; 19 совпадений live-regions в 12 файлах |
| **Адаптивность/моушн** | `clamp()`, `:focus-visible`, `prefers-reduced-motion`, `@media` — 133 совпадения в 10 CSS | `css/base.css`, `css/layout.css` и др. |
| **Тесты** | parallel node:test; 77 архитектурных invariant-тестов; golden/roundtrip guards; **0** `test.skip/only/fixme` и браузерных `force:true` | `tests/run.js:55-68`; `tests/unit/architecture/*`; `tests/integration/scenario-persist-roundtrip.test.js`; `tests/unit/domain/business-golden-scenarios.test.js` |
| **Секреты/ПДн** | Нет API-ключей/токенов/паролей в коде; нет аутентифицированных сетевых вызовов | grep `apiKey/secret/password/Bearer` → единственное совпадение `js/domain/seed.js:1533` (пример-текст подсказки, не секрет) |

---

## 3. Реестр находок

Критичность: **Критический** (потеря/порча данных, безопасность, ПДн, отсутствие обязательного отката) · **Высокий** (падения, опасные операции без защиты, рефакторинг без страховочной сетки, сетевой сбой ломает состояние) · **Средний** (качество кода, консистентность, документация, процессы) · **Низкий** (косметика, мелкий долг).

> **Критических находок нет** (см. §0). Перечень ниже отсортирован по убыванию критичности.

### DATA-1 · Высокий · Нет pre-migration бэкапа: сбойная миграция перезаписывает исходные данные

- **Направление:** Данные / Надёжность.
- **Факт:** На boot активный расчёт мигрируется и при `needsPersist` сохраняется через `commitMigratedCalc(migrated)` по тому же ключу `calc.<id>`, перезаписывая исходный JSON. `saveCalc` пишет по `STORAGE_KEYS.CALC_PREFIX + calc.id` — то есть **поверх** оригинала. Pre-migration снимок нигде не создаётся.
- **Доказательство:** `js/controllers/calcListController.js:746-770` (миграция + `commitMigratedCalc`); `js/state/persistence.js:26-29` (`saveCalc` перезаписывает по id). Атомарность есть только in-memory: `js/state/migrations.js:710-728`.
- **Последствия:** Если шаг миграции содержит необнаруженный баг для конкретного edge-case расчёта (а миграции по природе запускаются массово при обновлении приложения у пользователей), исходные данные пользователя теряются необратимо — отката к до-миграционной версии нет.
- **Митигация (план):** Перед первым `commit` мигрированной версии писать одноразовый снимок (`calc.<id>.premigrate.<fromVersion>` или экспорт-бандл) и удалять его после N успешных запусков. См. план DATA-1.

### DATA-2 · Высокий · Единственная точка хранения без авто-бэкапа

- **Направление:** Данные.
- **Факт:** Все данные живут только в `localStorage` текущего профиля браузера. Каждый расчёт сериализуется **вместе со своими словарями** (`calc.dictionaries`), что увеличивает объём и приближает quota-потолок (~5–10 МБ). Авто-экспорта / периодического бэкапа / напоминания нет; есть только ручной экспорт JSON/bundle.
- **Доказательство:** `js/services/storage.js` (только `localStorage`/memory); `js/state/persistence.js:21-29` (`loadCalc`/`saveCalc` — весь объект целиком); ручной экспорт — `js/app/importExportActions.js`.
- **Последствия:** Очистка данных браузера / смена профиля / повреждение localStorage = полная потеря всех расчётов. При большом числе расчётов — quota (обрабатывается gracefully, но блокирует сохранение).
- **Митигация (план):** Опциональный «бэкап в файл» (экспорт всего bundle одной кнопкой/по расписанию-напоминанию), индикатор занятого объёма, документированная процедура восстановления. См. план DATA-2.

### UX-1 · Средний · Асимметрия страховочной сетки destructive-действий

- **Направление:** UI/UX / Данные.
- **Факт:** Разные деструктивные действия имеют **разный** состав защиты:
  - `deleteCalc` — confirm (danger) + backup + undo-snackbar + quota-обработка. `js/app/calcListActions.js:105-137`.
  - `deleteItem` — backup + undo + предупреждение о висящих ссылках, **без confirm**. `js/app/crudActions.js:1-47`.
  - `deleteQuestion` — confirm **только если** вопрос используется в формулах, иначе сразу удаление (с undo). `js/app/crudActions.js:130-148`.
  - `resetAnswers` — confirm есть (`js/ui/questionnaire.js:287`), но **без undo/backup** (`js/app/nextStepActions.js:18-21`).
- **Последствия:** Непредсказуемость для пользователя; `resetAnswers` стирает все ответы расчёта без возможности отмены. (Замечание: первичная гипотеза «resetAnswers без confirm» при верификации оказалась неверной — confirm есть; реальная проблема — отсутствие undo.)
- **Митигация (план):** Единый контракт «confirm + undo + backup» для всех деструктивных операций; добавить undo к `resetAnswers`. См. план UX-1.

### ENG-1 · Средний · Нет линтера / форматтера / type-check

- **Направление:** Инженерные практики / Надёжность / Типобезопасность.
- **Факт:** В репозитории нет конфигов ESLint / Prettier / `tsconfig` / `jsconfig` (`checkJs`); нет `// @ts-check`. Скрипты ограничены `syntax-check` (`node --check`) и архитектурными invariant-тестами.
- **Доказательство:** поиск `tsconfig*/jsconfig*/.eslintrc*/eslint.config.*/.prettierrc*` → 0 файлов; `package.json:8-30` (нет `lint`/`typecheck`); grep `@ts-check` → 0.
- **Последствия:** Класс ошибок (неиспользуемые переменные, `==` вместо `===`, переопределение, опечатки в именах JSDoc-API, тени) не ловится автоматически — только ревью/тестами. Глобальные правила пользователя (`~/.claude/CLAUDE.md §3.bis`) предполагают `npm run lint` как линию защиты — здесь её нет.
- **Митигация (план):** ESLint (flat-config, vanilla-правила) + включить `checkJs` через `jsconfig.json` — дёшево, **без миграции на TypeScript**, опирается на уже обширный JSDoc. См. план ENG-1.

### CODE-1 · Средний · God-object `ctx` в `app.js`

- **Направление:** Архитектура / Модульность.
- **Факт:** `app.js` — 1029 строк; объект `ctx` агрегирует ~150+ методов-действий (приближённо 193 method-like строки). Сами действия уже вынесены в `js/app/*.js`, но `app.js` остаётся единой огромной точкой связывания.
- **Доказательство:** `js/app.js:128-893` (тело `ctx`); `grep -cE "^\s+[a-zA-Z_]+\s*\(" js/app.js` → 193.
- **Последствия:** Тяжёлая навигация, hotspot merge-конфликтов, частый churn одного файла.
- **Митигация (план):** Сгруппировать `ctx` в namespaced суб-контексты (`calcCtx`, `providerCtx`, `modalCtx`, `optimizationCtx`), собираемые в `app.js`. См. план CODE-1.

### CODE-2 · Средний · Очень крупные файлы (`seed.js`, `constants.js`)

- **Направление:** Код / Модульность.
- **Факт:** `js/domain/seed.js` — 4607 строк, смешивает seed-**данные** (ЭК, вопросы, шаблоны) и **логику** обогащения (`enrichLegacyDictionary*`). `constants.js` — 1482, `questionnaire.js` — 1053.
- **Доказательство:** `wc -l` (см. §1); упоминания `enrichLegacyDictionary*` в `js/state/migrations.js:311-312`.
- **Последствия:** Тяжело ревьюить и диффить; данные и логика в одном файле затрудняют изменение каталога ЭК без риска для логики.
- **Митигация (план):** Разбить `seed.js` на data-модули (seed-items / seed-questions / templates) + отдельный модуль enrichment. См. план CODE-2.

### DOC-1 · Средний · Документация сильная, но неудобно расположена/структурирована

- **Направление:** Документация.
- **Факт:** Богатая документация в `docs/assistant/` (Architecture.md 86 КБ, MAINTAINER_GUIDE, AGENTS, BROWSER_SMOKE и др.), но `DECISIONS.md` — **1.35 МБ** (неподъёмен для навигации), всё лежит под `docs/assistant/` (ассистент-ориентированное имя). Нет корневого `SECURITY.md`, нет `CHANGELOG.md` (история релизов — только в git-коммитах `Release vX.Y.Z` и `DECISIONS.md`).
- **Доказательство:** `ls docs/assistant/`; поиск `CHANGELOG*/RELEASE*/SECURITY*` в корне/`docs` → 0 файлов.
- **Последствия:** Внешним участникам и security-ревьюерам нет канонических `SECURITY.md`/`CHANGELOG.md`; `DECISIONS.md` слишком велик.
- **Митигация (план):** Добавить сжатый `SECURITY.md` + `CHANGELOG.md` (курируемый из `Release`-коммитов); сегментировать `DECISIONS.md` по периодам; вынести ключевые доки в корень `docs/`. См. план DOC-1.

### REL-1 · Средний · Релизный процесс — только по конвенции

- **Направление:** Релизы.
- **Факт:** Версионирование SemVer-подобное (`2.20.103`), каждое изменение = коммит `Release vX.Y.Z` + тег; `bump-version.mjs` синхронизирует версию по файлам. Но нет `CHANGELOG`, нет документированного релиз-чеклиста-файла, нет описанной процедуры отката данных пользователя при плохом релизе (связано с DATA-1).
- **Доказательство:** `git log` (`Release vX.Y.Z`); `scripts/bump-version.mjs`; отсутствие CHANGELOG (см. DOC-1).
- **Последствия:** Внешние пользователи не видят, что изменилось; нет истории отката.
- **Митигация (план):** `CHANGELOG.md` + `RELEASE_CHECKLIST.md` + документированный downgrade/restore через JSON-экспорт. См. план REL-1.

### DATA-3 · Низкий–Средний · Вестигиальный дубль механизма версий схемы

- **Направление:** Данные / Код.
- **Факт:** Существуют два механизма «версии схемы»: (1) реальный per-calc `migrateCalculation()` (`migrations.js`); (2) глобальный ключ `SCHEMA_VERSION` + `runMigrations()` — **no-op**, лишь штампует версию. `runMigrations()` вызывается на каждом boot, но не выполняет шагов.
- **Доказательство:** `js/state/persistence.js:548-553` (no-op тело + комментарий «Здесь будут шаги миграции при обновлениях»); вызов `persist.runMigrations()` в `js/controllers/calcListController.js:676`; `persist.setSchemaVersion(...)` `calcListController.js:660`.
- **Последствия:** Запутывающий «почти мёртвый» код; будущий разработчик может добавить глобальную миграцию не туда.
- **Митигация (план):** Удалить или явно задокументировать как зарезервированный; консолидировать вокруг per-calc механизма. См. план DATA-3.

### TEST-1 · Низкий–Средний · UI-модалки без unit-тестов

- **Направление:** Тесты.
- **Факт:** `js/ui/modals/*.js` (36 файлов) не имеют каталога `tests/unit/modals/`; покрыты лишь косвенно через e2e/integration.
- **Доказательство:** нет `tests/unit/modals/` (инвентарь find); рендер-тесты для прочего UI есть в `tests/unit/ui/`.
- **Последствия:** Регрессии рендера модалок ловятся только на e2e (медленнее, desktop-only).
- **Митигация (план):** render-smoke unit-тесты для модалок (как существующие `tests/unit/ui/*`). См. план TEST-1.

### TEST-2 · Низкий · E2E только desktop (1365×768)

- **Направление:** Тесты / UI.
- **Факт:** Playwright использует единственный viewport `1365×768`, chromium; нет проекта для узких экранов.
- **Доказательство:** `playwright.config.js:23-24`.
- **Последствия:** Поломки вёрстки на меньших ноутбучных ширинах не ловятся. (Приложение — desktop-инструмент, поэтому Низкий.)
- **Митигация (план):** Добавить узкий viewport (напр. 1024px) с инвариантом отсутствия горизонтального overflow. См. план TEST-2.

### CODE-3 · Низкий · Вводящее в заблуждение имя `providerPriceFetch.js`

- **Направление:** Код / Именование.
- **Факт:** Модуль `js/services/providerPriceFetch.js` не делает сетевого `fetch` — читает локальный файл (workflow «загрузка локального JSON»).
- **Доказательство:** grep `fetch(` по `js/` не показал совпадений в `providerPriceFetch.js`; `js/app.js:282-289` (комментарий про локальный JSON).
- **Последствия:** Имя подразумевает сетевое поведение, которого нет → путаница при онбординге.
- **Митигация (план):** Переименовать в `providerPriceFileLoad.js` (или явно задокументировать). См. план CODE-3.

### ENG-2 · Низкий · Риск дрейфа двух источников через `.pages-dist/`

- **Направление:** Инженерные практики / Релизы.
- **Факт:** `.pages-dist/` — полная копия проекта как build-артефакт (gitignored). При ручной публикации без пересборки возможен дрейф (паттерн `~/.claude/CLAUDE.md §16`).
- **Доказательство:** `.gitignore:8` игнорирует `.pages-dist/`; `scripts/build-pages-dist.mjs` генерит; CI пересобирает (`ci.yml:45` `pages:build`).
- **Последствия:** Устаревший опубликованный билд, если `pages:build` не запущен (в CI запускается — риск ограничен ручной публикацией).
- **Митигация (план):** Гарантировать пересборку в `pages.yml`; задокументировать «`.pages-dist` нельзя править руками». См. план ENG-2.

### SEC-1 · Низкий (информационно) · `renderMarkdown` рассчитан только на доверенный контент

- **Направление:** Безопасность.
- **Факт:** `safeUrl` использует allow-list, но **не декодирует HTML-entity** до проверки; `inline()` инжектит теги в уже экранированную строку. Сейчас безопасно, т.к. рендерится только bundled-контент (README/UserManual).
- **Доказательство:** `js/services/markdown.js:13-19`, `26-38`; вызов из `js/controllers/helpController.js:21` (`UserManual.md`), `js/ui/modals/helpModal.js`.
- **Последствия:** Если `renderMarkdown` когда-либо переиспользуют для **пользовательского** контента, отсутствие entity-decode + allow-list по сырой строке может стать вектором (см. `~/.claude/CLAUDE.md §3.quint`).
- **Митигация (план):** Задокументировать инвариант «только доверенный bundled-контент»; при будущем переиспользовании — entity-decode перед проверкой или sanitizer. См. план SEC-1.

### SEC-2 · Информационно (уже учтено) · `frame-ancestors` требует HTTP-заголовка

- **Направление:** Безопасность / Деплой.
- **Факт:** Защита от clickjacking через `frame-ancestors` работает только как HTTP-заголовок CSP, не из `<meta>` — это уже честно задокументировано в коде.
- **Доказательство:** `index.html:24-33`.
- **Последствия:** При веб-self-hosting нужен серверный заголовок (иначе нет защиты от iframe-embedding).
- **Митигация (план):** Убедиться, что инструкции деплоя (`HOW_TO_START.md` «Веб-публикация») содержат заголовок; вынести в `SECURITY.md`. См. план DOC-1/SEC-2.

---

## 4. Методология и оговорки

- **Верифицировано лично** (Read/Grep): архитектура слоёв, storage, парсер DSL, миграции, CRUD/destructive-действия, XSS-поверхность, CSP, секреты, конфиги lint/typecheck, CI, test-runner, focus/a11y.
- **Получено суб-агентами и перепроверено:** инвентарь UI/вкладок и тестов. В ходе верификации (дисциплина `~/.claude/CLAUDE.md §4`) выявлены и **отброшены** ложные срабатывания агентов:
  - ❌ «focus-trap не найден» — на деле `js/ui/focus.js:74-92` (`trapTabIn`).
  - ❌ «`data-focus-key` не используется» — используется в `js/ui/focus.js:27,44`.
  - ❌ «`aria-live` не найдено» — live-regions присутствуют (19 совпадений).
  - ❌ «`resetAnswers` без confirm — один клик стирает» — confirm есть (`js/ui/questionnaire.js:287`); реальная проблема (UX-1) мягче: нет undo.
  - ❌ «`deleteItem`/`deleteQuestion` без confirm/undo/backup» — у обоих есть backup+undo, у `deleteQuestion` контекстный confirm (`js/app/crudActions.js`).
- **Не проверялось динамически** (read-only режим, по условию задачи): фактический прогон `npm test` / Playwright / реальное поведение в браузере. Метрики тестов взяты из кода runner'а и инвентаря файлов, не из живого прогона.
- **Допущения** явно помечены в тексте; находки без подтверждения `file:line` в реестр не включались.
- **`.pages-dist/`** исключён из анализа как build-копия; все ссылки указывают на исходники `js/`, `css/`.
