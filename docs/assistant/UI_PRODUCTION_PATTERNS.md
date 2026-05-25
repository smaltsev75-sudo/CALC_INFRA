# UI Production Hardening Patterns

> Обобщение опыта Stage 8 (PATCH 2.4.34 → 2.4.39, 2026-05-09).
> 6 патчей за один день, все спровоцированы быстрыми feedback-итерациями
> пользователя «Ошибка в UI / не решено / сколько можно». Документ
> дистиллирует META-паттерны, которые повторно проявлялись в течение сессии.
>
> Назначение — quick-reference для будущих UI-fixes. Каждый паттерн = распознавание
> сигнала + анти-паттерн + правильный подход + пример из проекта.

---

## Содержание
B
1. [Override-hunt при повторных жалобах](#1-override-hunt-при-повторных-жалобах)
2. [Несколько контейнеров — одинаковое поведение](#2-несколько-контейнеров--одинаковое-поведение)
3. [Print/screen parity bidirectional: background ↔ foreground](#3-printscreen-parity-bidirectional-background--foreground)
4. [Sticky на @media print = undefined behavior](#4-sticky-на-media-print--undefined-behavior)
5. [Variable content ломает fixed grids](#5-variable-content-ломает-fixed-grids)
6. [`min-width: 0` на flex-item vs body horizontal scroll](#6-min-width-0-на-flex-item-vs-body-horizontal-scroll)
7. [Test helpers должны следовать эволюции CSS](#7-test-helpers-должны-следовать-эволюции-css)
8. [Hidden columns — приемлемая PDF degradation](#8-hidden-columns--приемлемая-pdf-degradation)
9. [Quick-reference таблица сигналов](#9-quick-reference-таблица-сигналов)

---

## 1. Override-hunt при повторных жалобах

**Сигнал:** Пользователь повторяет одну UI-жалобу 2+ раза. Каждый раз ты «применяешь fix», тесты зелёные, hard-reload не помогает.

**Анти-паттерн:** Править то же базовое CSS-правило N-й раз и надеяться, что в этот раз сработает.

**Правильный подход:**
1. `grep` по класс-имени во ВСЕХ CSS-файлах проекта.
2. Найти все правила, использующие этот класс — НЕ ТОЛЬКО base, но более-специфичные (с родителем, темой, состоянием).
3. Для каждого override проверить контекст: применяется ли в зоне бага?
4. Победитель каскада: !important > специфичность > порядок. Без !important любой более-специфичный селектор перебивает base.

**Пример (PATCH 2.4.30 → 2.4.35):**
Пользователь ТРИЖДЫ просил AI-метрики на Hero-карточке в layout 2×2. PATCH 2.4.30 правил базовое `.dash-ai-metrics-grid`, но `.dash-card-hero .dash-ai-metrics-grid` overrid'ил его на `auto-fit`. На третий раз grep показал второе правило, исправил его → закрыто.

**Закон:** На третий раз НЕ править то же место. Grep, потом fix.

---

## 2. Несколько контейнеров — одинаковое поведение

**Сигнал:** В UI есть 2+ контейнера, где дочерние элементы должны вести себя одинаково. Например, `.grid-A .item` и `.grid-B .item`.

**Анти-паттерн:**
- Применить layout-fix только к `.grid-A .item`, забыв про `.grid-B .item`.
- Использовать comma-группу `.grid-A .item, .grid-B .item { ... }`, которая ломает test-helpers с поиском по точному селектору.

**Правильный подход:**
- Дублировать rule-blocks отдельно для каждого контейнера.
- Это duplication CSS body, но обеспечивает совместимость с `ruleBody`-helpers и упрощает регрессионные тесты.

**Пример (PATCH 2.4.38):**
PATCH 2.4.33-2.4.37 фиксили layout `.questionnaire-grid .field` (grid-template-rows, label-floor, align-self), но секции «Использование LLM» / «RAG» / «Кастомизация и приватность» используют `.questionnaire-grid-explicit` (через `SUBGROUP_LAYOUTS`-карту). Все правки не применялись к этим секциям → controls плавали по y. Решение: продублировать rule-blocks.

**Закон:** При создании нового контейнера-«родственника» — сразу скопировать ВСЕ правила, не только grid-template-columns. Иначе layout-фиксы будут регрессировать в одном из контейнеров.

---

## 3. Print/screen parity bidirectional: background ↔ foreground

**Сигнал:** На PDF-выгрузке некий widget виден частично — фон есть, текст невидим (или наоборот).

**Анти-паттерн:** В `@media print` сбросить ТОЛЬКО background на white (через !important на контейнере), забыть про color на text-children.

**Правильный подход:** На каждый widget с dark-theme background обязательно ОБА reset'а:
- (a) Background reset на контейнере: `background: white !important`
- (b) Foreground reset на ВСЕХ text-children: `color: black !important; -webkit-text-fill-color: black !important`

text-children = `-qty`, `-value`, `-unit`, `-label`, `-subtitle`, gradient-text, любой элемент с собственным color.

**Пример (PATCH 2.4.32 → 2.4.37):**
- 2.4.32 добавил background-resets для `.dash-card`, `.dash-stand-card`, `.dash-resources`, `.dash-ai-metrics`.
- НО `.dash-resource-row-qty`, `.dash-ai-metric-row-qty` имеют `color: var(--text)` (slate на dark-теме). На print background форсится white, color остаётся slate → значения «267 015 млн токенов / мес» **невидимы** на бумаге.
- 2.4.37 добавил эти селекторы в общий color-override list.

**Закон:** Чек-лист на новый dashboard widget:
1. Backgrounds → print.css background-resets.
2. Foregrounds → print.css color-overrides.
3. Sub-divs со своим color → отдельный override (color: !important на родителе НЕ каскадирует на детей со своим color).

---

## 4. Sticky на @media print = undefined behavior

**Сигнал:** На PDF появляется тёмный пустой прямоугольник на месте sticky-thead. Header'ы есть в DOM, но на бумаге их не видно.

**Анти-паттерн:** Полагаться на browser fallback для `position: sticky` на печатном medium.

**Правильный подход:** Defensive sticky → static reset на `@media print` для ВСЕХ таблиц:

```css
@media print {
    .my-table thead,
    .my-table thead tr,
    .my-table thead th,
    .my-table thead td,
    .my-table .sticky-totals-row td {
        position: static !important;
        top: auto !important;
        z-index: auto !important;
        background: white !important;
        color: black !important;
    }
}
```

**Пример (PATCH 2.4.39):**
Chrome PDF-движок не сбрасывает `position: sticky` обратно в `static`. Headers пытаются прилипать к viewport, которого на printer-media физически нет → рендерятся «вне страницы», оставляя на месте `var(--bg-card)` background = тёмный rectangle. Reset → static исправил.

**Закон:** ANY таблица со sticky-thead на screen ОБЯЗАНА иметь sticky-reset на print. Не один раз для одной таблицы — defensive default для всего проекта.

---

## 5. Variable content ломает fixed grids

**Сигнал:** Соседние cells в одной row имеют разную высоту. Inputs/controls внутри cells оказываются на разной y-позиции, descriptions «провисают».

**Анти-паттерн:**
- Использовать `align-items: end` или `justify-content: flex-end` на parent grid — короткие cells прижимаются к низу row, их content (input/desc) уезжает вниз.
- Полагаться на `align-content: stretch` (default) без явного row-template — каждая cell имеет свой row sizing.
- Floor `minmax(3em, auto)` — фитит только 1-2 строки label-text, при 3-line labels (длинные русские с inline-бейджами) row 1 растёт ровно у длинных cells → input уезжает.

**Правильный подход:**
- Явный `grid-template-rows` с предсказуемыми ожиданиями: `minmax(LABEL_FLOOR, auto) auto 1fr` для label/control/desc.
- LABEL_FLOOR должен фитить максимально-возможный label content (для русских labels с inline-бейджами — 4.5em, не 3em).
- `align-self: start` на description — top-align, лишнее место уходит вниз cell. Не bottom-align (`align-self: end`).
- `align-self: center` на input/switch/segmented — controls в center своей row, не у её краёв.

**Пример (PATCH 2.4.29 → 2.4.33 → 2.4.35 → 2.4.37 → 2.4.38):**
5 итераций alignment-фиксов. Каждая итерация фиксила layer ниже, пока не покрыли все: parent grid (2.4.29) → field interior flex (2.4.33) → grid-template-rows (2.4.33) → align-self description (2.4.35) → label floor 4.5em (2.4.37) → дублирование для explicit-контейнера (2.4.38).

**Закон:** При alignment-баге проверять ВСЕ оси variation одним проходом:
- Variable label height (lines)
- Variable control height (toggle vs input vs select)
- Variable description height
- Inline-бейджи в labels
- Container width (на узких столбцах русские wrap'ятся в 3-4 строки)

Иначе многотактовые re-fix'ы.

---

## 6. `min-width: 0` на flex-item vs body horizontal scroll

**Сигнал:** Широкая таблица (16+ колонок с nowrap) клипается справа. Body не получает horizontal scroll, html-scrollbar не появляется.

**Анти-паттерн:** Применить `flex: 1; min-width: 0` к ОБЩЕМУ wrapper'у, в котором живут И grid-cards (auto-fit) И wide-tables. min-width:0 разрешает flex-item шринкаться ниже content min-content → wide-таблица не «распирает» body.

**Правильный подход:**
- `min-width: 0` ставится ТОЛЬКО на конкретные grid-items, которым нужна способность шринкаться (например, инлайн-row внутри auto-fit cells).
- На общий main-col wrapper `min-width: 0` НЕ ставится, чтобы wide-таблицы могли «распереть» body → html получает horizontal scrollbar.
- `body { overflow-x: hidden }` — defensive add, который потом ломает дизайн широких таблиц. Снимать осознанно.

**Пример (PATCH 2.4.31 → 2.4.35):**
- 2.4.31 снял `body { overflow-x: hidden }` — half-fix.
- 2.4.35 убрал `min-width: 0` с `.app-main-col`. Теперь main-col растёт под содержимое (Details 17 колонок ≈ 1700px), body шире viewport, html-scrollbar внизу страницы → все колонки доступны через horizontal scroll.

**Закон:** Связка для wide-table: `body { overflow-x: visible }` (или not set) + `.main-wrapper { min-width: NOT 0 }` + `.table-wrap { overflow-x: visible }`. Sticky-thead продолжает работать, потому что body не scroll-container — sticky targets viewport.

---

## 7. Test helpers должны следовать эволюции CSS

**Сигнал:** После CSS-рефакторинга (например, объединения rules в comma-группу) тесты падают с «CSS-правило не найдено».

**Анти-паттерн:** Использовать в test-helper'ах regex по точному селектору + `\s*\{`, не учитывая возможные comma-группы / nested selectors / @supports блоки.

**Правильный подход:**
- Либо избегать comma-групп, дублировать rule-blocks (pragmatic).
- Либо улучшить helper для поддержки grouped patterns (long-term).
- При rewrite CSS — сразу прогнать тесты, не оставлять «прогоним позже».

**Пример (PATCH 2.4.38):**
`tests/_helpers/source.js:ruleBody(src, '.foo')` ищет `\.foo\s*\{`. При comma-группе `.foo, .bar { ... }` regex не матчит → тесты на `.foo` ломаются. Пришлось перейти на дублирование rule-blocks.

**Закон:** Test-helpers — часть «public API» проекта. Их API должен поддерживать current-state CSS, не legacy. Если CSS эволюционирует, helper тоже эволюционирует. Технический долг — `ruleBody` не поддерживает grouped selectors.

---

## 8. Hidden columns — приемлемая PDF degradation

**Сигнал:** Таблица не помещается на A4 даже после максимального font-reduction (6.5pt) и tight padding.

**Анти-паттерн:**
- Использовать `transform: scale()` — ломает Chrome pagination.
- Уменьшать font ниже 6pt — нечитаемо на бумаге.
- Оставлять обрезку — пользователь теряет данные.

**Правильный подход:**
- Скрывать малоинформативные колонки на @media print через `display: none !important`.
- Производные показатели (Доля %, Риск %, конвертированные значения) — лучшие кандидаты на скрытие. Читатель PDF их легко выводит мысленно.
- Сохранить full-detail на ключевых столбцах (имя, стенды, ИТОГО).

**Пример (PATCH 2.4.38):**
Details-таблица 17 колонок не помещалась на A4 landscape (~1062px) даже при font 6.5pt. Скрыты `.col-share` («Доля, %»), `.col-risk` («Риск, %»), `.col-risk-amount` («Риск, ₽/мес»). 17 → 14 видимых на печати → ИТОГО / ГОД помещается с запасом.

**Закон:** PDF-формат имеет свои UX-правила, отличные от screen. Меньше — лучше для бумаги. Что не критично для бумажной отчётности — `display: none !important` на @media print без сожалений.

---

## 9. Quick-reference таблица сигналов

| Сигнал пользователя / симптом | META-паттерн | Раздел |
|------|-------|--------|
| «В 3-й раз прошу» / «Сколько можно?» | Override-hunt | [§1](#1-override-hunt-при-повторных-жалобах) |
| «Не выровнено по вертикали» в одной секции, в другой работает | Несколько контейнеров — одинаковое поведение | [§2](#2-несколько-контейнеров--одинаковое-поведение) |
| «На PDF не видны значения» (фон есть, текст невидим) | Print/screen parity (background+foreground) | [§3](#3-printscreen-parity-bidirectional-background--foreground) |
| «Заголовки таблицы исчезли на PDF», тёмный rectangle | Sticky на @media print | [§4](#4-sticky-на-media-print--undefined-behavior) |
| «Поля не выровнены по высоте» при разной длине labels/desc | Variable content в fixed grids | [§5](#5-variable-content-ломает-fixed-grids) |
| «Правые столбцы обрезаются» (на screen) | min-width:0 на flex-item | [§6](#6-min-width-0-на-flex-item-vs-body-horizontal-scroll) |
| «Тесты упали после CSS-рефакторинга» | Test helpers vs CSS evolution | [§7](#7-test-helpers-должны-следовать-эволюции-css) |
| «Правый столбец обрезается на PDF» (после font-reduction) | Hidden columns degradation | [§8](#8-hidden-columns--приемлемая-pdf-degradation) |

---

## Cross-cutting принципы

Все 8 паттернов сводятся к 3 META-META-урокам:

### A. Каскад > правило
CSS — каскадная система. Правка одного rule'а не закрывает баг, если поверх есть override. Always **grep first, fix later**. Применимо к JS event delegation, config-cascade, любой layered system.

### B. Парные инварианты должны меняться вместе
- Background ↔ foreground (для print).
- Screen-mode ↔ print-mode (для sticky).
- min-width на wrapper ↔ body overflow (для horizontal scroll).
- Layout container A ↔ container B одного класса (для multi-grid layouts).

При изменении одной стороны pair'а — обязательно проверить вторую.

### C. PDF-формат имеет свои UX-правила
Что хорошо на screen (sticky-thead, dark-theme accent цвета, gradient-text, многоколоночность) — может ломаться на бумаге. Defensive на @media print: sticky→static, color→black, hide-малоинформативные-колонки. Не переносить screen-design 1:1 на печать.

---

## Документация-связки

- **Хронология патчей:** [DECISIONS.md → Stage 8](DECISIONS.md) — описание каждого PATCH 2.4.34-2.4.39 с file:line.
- **Ловушки/инварианты:** [CLAUDE.md → Ловушки](CLAUDE.md) — короткие записи каждого паттерна для future-self.
- **Memory (cross-project):**
  - `feedback_check_overrides_when_repeated.md` — алгоритм для повторных жалоб.
  - `feedback_print_pdf_pitfalls.md` — три ловушки PDF-печати.

---

**Версия документа:** 2.4.39 (последний bundled патч в Stage 8).
**Дата:** 2026-05-09.
**Тесты:** 2192/2192 зелёные.
