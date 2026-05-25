/**
 * Вкладка «Сравнение»: side-by-side сравнение 2-4 расчётов.
 *
 * 12.U28 — Объединённая таблица:
 *   1. Селекторы расчётов сверху + кнопка «Очистить выбор» / «Экспорт CSV».
 *   2. ОДНА таблица:
 *        thead:
 *          - row 1: «Элемент» | {calc.name} | {Δ vs calc[0]} | …
 *          - row 2: «Стоимость / мес» | totalMonthly[i] | Δ
 *          - row 3: «Стоимость / год» | totalAnnual[i]  | Δ
 *          → все 3 ряда — sticky-top, не двигаются при вертикальном скролле.
 *        tbody:
 *          - категории-аккордеоны (cmp-cat-row): шеврон + название + counter +
 *            суммы по категории + Δ. По умолчанию ВСЕ свёрнуты.
 *          - при раскрытии — ЭК внутри категории (cmp-item-row). Сортировка
 *            индикаторов min/yellow/max по столбцу применяется ВНУТРИ категории.
 *
 * Использует те же calculate() и formatting, что и остальные вкладки.
 */

import { el, infoIcon } from './dom.js';
import { icon } from './icons.js';
import { calculate } from '../domain/calculator.js';
import {
    CATEGORY_IDS, CATEGORY_LABELS, CATEGORY_COLORS, isZeroMoney,
    STAND_IDS, STAND_LABELS,
    DASHBOARD_AI_METRIC_LABELS, DASHBOARD_AI_METRIC_TITLES,
    DASHBOARD_AI_METRIC_DESCRIPTIONS, DASHBOARD_AI_METRIC_UNIT_SUFFIX,
    MAX_COMPARISON_CALCS
} from '../utils/constants.js';
import { money, percent } from '../services/format.js';
import { computeRowIndicators, sortRowsByIndicator, nextSortState } from './comparisonIndicators.js';
import { aggregateAiMetrics, formatResourceQty } from './dashboard.js';
import { getActiveScenario } from '../domain/scenarios.js';
import { getCalculationPriceActualityInfo } from './providerPriceActuality.js';

/**
 * Sprint 3.0 Stage 3: scenario-aware Comparison.
 *
 * Возвращает label активного scenario, если у calc'а ≥ 2 сценариев. Для legacy
 * (нет scenarios[]) и для calc'ов с одним сценарием — null (label «Базовый»
 * не несёт информации в сравнении и был бы шумом). UI выводит результат
 * подстрокой под именем calc'а в шапке колонки и в title AI-блока.
 *
 * Семантика: «в сравнении показан тот scenario, который сейчас активен в
 * каждом calc'е». Переключить scenario для конкретного calc'а можно через
 * tab-switcher на дашборде этого calc'а — после переключения и возврата на
 * вкладку Сравнение шапка обновится автоматически (calc грузится через
 * ctx.loadCalcById, который читает свежий store).
 */
function activeScenarioLabelForCompare(calc) {
    if (!calc) return null;
    const scenarios = Array.isArray(calc.scenarios) ? calc.scenarios : null;
    if (!scenarios || scenarios.length < 2) return null;
    const active = getActiveScenario(calc);
    return active && active.label ? active.label : null;
}

export function renderComparison(state, ctx) {
    const ids = state.comparisonIds || [];
    // Загрузка расчёта по id — через ctx-обёртку (UI ↛ state/persistence).
    const calcs = ids.map(id => ctx.loadCalcById(id)).filter(Boolean);
    const results = calcs.map(c => calculate(c));

    return el('section', { class: 'tab-pane' },
        el('div', { class: 'tab-toolbar' },
            el('h2', { class: 'tab-title', text: 'Сравнение расчётов' }),
            el('div', { class: 'tab-toolbar-actions' },
                el('span', { class: 'tab-toolbar-hint', text: `Выбрано: ${calcs.length} · лимит ${MAX_COMPARISON_CALCS}` }),
                calcs.length > 0 && el('button', {
                    class: 'btn btn-ghost btn-icon-text',
                    title: 'Снять отметки со всех выбранных расчётов и начать выбор заново',
                    onClick: () => ctx.clearComparison()
                },
                    icon('x', { size: 16 }),
                    el('span', { text: 'Очистить выбор' })
                )
            )
        ),

        renderPicker(state, calcs, ctx),

        calcs.length === 0
            ? renderEmptyState(state, ctx)
            : el('div', { class: 'comparison-content' },
                renderComparisonPriceActuality(calcs),
                renderComparisonVatWarning(calcs),
                renderUnifiedTable(calcs, results, ctx, state),
                /* Раздел AI-метрик: на каждый выбранный расчёт — мини-таблица
                   4 метрики × 5 стендов + ИТОГО. Помогает увидеть, какой
                   вариант дешевле в AI-разрезе (например один кейс с realtime-
                   эмбеддингами 12× против еженедельного 1×). */
                renderAiMetricsComparisonSection(calcs, results, ctx)
            )
    );
}

