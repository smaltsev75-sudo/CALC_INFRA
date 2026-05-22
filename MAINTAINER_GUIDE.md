# MAINTAINER_GUIDE.md

Практический runbook для maintainer'а проекта: обновление цен провайдеров, проверка прайсов, регламент тестов, расширение схемы расчёта.

Целевая аудитория — разработчик / DevOps / data-инженер, который сопровождает калькулятор. Конечный пользователь приложения (PO + Архитектор) сюда не заходит — его рабочий процесс в [UserManual.md](UserManual.md).

---

## 1. Provider Price Update Workflow

Цены провайдеров живут в `data/providers/<provider>-latest.json`. Обновляется руками. Регламент — раз в квартал, особенно для волатильных категорий (LLM-токены, SMS).

### 1.1 Файлы провайдеров в репозитории

```
data/providers/sbercloud-latest.json
data/providers/yandex-latest.json
data/providers/vk-latest.json
```

При добавлении нового провайдера — новый файл `data/providers/<id>-latest.json`. `<id>` должен совпадать с `providerId` внутри файла.

### 1.2 Шаги обновления

#### Шаг 1. Собрать актуальные цены с публичных страниц

| Провайдер | Источник цен |
|---|---|
| Cloud.ru (бывший SberCloud, `providerId: sbercloud`) | https://cloud.ru/documents/tariffs/evolution/index + при отсутствии Evolution SKU: https://cloud.ru/documents/tariffs/advanced/index |
| Yandex Cloud | https://yandex.cloud/ru/prices |
| VK Cloud | https://cloud.vk.com/pricelist |
| MTS Cloud | https://cloud.mts.ru/calculator/ |
| On-premises | внутренние прайсы вендора железа / ОС / СУБД |

Записывать **on-demand цены, регион Москва, без reserved-commits, без скидок**. Корпоративные дисконты — отдельным override через UI, не в bundled JSON.

#### Шаг 2. Открыть нужный файл и поправить значения

Изменяемые поля: `prices.<itemId>.pricePerUnitNet` или `prices.<itemId>.pricePerUnitGross`, `prices.<itemId>.vatRate`, `prices.<itemId>.priceSource` (URL/дата сбора), при необходимости `version` и `timestamp` верхнего уровня.

**Обязательные поля верхнего уровня**:
- `schemaVersion`: `2`
- `providerId`: должен совпадать с именем файла
- `version`: строка-метка прайса (например, `"2026-Q4"`)
- `timestamp`: ISO-дата сбора цен
- `source`: URL/описание источника
- `vatPolicy`: явная VAT-семантика источника
- `prices`: объект `{ <itemId>: { pricePerUnitNet? | pricePerUnitGross?, vatRate?, vendor, priceSource } }`

Любое другое поле верхнего уровня → reject линтером. Внутри `vatPolicy`
разрешены только `pricesIncludeVat`, `vatRateIncluded`, `confidence`;
`pricesIncludeVat` обязан быть boolean, а при `pricesIncludeVat=true`
обязателен `vatRateIncluded` как доля (`0.22`, не `22`).

**Пример**:

```json
{
  "schemaVersion": 2,
  "providerId": "sbercloud",
  "version": "2026-Q4",
  "timestamp": "2026-09-01T00:00:00.000Z",
  "source": "https://cloud.ru/ru/services/pricing (2026-09)",
  "vatPolicy": {
    "pricesIncludeVat": true,
    "vatRateIncluded": 0.22,
    "confidence": "source-level"
  },
  "prices": {
    "cpu-vcpu-shared": {
      "pricePerUnitGross": 980,
      "vatRate": 0.22,
      "vendor": "Cloud.ru",
      "priceSource": "cloud.ru/2026-Q4"
    },
    "ram-gb": {
      "pricePerUnitGross": 270,
      "vatRate": 0.22,
      "vendor": "Cloud.ru",
      "priceSource": "cloud.ru/2026-Q4"
    }
  }
}
```

Допустимые `<itemId>` — это id любого ЭК из `js/domain/seed.js`. Опечатка ловится линтером (см. п. 2 ниже).

#### Шаг 3. Пересобрать bundled module и отчёт свежести

```bash
npm run generate:providers
npm run prices:freshness
```

