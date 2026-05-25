## Оптимизированный skill.md

Да, вот компактная версия без дублей (удалены повторения по UI-дублям, хоткеям, фокусу, state; слиты похожие таблицы). Объём сокращён на ~40%, сохранена вся суть. [learn.microsoft](https://learn.microsoft.com/ru-ru/agent-framework/agents/skills)

## 1. Тип продукта

Локальное web-приложение: десктопный инструмент в браузере (скачать архив → запустить сервер → offline). Сценарии: калькуляторы, конструкторы, аналитика. [hirehi](https://hirehi.ru/blog/rabota-s-griaznymi-dannymi-kak-chistit-normalizovat-i-ne-poteriat-vazhnuiu-informatsiiu)

## 2. Принципы

| Принцип | Описание |
|---|---|
| Универсальность | Алгоритмы в коде, данные в seed (без брендов). |
| Качество | Market-grade UI, без TODO. |
| Простота | Освоение 5 мин, результат 2 мин, ≤2 клика на действие. |
| Надёжность | Подтверждение + undo для деструктива; ошибки не валят UI. |

## 3. Стек

| ✅ | ❌ |
|---|----|
| Vanilla JS (ES2022+, модули), CSS vars | TS, сборка, CSS-in-JS |
| `node:test` | jest, jsdom |
| `el()` render, localStorage (in-memory fallback) | Web Components, IndexedDB, eval |
| Собственный DSL-парсер | `prompt/confirm` |
| `escapeHtml()` + модалки | Прямая HTML-конкатенация |

Runtime deps: 0. Dev: только тесты.

## 4. Кроссплатформенность

| ОС | Скрипт |
|----|--------|
| Windows 10+ | `start-server.bat` (Python/Node auto) |
| Linux (Ubuntu+) | `start-server.sh` (Python/Node/PHP) |
| macOS 12+ | `start-server.sh` |

Браузеры: Chrome/Yandex/Safari (мажорные). Graceful degradation (UUID, CSS.escape, storage). Файлы: lowercase, UTF-8 LF, relative `/`. Шрифты: system-ui. [gist.github](https://gist.github.com/Jekins/2bf2d0638163f1294637)

## 5. Архитектура (6 слоёв)

```
ui/ — DOM render
controllers/ — events → store
state/ — store (deepFreeze, revision), persist/migrations
services/ — IO (storage/json/csv/markdown)
domain/ — логика (без DOM/store)
utils/ — debounce/freeze/uuid/escape
```

Поток: event → controller → store.update() → notify → rAF render + persist.

| Слой | DOM | Store | Логика |
|------|-----|-------|--------|
| domain | ❌ | ❌ | ✅ |
| controllers | ✅ | ✅ | оркестр |
| services/ui | ✅ | ctx | ❌ |

## 6. Store

```js
import { deepFreeze } from '../utils/freeze.js';
const initialState = deepFreeze({ activeTab: 'main', entityRevision: 0, persistStatus: 'idle', ui: {}, modals: {} });

export class Store {
  getState() { return this._state; }
  subscribe(fn) { /*...*/ }
  batch(fn) { /* nested-safe */ }
  _set(patch) { this._state = deepFreeze({...this._state, ...patch}); this._notify(); }
}
export const store = new Store();
```

## 7. UI/UX паттерны

### Палитра (тёмная hi-tech, после 9.6 — стиль Hynex)
```css
--bg-main:#0a0f1a; --bg-card:#141a2a; --accent:#26d49a; --text:#e6edf7; --success:#10b981; --danger:#ff5c7a;
--border: rgba(255,255,255,0.06);
```
WCAG AA. Sidebar layout (220px → 64px на ≤1100px), Lucide line-icons.

### Фокус/снэки/хоткеи
- `data-focus-key` + capture/restore (ui/focus.js).
- Undoable snackbars (стек, 4с таймаут).
- Хоткеи (`e.code`): Ctrl+Alt+N(новая), S/O(сохранить/загрузить), F(поиск), 1-9(вкладки), Esc(модалка). Без деструктива. [gist.github](https://gist.github.com/Jekins/2bf2d0638163f1294637)

### Кнопки/формы
- `title="Действие (Ctrl+Alt+X)"`. Одна кнопка/действие (toolbar vs empty-state OK).
- ⓘ для пояснений → модалка.
- RU-локаль: `,` десятичный, пробелы тысячи, RUB после числа. `parseNumberInput` tolerant.
- Группы в формах: order шаг 100, визуальные заголовки >5 полей.

## 8. Безопасность/DSL

| Угроза | Защита |
|--------|--------|
| XSS | `escapeHtml()` всегда; textContent prefer |
| RCE | Собственный AST-парсер (tokenize/eval/cache) |
| Storage quota | `persistStatus='error'` + snackbar |
| State мутации | deepFreeze |

DSL: `Q.id` (одноуровневый) + `S.param` или `S.param.sub` (многоуровневый dot для вложенных settings, например `S.standSizeRatio.DEV`); whitelist (min/max/if/round/ceil/floor/abs/clamp); edge: /0→0, NaN→error, exp-нотация. AST `Var{scope, path:string[]}`. [qna.habr](https://qna.habr.com/q/423586)

## 9. Тесты

`node:test`, `tests/run.js` (рекурсия *.test.js). 80%+ domain. Unit/integration (storage-mock). `npm test`. [reddit](https://www.reddit.com/r/ObsidianMD/comments/16lyhap/is_there_a_way_to_strip_markdown_from_text_you/)

## 10. Ловушки (key lessons)

- `<select>`: value ПОСЛЕ children.
- `escapeHtml`: не `` ` `` (Markdown).
- Drafts в `state.modals`, не module-scope.
- Хоткеи: `e.code` (KeyN/Digit3), Ctrl+Alt (no Ctrl+S conflict).
- Storage: try/catch JSON, Safari private → in-memory.
- State: `if (!active) return;`, revision vs hash.
- Импорт: atomic backup/rollback, schemaVersion check.
- UI: нет тех.терминов (seed→"справочники", Q.id→"параметр"); описания "зачем"; RU-единицы ("млн./мес.").
- Нет дублей: card-click без отдельной кнопки.
- **Эмодзи в UI запрещены** — только line-SVG из `js/ui/icons.js` (Lucide). В .md и комментариях кода допустимы. См. memory `feedback_no_emojis_in_ui`.
- **Числа в столбце/списке внутри категории — по убыванию** (стенд-карточки по `totalMonthly`, ЭК в категории детализации, риск-факторы по вкладу). См. memory `feedback_sort_descending`.
- **Persist UI-state** — F5 не должен сбрасывать вкладку/период/фильтры. Любая «view»-настройка → localStorage (`STORAGE_KEYS.ACTIVE_TAB`) или per-calc (`calc.view.disabledStands`). См. memory `feedback_persist_ui_state`.
- **info-иконка** унифицирована — один класс `.info-icon`, поведение по тегу: `<button>` clickable + pointer, `<span>` tooltip-only + help. Не плодить `.dash-info-btn`/`.field-info-icon`. Хелпер: `infoIcon()` в `dom.js`.
- **Расчёт сам знает свой режим**: параметр (например, `applyRiskFactors`) живёт в `calc.settings`, не в `state.ui` — иначе UI и расчёт расходятся, и режим теряется при экспорте JSON / переключении расчётов.
- **UI-toggle, который меняет ВСЕ суммы расчёта — это параметр расчёта, не view-настройка.** View — это период / стенды-фильтр / sub-tab / hide-zero. Если toggle меняет `result.totalMonthly` — его место в `calc.settings`.

## 11. JSON форматы

**Entity**:
```json
{"version":"1.0","schemaVersion":1,"id":"uuid","name":"","settings":{},"answers":{}}
```

**Bundle**:
```json
{"version":"bundle-1.0","activeCalcId":null,"defaultDictionary":{},"calculations":[ ]}
```

CSV: BOM, `;`, `,`, `"..."` escape.

## 12. Чеклист проекта

- [ ] ТЗ/README/HOW_TO_START.md
- [ ] index.html (#app), package.json, start-*.*
- [ ] utils/store/persistence/ui(*/focus/snackbar/header/tabs/modals)/controllers/keyboard
- [ ] css(base/layout/components)
- [ ] Кнопки title+хоткей, undo, persist индикатор, фокус OK, кирилл. хоткеи, no дубли
- [ ] tests (80% domain), npm test зелёный

## 13. Коммуникация

1. Уточнения → ТЗ → код.
2. Группы вопросов, ⚠ по умолчанию.
3. Smoke после волны.
4. No libs без OK.
5. UI/комменты RU, ids EN.
6. Баг → фикс → check.

Фразы: "Как есть"=OK; "Сделай всё"=полный; "По приоритету"=волнами.

---


## Версия
1.1 · 2026-05-03 · собран по итогам разработки калькулятора инфраструктуры. Обновлено после Этапа 9.6 (UI редизайн в стиле Hynex). Обновлять при новых ловушках.