function renderComparisonPriceActuality(calcs) {
    if (!Array.isArray(calcs) || calcs.length === 0) return null;
    return el('div', { class: 'comparison-price-actuality-list' },
        ...calcs.map(calc => {
            const info = getCalculationPriceActualityInfo(calc);
            return el('div', {
                class: 'comparison-price-actuality',
                attrs: { role: 'status' }
            },
                icon('clock', { size: 16 }),
                el('div', { class: 'comparison-price-actuality-text' },
                    el('strong', { text: calc.name || 'Расчёт' }),
                    el('span', { text: ` — ${info.labelWithProvider}` })
                )
            );
        })
    );
}

/* Секция «AI-метрики» внизу страницы Сравнения. На каждый выбранный
   расчёт — отдельная мини-таблица 4×(5+1). Появляется только если
   ХОТЯ БЫ ОДИН расчёт имеет ненулевую AI-нагрузку. Расчёты без AI
   показываем как «нет данных», чтобы пользователь видел контекст
   («у второго проекта вообще нет AI»). */
function renderAiMetricsComparisonSection(calcs, results, ctx) {
    if (!calcs || calcs.length === 0) return null;

    // Собираем aiMetrics для каждого расчёта.
    const items = calcs.map((calc, idx) => {
        const result = results[idx];
        const disabledStands = calc.view?.disabledStands || [];
        const applyRisks = calc.settings?.applyRiskFactors !== false;
        const ai = aggregateAiMetrics(result, calc.dictionaries?.items || [], disabledStands, applyRisks, calc);
        const hasAny = DASHBOARD_AI_METRIC_LABELS.some(label => {
            const e = ai.total?.[label];
            return e && e.qty > 0;
        });
        return { calc, ai, hasAny, disabledStands, applyRisks };
    });

    // Если ни один не использует AI — секцию не показываем.
    if (!items.some(it => it.hasAny)) return null;

    const blocks = items.map(({ calc, ai, hasAny, disabledStands, applyRisks }) => {
        if (!hasAny) {
            return el('div', { class: 'comparison-ai-block comparison-ai-block-empty' },
                el('div', { class: 'comparison-ai-block-title', text: calc.name || '—' }),
                el('div', { class: 'comparison-ai-block-empty-text',
                    text: 'AI / поиск по корпоративной базе знаний / виртуальные агенты не используются в этом расчёте.' })
            );
        }

        const fmtCell = (cell) => {
            if (!cell || !(cell.qty > 0)) return '—';
            const v = formatResourceQty(cell.qty, cell.unit);
            return v === null ? '—' : v;
        };

        const headerRow = el('tr', null,
            el('th', { class: 'comparison-ai-cell-metric', text: 'Метрика' }),
            ...STAND_IDS.map(sid => el('th', {
                class: ['comparison-ai-cell-stand', disabledStands.includes(sid) && 'comparison-ai-cell-disabled'],
                title: disabledStands.includes(sid)
                    ? `${STAND_LABELS[sid]} исключён из ИТОГО (toolbar расчёта)`
                    : STAND_LABELS[sid],
                text: STAND_LABELS[sid]
            })),
            el('th', { class: 'comparison-ai-cell-total', text: 'ИТОГО' })
        );

        const rows = DASHBOARD_AI_METRIC_LABELS.map(label => {
            const tot = ai.total?.[label];
            const title = DASHBOARD_AI_METRIC_TITLES[label] || label;
            const desc = DASHBOARD_AI_METRIC_DESCRIPTIONS[label] || '';
            const suffix = DASHBOARD_AI_METRIC_UNIT_SUFFIX[label] || '';

            const openHint = ev => {
                ev?.preventDefault?.();
                ev?.stopPropagation?.();
                if (typeof ctx.openMessageModal === 'function') {
                    ctx.openMessageModal({ title, message: desc });
                }
            };

            const cells = STAND_IDS.map(sid => {
                const cell = ai.perStand?.[sid]?.[label];
                return el('td', {
                    class: ['comparison-ai-cell-stand', disabledStands.includes(sid) && 'comparison-ai-cell-disabled'],
                    title: cell && cell.qty > 0
                        ? `${STAND_LABELS[sid]}: ${fmtCell(cell)} ${cell.unit}${suffix}`
                        : `${STAND_LABELS[sid]}: 0`,
                    text: fmtCell(cell)
                });
            });

            const totalText = tot && tot.qty > 0
                ? `${fmtCell(tot)} ${tot.unit}${suffix}`
                : '—';

            return el('tr', null,
                el('td', { class: 'comparison-ai-cell-metric' },
                    el('span', { class: 'comparison-ai-cell-metric-name', text: title }),
                    infoIcon(openHint, 'Подробное описание метрики')
                ),
                ...cells,
                el('td', { class: 'comparison-ai-cell-total', text: totalText })
            );
        });

        const modeBadge = applyRisks
            ? el('span', { class: 'pill pill-success', text: 'С РИСКАМИ' })
            : el('span', { class: 'pill pill-warn', text: 'БЕЗ РИСКОВ' });

        const scenarioLabel = activeScenarioLabelForCompare(calc);

        return el('div', { class: 'comparison-ai-block' },
            el('div', { class: 'comparison-ai-block-header' },
                el('div', { class: 'comparison-ai-block-titles' },
                    el('span', { class: 'comparison-ai-block-title', text: calc.name || '—' }),
                    /* Stage 3: подстрока с активным scenario для AI-блока.
                       AI-метрики могут различаться между сценариями одного calc'а
                       (например, scenario с включённым LLM vs без LLM), поэтому
                       подсказка важна — без неё пользователь не понимает, какой
                       профиль AI-нагрузки видит. */
                    scenarioLabel
                        ? el('span', { class: 'comparison-ai-block-scenario',
                                       title: `Активный сценарий расчёта «${calc.name || '—'}». Переключить можно через tab-switcher на дашборде этого расчёта.`,
                                       text: `сценарий: ${scenarioLabel}` })
                        : null
                ),
                modeBadge
            ),
            el('div', { class: 'comparison-ai-block-table-wrap' },
                el('table', { class: 'comparison-ai-table' },
                    el('thead', null, headerRow),
                    el('tbody', null, ...rows)
                )
            )
        );
    });

    return el('section', { class: 'comparison-ai-section' },
        el('div', { class: 'comparison-ai-section-header' },
            el('h3', { class: 'comparison-ai-section-title', text: 'Объёмы AI-нагрузки · по расчётам' }),
            el('div', { class: 'comparison-ai-section-hint',
                text: 'Сравнение операционных объёмов AI-нагрузки: токены модели AI, индекс поиска по корпоративной базе знаний, эмбеддинги для семантического поиска, вычислительные ресурсы для виртуальных агентов. Каждый расчёт — отдельная таблица: 4 метрики × 5 стендов. Расчёты без AI показаны заглушкой.'
            })
        ),
        el('div', { class: 'comparison-ai-section-grid' }, ...blocks)
    );
}

