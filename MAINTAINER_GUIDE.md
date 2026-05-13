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
| Cloud.ru | https://cloud.ru/ru/services/pricing |
| Yandex Cloud | https://yandex.cloud/ru/prices |
| VK Cloud | https://mcs.mail.ru/pricing/ |
| SberCloud | https://sbercloud.ru/ru/products (карточка конкретного продукта) |
| MTS Cloud | https://cloud.mts.ru/calculator/ |
| On-premises | внутренние прайсы вендора железа / ОС / СУБД |

Записывать **on-demand цены, регион Москва, без reserved-commits, без скидок**. Корпоративные дисконты — отдельным override через UI, не в bundled JSON.

#### Шаг 2. Открыть нужный файл и поправить значения

Изменяемые поля: `prices.<itemId>.pricePerUnit`, `prices.<itemId>.priceSource` (URL/дата сбора), при необходимости `version` и `timestamp` верхнего уровня.

**Обязательные поля верхнего уровня**:
- `schemaVersion`: `1`
- `providerId`: должен совпадать с именем файла
- `version`: строка-метка прайса (например, `"2026-Q4"`)
- `timestamp`: ISO-дата сбора цен
- `source`: URL/описание источника
- `prices`: объект `{ <itemId>: { pricePerUnit, vendor, priceSource } }`

Любое другое поле верхнего уровня → reject линтером.

**Пример**:

```json
{
  "schemaVersion": 1,
  "providerId": "sbercloud",
  "version": "2026-Q4",
  "timestamp": "2026-09-01T00:00:00.000Z",
  "source": "https://cloud.ru/ru/services/pricing (2026-09)",
  "prices": {
    "cpu-vcpu-shared": {
      "pricePerUnit": 980,
      "vendor": "SberCloud",
      "priceSource": "cloud.ru/2026-Q4"
    },
    "ram-gb": {
      "pricePerUnit": 270,
      "vendor": "SberCloud",
      "priceSource": "cloud.ru/2026-Q4"
    }
  }
}
```

Допустимые `<itemId>` — это id любого ЭК из `js/domain/seed.js`. Опечатка ловится линтером (см. п. 2 ниже).

#### Шаг 3. Прогнать тесты

```bash
npm test
```

Линтер `tests/unit/architecture/stage-14-7-json-linter.test.js` проверит:
- `prices.<id>` существует в `SEED_ITEMS`;
- `pricePerUnit > 0`;
- все обязательные поля верхнего уровня заполнены;
- нет неизвестных полей;
- timestamp — валидный ISO.

Если упало — читать сообщение об ошибке, оно укажет на конкретное поле.

#### Шаг 4. Закоммитить и задеплоить

После следующего deploy / обновления приложения у пользователей пользователи через **Опросник → Тарифы провайдера → Импорт прайса** получают новый bundle (если выберут provider-JSON из поставки) или применяют JSON через файл-picker как разовый override.

---

## 2. Price Linting & Validation

Проверки прайсов автоматизированы в test-suite. Все проверки — pure-JS, без сетевых обращений. Запускаются на каждом `npm test`.

| Линтер | Что проверяет |
|---|---|
| [stage-14-7-json-linter.test.js](tests/unit/architecture/stage-14-7-json-linter.test.js) | Структура `data/providers/*.json` (schemaVersion, providerId, prices.<id> ∈ SEED_ITEMS, pricePerUnit > 0) |
| [seed-formulas.test.js](tests/unit/domain/seed-formulas.test.js) | Каждая qty-формула в seed парсится и считается в финитное неотрицательное число |
| [no-emoji-in-source.test.js](tests/unit/architecture/) | Эмодзи в UI-исходниках запрещены |
| [storage-whitelist.test.js](tests/unit/services/storage-whitelist.test.js) | Все ключи localStorage идут через `STORAGE_KEYS` |
| [layer-imports.test.js](tests/unit/architecture/layer-imports.test.js) | UI ↛ controllers/state, domain ↛ services/state/controllers/ui |

