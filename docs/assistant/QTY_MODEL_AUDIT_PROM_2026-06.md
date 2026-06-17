# Аудит qty-модели ПРОМ и план доработки (2026-06)

Статус: аудит завершён, scope-решения зафиксированы в
[DECISIONS.md](DECISIONS.md) («ПЛАН: Доработка qty-модели ПРОМ»).

## Методология

- Детерминированный дамп всех `SEED_ITEMS`/`SEED_QUESTIONS`/`SEED_SETTINGS`:
  PROD-формулы, ссылки `Q.*`/`S.*` по всем стендам, магические числа,
  cross-reference существования вопросов/настроек.
- Параллельный аудит через Workflow (10 субагентов: 8 зон + покрытие опросника +
  инвентаризация health-checks).
- **Верификация каждой находки** по `file:line` против кода. Отбраковка
  false-positive. Скрипт-проверки `quantity:audit:check` / `sanity:check` /
  `prices:freshness:check` — зелёные на момент аудита.

## Ground truth (на 2026-06-17)

- ЭК в справочнике: 63 (61 с PROD-формулой; 2 — LOAD-only: `one-load-test-*`).
- Вопросов: 90. **Мёртвых (нигде не используемых): 0** — 82 в формулах (вкл.
  LOAD-only), 5 через производные `S.*` в `calculator.js`
  (`ai_model_tier→aiModelTierFactor`, `agent_complexity`/`ai_agent_type`/
  `agent_parallel_specialists`→`agentStepFactor`, `agent_tool_use_share`→
  `agentToolFactor`), 3 информационных для guardrails/НДС (`target_capex_rub`,
  `target_opex_monthly_rub`, `launch_year`).
- DSL ([parser.js](../../js/domain/formula/parser.js)): формула читает только
  `Q.*` и `S.*`; **не может** ссылаться на qty другого ЭК (нет цикла/самоссылки).
