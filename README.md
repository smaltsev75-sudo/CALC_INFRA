# Калькулятор инфраструктуры

Локальное web-приложение для оценки инфраструктуры и совокупной стоимости (CAPEX + OPEX) программного продукта по 5 стендам: **DEV · ИФТ · ПСИ · ПРОМ · НТ**.

Работает полностью **offline**, без runtime-зависимостей. Все цены в **рублях**.

Текущая версия — в [package.json](package.json) (поле `version`). Журнал ключевых решений по этапам — в [DECISIONS.md](DECISIONS.md).

---

## Назначение

Помогает архитектору / тимлиду / RFP-инженеру за 5–15 минут собрать предварительную оценку полной стоимости инфраструктуры для продукта на этапе «бизнес ставит вопрос — нужны цифры».

Не подменяет проектную документацию и КП от подрядчиков — это инструмент быстрой оценки. Каждая цена в каталоге снабжена ссылкой на источник (Cloud.ru, GigaChat, рыночные медианы 2026 г.).

---

## Основные функции

- **Опросник** из ~80 вопросов про продукт (нагрузка, БД, AI, безопасность, регуляторика).
- **Дашборд** с распределением по категориям, стенд-карточками, вкладом риск-коэффициентов и блоком «Следующие шаги».
- **Постатейная детализация** по каждому элементу × стенду.
- **Сравнение расчётов** до 4 штук side-by-side.
- **Анализ расчёта**: Качество (Health Check + динамика), Реестр допущений, Анализ чувствительности, Бюджетные ограничения, Decision Memo.
- **Планер оптимизации стоимости**: черновик изменений, preview экономии/рисков, явное применение и откат последнего apply.
- **36 элементов конфигурации** (включая 7 AI-позиций) и формульный движок qty с собственным безопасным DSL.
- **Импорт прайса JSON** (provider-JSON, CSV или JSON-массив через мастер маппинга), история откатов, прайс-бенчмарк (read-only сравнение прайсов провайдеров).
- **Кросс-табная синхронизация**: одновременно открытые вкладки видят чужие обновления и блокируют конфликты.
- **Защита от двойного запуска**: одновременно может работать только **один экземпляр приложения** в браузере. Второе окно/вкладка получает экран «Приложение уже открыто» — это гарантия, что две копии не повредят данные расчётов в общем хранилище.
- **PDF-печать** дашборда / опросника / детализации.
- **CSV экспорт-импорт** детализации.
- **JSON экспорт-импорт** одного расчёта или полного состояния.
- **Светлая и тёмная темы** с переключателем в шапке приложения.
- **Расширенные настройки** (admin) — CRUD каталога ЭК и вопросов, CSV-цены. По умолчанию скрыто.
- Полная **a11y / WCAG 2.1 AA** (focus-visible, aria-labelledby, touch-targets ≥44px, prefers-reduced-motion).

---

## Установка и запуск

Приложение — статический web (ES-модули). Требуется HTTP-сервер (`file://` блокирует ESM).

### 1. Скачать или клонировать

Распакуйте архив проекта в любую папку.

### 2. Запустить локальный HTTP-сервер

| ОС | Команда |
|----|---------|
| Windows | двойной клик по `start-server.bat` |
| Linux / macOS | `bash start-server.sh` |

Скрипт автоматически выберет первый доступный из: Python 3 → Node.js → PHP, поднимет сервер на порту 8000 и откроет браузер на `http://localhost:8000`.

### 3. Запуск вручную

```bash
python3 -m http.server 8000     # Python — рекомендуется
npx http-server -p 8000 -c-1    # Node.js
php -S localhost:8000           # PHP
```

Другой порт: `PORT=8080 bash start-server.sh`.

### 4. Доступ из локальной сети (Wi-Fi)

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

И открыть `http://<ваш-IP>:8000` с другого устройства. На Linux: `sudo ufw allow 8000` для firewall.

### 5. Через Docker

```bash
docker run -p 8000:80 -v "$PWD":/usr/share/nginx/html nginx:alpine
```

### Системные требования

- **Браузер**: Chrome 90+ / Yandex / Safari 14+ / Firefox современный.
- **Один из**: Python 3.7+, Node.js 18+, PHP 7.4+ (только для запуска HTTP-сервера; в коде проекта runtime-зависимостей нет). Node.js 18+ обязателен для `npm test`, Playwright smoke и maintainer-скриптов.
- **Разрешение экрана**: ≥1280×720 (адаптивная вёрстка работает и на ноутбуках 1366×768).