/* ---------- Селектор расчётов ---------- */

function renderPicker(state, selectedCalcs, ctx) {
    const list = state.calcList;
    if (list.length === 0) return null;
    const selectedSet = new Set(state.comparisonIds);
    /* Stage 3 финализация: lazy-load для scenario.label в picker chip.
       Полные calc'и для уже выбранных загружаются один раз в renderComparison —
       переиспользуем тот массив через Map(id → calc) вместо повторных
       loadCalcById(meta.id) для каждой chip. Невыбранные calc'и в picker'е
       НЕ грузим (для N=20 calc'ов это были бы 20 чтений localStorage перед
       каждым render-циклом — недопустимая стоимость). Семантика:
       пользователь видит активный сценарий ТОЛЬКО для тех calc'ов, которые
       он уже выбрал — что согласуется с поведением шапки таблицы (там тоже
       только выбранные участвуют). */
    const selectedById = new Map((selectedCalcs || []).map(c => [c.id, c]));
    return el('div', { class: 'comparison-picker' },
        el('div', { class: 'comparison-picker-label', text: 'Выберите расчёты для сравнения:' }),
        el('div', { class: 'comparison-chips' },
            ...list.map(meta => {
                const isSel = selectedSet.has(meta.id);
                const disabled = !isSel && selectedSet.size >= MAX_COMPARISON_CALCS;
                const fullCalc = selectedById.get(meta.id);
                const scenarioLabel = fullCalc ? activeScenarioLabelForCompare(fullCalc) : null;
                return el('label', {
                    class: ['chip', isSel && 'chip-active', disabled && 'chip-disabled',
                            scenarioLabel && 'chip-with-scenario']
                },
                    el('input', {
                        type: 'checkbox',
                        checked: isSel,
                        disabled,
                        onChange: e => {
                            if (e.target.checked) ctx.addComparisonId(meta.id);
                            else ctx.removeComparisonId(meta.id);
                        }
                    }),
                    el('span', { class: 'chip-content' },
                        el('span', { class: 'chip-name', text: meta.name || '—' }),
                        scenarioLabel
                            ? el('span', { class: 'chip-scenario',
                                           title: `Активный сценарий расчёта «${meta.name || '—'}». Переключить можно через tab-switcher на дашборде этого расчёта.`,
                                           text: `сценарий: ${scenarioLabel}` })
                            : null
                    )
                );
            })
        )
    );
}

