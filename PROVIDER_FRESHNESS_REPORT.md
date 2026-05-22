# Свежесть provider-прайсов

Дата отчёта: 2026-05-22. Порог устаревания bundle: 6 мес.
Источник: `data/providers/*-latest.json` → `npm run generate:providers` → `js/data/providers-bundled.generated.js`.

| Провайдер | Версия | Дата сбора | Возраст | Позиций | VAT confidence | Статус |
|---|---|---:|---:|---:|---|---|
| sbercloud | 2026-Q3 | 13.05.2026 | 0.3 мес | 16 | verified | OK |
| vk | 2026-Q3-stub | 09.05.2026 | 0.4 мес | 14 | assumed | STUB + ASSUMED_VAT |
| yandex | 2026-Q3 | 09.05.2026 | 0.4 мес | 15 | source-level | OK |

## Интерпретация

Требуют внимания: vk (STUB + ASSUMED_VAT).
`STALE` означает возраст старше порога, `STUB` — реалистичный stub вместо проверенного прайса, `ASSUMED_VAT` — НДС-политика принята по допущению.

## Maintainer flow

1. Обновить `data/providers/<provider>-latest.json`: цены, `version`, `timestamp`, `priceSource`, VAT-поля.
2. Выполнить `npm run generate:providers` и `npm run prices:freshness`.
3. Проверить `npm run prices:freshness:check`, `npm run sanity:check`, `npm test`.
