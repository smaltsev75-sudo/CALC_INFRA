# Свежесть provider-прайсов

Дата отчёта: 2026-05-22. Порог устаревания bundle: 6 мес.
Источник: `data/providers/*-latest.json` → `npm run generate:providers` → `js/data/providers-bundled.generated.js`.

| Провайдер | Версия | Дата сбора | Возраст | Позиций | VAT confidence | Статус |
|---|---|---:|---:|---:|---|---|
| sbercloud | 2026-Q3 | 13.05.2026 | 0.3 мес | 16 | verified | OK |
| vk | 2026-01-12-public | 12.01.2026 | 4.3 мес | 10 | source-level | OK |
| yandex | 2026-Q3 | 09.05.2026 | 0.4 мес | 15 | source-level | OK |

## Quality gates

| Провайдер | Core SKU coverage | VAT policy | Bad prices | Missing sources | Статус |
|---|---:|---|---:|---:|---|
| sbercloud | 8/8 | gross→net OK | 0 | 0 | OK |
| vk | 7/8 | gross→net OK | 0 | 0 | MISSING_CORE |
| yandex | 8/8 | gross→net OK | 0 | 0 | OK |

## Confidence summary

| Провайдеров | Verified/source-level VAT | Assumed VAT | Unknown VAT | Stub providers | Attention |
|---:|---:|---:|---:|---:|---|
| 3 | 3 | 0 | 0 | 0 | vk |

## Интерпретация

Все bundled-прайсы находятся в пределах порога свежести, без stub/assumed-флагов.
Quality gates требуют внимания: vk (MISSING_CORE).
`MISSING_CORE` означает отсутствие базового compute/storage/network SKU, `BAD_VAT_POLICY` — неполную gross→net политику, `BAD_PRICE` — неположительную цену, `MISSING_SOURCE` — пустой vendor/source.
Для коммерческого baseline предпочтительны провайдеры без freshness/quality-флагов. `STUB`/`ASSUMED_VAT` требуют ручной замены, а `MISSING_CORE` — получения КП или ручного override по отсутствующим SKU перед финальным бюджетом.

## Maintainer flow

1. Обновить `data/providers/<provider>-latest.json`: цены, `version`, `timestamp`, `priceSource`, VAT-поля.
2. Выполнить `npm run generate:providers` и `npm run prices:freshness`.
3. Проверить `npm run prices:freshness:check`, `npm run sanity:check`, `npm test`.