function renderEmptyState(state, ctx) {
    return el('div', { class: 'empty-state empty-state-compact' },
        el('div', { class: 'empty-state-icon' }, icon('git-compare', { size: 48 })),
        el('div', { class: 'empty-state-title', text: 'Выберите расчёты для сравнения' }),
        el('div', { class: 'empty-state-subtitle' },
            'Отметьте 2-4 расчёта в селекторе выше — таблица сравнения появится автоматически. ',
            'Полезно для оценки альтернативных конфигураций (MVP / v1 / v2, разные показатели пиковой одновременной аудитории и нагрузки).'
        )
    );
}

/* ---------- Объединённая таблица: header + totals + accordion-категории ---------- */

const INDICATOR_TITLES = {
    green:  'Минимальная стоимость в строке (самый дешёвый расчёт по этому ЭК).',
    yellow: 'Следующая после минимальной — второй по выгодности расчёт по этому ЭК.',
    red:    'Максимальная стоимость в строке (самый дорогой расчёт по этому ЭК).',
    none:   ''
};

/* 12.U31 (E.1): aria-label для colorblind-доступности.
   `.cmp-ind-dot` — пустой 8×8 кружок, различается только background-color.
   Для protanopia/deuteranopia (≈8% мужчин) `#26d49a` (green) и `#f87171` (red)
   воспринимаются почти одинаково. Screen-reader без aria-label произносит
   «зелёный круг» — без смысла. Текстовые лейблы дают семантику. */
const INDICATOR_ARIA = {
    green:  'минимум',
    yellow: 'средняя позиция',
    red:    'максимум',
    none:   ''
};

/**
 * Построить ItemRows: для каждого ЭК — ячейки {present, value} по колонкам
 * + indicators-массив (зелёный/жёлтый/красный/none).
 *
 * 12.U25: ЭК отсутствующий в расчёте — present:false → ignored from min/max.
 * Cost === 0 у present-item остаётся = 0 (есть в расчёте, просто без бюджета).
 */