`generate:providers` обновляет runtime-источник `js/data/providers-bundled.generated.js`.
`prices:freshness` обновляет [PROVIDER_FRESHNESS_REPORT.md](PROVIDER_FRESHNESS_REPORT.md):
возраст прайса, число SKU, VAT confidence, флаги `STALE` / `STUB` /
`ASSUMED_VAT`, structural quality gates и confidence summary по уровню доверия
к bundled-провайдерам.

#### Шаг 4. Прогнать тесты

```bash
npm run prices:freshness:check
npm run sanity:check
npm test
```

Линтер `tests/unit/architecture/stage-14-7-json-linter.test.js` проверит:
- `prices.<id>` существует в `SEED_ITEMS`;
- entry содержит положительную net/gross цену и корректную VAT-семантику;
- все обязательные поля верхнего уровня заполнены;
- нет неизвестных полей;
- timestamp — валидный ISO.

Если упало — читать сообщение об ошибке, оно укажет на конкретное поле.

#### Шаг 5. Закоммитить и задеплоить

После следующего deploy / обновления приложения пользователи через **Опросник → Тарифы провайдера → Импорт прайса** получают новый bundle (если выберут provider-JSON из поставки) или применяют JSON через файл-picker как разовый override.

---

## 2. Price Linting & Validation

Проверки прайсов автоматизированы в test-suite. Все проверки — pure-JS, без сетевых обращений. Запускаются на каждом `npm test`.

| Линтер | Что проверяет |
|---|---|
| [stage-14-7-json-linter.test.js](tests/unit/architecture/stage-14-7-json-linter.test.js) | Структура `data/providers/*.json` (schemaVersion, providerId, vatPolicy, prices.<id> ∈ SEED_ITEMS, net/gross price > 0) |
| [provider-freshness-report-sync.test.js](tests/unit/architecture/provider-freshness-report-sync.test.js) | [PROVIDER_FRESHNESS_REPORT.md](PROVIDER_FRESHNESS_REPORT.md) соответствует bundled-прайсам, timestamps, VAT confidence и quality gates |
| [seed-formulas.test.js](tests/unit/domain/seed-formulas.test.js) | Каждая qty-формула в seed парсится и считается в финитное неотрицательное число |
| [no-emoji-in-source.test.js](tests/unit/architecture/) | Эмодзи в UI-исходниках запрещены |
| [storage-whitelist.test.js](tests/unit/services/storage-whitelist.test.js) | Все ключи localStorage идут через `STORAGE_KEYS` |
| [layer-imports.test.js](tests/unit/architecture/layer-imports.test.js) | UI ↛ controllers/state, domain ↛ services/state/controllers/ui |

### Типовые ошибки прайс-импорта

| Ошибка | Причина | Что делать |
|---|---|---|
| `unknown itemId 'cpu-vCPU-shared'` | Опечатка в id (case-sensitive) | Сверить с `js/domain/seed.js` |
| `pricePerUnit must be > 0` | Цена 0 или отрицательная | Поправить значение |
| `schemaVersion expected 1 or 2` | Используется неподдерживаемая версия формата | Обновить файл под текущий schema, либо обновить парсер |
| `unknown top-level field 'discount'` | Лишнее поле верхнего уровня | Удалить либо вынести в `prices.<id>.<vendor-meta>` |
| `invalid-vat-policy` | `vatPolicy` неполный, с лишними полями или ставкой `22` вместо `0.22` | Исправить `pricesIncludeVat`, `vatRateIncluded`, `confidence` |
| `vat-policy-required` | Импорт legacy schema v1 без явного выбора VAT-политики | В UI выбрать net / gross-20 / gross-22 либо перевести файл в schema v2 |
| `vat-inconsistency` | `net`, `gross` и `vatRate` математически не сходятся | Проверить округления; допуск consistency = 0.01 ₽ |

---

## 3. Почему нет автоматического обновления цен

Вопрос регулярно возникает — сюда вынесены ответы. UserManual ссылается на этот раздел.

Технически автоматическое обновление означало бы: браузер пользователя делает HTTPS-запросы к `cloud.ru`, `yandex.cloud`, `mcs.mail.ru` и т. д. в момент клика по «Обновить». Этого нет, и реализовано не будет, по пяти независимым причинам.