### Типовые ошибки прайс-импорта

| Ошибка | Причина | Что делать |
|---|---|---|
| `unknown itemId 'cpu-vCPU-shared'` | Опечатка в id (case-sensitive) | Сверить с `js/domain/seed.js` |
| `pricePerUnit must be > 0` | Цена 0 или отрицательная | Поправить значение |
| `schemaVersion expected 1, got 2` | Используется неподдерживаемая версия формата | Обновить файл под текущий schema, либо обновить парсер |
| `unknown top-level field 'discount'` | Лишнее поле верхнего уровня | Удалить либо вынести в `prices.<id>.<vendor-meta>` |

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

Maintainer раз в квартал руками выписывает 35 цен с сайтов провайдеров в JSON (1–2 часа работы), коммитит в репо, пользователи через **Импорт прайса** подтягивают свежий bundle. Это покрывает 95% реальных use-case'ов без backend, парсеров, юридических рисков и хостинга.

---

## 4. Running Tests

### 4.1 Базовые команды

```bash
npm test                  # Все тесты (node:test, custom runner)
npm run test:watch        # Watch-режим (node --watch)
npm run syntax-check      # node --check на всех js/**/*.js
```

Запустить один файл:

```bash
node --test tests/unit/domain/calculator.test.js
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
| `tests/integration/` | Кросс-слойные сценарии (atomicity, leak-detection) |
| `tests/unit/performance/` | Bench / sanity на больших данных |

### 4.3 Sanity report (вручную)

```bash
node tests/_sanity-check.mjs > SANITY_REPORT.md
```

Прогоняет калькулятор на 3 типовых профилях (Startup MVP / SMB B2B SaaS / Enterprise) и таблицу чувствительности к риск-коэффициентам. Запускать после правок прайсов или формул.

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
3. Никаких `style:` user-input, никаких `el(..., { html: ... })` без `trustedHtml(...)`.
4. Никаких `eval` / `new Function` / `setTimeout(string)` / `.innerHTML = userInput`.
5. Все ключи localStorage — через `STORAGE_KEYS`.
6. Денежные сравнения — через `isZeroMoney(x)`, не `x === 0`.
7. Если правил `seed.js` или DSL-парсер — прогнать `seed-formulas.test.js`.
8. Скриншоты Playwright — в `.playwright-mcp/`, не в корень проекта.
9. Временные файлы — в `d:/tmp/` или `$TEMP`, не в working dir.

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

С 2.16.0 (Stage VAT-2) `data/providers/*-latest.json` использует **schema v2** с явной VAT-семантикой: каждая запись цены хранит net и/или gross + vatRate. Калькулятор внутри работает только с net (НДС применяется отдельно через `calc.settings.vatRate`).

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

### После изменения JSON — обязательно

```bash
npm run generate:providers   # пересобирает js/data/providers-bundled.generated.js
npm test                      # sync-test проверит, что generated module ≡ свежим JSON
```

Если забыли `npm run generate:providers` — sync-test ([providers-bundled-sync.test.js](tests/unit/architecture/providers-bundled-sync.test.js)) упадёт с подсказкой команды.

### Какие SKU входят в bundled

Coverage у каждого провайдера разная и отражает реальный прайс-лист:
- **sbercloud** (15 SKU) — Cloud.ru Evolution: compute + AI agents + LLM tokens + RAG.
- **yandex** (15 SKU) — yandex.cloud/pricing: compute + dedicated + AI tokens + RAG.
- **vk** (14 SKU) — realistic-stub: compute + licenses + услуги.

Items, отсутствующие в bundled (например, sbercloud не покрывает licenses) — silent fallback на SEED-цену в `applyProviderOverlay`. Это нормальный сценарий: bundled JSON покрывает provider-specific прайс, остальное берётся из SEED-defaults.