function buildItemRows(allItems, calcs, results) {
    return allItems.map(meta => {
        const cells = calcs.map((c, i) => {
            const inCalc = c.dictionaries.items.find(x => x.id === meta.id);
            if (!inCalc) return { present: false, value: 0 };
            const cost = results[i].items[meta.id]?.totalMonthly || 0;
            return { present: true, value: cost };
        });
        return {
            id: meta.id,
            meta,
            cells,
            indicators: computeRowIndicators(cells)
        };
    });
}

/**
 * Группировка ЭК по категории в порядке CATEGORY_IDS.
 * @returns {Array<{ catId: string, items: Array<{id, name, category}> }>}
 *  — только категории, в которых есть items. Внутри каждой items сортируются
 *  по name (RU-locale).
 *
 * Экспортируется для тестов; в самой comparison.js используется напрямую.
 */
export function groupItemsByCategory(allItems) {
    const buckets = new Map();
    for (const it of allItems) {
        const cat = it.category || 'HW';
        if (!buckets.has(cat)) buckets.set(cat, []);
        buckets.get(cat).push(it);
    }
    const groups = [];
    for (const cat of CATEGORY_IDS) {
        const items = buckets.get(cat);
        if (!items || items.length === 0) continue;
        items.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
        groups.push({ catId: cat, items });
    }
    return groups;
}

/** Сумма cells.value для подмножества items по конкретному столбцу (расчёту i).
 *  Экспортируется для тестов. */
export function categoryColSum(items, results, colIdx) {
    let sum = 0;
    for (const it of items) {
        const v = results[colIdx].items[it.id]?.totalMonthly || 0;
        if (Number.isFinite(v)) sum += v;
    }
    return sum;
}

/* VAT-1 Phase 5: warning над таблицей, если у выбранных calc'ов разные ставки
   НДС (с учётом vatEnabled). Если все ставки совпадают — null (no-op). */
function renderComparisonVatWarning(calcs) {
    if (!Array.isArray(calcs) || calcs.length < 2) return null;
    /* Effective-rate: для calc с vatEnabled=false ставка = 0 (применяется ×1).
       Это правильно — расчёт без НДС несопоставим с расчётом 22% даже если
       формально `vatRate=0.22`, потому что в первом он не учитывается. */
    const effectiveRates = calcs.map(c => {
        const s = c.settings || {};
        if (s.vatEnabled === false) return 0;
        return Number.isFinite(s.vatRate) ? s.vatRate : 0;
    });
    const unique = new Set(effectiveRates);
    if (unique.size <= 1) return null;
    return el('div', {
        class: 'comparison-vat-warning',
        attrs: { role: 'status', 'aria-live': 'polite' }
    },
        el('span', { class: 'comparison-vat-warning-text',
            text: 'Ставки НДС различаются — итоги не сопоставимы напрямую.' })
    );
}

/* VAT-1 Phase 5: маленькая sub-line «НДС: 22% · авто» под именем calc в шапке.
   Минимальная информация, без захламления — детали в Опроснике / Memo. */
function renderComparisonVatChip(calc) {
    const s = calc?.settings || {};
    if (s.vatEnabled === false) {
        return el('div', { class: 'comparison-vat-chip',
            title: 'Расчёт без НДС.',
            text: 'без НДС' });
    }
    const rate = Number.isFinite(s.vatRate) ? s.vatRate : 0;
    const ratePct = Math.round(rate * 100);
    const mode = s.vatRateMode || 'auto-by-date';
    const modeLabel = mode === 'manual' ? 'вручную'
        : mode === 'frozen' ? 'заморожено'
        : 'авто';
    return el('div', {
        class: 'comparison-vat-chip',
        title: `Ставка НДС в расчёте «${calc.name || '—'}» — ${ratePct}% (${modeLabel}).`,
        text: `НДС ${ratePct}% · ${modeLabel}`
    });
}

