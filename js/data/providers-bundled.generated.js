/**
 * AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
 *
 * Source of truth: data/providers/*-latest.json
 * Regenerate via:  npm run generate:providers
 *
 * Stage VAT-2 Phase 2: bundled-provider runtime source. Sync-test
 * `tests/unit/architecture/providers-bundled-sync.test.js` ловит
 * рассинхронизацию JSON ↔ этого файла.
 */

export const BUNDLED_PROVIDER_PRICES = Object.freeze({
    "sbercloud": {
        "prices": {
            "ai-agent-memory-storage-tb": {
                "pricePerUnitGross": 12000,
                "pricePerUnitNet": 9836.07,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.16 п.3 версия 260316 (2026-03-16): «Хранилище на сетевых SSD дисках» Managed Redis = 0,016836 ₽/ГБ·час с НДС 22% × 730 × 1024 = 12 585 ≈ 12 000 ₽/ТБ/мес. Та же ставка что rag-vector-db-gb — agent memory обычно хранится в Redis или Postgres рядом с RAG-индексом. NB: Evolution AI Agents «Динамический ресурс 1 ГБ RAM» (EVO.22 п.4) = 0,488 ₽/ГБ·час → 356 ₽/ГБ/мес = ~365 000 ₽/ТБ/мес — это RAM working set активного агента, НЕ persistent storage; «Выделенный ресурс 1 ГБ RAM» (п.2) = 0,3904 → 285 ₽/ГБ/мес = ~292 000 ₽/ТБ/мес. Для долговременной памяти (trajectory, история действий) нужен именно SSD storage.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Managed Redis® / Managed PostgreSQL®, network SSD storage)"
            },
            "ai-agent-sandbox-vcpu": {
                "pricePerUnitGross": 1425,
                "pricePerUnitNet": 1168.03,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.22 п.3 версия 260316 (2026-03-16): «Динамический ресурс 1 vCPU» = 1,952 ₽/час с НДС 22% × 730 ≈ 1 425. Динамический выбран как default для sandbox tool-execution (бурсты, неравномерная нагрузка от user-driven запросов). Альтернатива: «Выделенный ресурс 1 vCPU» (п.1) = 1,5616 ₽/час × 730 ≈ 1 140 ₽/мес — если агент-пул работает стабильно 24/7 (24% дешевле). Общий cpu-vcpu-shared (712 ₽) — НЕ применять для агент-tool-execute: это специализированный SKU AI Agents платформы со встроенной изоляцией и runtime.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution AI Agents, Динамический ресурс)"
            },
            "cpu-vcpu-gpu": {
                "pricePerUnitGross": 11578,
                "pricePerUnitNet": 9490.16,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.1G версия 260316 (2026-03-16): Evolution Compute. GPU. ВМ 20vCPU/125GB/1 A100 PCI без NVLink = 317,20 ₽/час с НДС 22% × 730 ÷ 20 vCPU = 11 578. Линейная пропорция подтверждена на 4 точках: 40vCPU/250GB/2 A100 = 634,40 (÷40 = 11 578); 80vCPU/500GB/4 A100 = 1 268,80 (÷80 = 11 578); 160vCPU/900GB/8 A100 = 2 537,60 (÷160 = 11 578). Альтернативы из этого PDF: H100 PCI (20vCPU/110GB) → 20 039 ₽/(GPU-vCPU)/мес (newer/faster), A100 NVLink (через EVO.11.1 ML Inference) → 12 914, A100 40GB PCI (24vCPU shape) → 7 793, V100 (4vCPU/64GB) → 9 125, H100 NVLink → 25 550.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Compute GPU, NVIDIA A100 PCI без NVLink)"
            },
            "cpu-vcpu-shared": {
                "pricePerUnitGross": 712,
                "pricePerUnitNet": 583.61,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.1 версия 260316 (2026-03-16): Evolution Compute. Linear-fit на bundle-ценах с фиксированным RAM/vCPU=2 (4×8GB=5,9414; 8×16GB=11,8828; 16×32GB=23,7656 ₽/час с НДС 22%): vCPU = 0,975 ₽/vCPU·час с НДС × 730 ч ≈ 712. RAM-slope = 0,255 ₽/ГБ·час (см. ram-gb). Аналитически точная декомпозиция: verified против 4×16GB (0,975×4 + 0,255×16 = 7,98 vs 7,9788 ✓), 4×32GB (12,06 vs 12,0414 ✓), 1×2GB (1,485 vs 1,48535 ✓).",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Compute, regular VM)"
            },
            "llm-tokens-input-1m": {
                "pricePerUnitGross": 569,
                "pricePerUnitNet": 466.39,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.11.2 п.2 версия 260430 (2026-04-30): «БЯМ GigaChat-2-Max входные токены» = 569,3374 ₽ за 1 млн токенов с НДС 22% ≈ 569. Альтернативы из того же PDF (флагман vs варианты): GigaChat3-10B-A1.8B (small distilled) = 12,20; gpt-oss-120b (Cloud.ru-hosted open) = 15,86; Anthropic Claude Sonnet 4.6 (партнёр) = 589,26; OpenAI GPT-5 = 245,53; OpenAI GPT-5 Mini = 49,11; Anthropic Claude Opus 4.6 = 982,10; DeepSeek V3.2 = 113,92; Qwen3 235B A22B = 89,37. Цена-ориентир для Pro-tier flagship LLM.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Foundation Models, GigaChat-2-Max sync)"
            },
            "llm-tokens-output-1m": {
                "pricePerUnitGross": 569,
                "pricePerUnitNet": 466.39,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.11.2 п.3 версия 260430 (2026-04-30): «БЯМ GigaChat-2-Max генерируемые токены» = 569,3374 ₽ за 1 млн токенов с НДС 22% ≈ 569. У GigaChat-2-Max output = input (нет дифференциации). У ряда партнёрских моделей output дороже в 3-6× input: Anthropic Claude Sonnet 4.6 = 2 946,30 (5× input); OpenAI GPT-5 = 1 964,20 (8×); Claude Opus 4.6 = 4 910,50 (5×). При смене модели на партнёрскую — обновить.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Foundation Models, GigaChat-2-Max sync)"
            },
            "network-lb-l7": {
                "pricePerUnitGross": 1691,
                "pricePerUnitNet": 1386.07,
                "priceSource": "cloud.ru/documents/tariffs/advanced/services/elastic-load-balance, на 2026-01-01: L7 (1AZ) 2,318 ₽/час × 730 ч ≈ 1 691. Evolution PDF EVO.19 версия 260316 содержит ТОЛЬКО Network Load Balancer L4 («Ресурсная единица балансировщика L4» 0,80317 ₽/час × 730 = 586 ₽/мес — для TCP/UDP-балансировки без HTTP-маршрутизации/TLS). Для L7 (Application LB с поддержкой HTTP/HTTPS, SNI, WAF-интеграцией) Evolution-договор в shared-PDF не предоставляет — оставлен reference Advanced platform.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Advanced Elastic Load Balancer L7, 1AZ) — Evolution PDF содержит только L4"
            },
            "network-waf": {
                "pricePerUnitGross": 5000,
                "pricePerUnitNet": 4098.36,
                "priceSource": "cloud.ru/documents/tariffs/advanced/services/web-app-firewall, на 2026-01-01: ОЦЕНКА для типовой конфигурации (2-3 домена + 1М запросов + 5 правил) ≈ 5 000 ₽/мес. WAF тарифицируется комплексно (домены + запросы + правила); реальная цена зависит от конфигурации. 19 Evolution-приложений договора версии 260316 (EVO.1..EVO.28, предоставленные пользователем) WAF-SKU не содержат — для Web Application Firewall на платформе Evolution требуется отдельный коммерческий запрос.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Advanced WAF, типовая конфигурация) — Evolution PDF не содержит WAF SKU"
            },
            "rag-embeddings-1m": {
                "pricePerUnitGross": 1,
                "pricePerUnitNet": 0.82,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.11.2 п.11 версия 260430 (2026-04-30): «Модель-эмбеддер bge-m3 входные токены» = 0,61 ₽ за 1 млн токенов с НДС 22% ≈ 1. Альтернативы Cloud.ru-нативные: Qwen3-Embedding-0.6B = 0,854 ₽/М, Qwen3-VL-Embedding-2B (multimodal) = 73,20 ₽/М, Qwen3-VL-Embedding-8B = 85,40 ₽/М. Партнёрские embedders дороже на 1-2 порядка: OpenAI Text Embedding 3 Large = 25,53 ₽/М, Google Gemini Embedding 001 = 29,46 ₽/М. SEED-default 10 ₽/М (GigaChat Embeddings) уточнён до фактической Cloud.ru-цены 0,61 ₽/М.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Foundation Models, Модель-эмбеддер bge-m3)"
            },
            "rag-managed-knowledge-base-gb": {
                "pricePerUnitGross": 997,
                "pricePerUnitNet": 817.21,
                "priceSource": "Тариф для MANAGED RAG-сервиса провайдера (готовая «база знаний» с embeddings + index + search-API в одном SKU). ПРИЛОЖЕНИЕ №7.EVO.20 п.2 версия 260316 (2026-03-16): «Хранение преобразованных текстовых данных в базе знаний» = 1,12 ₽/ГБ·час без НДС / 1,3664 ₽/ГБ·час с НДС 22% × 730 ≈ 997 ₽/ГБ/мес (точное 997,47). Активно при Q.rag_needed && Q.rag_managed_used. Альтернатива (self-hosted, ~12 ₽/ГБ/мес) — rag-vector-db-gb на тарифе SSD Managed Redis/Postgres. Также EVO.20 п.1: «Обработка запросов к API базы знаний» = 0,0976 ₽/тыс шт·час (отдельный SKU для query-load, не покрывается калькулятором в текущей версии).",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Managed RAG, готовая база знаний)"
            },
            "rag-vector-db-gb": {
                "pricePerUnitGross": 12,
                "pricePerUnitNet": 9.84,
                "priceSource": "Тариф для SELF-HOSTED vector DB (pgvector поверх Managed PostgreSQL или RediSearch поверх Managed Redis). ПРИЛОЖЕНИЕ №7.EVO.16 п.3 (Managed Redis) и №7.EVO.4 п.5 (Managed PostgreSQL) версия 260316 (2026-03-16): «Хранилище на сетевых SSD дисках» = 0,016836 ₽/ГБ·час с НДС 22% × 730 ≈ 12 (точное 12,29 ₽/ГБ/мес). Активно при Q.rag_needed && !Q.rag_managed_used. Если выбран Managed RAG провайдера — используется отдельный SKU rag-managed-knowledge-base-gb по тарифу EVO.20 п.2 (готовая база знаний: embeddings + index + search-API, ~997 ₽/ГБ/мес, в ~80 раз дороже).",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Managed Redis® / Managed PostgreSQL®, network SSD storage)"
            },
            "ram-gb": {
                "pricePerUnitGross": 186,
                "pricePerUnitNet": 152.46,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.1 версия 260316 (2026-03-16): RAM-slope из linear-fit (см. cpu-vcpu-shared methodology) — 0,255 ₽/ГБ·час с НДС 22% × 730 ч ≈ 186. Verified против всех bundle-точек: 4×16GB = 7,9788 (0,975×4+0,255×16 = 7,98 ✓), 4×32GB = 12,0414 (12,06 ✓), 4×64GB = 20,1788 (20,22 ✓). Точная аналитическая декомпозиция договорных bundle-цен.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Compute, regular VM)"
            },
            "storage-hdd-tb": {
                "pricePerUnitGross": 5018,
                "pricePerUnitNet": 4113.11,
                "priceSource": "cloud.ru/documents/tariffs/advanced/services/elastic-volume — High I/O (SAS): 0,00671 ₽/GB·час с НДС 22% × 730 ч × 1024 GB/TB = 5 018. Это ближайший к 'HDD' тип (SAS-диск); классических SATA HDD на платформе нет. NB: 19 Evolution-приложений договора версии 260316 (предоставлены пользователем) содержат только SSD NVMe / network SSD; для cold/archive storage используется Object Storage Холодное (1 003 ₽/ТБ) или Ледяное (501 ₽/ТБ).",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Advanced Elastic Volume High I/O SAS) — Evolution PDF не содержит HDD/SAS SKU"
            },
            "storage-object-tb": {
                "pricePerUnitGross": 1162,
                "pricePerUnitNet": 952.46,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.3 п.1 версия 260316 (2026-03-16): «Объектное хранилище S3 Однозонное» = 1,1346 ₽/ГБ/мес с НДС 22% × 1024 ≈ 1 162. Альтернативы из того же PDF: Стандартное от 15 ГБ = 1,83915 → 1 883 ₽/ТБ; Холодное = 0,97905 → 1 003 ₽/ТБ; Ледяное = 0,489525 → 501 ₽/ТБ. Egress от 10 000 ГБ — 1,1712 ₽/ГБ → 1 199 ₽/ТБ. Operations: GET/HEAD = 0,03294 ₽/тыс, LIST/POST/PUT = 0,1098 ₽/тыс.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Object Storage S3 Однозонное)"
            },
            "storage-ssd-tb": {
                "pricePerUnitGross": 11858,
                "pricePerUnitNet": 9719.67,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.1 п.56 версия 260316 (2026-03-16): «Диск SSD NVMe» = 0,01586 ₽/ГБ·час с НДС 22% × 730 × 1024 = 11 858 ₽/ТБ/мес. Та же ставка для Managed Kubernetes (EVO.2 п.38) — единая SSD-NVMe ставка по платформе Evolution. Альтернатива для Managed-БД: «Хранилище на сетевых SSD дисках» в Managed Redis/PostgreSQL (EVO.4, EVO.16) = 0,016836 ₽/ГБ·час → 12 585 ₽/ТБ/мес (немного дороже, network-attached vs local NVMe).",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Compute, Диск SSD NVMe)"
            },
            "traffic-egress-tb": {
                "pricePerUnitGross": 3838,
                "pricePerUnitNet": 3145.9,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.1 п.58 версия 260316 (2026-03-16): «Публичный IP адрес. Исходящий трафик» = 0,00366 ₽/МБ с НДС 22% × 1024 МБ × 1024 ГБ/ТБ ≈ 3 838 ₽/ТБ/мес. Альтернативы для приложений с другим origin'ом: Object Storage egress (от 10 ТБ) = 1,1712 ₽/ГБ → 1 199 ₽/ТБ (EVO.3 п.7); Artifact Registry egress (от 100 ГБ) = 1,39995 ₽/ГБ → 1 434 ₽/ТБ (EVO.6 п.1); CDN egress (Cloud Video / Cloud CDN) — нет в shared Evolution PDF, требуется отдельный SKU.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Compute, Публичный IP исходящий трафик)"
            }
        },
        "providerId": "sbercloud",
        "schemaVersion": 2,
        "source": "Cloud.ru Evolution договорные тарифы (приложения к Договору версия 260316 = 2026-03-16, EVO.11.2 версия 260430; НДС 22% — РФ с 2026 г.). 16 ЭК. 13 SKU извлечены напрямую из 20 PDF-приложений (EVO.1, EVO.1G, EVO.2, EVO.3, EVO.4, EVO.6, EVO.10, EVO.11.1/11.2, EVO.16, EVO.19, EVO.20, EVO.22). Платформа — Evolution (current commercial line). Где Evolution PDF не содержит SKU (HDD/SAS storage, L7-LB, WAF) — оставлен Advanced reference с явной маркировкой «Evolution PDF не содержит SKU». ПРОВЕНАНС: данные верифицированы против официальных договорных приложений 2026-03-16. 2026-05-13: добавлен ЭК rag-managed-knowledge-base-gb (Managed RAG, EVO.20 п.2 = 997 ₽/ГБ/мес) — теперь rag-vector-db-gb и Managed RAG разделены через дискриминатор Q.rag_managed_used. NB: traffic-ingress-tb (входящий VPC) не включён в overlay — SEED уже имеет 0 как нативный дефолт (Cloud.ru ingress не тарифицирует).",
        "timestamp": "2026-05-13T08:30:00.000Z",
        "vatPolicy": {
            "confidence": "verified",
            "pricesIncludeVat": true,
            "vatRateIncluded": 0.22
        },
        "version": "2026-Q3"
    },
    "vk": {
        "prices": {
            "cpu-vcpu-dedicated": {
                "pricePerUnitGross": 546,
                "pricePerUnitNet": 447.54,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "cpu-vcpu-gpu": {
                "pricePerUnitGross": 16275,
                "pricePerUnitNet": 13340.16,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "cpu-vcpu-shared": {
                "pricePerUnitGross": 756,
                "pricePerUnitNet": 619.67,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "license-db-per-vcpu": {
                "pricePerUnitGross": 173250,
                "pricePerUnitNet": 142008.2,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "license-os-per-node": {
                "pricePerUnitGross": 30975,
                "pricePerUnitNet": 25389.34,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "license-siem-edr-per-node": {
                "pricePerUnitGross": 2604,
                "pricePerUnitNet": 2134.43,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "network-lb-l7": {
                "pricePerUnitGross": 1680,
                "pricePerUnitNet": 1377.05,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "network-waf": {
                "pricePerUnitGross": 5198,
                "pricePerUnitNet": 4260.66,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "ram-gb": {
                "pricePerUnitGross": 210,
                "pricePerUnitNet": 172.13,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "service-email-per-1k": {
                "pricePerUnitGross": 103,
                "pricePerUnitNet": 84.43,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "service-sms-per-1k": {
                "pricePerUnitGross": 6615,
                "pricePerUnitNet": 5422.13,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "storage-hdd-tb": {
                "pricePerUnitGross": 4095,
                "pricePerUnitNet": 3356.56,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "storage-object-tb": {
                "pricePerUnitGross": 1838,
                "pricePerUnitNet": 1506.56,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "storage-ssd-tb": {
                "pricePerUnitGross": 11340,
                "pricePerUnitNet": 9295.08,
                "priceSource": "realistic-stub vkcloud.ru/services Q3-2026",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            }
        },
        "providerId": "vk",
        "schemaVersion": 2,
        "source": "realistic-stub Q3-2026 для VK Cloud — синтетическое смещение от frozen-baseline (~+5%). НЕ верифицированный публичный прайс; замените файлом из реальных тарифов vkcloud.ru при готовности.",
        "timestamp": "2026-05-09T12:00:00.000Z",
        "vatPolicy": {
            "confidence": "assumed",
            "pricesIncludeVat": true,
            "vatRateIncluded": 0.22
        },
        "version": "2026-Q3-stub"
    },
    "yandex": {
        "prices": {
            "cpu-vcpu-dedicated": {
                "pricePerUnitGross": 1022,
                "pricePerUnitNet": 837.7,
                "priceSource": "yandex.cloud/ru/prices (1 мая 2026): «Вычислительные ресурсы выделенных хостов, Intel Ice Lake intel-6338-c108-m704-n3200x6, 100% vCPU» = 1.4 ₽/vCPU·час × 730 ч ≈ 1022. Premium-вариант — 100% vCPU на dedicated физическом хосте (=cpu-vcpu-shared, но с гарантированной изоляцией).",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (Compute Cloud, Intel Ice Lake dedicated host intel-6338)"
            },
            "cpu-vcpu-gpu": {
                "pricePerUnitGross": 12315,
                "pricePerUnitNet": 10094.26,
                "priceSource": "yandex.cloud/ru/prices (1 мая 2026, Compute Cloud — GPU): A100 на AMD EPYC — GPU 408,12 ₽/GPU·час, vCPU 0,9882 ₽/час, RAM 0,3074 ₽/ГБ·час. Эталонная shape per Yandex docs gpu-platform-v3 (g2.standard): 28 vCPU + 119 ГБ RAM на 1 GPU A100. Полная нода: (408,12 + 0,9882×28 + 0,3074×119) × 730 ≈ 344 830 ₽/мес ÷ 28 vCPU ≈ 12 315 ₽/(GPU-vCPU)/мес. Методология «full-node ÷ vCPU count» как у Cloud.ru reference. Альтернативы из CSV: V100 (Cascade Lake) ~9 700 ₽/(GPU-vCPU)/мес, T4 ~2 800 ₽/(GPU-vCPU)/мес — для inference small/medium моделей.",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (Compute Cloud GPU, AMD EPYC + 1 GPU NVIDIA A100)"
            },
            "cpu-vcpu-shared": {
                "pricePerUnitGross": 905,
                "pricePerUnitNet": 741.8,
                "priceSource": "yandex.cloud/ru/prices (1 мая 2026, скриншот калькулятора): «Вычислительные ресурсы обычной ВМ, Intel Ice Lake, 100% vCPU» = 1.24 ₽/vCPU·час × 730 ч ≈ 905. Ice Lake — current default Intel platform, non-Compute-Optimized для general workload.",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (Compute Cloud, Intel Ice Lake regular VM)"
            },
            "llm-tokens-input-1m": {
                "pricePerUnitGross": 800,
                "pricePerUnitNet": 655.74,
                "priceSource": "yandex.cloud/ru/prices (3 марта 2026): «AI Studio. Генерация текста, модель YandexGPT Pro 5.1, входящие токены, синхронный режим» = 0,8 ₽ за 1 тыс. токенов × 1000 = 800 ₽/М. Async-режим: 0,41 ₽/1k → 410 ₽/М (50% скидка за латентность). Альтернативы: YandexGPT Lite 5 sync 0,2/1k → 200 ₽/М, YandexGPT Pro 5 (предыдущая версия) sync 1,2/1k → 1 200 ₽/М.",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (AI Studio, YandexGPT Pro 5.1 sync)"
            },
            "llm-tokens-output-1m": {
                "pricePerUnitGross": 800,
                "pricePerUnitNet": 655.74,
                "priceSource": "yandex.cloud/ru/prices (3 марта 2026): «AI Studio. Генерация текста, модель YandexGPT Pro 5.1, исходящие токены, синхронный режим» = 0,8 ₽ за 1 тыс. токенов × 1000 = 800 ₽/М. У YandexGPT Pro 5.1 цена output = цена input (нет дифференциации), как и у GigaChat 2 Pro. Async-режим: 410 ₽/М.",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (AI Studio, YandexGPT Pro 5.1 sync)"
            },
            "network-lb-l7": {
                "pricePerUnitGross": 1920,
                "pricePerUnitNet": 1573.77,
                "priceSource": "yandex.cloud/ru/docs/application-load-balancer/pricing — Resource Unit 2.63 ₽/час с НДС × 730 ч ≈ 1920. Один resource unit обрабатывает до 1000 RPS, 4000 connections, 22 MB/s. Трафик отдельно НЕ тарифицируется (включён в resource unit).",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (Application Load Balancer)"
            },
            "network-waf": {
                "pricePerUnitGross": 40667,
                "pricePerUnitNet": 33333.61,
                "priceSource": "yandex.cloud/ru/docs/smartwebsecurity/pricing — WAF Start package 40 667 ₽/мес с НДС, до 100M requests/мес. WAF Pro: 76 250 ₽/мес (500M req). WAF Business: 152 500 ₽/мес (1B req). Pay-per-request alternative: 0..153.72 ₽/M requests.",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (Smart Web Security WAF Start subscription)"
            },
            "rag-embeddings-1m": {
                "pricePerUnitGross": 10,
                "pricePerUnitNet": 8.2,
                "priceSource": "yandex.cloud/ru/prices (1 мая 2026): «AI Studio. Эмбеддинг текста» = 0,0101 ₽ за 1 тыс. юнитов × 1000 ≈ 10 ₽/М. Практически совпадает с GigaChat Embeddings (0,01 ₽/1k = 10 ₽/М).",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (AI Studio, Эмбеддинг текста)"
            },
            "rag-vector-db-gb": {
                "pricePerUnitGross": 16,
                "pricePerUnitNet": 13.11,
                "priceSource": "yandex.cloud/ru/prices (1 мая 2026): «Managed Service for OpenSearch. Хранилище на сетевых SSD-дисках» = 0,0218 ₽/ГБ·час × 730 ч ≈ 16. SEED-default = 12 (оценка); реальный price-list даёт 16. Альтернативы: HDD 0,0052 → 4 (медленнее, для холодных индексов), local SSD 0,0198 → 14, нереплицируемый SSD 0,0147 → 11, 3-replica SSD 0,0365 → 27 (для production-репликации).",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (Managed Service for OpenSearch, network SSD)"
            },
            "ram-gb": {
                "pricePerUnitGross": 241,
                "pricePerUnitNet": 197.54,
                "priceSource": "yandex.cloud/ru/prices (1 мая 2026): «Вычислительные ресурсы обычной ВМ, Intel Ice Lake, RAM» = 0.33 ₽/ГБ·час × 730 ч ≈ 241. CVoS-1-год дешевле (0.28 → 204 ₽/мес), но baseline = on-demand.",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (Compute Cloud, Intel Ice Lake regular VM)"
            },
            "service-email-per-1k": {
                "pricePerUnitGross": 40,
                "pricePerUnitNet": 32.79,
                "priceSource": "yandex.cloud/ru/prices (1 мая 2026, Yandex Cloud Postbox): «Исходящее электронное письмо, от 100 до 250 единиц тарификации в месяц» = 39,65 ₽ за 1 тыс. писем ≈ 40. Tiered: 0-2 free, 2-10 → 80, 10-50 → 70, 50-100 → 60, 100-250 → 40 (canonical tier для seed-примера 100k писем/мес = 100 ед.), 250-500 → 29, 500-1k → 14, 1k-5k → 11, 5k-10k → 9, 10k-50k → 8, ≥50k → 6 ₽/тыс.",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (Postbox, tier 100-250 единиц/мес)"
            },
            "storage-hdd-tb": {
                "pricePerUnitGross": 3588,
                "pricePerUnitNet": 2940.98,
                "priceSource": "yandex.cloud/ru/prices (1 мая 2026): «Стандартный диск (HDD)» network-attached = 0.0048 ₽/ГБ·час × 730 ч × 1024 ГБ/ТБ ≈ 3 588. Альтернатива: «Стандартная файловая система (HDD)» 0.0055 → 4 113 ₽/ТБ·мес. Подтверждено CSV-дампом полного прайса 2026-05-09.",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (Compute Cloud, Network HDD)"
            },
            "storage-object-tb": {
                "pricePerUnitGross": 2467,
                "pricePerUnitNet": 2022.13,
                "priceSource": "yandex.cloud/ru/prices (1 мая 2026): «Object Storage. Размещение данных в стандартном хранилище, от 720 единиц тарификации в месяц» = 0.0033 ₽/ГБ·час × 730 ч × 1024 ГБ/ТБ ≈ 2 467. До 720 ГБ·мес — free tier. Альтернативы: холодное 0.00176 → 1 316 ₽/ТБ·мес, ледяное 0.00088 → 658 ₽/ТБ·мес (последнее — глубокий archive с штрафом за досрочное удаление < 12 мес).",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (Object Storage Standard)"
            },
            "storage-ssd-tb": {
                "pricePerUnitGross": 14878,
                "pricePerUnitNet": 12195.08,
                "priceSource": "yandex.cloud/ru/prices (1 мая 2026): «Быстрый диск (SSD)» network-attached = 0.0199 ₽/ГБ·час × 730 ч × 1024 ГБ/ТБ ≈ 14 878. Альтернативы из price-list: «Быстрая файловая система (SSD)» 0.0229 → 17 121; «Сверхбыстрое сетевое хранилище с тремя репликами (SSD)» 0.0332 → 24 824 (3-AZ replicated); локальный SSD на dedicated host 0.0134 → 10 020 (привязан к dedicated host); нереплицируемый SSD 0.0147 → 10 992.",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (Compute Cloud, Network SSD)"
            },
            "traffic-egress-tb": {
                "pricePerUnitGross": 1454,
                "pricePerUnitNet": 1191.8,
                "priceSource": "yandex.cloud/ru/prices (1 мая 2026): «VPC. Исходящий трафик, от 100 единиц тарификации в месяц» = 1,42 ₽/ГБ × 1024 ≈ 1 454. До 100 ГБ — free tier. Альтернативы: Object Storage egress (1024-51200 ГБ/мес) 1,40544 ₽/ГБ → 1 439; CDN egress 1,054 ₽/ГБ → 1 079 (если приложение работает через Yandex CDN).",
                "vatRate": 0.22,
                "vendor": "Yandex Cloud (Virtual Private Cloud egress, tier ≥100 ГБ/мес)"
            }
        },
        "providerId": "yandex",
        "schemaVersion": 2,
        "source": "Yandex Cloud price-list (1 мая 2026, регион RU, RUB) — full text dump прайса (CSV-выгрузка пользователя 2026-05-09 из yandex.cloud/ru/prices, валидирован против скриншота Compute Cloud). Canonical platforms: Intel Ice Lake regular VM (general compute), AMD EPYC + A100 (GPU/AI). НДС 22% (РФ с 2026 г.): цены /ru/prices показаны с НДС (стандарт Yandex). 15 ЭК с реальными числами. WAF — пакетный тариф Start взят с docs-страницы yandex.cloud/ru/docs/smartwebsecurity/pricing; в price-list дампе видна альтернативная pay-per-request таблица (27 450 ₽/M req 0.01-1M; 3 843 ₽/M req 1-10M; ниже tiered). NB: traffic-ingress-tb (входящий VPC) не включён в overlay — SEED уже имеет 0 как нативный дефолт (Yandex VPC ingress не тарифицирует).",
        "timestamp": "2026-05-09T19:30:00.000Z",
        "vatPolicy": {
            "confidence": "source-level",
            "pricesIncludeVat": true,
            "vatRateIncluded": 0.22
        },
        "version": "2026-Q3"
    }
});