- LLM-токены имеют операционный fallback в
  [calculator.js:484-503](../../js/domain/calculator.js#L484-L503) — любая правка
  формул токенов ОБЯЗАНА зеркалиться там.

## Подтверждённые находки (после верификации)

| Зона | Sev | ЭК / место | Суть (подтверждено) |
|---|---|---|---|
| RAG | P1 | `rag-vector-db-gb` [seed.js:3934-3938](../../js/domain/seed.js#L3934), `rag-managed-knowledge-base-gb` [3963-3967](../../js/domain/seed.js#L3963) | Размер хранилища умножается на `max(1, retrieval_calls/4)`. Storage ≠ f(частота поисков); противоречит собств. описанию «1 млн эмбеддингов × 4 КБ ≈ 4 ГБ». → убрать множитель |
| RAG | P2 | `rag-embeddings-1m` [3906](../../js/domain/seed.js#L3906) vs `rag-vector-db-gb` [3937](../../js/domain/seed.js#L3937) | Десинхрон: токены эмбеддингов от `corpus_size_gb`, размер vector-DB от независимого `rag_embeddings_million`. → авто-расчёт из corpus + override + health |
| RAG | P2 | `rag-embeddings-1m` [3903-3907](../../js/domain/seed.js#L3903) | `realtime == daily == ×30`; нет параметра доли корпуса за цикл (delta %). → realtime=дельта + параметр delta% (default 100%) |
| RAG | P3 | `rag-embeddings-1m` коммент [3874](../../js/domain/seed.js#L3874) | 200 млн токенов/ГБ — обосновано (~4 байта/токен), defensible worst-case. Оставить + пометить «оценка» |
| RAG | P2 | `rag-*` гейт `ai_hosting_mode != "on_prem_gpu"` | Допущение: on-prem embeddings бесплатны. → пометить допущением |
| LLM | P1 | `llm-tokens-input-1m` [seed.js:3895+](../../js/domain/seed.js) | RAG-контекст не добавляется к input-токенам (фикс avg). → опц. множитель RAG-контекста |
| LLM | P2 | input/output формулы | Токены не разложены (system/история/RAG/tool-use/output/caching). → опц. детальный режим |
| LLM | P2 | `ai-safety-moderation-tokens-1m` (10% overhead) | Placeholder. → параметр `ai_safety_overhead_percent` 0–50%, default 10% |
| CPU | P2 | `cpu-vcpu-shared` [2762-2766](../../js/domain/seed.js#L2762), gpu `/5000`, sandbox `/0.3` | Эвристики 50/200/5000/0.3 без расширенной модели. → опц. cpu_ms/запрос, target_util 65%, min_instances |
| CPU | P2 | realtime `+1 vCPU` [2762](../../js/domain/seed.js#L2762) | Фикс, не масштабируется. → `ceil(PCU/1000)` |
| RAM | P2 | `ram-gb` [2850-2854](../../js/domain/seed.js#L2850) | Нет app-baseline / RAM на realtime-соединение. *(двойной учёт cache — уже исправлен в 13.U13)* → опц. параметры |
| Storage | P2 | `storage-ssd/hdd-tb` [2880-2922](../../js/domain/seed.js#L2880) | Магические 0.10/0.5/0.00005; нет индексов/WAL/compression/dedup/versioning. → дефолты ×1.3 / +10% / ÷2 + параметризовать |
| Security | P2 | `security-audit-log-storage-gb` [3356](../../js/domain/seed.js) | Считается от объёма БД ×0.15, не от событий/день. → опц. точная модель + пометка fallback |
| Security | P2 | WAF/SIEM/DLP `if(flag,1,0)` | 1 контур без масштаба. → опц. масштаб или пометка «оценочная статья» |
| DR | P1 (арх.) | `res-georedundancy`/`res-dr-active` [seed.js:4307+](../../js/domain/seed.js) | Не масштабируется с ПРОМ (fixed qty). → производные `S.prodComputeVcpu/RamGb/StorageTb` + DR mode + % от ПРОМ |
| Project | P2 | `one-deployment` [4231](../../js/domain/seed.js) | const 1, нет маркера «проектная работа». → маркер + классификатор ЭК |
| Project | P2 | `one-seasonal-load-readiness` [3129](../../js/domain/seed.js#L3129) | `max(1, count(peak_months))` без cap (12 мес = 12 циклов). → cap 4 |
| Health | P2 | [calculationHealthChecks.js](../../js/domain/calculationHealthChecks.js) | Есть ~19 проверок; отсутствуют: AI-вкл-но-нет-demand, RAG corpus↔embeddings mismatch, backup-retention-без-HDD, CPU>0-RAM=0 |

## Отбраковано (false-positive — намеренный дизайн)

| Пункт субагента | Почему отбраковано |
|---|---|
| «5 двойных счётов» SIEM/DLP/SSO/antifraud/EDO | Намеренный CAPEX/OPEX силос: oneTime + monthly/annual (проверено `billingInterval`). SIEM 350k+50k/мес, DLP 1M+1.5M/год, SSO 600k+50k/мес, antifraud 700k+1M/год, EDO 600k+50k/год |
| `load_test_*` — «unused» | Используются в `one-load-test-prelaunch` [4111](../../js/domain/seed.js#L4111), `one-load-test-regular` [4135](../../js/domain/seed.js#L4135) (LOAD-only). *(Первый дамп ошибочно парсил только PROD — исправлено.)* |
| `storage-secure-gb` PROD без `standSizeRatio` | By design: PROD ratio=1 (no-op); все PROD-формулы опускают множитель |
| `cache_size_gb` двойной учёт RAM+SSD | Уже исправлено в 13.U13 (подтверждено агентом) |
| ~25 пунктов `no-change-mark-only` | Документационные предложения, не баги |

## Инвентаризация Health Checks

Существующие (полные): AI токены=0 при demand>0, RAG core (corpus/embeddings=0),
storage core, CPU/RAM присутствие, шифрование при ПДн, категория ПДн, WAF/DDoS
для b2c/b2g, SLA/RTO/RPO/replicas, консистентность (avg>peak, PCU>users,
peak_duration>24, registered>total, DAU<1%).

Отсутствующие (добавить по этапам): AI включён но demand=0; RAG corpus↔embeddings
mismatch; backup_retention>0 но HDD=0; CPU>0 но RAM=0; security-флаг включён но
ЭК не меняется; DR-требования но DR не меняется.

## Этапы

RAG → LLM → Storage/backup → CPU/RAM → Security/DR/project works. Каждый: TDD,
объяснимость (какие ответы/значения/default/оценка/override), health-checks,
полный прогон проверок, обновление UserManual/Architecture/MAINTAINER_GUIDE,
отдельный approval на commit/release.
