/**
 * Sprint 3.0 Stage 2: горизонтальный tab-switcher для сценариев расчёта.
 *
 * Размещение: в topbar между названием calc и persist-индикатором (см. header.js).
 * Виден на всех экранах (Опросник / Дашборд / Детализация / Сравнение).
 *
 * Каждая вкладка — clickable button + kebab «⋯» для действий (Rename / Duplicate /
 * Delete) через scenarioMenu modal. Trailing «+ Сценарий» добавляет новый.
 *
 * Legacy fallback: для calc'ов без scenarios[] — рендерится одна виртуальная
 * вкладка «Базовый» (см. getScenariosForUI в state/scenarios.js). Первое же
 * CRUD-действие через _withSyncedRoot bootstrap'ит реальный scenarios[].
 *
 * a11y: каждая вкладка — `<button role="tab" aria-selected>`, kebab — `<button
 * aria-label="Действия для сценария …">`. На мобиле полоса horizontal-scrollable.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { getScenariosForUI, countManualOverridesInScenario } from '../domain/scenarios.js';

export function renderScenarioTabs(state, ctx) {
    const calc = state.activeCalc;
    if (!calc) return null;
    const scenarios = getScenariosForUI(calc);
    if (scenarios.length === 0) return null;

    const activeId = calc.activeScenarioId
        || (scenarios[0] && scenarios[0].id);

    return el('div', {
        class: 'scenario-tabs',
        attrs: { role: 'tablist', 'aria-label': 'Сценарии расчёта' }
    },
        ...scenarios.map(s => renderTab(s, s.id === activeId, scenarios.length, ctx)),
        renderAddButton(ctx)
    );
}

function renderTab(scenario, isActive, totalCount, ctx) {
    const onSwitch = () => {
        if (!isActive) ctx.switchScenario(scenario.id);
    };
    const onMenu = (e) => {
        e.stopPropagation();
        ctx.openScenarioMenu(scenario.id);
    };

    /* Stage 4.5: индикатор-точка для сценариев с ручными правками. Точка имеет
       свой собственный tooltip — пользователь на hover точки видит «N правок
       вручную», на hover label'а — стандартный «Активный/Переключиться на».
       Native title на span внутри button работает раздельно от button.title. */
    const overrideCount = countManualOverridesInScenario(scenario);
    const hasOverrides = overrideCount > 0;

    return el('div', {
        class: ['scenario-tab', isActive && 'is-active'],
        attrs: { role: 'tab', 'aria-selected': isActive ? 'true' : 'false' }
    },
        el('button', {
            class: 'scenario-tab-body',
            attrs: { type: 'button', title: isActive ? `Активный сценарий: ${scenario.label}` : `Переключиться на сценарий «${scenario.label}»` },
            onClick: onSwitch
        },
            el('span', { class: 'scenario-tab-label', text: scenario.label }),
            hasOverrides
                ? el('span', {
                    class: 'scenario-tab-override-dot',
                    attrs: {
                        title: `${overrideCount} ${pluralizeRu(overrideCount, 'правка', 'правки', 'правок')} вручную`,
                        'aria-label': `${overrideCount} ручных правок в этом сценарии`,
                        role: 'img'
                    }
                })
                : null
        ),
        el('button', {
            class: 'scenario-tab-menu',
            attrs: {
                type: 'button',
                'aria-label': `Действия для сценария ${scenario.label}`,
                title: 'Действия со сценарием: переименовать, дублировать, удалить'
            },
            onClick: onMenu
        },
            icon('more-horizontal', { size: 14 })
        )
    );
}

/** Русская плюрализация для счётчика правок: «1 правка», «2 правки», «5 правок». */
function pluralizeRu(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}

function renderAddButton(ctx) {
    return el('button', {
        class: 'scenario-tabs-add',
        attrs: {
            type: 'button',
            /* 2026-05-18: tooltip с конкретным примером — раньше был абстрактный
               текст («альтернативные настройки / сравнить варианты»), пользователь
               не понимал что именно даёт фича. Теперь — 3 контрастных сценария
               на типовом расчёте, чтобы сразу было видно use-case. */
            title: 'Сценарий — отдельный набор ответов опросника ВНУТРИ текущего расчёта. ' +
                   'Создайте, чтобы сравнить варианты, не теряя исходный. ' +
                   'Например: «Базовый» (1000 пользователей, без AI) → «+GPU» ' +
                   '(тот же масштаб, включён AI-агент) → «×5 нагрузка» (5000 пользователей). ' +
                   'Переключаетесь между ними одним кликом — сразу видно, как меняется итоговая стоимость каждого варианта.'
        },
        onClick: () => ctx.addScenario()
    },
        icon('plus', { size: 14 }),
        el('span', { class: 'scenario-tabs-add-label', text: 'Сценарий' })
    );
}

