# Spec-plan: provider-price-schema-v2

**Статус**: DRAFT — spec-only.
**НЕ ИСПОЛНЯЕТСЯ**: `.md`-расширение → runner [tests/run.js](../../run.js) подбирает только `*.test.js`.
**Когда станет `.test.js`**: после browser-smoke green по VAT-1 2.15.1, на старте Phase 1 Stage VAT-2.

План — [stage-vat-2-provider-vat-schema.md](../../../../../../../../Users/Сергей/.claude/plans/stage-vat-2-provider-vat-schema.md).

---

## Контракт под тест

Тестируемая поверхность (после реализации Phase 1):

```text
js/services/priceImportParser.js
    - validateProviderPriceJson(json)
        → { ok: true, normalized } | { ok: false, reason, errors }
    - normalizeProviderPriceEntry(entry, vatPolicy, options)
        → { pricePerUnit (net), pricePerUnitNet, pricePerUnitGross?,
            vatRateIncluded?, vatPolicyConfidence?, vatNormalized: true,
            originalPricePerUnit? }

js/utils/constants.js
    - PROVIDER_PRICE_SCHEMA_VERSION = 2
    - EPSILON_VAT_CONSISTENCY = 0.01
```

Инвариант, защищаемый этим спеком:

```text
Все downstream-функции получают pricePerUnit КАК NET.
calculator.js применяет НДС ровно один раз через vatMul.
JSON gross 122 + vatRate 0.22 → net 100 → calc VAT 0.20 → final 120.
Никогда не 146.4.
```

---

## Группа A — v2 happy paths

### A.1 — v2 принимает pricePerUnitNet

```text
Вход:
{
  "schemaVersion": 2,
  "providerId": "sbercloud",
  "currency": "RUB",
  "vatPolicy": { "pricesIncludeVat": false, "confidence": "verified" },
  "prices": { "cpu-vcpu-shared": {
    "pricePerUnitNet": 100,
    "unit": "month"
  }}
}

Ожидаем:
{ ok: true }
normalized.prices['cpu-vcpu-shared'].pricePerUnit === 100
normalized.prices['cpu-vcpu-shared'].pricePerUnitNet === 100
normalized.prices['cpu-vcpu-shared'].vatNormalized === true
```

### A.2 — v2 принимает gross + vatRate, считает net

```text
Вход:
prices.X = { pricePerUnitGross: 122, vatRate: 0.22, unit: 'month' }
vatPolicy.pricesIncludeVat = true
vatPolicy.vatRateIncluded = 0.22

Ожидаем:
normalized.X.pricePerUnit === 100         (gross 122 / 1.22)
normalized.X.pricePerUnitGross === 122
normalized.X.vatRateIncluded === 0.22
normalized.X.vatNormalized === true
```

### A.3 — v2 принимает net + gross + vatRate, валидирует consistency

```text
Вход:
prices.X = {
  pricePerUnitNet: 100.00,
  pricePerUnitGross: 122.00,
  vatRate: 0.22,
  unit: 'month'
}

Ожидаем:
abs(122.00 - 100.00 * (1 + 0.22)) === 0
→ ok: true
normalized.X.pricePerUnit === 100.00
```

---

## Группа B — v2 rejects

### B.1 — net/gross mismatch выходит за EPSILON_VAT_CONSISTENCY

```text
Вход:
prices.X = {
  pricePerUnitNet: 100.00,
  pricePerUnitGross: 122.05,   // фактический gross при net=100 и vat=0.22 → 122.00
  vatRate: 0.22
}

abs(122.05 - 122.00) = 0.05 > EPSILON_VAT_CONSISTENCY (0.01)

Ожидаем:
{ ok: false, reason: 'vat-inconsistency', errors: [...] }
```

### B.2 — net/gross внутри EPSILON_VAT_CONSISTENCY → принимается

```text
Вход:
prices.X = {
  pricePerUnitNet: 100.00,
  pricePerUnitGross: 122.005,
  vatRate: 0.22
}
abs(122.005 - 122.00) = 0.005 <= EPSILON_VAT_CONSISTENCY (0.01)

Ожидаем:
{ ok: true }
normalized.X.pricePerUnit === 100.00
```