### 3.1 Нет публичных billing-API без авторизации

Российские облачные провайдеры не публикуют машинно-читаемых price-feed'ов (типа AWS Price List API). Цены раскиданы по marketing-страницам с произвольной HTML-структурой.

### 3.2 CSP запрещает кросс-доменные запросы

В `index.html` явная директива `connect-src 'self'` (см. `HOW_TO_START.md → Рекомендуемая CSP`). Любой `fetch()` за пределы own-origin блокируется браузером. Расширение CSP сделало бы приложение существенно менее безопасным.

### 3.3 CORS на стороне провайдеров

Даже если бы CSP разрешала — `cloud.ru` не отдаёт `Access-Control-Allow-Origin: *` для своих публичных страниц. Браузер не получит ответ. Обойти можно только серверным прокси (= новый компонент архитектуры, выходит за рамки локального калькулятора).

### 3.4 HTML-парсинг провайдерских страниц фундаментально хрупкий

Cloud.ru / Yandex Cloud — SPA с client-side rendering, anti-bot защитой, динамическим разбиением на чанки. Парсер ломается при каждом редизайне (раз в 3–6 месяцев) — и ломается **тихо**: тесты зелёные, JSON парсится, цены неверные. Пользователь принимает решения по сломанным цифрам. Это **хуже**, чем нет автоматики совсем.

### 3.5 ToS многих провайдеров запрещают автоматизированный scraping

Юридический риск + потенциальные CDN-блокировки по IP клиентов калькулятора + репутационный риск для проекта-партнёра.

### 3.6 Реалистичный путь — semi-auto

Maintainer раз в квартал руками выписывает прайсы ключевых ЭК с сайтов провайдеров в JSON (1–2 часа работы), коммитит в репо, пользователи через **Импорт прайса** подтягивают свежий bundle. Это покрывает 95% реальных use-case'ов без backend, парсеров, юридических рисков и хостинга.

---

## 4. Running Tests

### 4.1 Базовые команды

```bash
npm test                  # Все тесты (node:test, custom runner)
npm run test:quick        # Быстрый unit-slice: domain/services/controllers/utils
npm run test:architecture # Architecture/source guards
npm run test:ui           # UI unit/source smoke
npm run test:integration  # Integration-сценарии
npm run test:watch        # Watch-режим (node --watch)
npm run smoke:desktop     # Playwright desktop smoke, 1365×768 + viewport guards, parallel workers
npm run smoke:desktop:headed # То же, но с видимым браузером
npm run smoke:published   # Короткий smoke опубликованной GitHub Pages сборки
npm run syntax-check      # node --check на всех js/**/*.js
npm run sanity:check      # SANITY_REPORT.md соответствует текущим формулам/прайсам
npm run sanity            # Пересобрать SANITY_REPORT.md
npm run prices:freshness:check # PROVIDER_FRESHNESS_REPORT.md соответствует bundled-прайсам
npm run prices:freshness       # Пересобрать PROVIDER_FRESHNESS_REPORT.md
npm run pages:build       # Собрать .pages-dist для Pages workflow
```

Запустить один файл:

```bash
node --test tests/unit/domain/calculator.test.js
node tests/run.js tests/unit/domain tests/unit/services
node tests/run.js --list tests/unit/ui
```

Запустить один тест по имени:

```bash
node --test --test-name-pattern="riskFactor" tests/unit/domain/calculator.test.js
```

### 4.2 Группы тестов

| Папка | Содержание |
|---|---|
| `tests/unit/domain/` | Чистые функции расчёта (calculator, formula DSL, риск-факторы) |
| `tests/unit/state/` | store, persistence, миграции |
| `tests/unit/services/` | storage, csv export/import, json |
| `tests/unit/controllers/` | calc/scenario/provider/item/question controllers |
| `tests/unit/ui/` | UI smoke + конкретные модалки |
| `tests/unit/architecture/` | Линтеры (layer-imports, storage-whitelist, no-emoji, json-linter, regression-guards) |
| `tests/e2e/` | Playwright desktop smoke (`*.spec.js`, отдельный runner) |
| `tests/integration/` | Кросс-слойные сценарии (atomicity, leak-detection) |
| `tests/unit/performance/` | Bench / sanity на больших данных |

