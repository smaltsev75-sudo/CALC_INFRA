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
                "pricePerUnitGross": 12585.25,
                "pricePerUnitNet": 10315.78,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.16 п.3 версия 260316 (2026-03-26): «Хранилище на сетевых SSD дисках» Managed Redis = 0,0138 ₽/ГБ·час без НДС / 0,016836 ₽/ГБ·час с НДС 22% × 730 × 1024 = 12 585,25 ₽/ТБ/мес с НДС. Та же ставка что rag-vector-db-gb — agent memory обычно хранится в Redis/Postgres рядом с RAG-индексом. NB: AI Agents RAM (EVO.22 п.4) = 0,488 ₽/ГБ·час с НДС — это RAM working set активного агента, НЕ persistent storage.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Managed Redis® / Managed PostgreSQL®, network SSD storage)"
            },
            "ai-agent-sandbox-vcpu": {
                "pricePerUnitGross": 1424.96,
                "pricePerUnitNet": 1168,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.22 п.3 версия 260316 (2026-03-26): «Динамический ресурс 1 vCPU» = 1,60 ₽/час без НДС / 1,952 ₽/час с НДС 22% × 730 = 1 424,96 ₽/мес с НДС. Динамический выбран как default для sandbox tool-execution (бурсты, неравномерная нагрузка от user-driven запросов). Альтернатива: «Выделенный ресурс 1 vCPU» = 1,5616 ₽/час с НДС × 730 = 1 140 ₽/мес.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution AI Agents, Динамический ресурс)"
            },
            "cpu-vcpu-gpu": {
                "pricePerUnitGross": 11577.8,
                "pricePerUnitNet": 9490,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.1G версия 260520 (2026-05-20): Evolution Compute GPU. ВМ 100vCPU/625GB RAM/5 GPU A100 PCI без NVLink = 1 586 ₽/час с НДС 22% ⇒ 15,86 ₽/(GPU-vCPU)·час × 730 = 11 577,80 ₽/(GPU-vCPU)/мес. Линейная пропорция подтверждена соседней строкой 120vCPU/750GB/6 GPU A100 = 1 903,20 ₽/час (÷120 = 15,86). Альтернативы из этого PDF: H100 PCI 100vCPU/550GB/5 GPU = 2 745 ₽/час; H100 94GB PCI = 3 233 ₽/час; H100 NVLink = 4 270 ₽/час.",
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
                "pricePerUnitGross": 569.34,
                "pricePerUnitNet": 466.67,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.11.2 п.326 версия 260430 (effective 2026-05-12): «БЯМ GigaChat-2-Max входные токены» = 466,67 ₽ без НДС / 569,3374 ₽ за 1 млн токенов с НДС 22%. Альтернативы из того же PDF: GigaChat3-10B-A1.8B = 12,20; gpt-oss-120b = 15,86; Anthropic Claude Sonnet 4.6 = 589,26; OpenAI GPT-5 = 245,53; Claude Opus 4.6 = 982,10.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Foundation Models, GigaChat-2-Max sync)"
            },
            "llm-tokens-output-1m": {
                "pricePerUnitGross": 569.34,
                "pricePerUnitNet": 466.67,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.11.2 п.327 версия 260430 (effective 2026-05-12): «БЯМ GigaChat-2-Max генерируемые токены» = 466,67 ₽ без НДС / 569,3374 ₽ за 1 млн токенов с НДС 22%. У GigaChat-2-Max output = input. У ряда партнёрских моделей output дороже: Anthropic Claude Sonnet 4.6 = 2 946,30; OpenAI GPT-5 = 1 964,20; Claude Opus 4.6 = 4 910,50.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Foundation Models, GigaChat-2-Max sync)"
            },
            "network-lb-l7": {
                "pricePerUnitGross": 1692.14,
                "pricePerUnitNet": 1387,
                "priceSource": "Cloud.ru Advanced ADV.18 версия 260101 (2026-01-01): «Elastic Load Balance Dedicated DC 1AZ Layer 7 LCU» = 1,90 ₽/час без НДС / 2,318 ₽/час с НДС 22% × 730 = 1 692,14 ₽/мес с НДС. Evolution Load Balancer EVO.19 версия 260316 содержит только L4 («Ресурсная единица балансировщика L4» 0,80316666 ₽/час с НДС × 730 = 586,31 ₽/мес); для HTTP/HTTPS L7 оставлен Advanced reference.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Advanced Elastic Load Balancer L7, 1AZ) — Evolution PDF содержит только L4"
            },
            "network-waf": {
                "pricePerUnitGross": 21916.84,
                "pricePerUnitNet": 17964.62,
                "priceSource": "Cloud.ru Advanced ADV.47 версия 260101 (2026-01-01): минимальная рабочая Cloud-mode конфигурация 1 защищаемый домен + 5 правил + 1 млн запросов/мес. Формула с НДС 22%: домен до 1 шт 29,1336 ₽/час × 730 = 21 267,53; правила 0,1586 ₽/правило·час × 5 × 730 = 578,89; запросы 70,4184 ₽/1 млн/мес; итого 21 916,84 ₽/мес с НДС. Доп. домен: 1,6348 ₽/час × 730 = 1 193,40 ₽/мес. Реальная WAF-цена зависит от числа доменов, правил и запросов; для финальной сметы нужен КП/override.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Advanced WAF, Cloud mode baseline) — Evolution не содержит WAF SKU"
            },
            "rag-embeddings-1m": {
                "pricePerUnitGross": 0.61,
                "pricePerUnitNet": 0.5,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.11.2 п.348 версия 260430 (effective 2026-05-12): «Модель-эмбеддер bge-m3 входные токены» = 0,50 ₽ без НДС / 0,61 ₽ за 1 млн токенов с НДС 22%. Ранее bundle округлял gross до 1 ₽; теперь хранится фактическая цена. Альтернативы Cloud.ru-нативные: Qwen3-Embedding-0.6B = 0,854 ₽/М, Qwen3-VL-Embedding-2B = 73,20 ₽/М, Qwen3-VL-Embedding-8B = 85,40 ₽/М.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Foundation Models, Модель-эмбеддер bge-m3)"
            },
            "rag-managed-knowledge-base-gb": {
                "pricePerUnitGross": 997.47,
                "pricePerUnitNet": 817.6,
                "priceSource": "Тариф для MANAGED RAG-сервиса провайдера (готовая «база знаний» с embeddings + index + search-API в одном SKU). ПРИЛОЖЕНИЕ №7.EVO.20 п.2 версия 260316 (2026-03-26): «Хранение преобразованных текстовых данных в базе знаний» = 1,12 ₽/ГБ·час без НДС / 1,3664 ₽/ГБ·час с НДС 22% × 730 = 997,47 ₽/ГБ/мес с НДС. Активно при Q.rag_needed && Q.rag_managed_used. Также EVO.20 п.1: «Обработка запросов к API базы знаний» = 0,0976 ₽/тыс шт·час (query-load SKU, не покрывается калькулятором в текущей версии).",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Managed RAG, готовая база знаний)"
            },
            "rag-vector-db-gb": {
                "pricePerUnitGross": 12.29,
                "pricePerUnitNet": 10.07,
                "priceSource": "Тариф для SELF-HOSTED vector DB (pgvector поверх Managed PostgreSQL или RediSearch поверх Managed Redis). ПРИЛОЖЕНИЕ №7.EVO.16 п.3 (Managed Redis) и №7.EVO.4 п.5 (Managed PostgreSQL) версия 260316 (2026-03-26): «Хранилище на сетевых SSD дисках» = 0,0138 ₽/ГБ·час без НДС / 0,016836 ₽/ГБ·час с НДС 22% × 730 = 12,29 ₽/ГБ/мес с НДС. Активно при Q.rag_needed && !Q.rag_managed_used. Если выбран Managed RAG провайдера — используется отдельный SKU rag-managed-knowledge-base-gb.",
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
                "pricePerUnitGross": 3191.91,
                "pricePerUnitNet": 2616.32,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.1 п.56 версия 260316 (2026-03-26): «Диск HDD» = 0,0035 ₽/ГБ·час без НДС / 0,00427 ₽/ГБ·час с НДС 22% × 730 × 1024 = 3 191,91 ₽/ТБ/мес с НДС. Это актуальный Evolution SKU; старый fallback на Advanced Elastic Volume High I/O SAS больше не используется.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Compute, Диск HDD)"
            },
            "storage-object-tb": {
                "pricePerUnitGross": 1161.83,
                "pricePerUnitNet": 952.32,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.3 п.1 версия 260316 (2026-03-26): «Объектное хранилище S3 Однозонное» = 0,93 ₽/ГБ/мес без НДС / 1,1346 ₽/ГБ/мес с НДС 22% × 1024 = 1 161,83 ₽/ТБ/мес с НДС. Альтернативы из того же PDF: Ледяное = 0,489525 → 501,27 ₽/ТБ; Object Storage egress от 10 000 ГБ = 1,1712 ₽/ГБ → 1 199,31 ₽/ТБ.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Object Storage S3 Однозонное)"
            },
            "storage-ssd-tb": {
                "pricePerUnitGross": 11855.67,
                "pricePerUnitNet": 9717.76,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.1 п.57 версия 260316 (2026-03-26): «Диск SSD NVMe» = 0,013 ₽/ГБ·час без НДС / 0,01586 ₽/ГБ·час с НДС 22% × 730 × 1024 = 11 855,67 ₽/ТБ/мес с НДС. Альтернатива для Managed-БД: «Хранилище на сетевых SSD дисках» в Managed Redis/PostgreSQL (EVO.4, EVO.16) = 0,016836 ₽/ГБ·час → 12 585,25 ₽/ТБ/мес (network-attached vs local NVMe).",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Compute, Диск SSD NVMe)"
            },
            "traffic-egress-tb": {
                "pricePerUnitGross": 3837.79,
                "pricePerUnitNet": 3145.73,
                "priceSource": "ПРИЛОЖЕНИЕ №7.EVO.1 п.59 версия 260316 (2026-03-26): «Публичный IP адрес. Исходящий трафик» = 0,003 ₽/МБ без НДС / 0,00366 ₽/МБ с НДС 22% × 1024 × 1024 = 3 837,79 ₽/ТБ. Альтернативы: Object Storage egress от 10 000 ГБ = 1,1712 ₽/ГБ → 1 199,31 ₽/ТБ.",
                "vatRate": 0.22,
                "vendor": "Cloud.ru (Evolution Compute, Публичный IP исходящий трафик)"
            }
        },
        "providerId": "sbercloud",
        "schemaVersion": 2,
        "source": "Cloud.ru official public tariff documents verified 2026-05-22: Evolution Compute EVO.1 version 260316 effective 2026-03-26, Evolution Compute GPU EVO.1G version 260520 effective 2026-05-20, Object Storage EVO.3 / Managed PostgreSQL EVO.4 / Managed Redis EVO.16 / Load Balancer EVO.19 / Managed RAG EVO.20 / AI Agents EVO.22 version 260316, Foundation Models EVO.11.2 version 260430 effective 2026-05-12; Advanced Elastic Load Balance ADV.18 and Web Application Firewall ADV.47 version 260101 for SKU missing in Evolution L7/WAF. НДС 22% — РФ с 2026 г.; JSON stores gross source prices and net prices for calculator VAT-once flow. 16 ЭК: 14 SKU extracted directly from Cloud.ru Evolution, 2 SKU (L7-LB, WAF) use Cloud.ru Advanced reference with explicit marker because Evolution Load Balancer exposes only L4 and Evolution has no WAF SKU in current public tariff set. HDD now uses Evolution Compute p.56 «Диск HDD» instead of the older Advanced SAS fallback. NB: traffic-ingress-tb (входящий VPC) не включён в overlay — SEED уже имеет 0 как нативный дефолт (Cloud.ru ingress не тарифицирует).",
        "timestamp": "2026-05-22T00:00:00.000Z",
        "vatPolicy": {
            "confidence": "verified",
            "pricesIncludeVat": true,
            "vatRateIncluded": 0.22
        },
        "version": "2026-05-20-public"
    },
    "vk": {
        "prices": {
            "cpu-vcpu-dedicated": {
                "pricePerUnitGross": 1297,
                "pricePerUnitNet": 1063.11,
                "priceSource": "https://cloud.vk.com/pricelist — Virtual servers, High-frequency CPU used as premium/dedicated proxy, 1297 RUB / 30 days incl. VAT",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "cpu-vcpu-gpu": {
                "pricePerUnitGross": 7116.66,
                "pricePerUnitNet": 5833.33,
                "priceSource": "https://cloud.vk.com/pricelist — GPU VM A100 bundle 227733 RUB / 30 days incl. VAT ÷ 32 vCPU",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "cpu-vcpu-shared": {
                "pricePerUnitGross": 849,
                "pricePerUnitNet": 695.9,
                "priceSource": "https://cloud.vk.com/pricelist — Virtual servers, CPU Intel Ice Lake, 849 RUB / 30 days incl. VAT",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "license-db-per-vcpu": {
                "pricePerUnitGross": 729822,
                "pricePerUnitNet": 598214.75,
                "priceSource": "https://cloud.vk.com/pricelist — MS SQL Enterprise, 121637 RUB / 30 days per each 2 vCPU incl. VAT × 12 / 2",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "license-os-per-node": {
                "pricePerUnitGross": 11880,
                "pricePerUnitNet": 9737.7,
                "priceSource": "https://cloud.vk.com/pricelist — Windows Server, 990 RUB / 30 days per each 2 vCPU incl. VAT × 12; mapped to one node",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "network-lb-l7": {
                "pricePerUnitGross": 2086,
                "pricePerUnitNet": 1709.84,
                "priceSource": "https://cloud.vk.com/pricelist — Standard load balancer HA, 2086 RUB / 30 days incl. VAT; closest public proxy for L7 LB",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "ram-gb": {
                "pricePerUnitGross": 223,
                "pricePerUnitNet": 182.79,
                "priceSource": "https://cloud.vk.com/pricelist — Virtual servers, RAM, 223 RUB / GB / 30 days incl. VAT",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "storage-hdd-tb": {
                "pricePerUnitGross": 4096,
                "pricePerUnitNet": 3357.38,
                "priceSource": "https://cloud.vk.com/pricelist — Virtual servers, HDD, 4 RUB / GB / 30 days incl. VAT × 1024 GB",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "storage-object-tb": {
                "pricePerUnitGross": 2334.72,
                "pricePerUnitNet": 1913.7,
                "priceSource": "https://cloud.vk.com/pricelist — VK Object Storage Hotbox, data storage 2.28 RUB / GB / 30 days incl. VAT × 1024 GB",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            },
            "storage-ssd-tb": {
                "pricePerUnitGross": 13312,
                "pricePerUnitNet": 10911.48,
                "priceSource": "https://cloud.vk.com/pricelist — Virtual servers, SSD, 13 RUB / GB / 30 days incl. VAT × 1024 GB",
                "vatRate": 0.22,
                "vendor": "VK Cloud"
            }
        },
        "providerId": "vk",
        "schemaVersion": 2,
        "source": "VK Cloud official public price list https://cloud.vk.com/pricelist (configuration and prices from 12.01.2026, prices include VAT) + tariff docs https://cloud.vk.com/docs/ru/computing/iaas/tariffication. WAF/DDoS are price-by-request and intentionally not bundled.",
        "timestamp": "2026-01-12T00:00:00.000Z",
        "vatPolicy": {
            "confidence": "source-level",
            "pricesIncludeVat": true,
            "vatRateIncluded": 0.22
        },
        "version": "2026-01-12-public"
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