### B.3 — gross без vatRate

```text
Вход:
prices.X = { pricePerUnitGross: 122, unit: 'month' }    // нет vatRate

Ожидаем:
{ ok: false, reason: 'gross-without-vat-rate' }
```

### B.4 — invalid vatRate

```text
Кейсы (table-driven):
  vatRate = -0.1        → 'invalid-vat-rate'
  vatRate = 1.5         → 'invalid-vat-rate'  (доля, не процент)
  vatRate = NaN         → 'invalid-vat-rate'
  vatRate = Infinity    → 'invalid-vat-rate'
  vatRate = '0.22'      → 'invalid-vat-rate'  (строка, не number)
```

### B.5 — negative net/gross

```text
Кейсы:
  pricePerUnitNet  = -1      → 'invalid-price'
  pricePerUnitGross = -1     → 'invalid-price'
  pricePerUnitNet = Infinity → 'invalid-price'
  pricePerUnitNet = NaN      → 'invalid-price'
```

### B.6 — отсутствие схемного версионирования

```text
Вход без schemaVersion ИЛИ schemaVersion === 1 без явного user-policy
  → отправляется в группу C (v1 fallback path), НЕ в v2 reject.
schemaVersion = 3 (будущее) → 'unsupported-schema-version'.
```

---

## Группа C — v1 fallback

### C.1 — v1 без VAT policy → vat-policy-required

```text
Вход:
{
  "providerId": "legacy-csv-export",
  "prices": { "X": { "pricePerUnit": 122 } }
}
// нет schemaVersion, нет vatPolicy

Вызов без options.userVatPolicy:
  validateProviderPriceJson(json, { /* нет userVatPolicy */ })

Ожидаем:
{ ok: false, reason: 'vat-policy-required' }
```

Цель: блокирует тихий импорт legacy-файла. UI должен открыть VAT policy
choice modal и повторно вызвать с явным options.userVatPolicy.

### C.2 — v1 + policy 'net' → цена не меняется

```text
options.userVatPolicy = 'net'

Вход: prices.X.pricePerUnit = 122

Ожидаем:
normalized.X.pricePerUnit === 122
normalized.X.vatRateIncluded === undefined
normalized.X.vatPolicyConfidence === 'user-declared'
```

### C.3 — v1 + policy 'gross-20' → /1.20

```text
options.userVatPolicy = 'gross-20'

Вход: prices.X.pricePerUnit = 120

Ожидаем:
normalized.X.pricePerUnit === 100           (120 / 1.20)
normalized.X.pricePerUnitGross === 120
normalized.X.vatRateIncluded === 0.20
normalized.X.vatPolicyConfidence === 'user-declared'
```

### C.4 — v1 + policy 'gross-22' → /1.22

```text
options.userVatPolicy = 'gross-22'

Вход: prices.X.pricePerUnit = 122

Ожидаем:
normalized.X.pricePerUnit === 100           (122 / 1.22)
normalized.X.pricePerUnitGross === 122
normalized.X.vatRateIncluded === 0.22
```

---

## Группа D — Anti-patterns (защитные)

### D.1 — priceSource НЕ используется как VAT source of truth

```text
Вход (v1):
prices.X = {
  pricePerUnit: 122,
  priceSource: "Cloud.ru Evolution, цена С НДС 22%"
}
// нет options.userVatPolicy

Ожидаем:
{ ok: false, reason: 'vat-policy-required' }

Защита от соблазна парсить «С НДС 22%» из текста.
Текстовый priceSource остаётся meta-полем, не правит цену.
```

### D.2 — schemaVersion=2 с vatPolicy === null → reject

```text
Вход: { schemaVersion: 2, vatPolicy: null, ... }
Ожидаем: { ok: false, reason: 'missing-vat-policy' }
```

### D.3 — confidence строго в whitelist

```text
Допустимые: 'verified' | 'source-level' | 'assumed' | 'user-declared'
Любое другое значение → 'invalid-confidence'
```

---

## Группа E — Double-VAT regression (acceptance core, criterion 22)

### E.1 — JSON gross 22% → calc VAT 20% manual → final 120