### 4.3 Desktop browser smoke

```bash
npm run smoke:desktop
```

Автоматический Playwright smoke поднимает локальный static server (`scripts/static-server.mjs`) и параллельно проверяет реальные desktop-сцены 1365×768: Dashboard, Cost Optimization Planner, Decision Memo, Детализацию, Сравнение, Опросник, scenario tabs, активный и bundle JSON import/export/reset, provider VAT-policy import, Decision Memo `.md` download и PDF routing из шапки приложения. Для Детализации suite сверяет порядок групп ЭК по `ИТОГО / год`, видимые totals/share группы с production-моделью, формат пакетных qty-единиц уведомлений (`тыс. SMS`, `тыс. писем`, `млн PUSH` без `16 1000 SMS`) и PDF print-mode через header PDF / `Ctrl+Alt+P` / native `beforeprint`: transient landscape `@page`, `table-layout: fixed`, ширина таблиц ≈ ширине листа, заголовки без посимвольного переноса. Viewport guard дополнительно проходит 1365×768, 1440×900 и 1920×1080, чтобы основные desktop-экраны не давали document-level horizontal overflow и app chrome не накладывался; Dashboard grid/card min-width guards защищают от Linux Chromium font-metric overflow в risk-card. Отдельный visual-regression слой делает PNG-signal проверки ключевых экранов: скриншот не должен быть пустым/однотонным, экран должен иметь ожидаемый desktop-размер, а основные chrome-блоки не должны перекрываться. Скриншоты пишутся в `.playwright-mcp/`; runner не должен создавать артефакты в корне проекта.

Локально по умолчанию используется системный Chrome (`PLAYWRIGHT_CHANNEL=chrome`). В CI channel не фиксируется: workflow ставит bundled Chromium через `npx playwright install --with-deps chromium`. При необходимости можно переключить канал, например `PLAYWRIGHT_CHANNEL=msedge npm run smoke:desktop`.

GitHub Actions workflow [ci.yml](.github/workflows/ci.yml) запускает два job'а:
`unit-and-sanity` (`npm test`, `syntax-check`, `sanity:check`,
`prices:freshness:check`, `pages:build`, `git diff --check`)
и `desktop-smoke` (`npm run smoke:desktop`). При падении browser job'а
артефакты забираются из `.playwright-mcp/test-results`.

GitHub Pages публикуется через [pages.yml](.github/workflows/pages.yml), а не
через legacy deploy-from-branch. Workflow собирает `.pages-dist` из tracked
static-файлов командой `npm run pages:build`, добавляет `.nojekyll` и деплоит
через `actions/deploy-pages@v5`. Репозиторий должен иметь Pages source
`GitHub Actions` (`build_type=workflow`).

После релиза полезно отдельно запускать `npm run smoke:published`: он проверяет
уже опубликованный GitHub Pages URL на base path `/CALC_INFRA/`. Если нужен
другой URL, задайте `PLAYWRIGHT_PUBLISHED_URL`. Скрипт делает один retry по
умолчанию (`PLAYWRIGHT_PUBLISHED_RETRIES=1`) и собирает точные URL для HTTP
4xx/5xx, чтобы transient Pages/CDN сбой не выглядел как безымянный console
error.

Расчётная сетка Quick Start покрыта двумя слоями: exact snapshots в
`tests/unit/domain/golden-scenarios.test.js` и полный invariant-прогон 2880
комбинаций в `tests/unit/domain/wizard-calculation-invariants.test.js`.
Ручные business-профили Startup / SMB / Enterprise / internal ops / regulated
fintech / AI agent support дополнительно закреплены в
`tests/unit/domain/business-golden-scenarios.test.js`: totals, стенды,
категории и top PROD drivers должны совпадать с maintainer sanity-моделью.
Performance guard `tests/unit/performance/calculate-large-data-budget.test.js`
проверяет большой пользовательский каталог ЭК и revision-cache `calculate()`.
При правке формул, прайсов, wizard-профилей или риск/VAT-множителей запускать
эти слои обязательно; `npm test` делает это автоматически.