function renderUnifiedTable(calcs, results, ctx, state) {
    /* --- Сбор всех ЭК и группировка по категориям --- */
    const itemMap = new Map();
    for (const c of calcs) {
        for (const it of c.dictionaries.items) {
            if (!itemMap.has(it.id)) itemMap.set(it.id, { id: it.id, name: it.name, category: it.category });
        }
    }
    const allItems = Array.from(itemMap.values());
    const groups = groupItemsByCategory(allItems);
    const presentCats = groups.map(g => g.catId);

    /* --- Состояние свёрнутых категорий ---
     * null = «не было сохранено» → дефолт = ВСЕ категории свёрнуты. UI на лету
     * разворачивает массив, когда пользователь раскрывает первую категорию. */
    const collapsedRaw = state?.ui?.comparisonCollapsedCats;
    const collapsedSet = collapsedRaw === null
        ? new Set(presentCats)                  // дефолт — всё свёрнуто
        : new Set(collapsedRaw);

    /* --- Сортировка по индикатору столбца --- */
    const sort = state?.ui?.comparisonSort;
    const sortActive = sort
        && Number.isInteger(sort.columnIndex)
        && sort.columnIndex >= 0
        && sort.columnIndex < calcs.length;

    const onColumnClick = (colIdx) => {
        const next = nextSortState(state?.ui?.comparisonSort || null, colIdx);
        ctx.setUi?.({ comparisonSort: next });
    };
    const onResetSort = () => ctx.setUi?.({ comparisonSort: null });

    /* 12.U30-fix: убрана отдельная delta-колонка — Δ теперь встроена в value-ячейку
       мелким текстом под суммой (как «+86,6% от базы» в Hero дашборда). Убрало дубль
       данных и сократило ширину таблицы. */
    const totalCols = 1 + calcs.length;

    return el('div', { class: 'comparison-unified' },
        /* Toolbar: индикатор сортировки + сброс + экспорт CSV.
           h3-заголовок убрали — таблица говорит сама за себя через 3-row sticky thead. */
        el('div', { class: 'tab-toolbar-actions comparison-export-actions' },
            sortActive && (() => {
                const sortedCalc = calcs[sort.columnIndex];
                const sortedScenario = activeScenarioLabelForCompare(sortedCalc);
                const sortedTitle = sortedScenario
                    ? `${sortedCalc.name} · сценарий: ${sortedScenario}`
                    : sortedCalc.name;
                return el('span', {
                    class: 'cmp-sort-status',
                    title: 'Постатейная таблица отсортирована по индикаторам столбца. ' +
                           'Клик на заголовке столбца переключает направление; третий клик сбрасывает.'
                },
                    el('span', { text: `Сортировка: «${sortedTitle}», ` }),
                    /* 12.U31 (Code Review Followup, E-P1): эмодзи `🟢 → 🔴` заменены на
                       текст «дешевле → дороже» и текстовые `min`/`max` (см. CLAUDE.md
                       «Эмодзи в UI запрещены»). Эмодзи рендерятся неконсистентно на
                       разных платформах и не несут смысла для screen-reader. */
                    el('span', { class: 'cmp-sort-direction',
                                 text: sort.direction === 'asc' ? 'min → max' : 'max → min' })
                );
            })(),
            sortActive && el('button', {
                class: 'btn btn-ghost btn-icon-text cmp-sort-reset',
                title: 'Сбросить сортировку — вернуться к исходному порядку ЭК внутри категорий',
                onClick: onResetSort
            },
                icon('x', { size: 14 }),
                el('span', { text: 'Сбросить сортировку' })
            ),
            el('button', {
                class: 'btn btn-ghost btn-icon-text',
                title: 'Скачать таблицу сравнения в Excel-совместимом формате CSV',
                onClick: (e) => ctx.exportComparisonCsv(e)
            },
                icon('bar-chart-3', { size: 16 }),
                el('span', { text: 'Экспорт сравнения CSV' })
            )
        ),

        el('div', { class: 'comparison-table-wrap' },
            el('table', { class: 'comparison-table comparison-table-unified' },
                el('thead', null,
                    /* Row 1: header — sticky на самом верху. Δ-колонка убрана —
                       Δ показывается подстрокой в каждой value-ячейке (мелким). */
                    el('tr', { class: 'cmp-header-row' },
                        el('th', { class: 'cmp-metric-col cmp-th-l1', text: 'Элемент' }),
                        ...calcs.map((c, i) => {
                            const isSorted = sortActive && sort.columnIndex === i;
                            const dirIcon = isSorted
                                ? (sort.direction === 'asc' ? ' ↑' : ' ↓')
                                : '';
                            const scenarioLabel = activeScenarioLabelForCompare(c);
                            return el('th', {
                                class: ['cmp-value-col', 'cmp-th-l1', 'cmp-sortable-col', isSorted && 'cmp-sorted-col'],
                                title: isSorted
                                    ? (sort.direction === 'asc'
                                        ? 'Сортировка: дешевле → дороже. Клик — переключить на «дороже → дешевле». Третий клик — сбросить.'
                                        : 'Сортировка: дороже → дешевле. Клик — сбросить.')
                                    : `Клик — отсортировать ЭК по индикаторам столбца «${c.name}» (дешевле/средне/дороже)`,
                                attrs: { 'aria-sort': isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none' },
                                onClick: () => onColumnClick(i)
                            },
                                el('div', { class: 'cmp-calc-name', text: c.name + dirIcon }),
                                /* Stage 3: подстрока с активным scenario, если у calc'а
                                   несколько сценариев. Тегом «сценарий: …» подчёркиваем,
                                   что это профиль внутри calc'а, а не другой расчёт. */
                                scenarioLabel
                                    ? el('div', { class: 'cmp-calc-scenario',
                                                  title: `Активный сценарий расчёта «${c.name}». Переключить можно на дашборде этого расчёта (вкладка-переключатель в шапке).`,
                                                  text: `сценарий: ${scenarioLabel}` })
                                    : null,
                                i > 0 ? el('div', { class: 'cmp-calc-baseline', text: `vs ${calcs[0].name}` }) : null,
                                /* VAT-1 Phase 5: ставка НДС каждого расчёта.
                                   Показывает «НДС 22% · авто» или «без НДС». */
                                renderComparisonVatChip(c)
                            );
                        })
                    ),
                    /* Row 2: «Стоимость / мес» — sticky под header. */
                    renderTotalsRow(calcs, results, {
                        rowClass: 'cmp-totals-row cmp-totals-row-monthly',
                        levelClass: 'cmp-th-l2',
                        label: 'Стоимость / мес',
                        get: r => r.totalMonthly
                    }),
                    /* Row 3: «Стоимость / год» — sticky под Row 2. */
                    renderTotalsRow(calcs, results, {
                        rowClass: 'cmp-totals-row cmp-totals-row-annual',
                        levelClass: 'cmp-th-l3',
                        label: 'Стоимость / год',
                        get: r => r.totalAnnual
                    })
                ),
                el('tbody', null,
                    ...groups.flatMap(group => {
                        const isCollapsed = collapsedSet.has(group.catId);
                        const catRow = renderCategoryRow({
                            group,
                            calcs,
                            results,
                            isCollapsed,
                            totalCols,
                            onToggle: () => ctx.toggleComparisonCategory?.(group.catId, presentCats)
                        });
                        if (isCollapsed) return [catRow];
                        // Раскрыта — рендерим items с применением сортировки.
                        let rows = buildItemRows(group.items, calcs, results);
                        if (sortActive) {
                            rows = sortRowsByIndicator(rows, sort.columnIndex, sort.direction);
                        }
                        return [catRow, ...rows.map(r => renderItemRow(r))];
                    })
                )
            )
        )
    );
}

/* Один totals-row в шапке: «Стоимость / мес (год)» с базовым значением.
 * Δ встроена внутрь value-ячейки подстрокой (без отдельного столбца). */
function renderTotalsRow(calcs, results, { rowClass, levelClass, label, get }) {
    const baseValue = get(results[0]);
    return el('tr', { class: rowClass },
        el('th', { class: ['cmp-metric-col', levelClass, 'cmp-totals-label'], text: label }),
        ...calcs.map((c, i) => {
            const v = get(results[i]);
            return el('th', { class: ['cmp-value-col', levelClass, 'mono'] },
                el('div', { class: 'cmp-value-main', text: money(v) }),
                i > 0 ? renderDeltaInline(v, baseValue) : null
            );
        })
    );
}

/** Inline-подстрока Δ в value-ячейке: «+5 000 ₽ (+1,2%)» с цветом up/down/zero. */
function renderDeltaInline(value, baseValue) {
    const delta = value - baseValue;
    if (delta === 0) {
        return el('div', { class: 'cmp-delta-inline cmp-delta-zero', text: '— нет разницы' });
    }
    const deltaPct = baseValue !== 0 ? delta / baseValue : 0;
    const cls = delta > 0 ? 'cmp-delta-up' : 'cmp-delta-down';
    const sign = delta > 0 ? '+' : '';
    return el('div', { class: ['cmp-delta-inline', cls],
        text: `${sign}${money(delta)} (${sign}${percent(deltaPct)})`
    });
}

/* Категория-row аккордеона: шеврон + название + counter + суммы + Δ. */
function renderCategoryRow({ group, calcs, results, isCollapsed, totalCols, onToggle }) {
    const baseSum = categoryColSum(group.items, results, 0);
    return el('tr', {
        class: ['cmp-cat-row', isCollapsed ? 'cmp-cat-row-collapsed' : 'cmp-cat-row-expanded'],
        attrs: { 'aria-expanded': isCollapsed ? 'false' : 'true' },
        onClick: () => onToggle && onToggle()
    },
        el('th', {
            class: 'cmp-cat-cell-label',
            attrs: { scope: 'row' }
        },
            el('button', {
                class: 'cmp-cat-toggle',
                attrs: { type: 'button', 'aria-label': isCollapsed ? 'Раскрыть категорию' : 'Свернуть категорию' },
                onClick: (e) => { e.stopPropagation(); onToggle && onToggle(); }
            },
                icon(isCollapsed ? 'chevron-right' : 'chevron-down', { size: 16 })
            ),
            el('span', { class: 'category-dot', style: { background: CATEGORY_COLORS[group.catId] || 'var(--text-dim)' } }),
            el('span', { class: 'cmp-cat-name', text: CATEGORY_LABELS[group.catId] || group.catId }),
            el('span', { class: 'cmp-cat-count', text: `· ${group.items.length}` })
        ),
        ...calcs.map((c, i) => {
            const v = categoryColSum(group.items, results, i);
            return el('td', { class: 'cmp-value-col mono cmp-cat-sum' },
                el('div', { class: 'cmp-value-main', text: money(v) }),
                i > 0 ? renderDeltaInline(v, baseSum) : null
            );
        })
    );
}

/* Item-row внутри раскрытой категории: имя + цена с встроенной Δ-подстрокой. */
function renderItemRow(row) {
    const baseCell = row.cells[0];
    return el('tr', { class: 'cmp-item-row' },
        el('td', { class: 'cmp-metric-col cmp-item-name' },
            el('span', { text: row.meta.name || '—' })
        ),
        ...row.cells.map((cell, i) => {
            if (!cell.present) {
                return el('td', { class: 'cmp-value-col cmp-empty mono', text: '—', title: 'Нет в этом расчёте' });
            }
            const ind = row.indicators[i];
            const indClass = ind === 'none' ? null : `cmp-ind-${ind}`;
            /* 12.U32 #1: epsilon-tolerant сравнение. Float-rounding после
               6+ накапливающихся умножений (риск-факторы × VAT) может дать
               остаток вроде 1e-12 в реально нулевой ячейке. isZeroMoney()
               использует EPSILON_KOPECK = 0.005 руб (полкопейки). */
            const showText = isZeroMoney(cell.value) ? '—' : money(cell.value);
            return el('td', {
                class: ['cmp-value-col', 'mono', indClass],
                title: INDICATOR_TITLES[ind] || ''
            },
                el('div', { class: 'cmp-value-main' },
                    ind !== 'none' ? el('span', {
                        class: ['cmp-ind-dot', `cmp-ind-dot-${ind}`],
                        attrs: { 'aria-label': INDICATOR_ARIA[ind], role: 'img' }
                    }) : null,
                    el('span', { text: showText })
                ),
                /* Δ только для калькуляторов кроме базового и при present обоих. */
                (i > 0 && baseCell.present)
                    ? renderDeltaInline(cell.value, baseCell.value)
                    : null
            );
        })
    );
}