---

## Типовые проблемы при установке

| Симптом | Решение |
|---|---|
| `Failed to load module script` или белый экран в console | Открыли через `file://` напрямую. Запустите HTTP-сервер. |
| `python3: command not found` | Установите Python (`sudo apt install python3` / `brew install python3`) или используйте `start-server.bat` — он попробует Node и PHP в качестве fallback. |
| `Address already in use: 8000` | Порт занят. Запустите с `PORT=8080`, либо убейте процесс: `netstat -ano \| findstr :8000` (Windows) → `taskkill /PID <num> /F`. |
| `Permission denied: ./start-server.sh` | На Linux/macOS: `chmod +x start-server.sh`. |
| Нажимаю Сохранить — приложение не запоминает данные | Открыли в режиме инкогнито. localStorage в нём не персистится. Используйте обычное окно или экспортируйте JSON вручную. |
| Открыл новую версию — а на экране старые названия / интерфейс | Жёсткий reload браузера: **Ctrl+Shift+R** (Windows/Linux) или **Cmd+Shift+R** (macOS). Браузер агрессивно кэширует ES-модули, обычный F5 не всегда подхватывает изменения. |
| Открыл с другого устройства по IP — не работает | Проверьте firewall (Windows Defender / `ufw`). Bind на `0.0.0.0` означает публичную доступность в LAN — не используйте на недоверенной сети. |
| Запустил, но `localhost` отвечает 403 / 404 | Сервер запущен из неверной папки. Перейдите в корень проекта (где лежит `index.html`) и оттуда запускайте. |
| Открыл вторую вкладку — экран «Приложение уже открыто» | Это защита: одновременно в одном браузере может работать только один экземпляр. Закройте лишнее окно и нажмите «Проверить снова». Если первое окно крашнулось — lock сам протухнет через 90 секунд, страница разблокируется автоматически. |

### Recommended Content Security Policy

Приложение не делает сетевых запросов наружу, не использует `eval` / `new Function`, не подключает CDN, не открывает inline `<script>`. При этом ему нужны: динамические inline-стили (`width: ${pct}%` у прогресс-баров, `background: CATEGORY_COLORS[cat]` у категорийных пилюль, `gridTemplateColumns: repeat(${cols}, ...)` у подгрупп опросника), favicon как `data:`-URI и локальный `fetch` пользовательских markdown-справочников.