### 4.4 Sanity report (вручную)

```bash
npm run sanity
```

Прогоняет калькулятор на 3 типовых sanity-профилях (Startup MVP / SMB B2B SaaS / Enterprise) и таблицу чувствительности к риск-коэффициентам. Ещё 3 ручных business-профиля (internal ops, regulated fintech, AI agent support) закреплены golden-тестом, чтобы ловить аномалии для low-security, regulated/high-security и AI-heavy сценариев. Запускать после правок прайсов или формул. В CI/перед коммитом удобнее `npm run sanity:check`: он не переписывает файл, а проверяет, что [SANITY_REPORT.md](SANITY_REPORT.md) актуален.

---

### 4.5 Provider freshness report

```bash
npm run prices:freshness
npm run prices:freshness:check
```

[PROVIDER_FRESHNESS_REPORT.md](PROVIDER_FRESHNESS_REPORT.md) фиксирует дату отчёта,
порог `STALE_BUNDLE_THRESHOLD_MONTHS`, версию/timestamp каждого bundled-прайса,
число позиций, `vatPolicy.confidence` и статус. `OK` означает, что прайс свежее
порога и не помечен stub/assumed. `STUB` и `ASSUMED_VAT` не ломают приложение, но
должны быть видны в релизном контексте.

Вторая таблица `Quality gates` проверяет maintainer-качество данных:
core SKU coverage для compute/storage/network, gross→net `vatPolicy`,
неположительные net/gross цены и пустые `vendor`/`priceSource`. `--check`
сравнивает отчёт с текущим `js/data/providers-bundled.generated.js` и входит в
CI.

Третья таблица `Confidence summary` агрегирует уровень доверия к bundled-прайсам:
сколько провайдеров имеют verified/source-level VAT, assumed/unknown VAT и
stub-статус. Колонка `Attention` включает и freshness-флаги, и проблемы из
`Quality gates`, поэтому провайдер с публичным VAT source-level всё равно может
требовать внимания из-за `MISSING_CORE`. Для коммерческого baseline провайдеры
с `STUB`/`ASSUMED_VAT` должны быть заменены ручной verified/source-level
выгрузкой, а провайдеры с `MISSING_CORE` — дополнены КП или ручным override
перед финальной сметой.

---

### 4.6 Source-grep тесты после модульного рефакторинга

В проекте много архитектурных и UI-тестов, которые читают исходник как текст. После дробления монолитов важно обновлять **путь файла-владельца поведения**, а не добавлять дубли в старый фасад:

| Поведение | Где теперь искать |
|---|---|
| `ctx` действия приложения | `js/app/*Actions.js` |
| runtime boot/render/instance lock | `js/app/renderScheduler.js`, `js/app/instanceLockRuntime.js`, `js/app/uiPersistenceSubscriber.js` |
| number input и inline validation в Опроснике | `js/ui/questionnaireNumberInput.js` |
| группы настроек Опросника | `js/ui/questionnaireSettings.js`, `questionnaireProviderSettings.js`, `questionnaireVatSettings.js`, `questionnaireStandSettings.js` |
| Dashboard profile/banner/aggregates | `js/ui/dashboardProfileBanner.js`, `dashboardAggregates.js`, `dashboardMetricBlocks.js`, `dashboardRiskCard.js` |
| Details qty/cost tables | `js/ui/detailsSections.js` |
| Details AI summary | `js/ui/detailsAiSummary.js` |
| Details totals helpers | `js/ui/detailsTotals.js` |
| provider update row | `js/ui/providerUpdateRow.js` |
| VAT normalization provider JSON | `js/services/providerPriceNormalize.js` |
| price import mapping rows/suggestions | `js/domain/priceImportMappingRows.js`, `priceImportMappingSuggest.js` |
| health-check rules | `js/domain/calculationHealthChecks.js` |
| wizard profile tables | `js/domain/wizardProfileData.js` |

Фасады (`app.js`, `questionnaire.js`, `dashboard.js`, `costOptimizationPlanner.js`, `providerPriceFetch.js`) оставлены для стабильного публичного API. Не переносите логику обратно в фасад только ради теста; лучше обновить source-grep тест на новый ownership.

---

## 5. Schema Migration

