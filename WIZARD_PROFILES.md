# WIZARD_PROFILES.md

Design-doc для Этапа 14: **Quick Start Wizard + Industry Matrix**.

**Статус:** черновик 2026-05-08, реализован (этапы 14.U1..14.U6 + Stage 4.5.1).

> ⚠ **Историческая терминология.** Документ написан до Stage 4.5.1 (см. DECISIONS.md), когда user-facing label провайдера ещё был «SberCloud». После Stage 4.5.1 актуальный бренд — **Cloud.ru (бывший SberCloud)** — это одна и та же платформа (ребрендинг 2024). Внутренний `providerId` остался `sbercloud` для backward-compat. Везде ниже, где упомянут «SberCloud» как бренд/label/vendor — читать как «Cloud.ru».

**Связанные документы:**
- [DECISIONS.md](DECISIONS.md) — журнал решений (запись 13.U13 про Phase 0)
- [ТЗ.md](ТЗ.md) — исходное ТЗ
- [CLAUDE.md](CLAUDE.md) — архитектурные правила проекта
- [seed.js:SEED_QUESTIONS](js/domain/seed.js#L48) — текущий каталог 89 вопросов

---

## 1. Цель

Снизить барьер входа: вместо 89 полей пользователь отвечает на **7 макро-вопросов** и получает полностью предзаполненный опросник + рабочую смету. Архитектор остаётся primary пользователем — все 89 полей видны в Опроснике, помечены бейджем «Из профиля» и доступны для override.

### Не-цели

- **НЕ** заменять детальный опросник. Wizard — добавочный entry-point, expert-mode никуда не исчезает.
- **НЕ** делать чёрный ящик. Каждое автозаполненное значение видно, имеет источник (industry profile / scale rule / default) и редактируемо.
- **НЕ** заменять архитектурную экспертизу. Wizard даёт baseline для типового сценария отрасли; для нетиповых проектов архитектор уйдёт в expert-mode сразу.

---

## 2. Семь вопросов wizard'а

| # | id | Тип | Значения | Default | Why |
|---|---|---|---|---|---|
| 1 | `wz_product_type` | select | `internal` / `b2b` / `b2c` / `b2g` | `b2b` | Драйвер архитектуры (внутренний → монолит, B2C → много RPS, B2G → compliance) |
| 2 | `wz_industry` | select | `corporate` (Корпоративные сервисы) / `edtech` / `fintech` / `consumer` (Потребительские сервисы) — 4 в MVP. Скрытые: medicine / ecommerce / govtech / media / iot | `corporate` | ВЕРТИКАЛЬ продукта (отрасль), независима от типа потребления (`product_type`). Драйвит SLA, RAG, AI-defaults, sector-compliance |
| 3 | `wz_scale` | select | `xs` (<1k) / `s` (<10k) / `m` (<100k) / `l` (<1M) / `xl` (>1M) | `m` | Драйвер всех количественных параметров (RPS, БД, vCPU, …) |
| 4 | `wz_geography` | select | `ru` / `ru_cis` / `global` | `ru` | CDN, мультирегиональность, egress-трафик |
| 5 | `wz_pdn` | boolean | `true` / `false` | зависит от p1 | Включает блок ФЗ-152 (шифрование, аудит, СЗИ, аттестация) |
| 6 | `wz_activity` | select | `low` / `medium` / `high` | `medium` | Доля активных пользователей от индустриального дефолта (×0.5 / ×1 / ×2) |
| 7 | `wz_ai_used` | boolean | `true` / `false` | `false` | Включает весь AI-блок (LLM/RAG/агенты), иначе все 26 вопросов AI = «не используется» |

### Логика дефолтов

- **`wz_pdn` default:**
  - `internal` → `false` (внутренний сервис может быть без ПДн)
  - `b2b` / `b2c` / `b2g` → `true` (всегда ФИО / контакты / часто документы)
- **`wz_activity` мнемоника:** low = «спящие пользователи, заходят раз в неделю» (CRM, отчётность); medium = «ежедневное использование» (B2B SaaS среднего профиля); high = «почасовое использование» (соцсеть, торговля, новости).

### Подсказки в UI

Каждый из 7 вопросов имеет **короткое описание** (1–2 предложения) и **пример проектов** в tooltip. Это снимает неопределённость для не-технических пользователей.

---

## 3. Scale rules (универсальные, до индустриального override)

Базовая таблица перевода `wz_scale` → числовые драйверы. **Индустриальный профиль может умножать/делить на коэффициент.**

| Параметр | xs | s | m | l | xl |
|---|---:|---:|---:|---:|---:|
| `registered_users_total` | 500 | 5 000 | 50 000 | 500 000 | 2 000 000 |
| `dau_share_of_registered_percent` * | 30 | 25 | 20 | 15 | 10 |
| `peak_rps` ** | 10 | 50 | 200 | 1 000 | 5 000 |
| `microservices_count` ** | 1 | 3 | 5 | 10 | 20 |
| `async_workers_count` ** | 1 | 2 | 3 | 5 | 10 |
| `db_count` ** | 1 | 1 | 2 | 3 | 5 |
| `db_size_initial_gb` ** | 10 | 50 | 200 | 1 000 | 5 000 |
| `db_growth_gb_month` ** | 1 | 5 | 20 | 100 | 500 |
| `db_replicas_count` ** | 0 | 1 | 1 | 2 | 3 |
| `cache_size_gb` ** | 2 | 8 | 16 | 32 | 64 |
| `email_per_month` *** | 1 000 | 10 000 | 100 000 | 1 000 000 | 5 000 000 |
| `sms_per_month` *** | 0 | 1 000 | 10 000 | 100 000 | 500 000 |
| `external_api_calls_per_month` *** | 10 000 | 100 000 | 1 000 000 | 10 000 000 | 50 000 000 |
| `traffic_egress_tb_month` *** | 0.1 | 1 | 5 | 30 | 150 |

\* Корректируется на `wz_activity`: ×0.5 / ×1 / ×2.
\*\* Корректируется на индустриальный множитель (см. §4).
\*\*\* Корректируется на `wz_geography` (global ×3 для трафика и API; ru ×1).

### Производные

- `avg_rps = peak_rps × 0.4` (типичный ratio peak/avg для большинства профилей)
- `peak_duration_hours = 4` (универсальный default — пик в часы пик)
- `peak_months = []` (выкл, кроме сезонных профилей; `wz_activity=high` + EdTech включает `[8, 9]` — back-to-school)
- `users_total = registered_users_total × 1.5` (за весь срок проекта)

### `pcu_target` — формула через индустриальный `pcu_share`

`pcu_target = registered_users_total × dau_share / 100 × pcu_share`, где `pcu_share` зависит от типа продукта (доля DAU, одновременно использующих продукт в пик):

| product_type | xs (<1k) | s (<10k) | m (<100k) | l (<1M) | xl (>1M) | Why |
|---|---:|---:|---:|---:|---:|---|
| `internal` | 30% | 25% | 20% | 15% | 10% | Внутренние сервисы — пользователи синхронизированы по рабочим часам |
| `b2b` | 4% | 5% | 5% | 4% | 3% | B2B SaaS — равномерное использование в рабочее время |
| `b2c` | 4% | 7% | 10% | 12% | 15% | B2C — вечерние пики (соцсети, развлечения, торговля); чем больше масштаб — тем выше PCU |
| `b2g` | 5% | 5% | 5% | 5% | 5% | Госсервисы — нагрузка распределённая, без острых пиков |

**Замена прежней формулы `peak_rps × 50`:** старая давала одинаковый PCU для всех типов; новая учитывает поведенческий паттерн B2C (вечерние пики выше) и масштаб (вирусность увеличивает синхронность нагрузки в больших B2C).

---

## 3.5 SLA_PRESETS — единая таблица SLA → производные параметры

SLA — это **главный драйвер** для DR-блока (RTO / RPO / DR-учения / maintenance window / георезервирование). Чтобы пользователь не настраивал 7 связанных полей вручную, фиксируем их единой таблицей. Любое изменение `sla_target` в Опроснике пересчитывает связанные поля автоматически (если они `source: 'profile'`); если поле было вручную override'нуто, оно сохраняет manual-значение.

### Таблица пресетов

| `sla_target` | `georedundancy_required` | `rto_hours` | `rpo_minutes` | `maintenance_window_hours_month` | `dr_drills_per_year` | Стандарт для |
|---:|:---:|---:|---:|---:|---:|---|
| **93–95%** | false | 24 | 1440 | 8 | 0 | Внутренние тулзы, прототипы |
| **96–98%** | false | 8 | 240 | 4 | 1 | **Стандарт для большинства отраслей** (B2B SaaS, EdTech, B2C, internal) |
| **99.0%** | false | 4 | 60 | 2 | 2 | Зрелый B2B / B2C на масштабе l+ |
| **99.5%** | false | 2 | 30 | 1 | 2 | Premium B2B SaaS; B2C с PCI/DSS |
| **99.9%** | true | 1 | 5 | 0.5 | 4 | **Стандарт для FinTech / Medicine / GovTech** |
| **99.95%** | true | 0.5 | 1 | 0 | 4 | High-availability финансовые системы |
| **99.99%** | true | 0.25 | 0.5 | 0 | 6 | Верхняя планка калькулятора (биржа, банкинг) |

### Правила применения

- **Default per industry:** B2B SaaS = `98`, EdTech = `98`, B2C = `98`, FinTech = `99.9` (см. §4).
- **Wizard:** `sla_target` доступен в детальной части Quick Start (или в Опроснике сразу после wizard'а), default — индустриальный.
- **Cascade:** при изменении `sla_target` 5 связанных полей переписываются по таблице **только если их `source !== 'manual'`**. Если пользователь раньше вручную задал `rto_hours = 0.5`, при смене SLA это значение сохраняется с пометкой «Отредактировано» и предупреждением «Не соответствует SLA-пресету».
- **Hard cap:** `sla_target > 99.99` блокируется в UI с пояснением «99.99% — верхняя планка калькулятора. Системы выше требуют индивидуального проектирования (multi-region active-active + chaos engineering)».
- **Soft warning:** SLA выше индустриального дефолта (например, B2B SaaS на 99.9%) показывает inline-warning с подсчётом дельты стоимости после пересчёта.

### Что **НЕ** управляется через `sla_target`

- `backup_retention_days` — управляется compliance (FinTech = 365, EdTech = 90, B2B SaaS = 30) и ФЗ-152, не SLA.
- `pentest_per_year`, `security_audit_per_year` — управляются compliance, не SLA.
- `realtime_required` — определяется отраслью (EdTech / FinTech / B2C high-activity), не SLA.

---

## 4. Индустриальные профили (4 шт. в MVP)

Каждый профиль — **набор overrides** поверх scale rules + **обязательные compliance-флаги**.

### 4.1 Корпоративные сервисы (`corporate`) — нейтральная база

**Семантика:** горизонтальные B2B-продукты (CRM / ERP / HR-tech / биллинг / project management). ~20% активных одновременно, плановое использование 8 часов в день.

**Типичный product_type:** `b2b` (но возможен и `internal` — внутрикорпоративный портал).

| Поле | Override | Why |
|---|---|---|
| `microservices_count` | × 1.0 | базовый ориентир |
| `db_count` | × 1.0 | базовый ориентир |
| `cache_size_gb` | × 1.0 | базовый ориентир |
| `ram_per_vcpu_ratio` | 4 | классический general-purpose |
| `hot_data_share_percent` | 30 | типичный B2B профиль |
| `file_storage_volume_tb` | 0.5 (s) / 5 (m) / 50 (l) / 200 (xl) | документы + аватары |
| `sla_target` | **98** | базовый стандарт большинства отраслей; для l/xl зрелого B2B — поднимается до 99.0 в scale-override |
| **DR-блок** (`rto_hours`/`rpo_minutes`/`georedundancy_required`/`dr_drills_per_year`/`maintenance_window_hours_month`) | по `SLA_PRESETS[98]` | Автоматически из таблицы §3.5 |
| `backup_retention_days` | 30 | типичный SaaS, не зависит от SLA |

**Compliance (флаги):** ФЗ-152 (если `wz_pdn=true`), без секторальной специфики.

**Особенность для `product_type = internal`:** corporate-вертикаль с `internal` — это внутрикорпоративный портал (HR-self-service / тикетная система / wiki). В этом случае внешние compliance-флаги, ориентированные на публичный контур, НЕ выставляются:
- `waf_required` → `false` (нет публичного периметра — сервис только в корпсети)
- `ddos_protection_required` → `false` (DDoS на внутренний сервис нерелевантен)
- `pentest_external` → `false` (только internal pentest имеет смысл, если `scale ≥ l`)
- `siem_integration_required` сохраняется через `scale ≥ l` (внутренние злоупотребления привилегиями — реальная угроза)
- ФЗ-152 + audit_logging остаются актуальными (ФИО / должности сотрудников = ПДн)

Решение принимает функция `computeCompliance(type, industry, scale, pdn)` через двойную проверку: «это публичный сервис?» (b2c/b2g/b2b ≠ internal) перед включением внешне-направленных флагов.

**Архитектура AI (если `wz_ai_used=true`):** LLM-чат как помощник пользователю (`ai_users_share=20%`, `ai_requests_per_user_day=10`, `ai_avg_input_tokens=2000`, `ai_avg_output_tokens=300`), RAG опционально (см. industry-specific override ниже).

### 4.2 EdTech (B2C-ориентированная)

**Семантика:** образовательная платформа / онлайн-курсы / репетиторство. Сезонные пики (back-to-school, экзамены), много медиа-контента.

| Поле | Override | Why |
|---|---|---|
| `microservices_count` | × 0.7 | EdTech часто на ранней стадии = монолит/мини-микросервисы |
| `cache_size_gb` | × 1.5 | контентный кэш, рендер уроков |
| `file_storage_volume_tb` | × 5.0 | видео-уроки, иллюстрации, материалы — много storage |
| `traffic_egress_tb_month` | × 2.0 | видео-стриминг |
| `hot_data_share_percent` | 50 | активные курсы — горячие данные |
| `seasonal_activity` | `true` | back-to-school + экзамены |
| `peak_months` | `[8, 9, 12]` | август-сентябрь и декабрь (зимняя сессия) |
| `sla_target` | **98** | online-сервис, но не life-critical; стандартный 98% |
| **DR-блок** | по `SLA_PRESETS[98]` | RTO=8ч, RPO=240мин, georedundancy=false, maintenance=4ч/мес, drills=1/год |
| `backup_retention_days` | 90 | образовательные данные требуют долгого хранения (госрегулирование курсов) |
| `realtime_required` | `true` | live-уроки, чаты с преподавателями |

**Compliance:** ФЗ-152 (если `wz_pdn=true`) + если `wz_pdn=true` + есть несовершеннолетние, добавить `pdn_category=2` (биометрия / дети).

**Архитектура AI:**
- `ai_users_share=40%` (AI-ассистент/проверка домашек — частая фича в современном EdTech)
- `ai_requests_per_user_day=20` (активное использование)
- `rag_needed=true` (RAG по корпусу курсов)
- `rag_corpus_size_gb=10` (xs/s) / `50` (m) / `200` (l) / `500` (xl)
- `rag_refresh_frequency=monthly` (учебные материалы редко меняются)

### 4.3 Потребительские сервисы (`consumer`) — массовый B2C

**Семантика:** соцсеть / маркетплейс / медиа-сервис / контент-платформа / геймдев / мобильное приложение для широкой аудитории. Большие объёмы UGC, вечерние пики, виральные нагрузки.

**Типичный product_type:** `b2c` (но `b2g` для массовых госсервисов тоже совместим — например, Госуслуги).

| Поле | Override | Why |
|---|---|---|
| `microservices_count` | × 1.3 | больше специализированных сервисов (feed / search / recommendation / social graph) |
| `db_count` | × 1.3 | разные хранилища под разные виды данных (профили / контент / аналитика) |
| `cache_size_gb` | × 2.0 | агрессивное кэширование контента — критично для B2C |
| `ram_per_vcpu_ratio` | 4 | стандарт |
| `hot_data_share_percent` | 60 | свежий контент = горячий |
| `file_storage_volume_tb` | × 10.0 | UGC: фото/видео/аудио — главный потребитель storage |
| `traffic_egress_tb_month` | × 5.0 | Просмотры контента, медиа-стриминг |
| `sla_target` | **98** | стандарт B2C, для l/xl зрелого — поднимается до 99.0 |
| **DR-блок** | по `SLA_PRESETS[98]` | RTO=8ч, RPO=240мин, georedundancy=false (l+ — true), drills=1 |
| `backup_retention_days` | 30 | стандартный B2C, не critical-data |
| `realtime_required` | `true` | чаты, уведомления, live-стримы |
| `peak_duration_hours` | 6 | вечерний пик длиннее (18:00–24:00) |
| `email_per_month` | × 3.0 | welcome-цепочки, retention-кампании, уведомления |
| `sms_per_month` | × 0.5 | в B2C SMS реже (push заменяет) |
| `push_per_month` | × 50.0 | push — ключевой канал retention в B2C |
| `external_api_calls_per_month` | × 2.0 | соцсети-логин, платежи, аналитика третьих лиц |

**Compliance:**
- ФЗ-152 (если `wz_pdn=true`, обычно да — пользовательские профили)
- `pdn_category=2` (фото / видео = биометрия в широком смысле)
- `waf_required=true` (B2C-публичные API — атакуемая поверхность)
- `ddos_protection_required` — `true` от scale ≥ m (вирусность ≠ DDoS, но защита нужна)
- `sso_required=true` (соц-логины — must-have для UX)
- `payment_gateway` — `true` если в продукте есть монетизация (ставим `true` от m+, иначе `false`)
- `audit_logging_required` — `true` от scale ≥ m
- `pentest_external=true` (m+), `pentest_per_year=1` (m+)

**Архитектура AI:**
- `ai_users_share=30%` (рекомендации / поиск-по-смыслу / умный фид)
- `ai_requests_per_user_day=15` (рекомендации каждое посещение)
- `rag_needed=true` (поиск по контенту)
- `rag_corpus_size_gb=20` (xs/s) / `100` (m) / `1000` (l) / `5000` (xl) — UGC корпус большой
- `rag_refresh_frequency=daily` (свежий контент должен быть индексирован сразу)
- `ai_safety_layer=true` (модерация UGC + AI-output обязательны для масс-аудитории)
- `ai_data_sensitivity='medium'`

### 4.4 Финансы / FinTech

**Семантика:** инвест-платформа, банкинг, кредиты, P2P-финансы. Critical SLA, compliance-heavy, антифрод обязателен.

| Поле | Override | Why |
|---|---|---|
| `microservices_count` | × 1.5 | финтех = много мелких сервисов с границами compliance |
| `db_count` | × 1.5 | разделение по компонентам (транзакции / профили / документы) |
| `db_replicas_count` | +1 (минимум 2) | финансовые данные требуют реплик |
| `ram_per_vcpu_ratio` | 8 | СУБД-heavy профиль (буферный пул PostgreSQL) |
| `cache_size_gb` | × 1.0 | средний кэш, основная нагрузка на БД |
| `hot_data_share_percent` | 40 | активные транзакции — горячие |
| `sla_target` | **99.9** | financial-grade SLA (стандарт для критичных отраслей) |
| **DR-блок** | по `SLA_PRESETS[99.9]` | RTO=1ч, RPO=5мин, georedundancy=true, maintenance=0.5ч/мес, drills=4/год |
| `backup_retention_days` | 365 | банковский стандарт хранения транзакций |
| `realtime_required` | `true` | биржевые данные / уведомления |
| `email_per_month` | × 2.0 | OTP-коды, выписки, уведомления |
| `sms_per_month` | × 5.0 | OTP — ключевой канал в финтехе |

**Compliance (всё `true`):**
- ФЗ-152 + `pdn_category=2`
- `fstec_certification_required=true`
- `waf_required=true`
- `ddos_protection_required=true`
- `siem_integration_required=true`
- `dlp_required=true`
- `audit_logging_required=true`
- `payment_gateway=true` (если карты)
- `antifraud_required=true`
- `pentest_external=true`, `pentest_internal=true`, `load_test_before_prod=true`
- `pentest_per_year=2` (минимум полугодовые)
- `security_audit_per_year=1`
- `iso_27001_required=true` (для серьёзных платформ)
- `encryption_at_rest=true`

**Архитектура AI:**
- `ai_users_share=15%` (антифрод-модель + опционально клиентский LLM)
- `ai_safety_layer=true` (модерация финансовых рекомендаций обязательна)
- `ai_data_sensitivity='high'`
- `rag_needed=true` (база регламентов / FAQ)
- `rag_corpus_size_gb=5` (xs/s) / `20` (m) / `100` (l) / `300` (xl) — меньше чем EdTech, но обязательно
- `rag_refresh_frequency=weekly` (обновления в регламентах быстрее реагируют)

---

## 5. Compliance-флаги (matrix)

Сводная таблица — какие compliance-вопросы автоматически выставляются `true` от профиля:

| Флаг | Corporate | EdTech | Consumer | FinTech |
|---|:---:|:---:|:---:|:---:|
| `pdn_152fz` | если `wz_pdn` | если `wz_pdn` | если `wz_pdn` | всегда |
| `pdn_category` | 3 | 2 (если несоверш.) / 3 | 2 (UGC = биометрия в широком смысле) | 2 |
| `fstec_certification_required` | — | — | — | ✓ |
| `iso_27001_required` | — | — | — | ✓ |
| `encryption_at_rest` | если `wz_pdn` | если `wz_pdn` | если `wz_pdn` | ✓ |
| `waf_required` | scale ≥ m | scale ≥ s | ✓ (всегда — B2C публичные API) | ✓ |
| `ddos_protection_required` | scale ≥ l | scale ≥ m | scale ≥ m | ✓ |
| `siem_integration_required` | scale ≥ l | — | scale ≥ l | ✓ |
| `dlp_required` | — | — | — | ✓ |
| `audit_logging_required` | scale ≥ m | scale ≥ m | scale ≥ m | ✓ |
| `sso_required` | scale ≥ m | — | ✓ (соц-логины) | scale ≥ m |
| `payment_gateway` | scale ≥ l (subscriptions) | — | scale ≥ m (монетизация) | ✓ |
| `pentest_external` | scale ≥ m | scale ≥ s | scale ≥ m | ✓ |
| `pentest_internal` | scale ≥ l | — | scale ≥ l | ✓ |
| `load_test_before_prod` | scale ≥ m | scale ≥ m | scale ≥ m | ✓ |
| `pentest_per_year` | 1 (m+) | 1 (s+) | 1 (m+) | 2 |
| `security_audit_per_year` | 1 (m+) | 0 | 1 (m+) | 1 |

**Правило:** флаги DDoS, SIEM, DLP, audit logging, AI safety и fine-tune уже имеют бюджетные ЭК и должны менять Детализацию. Если wizard выставляет новый compliance-флаг без ЭК (например SSO / payment / antifraud / TURN), он обязан явно пометить его как информационный до появления формулы, чтобы пользователь не принял флаг за учтённый бюджет.

---

## 5.1 Product-type overrides (вторая ось)

Поверх отраслевых дефолтов накладываются правки **от типа потребления** (`product_type`). Они независимы от индустрии и описывают «как пользователь взаимодействует с продуктом» — каналы коммуникации (push/sms/email), длительность пика, периметр compliance.

### Таблица overrides

| Параметр | `internal` | `b2b` | `b2c` | `b2g` |
|---|---|---|---|---|
| `peak_duration_hours` | 4 (рабочие часы) | 4 (bizhrs) | **6** (вечерние пики 18-24) | 6 (распределённая нагрузка) |
| `audience_geography` (default) | `ru` (внутренний контур) | wizard | wizard | `ru` (госуслуги — российский периметр) |
| **email** ×множитель | × 0.5 (меньше уведомлений) | × 1.5 | **× 3.0** (welcome + retention) | × 2.0 (госуведомления) |
| **sms** ×множитель | × 0.1 | × 0.5 | × 0.5 (push заменяет) | × 2.0 (госСМС) |
| **push** ×множитель | × 0.5 | × 1.0 | **× 50** (ключевой канал retention) | × 0.5 |
| **external_api_calls** ×множитель | × 1.0 | × 1.0 | × 2.0 (соц-логины + платежи + аналитика) | × 1.0 |
| `waf_required` | **false** (нет публичного периметра) | от scale ≥ m | **true** (всегда — публичный сервис) | **true** (госуслуги — публичный контур) |
| `sso_required` | от scale ≥ m | от scale ≥ m | **true** (соц-логины) | от scale ≥ m |
| `audit_logging_required` | от scale ≥ m | от scale ≥ m | от scale ≥ m | **true** (всегда — гос-аудит) |
| `pdn_152fz` | если `wz_pdn` | если `wz_pdn` | если `wz_pdn` | **true** (всегда) |
| `fstec_certification_required` | если industry=fintech | если industry=fintech | если industry=fintech | **true** (всегда) |
| `encryption_at_rest` | если `wz_pdn` | если `wz_pdn` | если `wz_pdn` | **true** (всегда) |
| `georedundancy_required` | от SLA-пресета | от SLA-пресета | от SLA-пресета | **true** (всегда — гос-резерв) |

### Семантика

- **`internal`** — внутрикорпоративный сервис в корпсети. Внешние compliance-флаги (waf, ddos, pentest_external) **отключаются жёстко**, кроме случаев когда industry-матрица дополнительно поднимает их (например, FinTech-internal — внутренний банковский портал — всё равно требует waf+ddos из-за compliance уровня вертикали).
- **`b2b`** — стандартный business-to-business путь. Большинство флагов compliance — от индустрии × масштаба × `wz_pdn`.
- **`b2c`** — массовый потребительский продукт. **Жёстко включаются:** WAF (атакуемый периметр), SSO (соц-логины как UX-обязательство). Каналы communication смещены на push (×50) от sms.
- **`b2g`** — госуслуги. **Жёстко включаются:** ФСТЭК-аттестация, ФЗ-152, encryption_at_rest, audit_logging, georedundancy. Геогр. — `ru` (нельзя global для гос-данных).

### Пересечение с industry compliance

Финальный compliance = логическое **ИЛИ** между industry-флагами (§5) и product-type overrides (§5.1). Если оба требуют флаг — он включается. Если только один — тоже. Это даёт конкретные сочетания:

- `b2b × corporate × m × pdn=true` → ФЗ-152 + audit (m+) + WAF (m+) + pentest_ext (m+) — стандарт SMB
- `b2c × corporate × m × pdn=true` → всё то же + WAF (от type) + SSO (от type) + push×50 (от type)
- `internal × fintech × xs × pdn=false` → ФСТЭК + ФЗ-152 + WAF + DDoS + SIEM + DLP (всё от industry, type не отключает финтех-compliance)
- `b2g × corporate × s × pdn=любое` → ФСТЭК + ФЗ-152 + audit + WAF + georedundancy + encryption (от type), даже если industry не требует

Логика: **type определяет ПЕРИМЕТР** (публичный / внутренний / государственный), **industry определяет СПЕЦИФИКУ ВЕРТИКАЛИ** (банковские стандарты / образовательные стандарты / etc.). Они дополняют друг друга через ИЛИ, не заменяют.

---

## 6. Provider-overlay

### 6.1 Провайдеры в MVP

| ID | Имя | Статус в MVP |
|---|---|---|
| `sbercloud` | SberCloud | Active (default) |
| `cloud_ru` | Cloud.ru | Stub («скоро», disabled) |
| `yandex` | Yandex.Cloud | Stub («скоро», disabled) |
| `vk` | VK.Cloud | Stub («скоро», disabled) |
| `onprem` | On-prem | Stub («скоро», disabled) |

UI: серый dropdown `Провайдер` с активным `SberCloud`, остальные disabled с `title="Поддержка добавится в следующих релизах"`.

### 6.2 SberCloud price overlay

Текущие `pricePerUnit` в seed.js — микс Cloud.ru / Yandex / GigaChat / медианы. Для MVP заменяем на SberCloud-specific. Проект cloud-овской услуги → mapping:

| ЭК | SberCloud-сервис | Цена-ориентир (₽/мес) |
|---|---|---|
| `cpu-vcpu-shared` | SberCloud Compute Shared | TBD по тарифу 2026-Q2 |
| `cpu-vcpu-dedicated` | SberCloud Compute Dedicated | TBD |
| `ram-gb` | SberCloud RAM | TBD |
| `storage-ssd-tb` | SberCloud Block Storage SSD | TBD |
| `storage-hdd-tb` | SberCloud Block Storage HDD | TBD |
| `storage-object-tb` | SberCloud Object Storage | TBD |
| `network-lb-l7` | SberCloud Application Load Balancer | TBD |
| `network-waf` | SberCloud Web Application Firewall | TBD |
| `traffic-egress-tb` | SberCloud egress | TBD |
| `llm-tokens-input-1m` | GigaChat (через SberCloud) | 0.0015 ₽/1К ввод |
| `llm-tokens-output-1m` | GigaChat | 0.0030 ₽/1К вывод |
| `rag-embeddings-1m` | GigaChat Embeddings | 0.01 ₽/1К |
| `rag-vector-db-gb` | SberCloud Managed Search | TBD |

**Источник цен:** актуальный SberCloud price list на дату релиза. **Перед стартом реализации запросить у пользователя**: имеется ли документ с тарифами SberCloud, или брать с публичной страницы https://cloud.ru/services?

### 6.3 Архитектура provider-overlay в коде

В seed.js остаётся **базовая** цена. Добавляется новый файл `js/domain/providerOverlay.js`:

```js
// js/domain/providerOverlay.js
export const PROVIDER_OVERLAYS = Object.freeze({
    sbercloud: {
        label: 'SberCloud',
        active: true,
        prices: {
            'cpu-vcpu-shared': { pricePerUnit: 800, source: 'cloud.ru/services 2026-05', vendor: 'SberCloud' },
            'cpu-vcpu-dedicated': { pricePerUnit: 920, source: '...', vendor: 'SberCloud' },
            // ...
        }
    },
    cloud_ru: { label: 'Cloud.ru', active: false, prices: {} },
    yandex:   { label: 'Yandex.Cloud', active: false, prices: {} },
    vk:       { label: 'VK.Cloud', active: false, prices: {} },
    onprem:   { label: 'On-prem', active: false, prices: {} }
});

export function applyProviderOverlay(items, providerId) {
    const overlay = PROVIDER_OVERLAYS[providerId];
    if (!overlay || !overlay.active) return items;
    return items.map(item => {
        const override = overlay.prices[item.id];
        return override ? { ...item, ...override } : item;
    });
}
```

`calc.settings.provider` хранит выбранный ID (default `'sbercloud'`). Calculator применяет overlay перед расчётом.

---

## 7. Locked / unlocked поля + UI бейджи

### 7.1 Маркировка

В `calc.answers[id]` добавляется параллельный объект `calc.answersMeta[id]`:

```js
{
    source: 'profile' | 'scale' | 'manual' | 'default',  // откуда пришло значение
    profileId: 'fintech' | 'edtech' | 'b2b_saas' | null,
    locked: false  // никогда true в MVP — все поля редактируемы
}
```

UI: рядом с полем — мини-бейдж:
- 🟢 «Из профиля» (FinTech) — заполнено wizard'ом
- 🔵 «Из масштаба» (M-сценарий) — рассчитано scale rule
- ⚪ «Вы изменили» — переопределено вручную
- (без бейджа) — default из seed.js

При клике «Сбросить» рядом с полем — возврат к profile-значению (или default).

### 7.2 Что НЕ заполняется wizard'ом

Wizard заполняет только **критичные драйверы стоимости** (58 полей из 89 для стандартного B2B-профиля без AI). Остальные оставляются на defaults из seed.js, доступны в expert-mode. Точное число привязано к acceptance-тесту [tests/integration/wizard-to-answers-b2b-acceptance.test.js](tests/integration/wizard-to-answers-b2b-acceptance.test.js) — если матрица заполнения меняется, обновите эту строку.

**Заполняется** (58 для B2B-standard):
- Все `business` (кроме `seasonal_activity`/`peak_months` — только для EdTech)
- Все `load_profile`
- Все `data_storage`
- Все `sla`
- Все `security` compliance-флаги
- Большинство `integrations` (email/sms/api/sso по profile)
- Все `testing`
- Все `ai_llm` если `wz_ai_used=true` (+ ещё полей при включённом AI)

**НЕ заполняется** (31 для B2B-standard):
- Все `budget` (target_capex, target_opex, launch_year, schedule_shift) — это плановые, остаются default
- AI-агенты (`ai_agent_mode`, `agent_*`) — слишком специфично, оставляем `false`/default
- `ai_finetune_*` — оставляем `false`

**Решение по AI при `wz_ai_used = false` (зафиксировано):**

Если в Quick Start пользователь выбрал «AI не используется» — **никакие AI-defaults не подтягиваются вообще**. Все 26 AI-вопросов остаются без значений (фактически `null` / unset). Если пользователь позже вручную включит `ai_llm_used=true` в детальном Опроснике, **AI-секция стартует пустой**, и пользователь сам заполняет параметры. Это честно (никаких скрытых дефолтов из «спящего» wizard'а) и предотвращает путаницу — если бы дефолты были заранее заполнены, пользователь мог бы получить смету с AI-расходами, не понимая, откуда они взялись.

`ai_safety_layer` (для FinTech / Consumer) — выставляется `true` ТОЛЬКО если `wz_ai_used=true`, синхронно с включением остальных AI-полей.

### 7.3 Reset-механика

Добавляется кнопка «Применить профиль заново» в Опроснике (выпадающее меню рядом с экспортом). Это перезаписывает `answers` значениями текущего профиля + scale rule, **сохраняя только поля с `source: 'manual'`**, если пользователь выбрал «Сохранить мои правки». Иначе — полный wipe и переприменение.

---

## 8. Schema migration plan

Новые поля в `calc`:
- `calc.wizard` — объект `{ product_type, industry, scale, geography, pdn, activity, ai_used }` (опциональный, наполняется только если расчёт создан через wizard)
- `calc.answersMeta` — параллель к `calc.answers`, описывает источник каждого значения
- `calc.settings.provider` — `'sbercloud'` (default), будущее расширение

**Миграция v12→v13:**
- legacy-расчёты получают `calc.wizard = null` (сценарий «создан вручную в expert-mode»)
- `calc.answersMeta = {}` (все поля показываются БЕЗ бейджа — историческая совместимость)
- `calc.settings.provider = 'sbercloud'` (default для новых, но также для legacy — это base price)

**Версия:** `LATEST_SCHEMA_VERSION` 12 → 13.
**APP_VERSION:** 1.6.0 → 1.7.0 (MINOR, новая видимая фича + миграция).

---

## 9. UI flow

### 9.1 Пути входа

```
[Empty state «Расчёты»]
    ├─ ▶ «Quick Start» (новый, default-CTA)         ──► [Wizard]  ──► [Опросник + дашборд]
    └─ «Создать пустой расчёт» (вторичный)           ──► [Опросник пустой] (для архитектора)
```

### 9.2 Wizard layout

7 шагов на одной странице (длинная вертикальная форма) или 7 экранов с stepper'ом? **Рекомендую: одна страница с группировкой 2-2-3** для скорости заполнения. Stepper'ы хороши для длинных форм, для 7 полей это overkill.

```
[ Quick Start                                                         ]
[ Расскажите о проекте — ответы определят базовые параметры расчёта.  ]
[                                                                     ]
[ 🎯 Тип и аудитория                                                 ]
[   Тип продукта         [B2B SaaS ▾]  ?                            ]
[   Отрасль              [Финансы ▾]   ?                            ]
[                                                                     ]
[ 📊 Масштаб                                                          ]
[   Размер аудитории     [До 100 тыс ▾] ?                            ]
[   Активность           [Средняя ▾]    ?                            ]
[                                                                     ]
[ 🌍 Контекст                                                         ]
[   География            [Россия ▾]     ?                            ]
[   Персональные данные  [✓ Да]         ?                            ]
[   Используется AI      [✗ Нет]        ?                            ]
[                                                                     ]
[ Провайдер             [SberCloud ▾]                                ]
[                                                                     ]
[              [ ◀ Назад ]      [ Создать расчёт ▶ ]                ]
```

### 9.3 После «Создать расчёт»

1. Рассчитывается `answers` по матрице.
2. Создаётся новый calc (`commitNewCalc`).
3. Откладывается `calc.wizard = { ... }` и `calc.answersMeta`.
4. Пользователь автоматически переводится на дашборд.
5. Сверху дашборда — баннер: «Расчёт создан из профиля **B2B SaaS · 100 тыс. · Россия**. Чтобы изменить параметры, перейдите в **Опросник**.»

### 9.4 Опросник после wizard'а

- Каждое поле — мини-бейдж источника (🟢 / 🔵 / ⚪).
- В шапке Опросника — кнопка **«Применить профиль заново»** (с подтверждением).
- Если пользователь меняет поле, бейдж переключается на «Вы изменили» и сохраняется как `source: 'manual'`.

---

## 10. План реализации (после утверждения этого документа)

### Спринт 1 (3–4 дня)

1. **Структуры данных:**
   - `js/domain/wizardProfileData.js` — frozen-таблицы 4 profile'ов (corporate / edtech / fintech / consumer) + scale rules + product-type overrides
   - `js/domain/wizardProfiles.js` — pure API `wizardToAnswers` / `computeCompliance` поверх profile data
   - `js/domain/providerOverlay.js` — overlay-механизм
   - Schema bump v13 + миграция (legacy `wizard=null`, `answersMeta={}`)
2. **Engine:**
   - `wizardToAnswers(wizardInput) → { answers, answersMeta }` (pure-функция, тестируемая)
   - `applyProviderOverlay(items, providerId) → items` (pure-функция)
   - `computeCompliance({ product_type, industry, scale, pdn })` → флаги безопасности
3. **Тесты:**
   - 4 профиля × 5 масштабов × 4 типа = 80 базовых кейсов; полный smoke 2880 комбинаций
   - Smoke: `wizardToAnswers` для каждой комбинации не падает + даёт финитные числа в формулах
   - Migration v12→v13 (8 кейсов: legacy без wizard, идемпотентность, валидация, не перезаписывает существующие)

### Спринт 2 (3–4 дня)

4. **UI Wizard:**
   - `js/ui/wizard.js` — рендер 7 полей
   - `js/controllers/wizardController.js` — handle submit
   - CSS: добавить стили в `forms.css` (используем существующий design-system)
5. **Empty state:**
   - Заменить primary CTA «Новый расчёт» на «Quick Start», secondary — «Создать пустой расчёт»
6. **Опросник:**
   - Бейджи источника рядом с полями
   - Кнопка «Применить профиль заново»
7. **Дашборд:**
   - Баннер «Расчёт из профиля X» с возможностью свернуть

### Спринт 3 (1–2 дня) — провайдер + полировка

8. **Provider dropdown:**
   - В Опроснике добавить dropdown «Провайдер» (только SberCloud active)
   - Показать stub'ы для остальных
9. **SberCloud price list:**
   - Заполнить overlay реальными тарифами SberCloud
10. **Browser-проверка** + screenshot'ы + DECISIONS.md запись.

**Итого: 8–10 рабочих дней при последовательной работе.** Параллелить можно UI (спринт 2.4–2.7) и SberCloud overlay (3.8–3.9).

---

## 11. Открытые вопросы

### Закрыто пользователем (2026-05-08)

- ✅ **Q2 (отрасли в MVP):** активны 4 — B2B SaaS / EdTech / FinTech / **B2C**. Остальные 5 (Медицина / E-commerce / Госсектор / Медиа / IoT) — **скрыты** до следующих релизов.
- ✅ **Q7 (`pcu_target`):** перешли на индустриальный `pcu_share` (см. §3 «Производные»). Для B2C: 4/7/10/12/15% по масштабам.
- ✅ **Q8 (Object Storage классы):** в MVP — стандарт-класс. Cold-tier и архив добавим, когда появятся реальные кейсы.
- ✅ **SLA-логика (новое решение):** введены `SLA_PRESETS` (см. §3.5). 98% — стандарт большинства отраслей; 99.9% — стандарт критичных (FinTech / Medicine / GovTech); 99.99% — верхняя планка калькулятора. Все DR-параметры (RTO, RPO, georedundancy, maintenance, drills) выводятся из SLA автоматически через таблицу. Manual-override полей сохраняется при пересчёте.

### Требуют ответа до старта Спринта 2 (UI)

1. **SberCloud price list:** есть ли у вас официальный документ с тарифами SberCloud на 2026-Q2, или берём с публичного сайта cloud.ru/services? От этого зависит точность стартовой сметы.
2. **Empty state CTA:** «Quick Start» как primary, «Создать пустой расчёт» как secondary — устраивает? Альтернатива: оставить «+ Новый расчёт» как primary (привычный архитектору), «Quick Start» — secondary с иконкой «волшебной палочки».
3. **Re-application semantics:** «Применить профиль заново» — стереть все ручные правки или сохранить с пометкой? **Default = с подтверждением: «Вы изменили N полей. Сохранить эти правки или сбросить?»**
4. **`wz_pdn` для `internal`:** default `false`. Но если внутренний инструмент содержит ФИО сотрудников — формально ПДн обрабатываются. Делаем default `false` (доверяем пользователю) или `true` (conservative)?
5. **Валидация AI-блока:** если `wz_ai_used=false`, все 26 AI-вопросов получают значения «выключено / 0». Если позже пользователь включит `ai_llm_used` вручную — нужны ли разумные defaults? **Предложение:** подтянуть AI-defaults даже при `wz_ai_used=false` (чтобы при включении в Опроснике сразу был рабочий AI-сценарий с industrial-tuning).

---

## 12. Готовность к ревью

После утверждения этого документа:
- Зафиксировать ответы на §11 (8 открытых вопросов)
- Создать DECISIONS.md запись «14.U1 — Wizard + Industry Matrix start»
- Стартовать Спринт 1

**Ожидаемое время на ревью + правки:** 0.5–1 день. После — implementation 8–10 рабочих дней.

---

## 13. Provider-overrides / Overlay reference (этап 14.U4)

Настройки provider'а — **независимая** ось от индустриального профиля. Wizard НЕ выбирает provider среди 7 макро-вопросов: дефолт всегда `sbercloud`, явный выбор — через dropdown в Опроснике.

### 13.1 Хранение

| Поле | Тип | Источник | Назначение |
|---|---|---|---|
| `calc.settings.provider` | `string` | wizard / manual | ID активного провайдера. Default `sbercloud`. |
| `calc.settings.providerSetByWizard` | `boolean` | wizard / manual | `true` — provider пришёл из Quick Start; `false` — manual через dropdown. Только для UI-бейджа. |

**НЕ используется** `calc.answers.provider` или `calc.answersMeta.provider` — provider не является ответом на вопрос Опросника, это глобальная настройка расчёта (как `vatEnabled`, `applyRiskFactors`).

### 13.2 Контракт изменения

| Действие | Эффект на `provider` | Эффект на `providerSetByWizard` |
|---|---|---|
| `createCalc(name)` | `'sbercloud'` | `false` (manual default) |
| `createCalcFromWizard(name, w)` | `'sbercloud'` | `true` |
| `setProvider('yandex')` (UI) | `'yandex'` | `false` (любая ручная правка) |
| `resetAnswers()` | без изменений | без изменений |
| Re-apply profile (14.U5, оба режима) | **без изменений** | **без изменений** |

**Ключевой инвариант 14.U5:** ни `preserve`, ни `overwrite` режим re-apply'а НЕ трогают `provider`. Wizard производит answers, не settings. Если пользователь выбрал Yandex.Cloud вручную — повторное применение профиля сохранит этот выбор. Хотим начать с чистого листа — есть `setProvider('sbercloud')` в Опроснике (бейдж после этого станет «Вы изменили», а не «Из мастера», но это корректно — выбор был сделан вручную).

### 13.3 Текущий каталог провайдеров

Полный список — в [providerOverlay.js: PROVIDER_OVERLAYS](js/domain/providerOverlay.js).

| ID | Label | Active в MVP | Описание |
|---|---|---|---|
| `sbercloud` | SberCloud | ✅ | Цены 2026-Q2 (заполнение в этапе 14.U6) |
| `cloud_ru` | Cloud.ru | ❌ stub | «(скоро)» в UI |
| `yandex` | Yandex.Cloud | ❌ stub | «(скоро)» в UI |
| `vk` | VK.Cloud | ❌ stub | «(скоро)» в UI |
| `onprem` | On-premises (CAPEX-модель) | ❌ stub | «(скоро)» в UI |

**Stub-провайдеры в dropdown отображаются как `disabled`-опции** с пометкой «(скоро)» — пользователь видит roadmap.

### 13.4 Применение overlay

`applyProviderOverlay(items, providerId)` ([providerOverlay.js](js/domain/providerOverlay.js)) перед расчётом подменяет `pricePerUnit` (и метаданные `vendor`, `priceSource`) для item'ов, перечисленных в `PROVIDER_OVERLAYS[providerId].prices`. Если provider не active или prices пустой — items возвращаются без изменений (silent fallback на seed-defaults).

**Текущее состояние (14.U4):** `PROVIDER_OVERLAYS.sbercloud.prices = {}` → overlay никого не подменяет. Реальные тарифы наполняются в этапе 14.U6.

### 13.5 Расширение каталога

Добавление нового провайдера:
1. Новый объект в `PROVIDER_OVERLAYS` с `active: true` и заполненным `prices`.
2. Опционально — короткая label-метка в UI (helper text не требуется править).
3. Тест: для каждого item-id в `prices` проверить, что seed item с таким id существует.

Полная таблица цен зеркалит структуру seed item — каждая запись содержит `pricePerUnit`, опционально `vendor` и `priceSource`. Spread-merge в `applyProviderOverlay`: `{ ...seedItem, ...overlayPriceEntry }` — overlay переопределяет поля, остальные (formula, applicableStands, dashboardResource) остаются из seed.

### 13.6 SberCloud price overlay (этап 14.U6 — текущее состояние)

**Состояние (2026-05-08):** `PROVIDER_OVERLAYS.sbercloud` содержит 14 ЭК с публичными тарифами `cloud.ru/services 2026-Q2`.

| Категория | item.id | ₽ за единицу |
|---|---|---|
| CPU | `cpu-vcpu-shared` | 840 ₽/мес |
| CPU | `cpu-vcpu-dedicated` | 550 ₽/мес |
| GPU | `cpu-vcpu-gpu` | 14 400 ₽/мес |
| RAM | `ram-gb` | 226 ₽/ГБ/мес |
| Storage | `storage-ssd-tb` | 12 378 ₽/ТБ/мес |
| Storage | `storage-hdd-tb` | 4 111 ₽/ТБ/мес |
| Storage | `storage-object-tb` | 1 883 ₽/ТБ/мес |
| Network | `network-lb-l7` | 1 691 ₽/мес |
| Network | `network-waf` | 5 000 ₽/мес |
| License | `license-db-per-vcpu` | 167 000 ₽/мес |
| License | `license-os-per-node` | 30 000 ₽/мес |
| License | `license-siem-edr-per-node` | 2 486 ₽/мес |
| Service | `service-email-per-1k` | 100 ₽/1000 |
| Service | `service-sms-per-1k` | 50 ₽/1000 |

**Подключение:** `applyProviderOverlay(items, providerId)` вызывается первым шагом в `calculator.js: calculate()` перед основным циклом. Все consumer'ы (Дашборд / Детализация / Сравнение / PDF / CSV) автоматически получают provider-aware цены — единый источник истины.

**Re-apply (14.U5) НЕ трогает provider** (см. §13.2) — текущий выбор provider'а сохраняется через все режимы re-apply'а, manual-правки в `calc.settings.provider` не сбрасываются.

**Quick Start (14.U1)**: при создании нового расчёта default provider = `'sbercloud'`, флаг `providerSetByWizard = true` (см. 14.U4).

**Линтер**: [provider-overlay-coverage.test.js](tests/unit/architecture/provider-overlay-coverage.test.js) проверяет, что каждый ключ в `prices` существует в `SEED_ITEMS.id`. При переименовании item.id в seed.js — тест укажет, что overlay устарел.

**UI mini-summary**: компактная сводка топ-3 цен (vCPU/RAM/SSD) отображается под dropdown'ом провайдера в Опроснике. Tooltip содержит полный список 14 цен. Sanity-check для пользователя «какой набор тарифов реально подставится».