Полная рекомендуемая политика (для HTTP-заголовка при веб-публикации):

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
```

`frame-ancestors 'none'` защищает от clickjacking (эквивалент `X-Frame-Options: DENY`). По CSP-spec эта директива **игнорируется в `<meta http-equiv>`** и работает ТОЛЬКО как HTTP-заголовок — поэтому в `index.html` её нет, и при публикации за reverse-proxy (Nginx / Apache / Caddy / Cloudflare) её необходимо явно добавить.

При публикации за reverse-proxy дублируйте всю политику HTTP-заголовком — иначе часть UI не отрисуется (`style-src 'self'` без `'unsafe-inline'` сломает прогресс-бары и категорийные цвета, отсутствие `data:` в `img-src` уберёт favicon). Защита от user-input в `style:` обеспечивается архитектурным линтером [tests/unit/architecture/style-no-user-input.test.js](tests/unit/architecture/style-no-user-input.test.js), а не самой CSP.

Подробные примеры конфигурации Nginx / Apache / Caddy / Netlify / Vercel — в [HOW_TO_START.md](HOW_TO_START.md#рекомендуемая-csp).

---

## Лицензии и сторонние зависимости

### Лицензия проекта

[MIT License](LICENSE). Полный текст — в файле `LICENSE`. Использование, модификация, дистрибуция и встраивание в коммерческие продукты разрешены при сохранении copyright-notice; гарантий нет.

### Runtime-зависимости

**Никаких.** Приложение собрано на чистом ES2020+ (vanilla HTML / CSS / JS), без npm-runtime-пакетов, фреймворков, CSS-препроцессоров и сборщиков.

### Dev-зависимости

- **Node.js встроенный `node:test`** — основной unit/architecture runner (входит в Node 18+, отдельно ставить не нужно).
- **Playwright** — desktop browser-smoke для реального рендера критичных экранов.
- Unit test-runner — собственный (`tests/run.js`), не Jest / Mocha / Vitest.

### Разработка и проверки

```bash
npm test                  # весь test-suite
npm run smoke:desktop     # Playwright desktop-smoke: Dashboard / Planner / Memo / Details / Comparison
npm run syntax-check      # node --check для js/**/*.js
npm run sanity:check      # проверка актуальности SANITY_REPORT.md
npm run sanity            # пересобрать SANITY_REPORT.md
```

Архитектура держится на ES-модулях без bundler'а. Исторические entry point'ы вроде `js/app.js`, `js/ui/questionnaire.js`, `js/domain/costOptimizationPlanner.js`, `js/services/providerPriceFetch.js` сохранены как стабильные фасады; узкая логика вынесена в соседние модули (`js/app/*Actions.js`, `questionnaire*`, `dashboard*`, `costOptimizationPlanner*`, `priceImportMapping*`, `providerPriceNormalize.js`, `decisionMemoFormat.js`). Актуальная карта ownership — в [Architecture.md](Architecture.md#фасады-после-модульного-рефакторинга).

### Встроенные ресурсы

- **Иконки**: набор line-SVG из библиотеки [Lucide](https://lucide.dev) (ISC-лицензия). Используются по принципу copy-paste — иконки физически встроены в `js/ui/icons.js`, без сетевых обращений в runtime.
- **Эмодзи** в UI не используются (только line-SVG); в комментариях кода и markdown-файлах допустимы.
- **Шрифты**: системные (`-apple-system`, `Segoe UI`, `Roboto` и т.п.) + моноширинный для денежных колонок. Без подгрузки из Google Fonts.

### Источники цен

Все 36 элементов конфигурации в `js/domain/seed.js` имеют источник цены в inline-комментарии: 35 позиций с `pricePerUnit > 0` и 1 явно бесплатная позиция `traffic-ingress-tb` (входящий трафик, 0 ₽/ТБ):

- Cloud-инфраструктура (CPU/RAM/Storage/LB/WAF/Traffic) — **Cloud.ru**.
- LLM-токены и embeddings — **GigaChat 2 Pro** (Сбер).
- Email — **UniSender Go**.
- SMS / PUSH — рыночные оценки (помечены «УТОЧНИТЬ ПО ТЕКУЩЕМУ ПРАЙСУ»).
- Лицензии — Tantor SE, Red OS, Kaspersky EDR.
- Пентесты, аудиты, сертификация — медианы рынка из публичных источников (anti-malware.ru, RTM Group, BI.ZONE, ibs-qa).

Цены требуют ревизии раз в 6+ месяцев (особенно LLM, SMS). Регламент обновления — в [MAINTAINER_GUIDE.md](MAINTAINER_GUIDE.md).

### Обновление цен

Калькулятор **не делает сетевых запросов к сайтам провайдеров** (CSP `connect-src 'self'`). Runtime-цены поставляются в `js/data/providers-bundled.generated.js`; maintainer-источники лежат в `data/providers/*.json` и пересобираются командой `npm run generate:providers`. Раз в квартал maintainer обновляет эти файлы вручную; пользователи получают новые цены через **Импорт прайса JSON** в Опроснике (пользовательский workflow — в [UserManual.md → Прайс](UserManual.md#прайс)) либо автоматически после `git pull` нового bundle.

Полный регламент обновления + причины, почему автоматический парсинг сайтов провайдеров не реализован — в [MAINTAINER_GUIDE.md → Provider Price Update Workflow](MAINTAINER_GUIDE.md#1-provider-price-update-workflow).

---

## Что дальше

- Подробное руководство пользователя — в [UserManual.md](UserManual.md).
- Регламент maintainer'а (обновление прайсов, тесты, миграции) — в [MAINTAINER_GUIDE.md](MAINTAINER_GUIDE.md).
- Архитектурный обзор для разработчиков и тестировщиков — в [Architecture.md](Architecture.md).
- Журнал ключевых решений по этапам — в [DECISIONS.md](DECISIONS.md).
- Все способы запуска и troubleshooting — в [HOW_TO_START.md](HOW_TO_START.md).
- Sanity-check цифр на 3 типовых профилях продукта — в [SANITY_REPORT.md](SANITY_REPORT.md).