```text
Шаг 1 (импорт):
  v2 JSON, prices.X = { pricePerUnitGross: 122, vatRate: 0.22 }
  → normalize → pricePerUnit (net) = 100

Шаг 2 (расчёт):
  calc.settings.vatEnabled = true
  calc.settings.vatRateMode = 'manual'
  calc.settings.vatRate = 0.20
  qty = 1

Шаг 3 (assert):
  costBase = 1 * 100 = 100
  vatMul = 1 + 0.20 = 1.20
  applyRiskFactors = false (изолируем НДС от рисков)
  costFinal = 100 * 1.20 = 120

  Ожидаем cell.costFinal === 120
  Запрещаем cell.costFinal === 146.4         (1 * 122 * 1.20 — double-VAT)
```

Это ЯДРО acceptance criterion 22 для всего Stage VAT-2.
Любая регрессия по этому тесту = блокер.

### E.2 — JSON net → calc VAT 22% auto-by-date → final 122

```text
v2 JSON, prices.X = { pricePerUnitNet: 100 } (без gross)
calc.settings.vatRateMode = 'auto-by-date', effective vatRate = 0.22

Ожидаем cell.costFinal === 122 (= 100 * 1.22).
```

### E.3 — JSON gross 22% → calc VAT отключён → final 100

```text
prices.X = { pricePerUnitGross: 122, vatRate: 0.22 } → net 100
calc.settings.vatEnabled = false

Ожидаем cell.costFinal === 100.
НЕ 122 (старый gross-снимок), НЕ 146.4 (double-VAT).
```

### E.4 — Frozen mode сохраняет ставку, но цена остаётся net

```text
Legacy calc с calc.settings.vatRateMode = 'frozen', vatRate = 0.20
Новый импорт v2 JSON с gross 22% → normalized net = 100

costFinal = 100 * 1.20 = 120 (frozen rate, не 22%).
```

---

## Группа F — Validator API contract

### F.1 — validateProviderPriceJson signature

```text
validateProviderPriceJson(json: object, options?: {
    userVatPolicy?: 'net' | 'gross-20' | 'gross-22',
    /* для v1 fallback. Игнорируется для schemaVersion === 2. */
})
  → { ok: true,  normalized: NormalizedProviderJson }
  | { ok: false, reason: string, errors?: Array<{path, message}> }
```

### F.2 — normalizeProviderPriceEntry signature

```text
normalizeProviderPriceEntry(
    entry: RawProviderPriceEntry,
    vatPolicy: { pricesIncludeVat, vatRateIncluded?, confidence },
    options?: { id?: string }
)
  → NormalizedProviderPriceEntry
```

### F.3 — Идемпотентность

```text
normalize(normalize(entry)) === normalize(entry)
(вторая нормализация — no-op для уже vatNormalized=true).
```

---

## Out of scope для этого spec-plan

```text
- Конверсия bundled JSON (Phase 3 — отдельный test file).
- Sync-test data/providers/*.json ↔ generated.js (Phase 2 architecture).
- VAT-policy choice modal UI (Phase 5 — ui/-папка).
- Legacy double-VAT banner (Phase 5 — ui/-папка).
- providerOverlay.js stale-maps linter (Phase 4 — architecture/).
- Decision Memo VAT line (это в VAT-1, не трогаем).
```

---

## Implementation hints (для Phase 1, когда стартанём)

```text
- normalizeProviderPriceEntry — pure function, без store/IO.
- При v1 path функция требует options.vatPolicy от вызывающего слоя
  (caller — priceImportMappingController).
- options.userVatPolicy → синтезируется в vatPolicy ДО вызова
  normalizeProviderPriceEntry.
- roundMoney(gross / (1 + vatRate)) использовать ИЗ formats/money helper,
  не вычислять inline (округление должно быть единообразным).
- При net+gross+vatRate: оба числа сохраняются как-есть, pricePerUnit = net
  (без пересчёта из gross — если consistency прошла).
- Никаких побочных эффектов: validate не пишет в store, не логирует, не
  тащит i18n строки.
```

---

**Spec-plan заморожен. Реализация откладывается до browser-smoke green по 2.15.1.**