Расчёт сериализуется в JSON со схемой версии `LATEST_SCHEMA_VERSION` (см. `js/utils/constants.js`). При изменении формата `calc.*` нужна миграция.

### 5.1 Где живут миграции

`js/state/migrations.js` — массив `MIGRATIONS` шагов `{ from, to, run(calc) }`. Применяется и при загрузке из localStorage, и при импорте JSON.

### 5.2 Как добавить миграцию

1. **Реализовать `step.run(calc)`** — мутирует **глубокую копию**, не оригинал.
2. **Шаг должен быть идемпотентным** — повторное применение не должно ломать calc.
3. **Добавить запись в `MIGRATIONS`** в порядке возрастания `to`.
4. **Bump `LATEST_SCHEMA_VERSION`** (`js/state/migrations.js`) — `CURRENT_SCHEMA_VERSION` в `constants.js` — re-export, не дублировать литерал.
5. **Синхронно bump `APP_VERSION`** в `js/utils/constants.js` и `package.json` (см. правило bump'а в `CLAUDE.md`).
6. **Добавить тесты** в `tests/unit/state/migrations.test.js` — минимум: round-trip, идемпотентность, edge-case (пустой calc, calc с already-applied миграцией).

### 5.3 Bundle-импорт и atomic backup

`js/services/bundleExport.js` делает atomic backup/rollback — если хоть один расчёт не мигрирует, состояние не меняется. Тесты на это — `tests/integration/calc-persistence-atomicity.test.js`.

### 5.4 Версионирование bundle (BUNDLE_MAJOR)

Если меняется формат **bundle-файла** (новые обязательные поля, другая структура), bump `BUNDLE_MAJOR` в `js/services/bundleExport.js`. Старые приложения отвергнут новый bundle с понятным сообщением.

---

## 6. Pre-commit чек-лист (быстрая самопроверка)

Подробный список — в [CLAUDE.md](CLAUDE.md). Минимум перед коммитом:

1. `npm test` зелёный.
2. `npm run syntax-check` зелёный.
3. `git diff --check` без trailing whitespace / conflict markers.
4. Для правок прайсов или формул — `npm run sanity:check` или обновлённый `npm run sanity`; для provider-прайсов дополнительно `npm run prices:freshness:check` или обновлённый `npm run prices:freshness`.
5. Никаких `style:` user-input, никаких `el(..., { html: ... })` без `trustedHtml(...)`.
6. Никаких `eval` / `new Function` / `setTimeout(string)` / `.innerHTML = userInput`.
7. Все ключи localStorage — через `STORAGE_KEYS`.
8. Денежные сравнения — через `isZeroMoney(x)`, не `x === 0`.
9. Если правил `seed.js` или DSL-парсер — прогнать `seed-formulas.test.js`.
10. Если меняете ownership модулей — обновить [Architecture.md](Architecture.md) и source-grep тесты.
11. Скриншоты Playwright — в `.playwright-mcp/`, не в корень проекта.
12. Временные файлы — в `d:/tmp/` или `$TEMP`, не в working dir.

---

## 7. Что НЕ делать

- **Не править `package.json` "version" в обход `APP_VERSION` в constants.js** — линтер `app-version-sync.test.js` упадёт.
- **Не использовать `git rebase -i` / `git add -i`** — интерактивные команды в pipeline'ах ломаются.
- **Не пушить force на main** без явной координации.
- **Не отключать тесты `--no-verify`** — если pre-commit hook упал, разбираться с причиной.
- **Не удалять файлы в `data/providers/`** без проверки, что нет расчётов с этим `providerId` в боевом localStorage пользователей. Удаление = providerVersion в их calc становится stale.
- **Не добавлять runtime-зависимости** (npm-пакеты для рантайма) — приложение работает offline без `node_modules`.

---

## 8. Дополнительно

- Архитектура и устройство кода — [Architecture.md](Architecture.md).
- Журнал решений по этапам — [DECISIONS.md](DECISIONS.md).
- Глобальные правила работы (для Claude Code, но полезно и для людей) — [CLAUDE.md](CLAUDE.md).
- Запуск приложения — [HOW_TO_START.md](HOW_TO_START.md).

---

## Updating provider price JSON v2 (Stage VAT-2, с 2.16.0)

С 2.16.0 (Stage VAT-2) `data/providers/*-latest.json` использует **schema v2** с явной VAT-семантикой: каждая запись цены хранит net и/или gross + vatRate. Калькулятор внутри работает только с net (НДС применяется отдельно через `calc.settings.vatRate`). Валидация верхнего уровня живёт в [providerPriceFetch.js](js/services/providerPriceFetch.js), нормализация entry → net — в [providerPriceNormalize.js](js/services/providerPriceNormalize.js).

### Когда правите цены

1. **Не указывайте VAT-политику только в `priceSource`** — это текстовое meta-поле, validator его не парсит (защита от silent guessing).

2. **Если источник показывает цены С НДС** (например, прайс Cloud.ru с пометкой «с НДС 22%»):
   ```json
   "cpu-vcpu-shared": {
       "pricePerUnitGross": 712,
       "vatRate": 0.22,
       "vendor": "...",
       "priceSource": "..."
   }
   ```
   `pricePerUnitNet` опционален — validator вычислит net = gross / 1.22 на входе.

3. **Если источник показывает цены без НДС** (некоторые B2B-договоры):
   ```json
   "cpu-vcpu-shared": {
       "pricePerUnitNet": 583.61,
       "vendor": "...",
       "priceSource": "..."
   }
   ```
   `vatRate` и `pricePerUnitGross` опциональны.

4. **Если известны обе цены** (договор показывает и net, и gross — для аудит-trail):
   ```json
   "cpu-vcpu-shared": {
       "pricePerUnitNet": 583.61,
       "pricePerUnitGross": 712,
       "vatRate": 0.22
   }
   ```
   Validator проверяет согласованность: `abs(gross - net × (1 + vatRate)) ≤ EPSILON_VAT_CONSISTENCY` (= 0.01 ₽). Несогласованные net/gross/vatRate — reject с `reason: 'vat-inconsistency'`.

5. **Top-level `vatPolicy` обязателен**:
   ```json
   "vatPolicy": {
       "pricesIncludeVat": true,
       "vatRateIncluded": 0.22,
       "confidence": "verified"
   }
   ```
   `confidence`:
   - `verified` — данные из официальных договорных приложений / verified API;
   - `source-level` — публичные тарифы провайдера (price-list page);
   - `assumed` — realistic-stub / синтетика, не верифицирована (используйте для placeholder-источников).

   Validator также проверяет shape: `pricesIncludeVat` только boolean,
   `vatRateIncluded` только доля в `[0, 1]`; при `pricesIncludeVat=true`
   ставка обязательна. Лишние поля внутри `vatPolicy` отклоняются.

### После изменения JSON — обязательно

```bash
npm run generate:providers   # пересобирает js/data/providers-bundled.generated.js
npm run prices:freshness      # обновляет PROVIDER_FRESHNESS_REPORT.md
npm test                      # sync-test проверит, что generated module ≡ свежим JSON
```

Если забыли `npm run generate:providers` — sync-test ([providers-bundled-sync.test.js](tests/unit/architecture/providers-bundled-sync.test.js)) упадёт с подсказкой команды.

### Какие SKU входят в bundled

Coverage у каждого провайдера разная и отражает реальный прайс-лист:
- **sbercloud** (16 SKU) — Cloud.ru public tariffs verified 2026-05-22: Evolution Compute/Object Storage/Foundation Models/Managed Redis/PostgreSQL/Managed RAG/AI Agents + Advanced L7/WAF where Evolution has no SKU.
- **yandex** (15 SKU) — yandex.cloud/pricing: compute + dedicated + AI tokens + RAG.
- **vk** (10 SKU) — cloud.vk.com/pricelist source-level: compute, RAM, disks, Object Storage, load balancer и Microsoft licenses. WAF/DDoS у VK Cloud опубликованы как «по запросу», поэтому не входят в bundled и подсвечиваются как `MISSING_CORE`.

Items, отсутствующие в bundled (например, sbercloud не покрывает licenses) — silent fallback на SEED-цену в `applyProviderOverlay`. Это нормальный сценарий: bundled JSON покрывает provider-specific прайс, остальное берётся из SEED-defaults.
