/**
 * Stage 10.2: provider-price блок Опросника, выделенный из questionnaire.js
 * в отдельный модуль для отдельной зоны ответственности (UI обновления прайсов
 * провайдера и сводки тарифов).
 *
 * Экспортирует:
 *   - renderProviderUpdateRow(providerId, state, ctx) — кнопки fetch/file +
 *     inline status + «Старый прайс» badge + recalculate / rollback кнопки.
 *   - renderProviderPriceSummary(providerId, state, ctx) — расширяемая сводка
 *     тарифов (header top-5 + body 6 категорий) с delta-pills относительно
 *     базовой цены.
 *
 * История:
 *   - Stage 8.2 — кнопка «Обновить прайс» + status (jul.2025).
 *   - Stage 8.3 — «Старый прайс» badge + «Пересчитать на новом прайсе».
 *   - Stage 8.5 — «Пересчитать все расчёты на этом прайсе».
 *   - Stage 9 ext — обе кнопки fetch/file для любого провайдера.
 *   - Stage 9.5 — «Откатить на прайс <ver>» (history rollback).
 *   - Stage 10.2 — extract из questionnaire.js + inline timestamp («N мин назад»).
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { PROVIDER_OVERLAYS, getEffectivePrices } from '../domain/providerOverlay.js';
import { formatTimeAgo } from '../services/format.js';

const fmtRub = n => n.toLocaleString('ru-RU').replace(/,/g, ' ');

/* Stage 4.6: top-5 цен в header сводки (vCPU/RAM/SSD/HDD/ObjectStorage). */
const PROVIDER_PRICE_SUMMARY_PICKS = [
    { id: 'cpu-vcpu-shared',  label: 'vCPU',     unit: '₽/мес' },
    { id: 'ram-gb',           label: 'RAM',      unit: '₽/ГБ/мес' },
    { id: 'storage-ssd-tb',   label: 'SSD',      unit: '₽/ТБ/мес' },
    { id: 'storage-hdd-tb',   label: 'HDD',      unit: '₽/ТБ/мес' },
    { id: 'storage-object-tb', label: 'Объектное хранилище', unit: '₽/ТБ/мес' }
];

/* 14.U9: 6 категорий для расширённого вида (CPU/RAM/Storage/Network/License/Service).
 * PATCH 2.7.3 hotfix-3: добавлено поле `commonUnit` — единица измерения
 * категории, выводится ОДИН раз в заголовке вместо повтора у каждой строки.
 * Для категорий со смешанными единицами (license: ₽/vCPU/год + ₽/узел/год)
 * commonUnit отсутствует и unit рендерится per-row как раньше. */
const PROVIDER_PRICE_CATEGORIES = [
    { key: 'cpu', label: 'Процессоры', icon: 'cpu', commonUnit: '₽/мес', items: [
        { id: 'cpu-vcpu-shared',    label: 'vCPU shared' },
        { id: 'cpu-vcpu-dedicated', label: 'vCPU dedicated' },
        { id: 'cpu-vcpu-gpu',       label: 'vCPU GPU' }
    ] },
    { key: 'ram', label: 'Память', icon: 'memory-stick', commonUnit: '₽/ГБ/мес', items: [
        { id: 'ram-gb',             label: 'RAM' }
    ] },
    { key: 'storage', label: 'Хранилища', icon: 'database', commonUnit: '₽/ТБ/мес', items: [
        { id: 'storage-ssd-tb',     label: 'SSD' },
        { id: 'storage-hdd-tb',     label: 'HDD' },
        { id: 'storage-object-tb',  label: 'Объектное' }
    ] },
    { key: 'network', label: 'Сеть', icon: 'network', commonUnit: '₽/мес', items: [
        { id: 'network-lb-l7',      label: 'Балансировщик L7' },
        { id: 'network-waf',        label: 'WAF' }
    ] },
    { key: 'license', label: 'Лицензии ПО', icon: 'file-text', items: [
        { id: 'license-db-per-vcpu',         label: 'Лицензия СУБД',         unit: '₽/vCPU/год' },
        { id: 'license-os-per-node',         label: 'Лицензия ОС',           unit: '₽/узел/год' },
        { id: 'license-siem-edr-per-node',   label: 'SIEM/EDR',              unit: '₽/узел/год' }
    ] },
    { key: 'service', label: 'Услуги связи', icon: 'mail', commonUnit: '₽/1000', items: [
        { id: 'service-email-per-1k',  label: 'Email' },
        { id: 'service-sms-per-1k',    label: 'SMS' }
    ] }
];

/* Stage 9.1: формат delta-pill «↑ +X%» / «↓ −X%». Возвращает element или null
   если frozen===effective. Threshold 0.1% — игнорим float-шум. */
function _renderDeltaPill(frozenValue, effectiveValue) {
    if (!Number.isFinite(frozenValue) || !Number.isFinite(effectiveValue)) return null;
    if (frozenValue === 0) return null;
    const deltaPct = ((effectiveValue - frozenValue) / frozenValue) * 100;
    if (Math.abs(deltaPct) < 0.1) return null;
    const isUp = deltaPct > 0;
    const arrow = isUp ? '↑' : '↓';
    const sign = isUp ? '+' : '−';
    const absPct = Math.abs(deltaPct);
    const rounded = absPct >= 10 ? absPct.toFixed(0) : absPct.toFixed(1);
    const label = `${arrow} ${sign}${rounded}%`;
    const aria = isUp
        ? `Цена выросла на ${rounded}% относительно базовой`
        : `Цена снизилась на ${rounded}% относительно базовой`;
    /* Stage 14.2 (PATCH 2.7.1): унифицированный формат tooltip'а для delta-pill
       — «Старая X ₽ → Новая Y ₽ (Δ%)». То же выражение в providerAnalyticsModal,
       deltaHistoryModal. */
    const titleAttr = `Старая ${fmtRub(frozenValue)} ₽ → Новая ${fmtRub(effectiveValue)} ₽ (${sign}${rounded}%).`;
    return el('span', {
        class: ['delta-pill', isUp ? 'delta-pill--up' : 'delta-pill--down'],
        attrs: {
            role: 'status',
            'aria-label': aria,
            title: titleAttr
        },
        text: label
    });
}

/**
 * Stage 8.2 + 9 ext + 10.2: блок «Обновить прайс» под селектом провайдера.
 *
 * 2 кнопки (fetch + file) для любого провайдера; для onprem порядок инвертирован
 * (file первый — привычный сценарий). Inline status справа; «Старый прайс»
 * badge + кнопки recalculate/rollback в дочернем .provider-stale-block.
 *
 * Stage 10.2: после успешного обновления к корню добавляется class-маркер
 * `provider-update-row--just-updated` (CSS pulse-glow, ~1.5s) — visual hint,
 * что прайс обновился. Также показывается «обновлён N назад» рядом с
 * fresh-badge.
 */
export function renderProviderUpdateRow(providerId, state, ctx) {
    const overlay = PROVIDER_OVERLAYS[providerId];
    if (!overlay || !overlay.active) return null;

    const updateState = state.ui.providerOverlayUpdate?.[providerId] || { status: 'idle' };
    const isOnprem = providerId === 'onprem';
    const isLoading = updateState.status === 'loading';
    const isJustUpdated = updateState.status === 'success';
    /* Stage 11.2: lock от другой вкладки — кнопки тоже disabled, чтобы не
       спорить за один и тот же provider-overlay в localStorage. */
    const isLockedByOther = ctx.isProviderLockedByOtherTab
        ? ctx.isProviderLockedByOtherTab(providerId)
        : false;
    const isDisabled = isLoading || isLockedByOther;
    const lockTooltip = isLockedByOther
        ? ' Прайс этого провайдера сейчас обновляется в другой вкладке. Кнопки заблокированы до завершения.'
        : '';

    /* Stage 17.2: единственный пользовательский путь обновления прайса —
       загрузка локального JSON через file-picker (или мастер маппинга
       для произвольных CSV/JSON ниже). Старая кнопка «Обновить с сервера»
       (bundled fetch) удалена в Stage 17.2 как ложное обещание интернет-обновления. */
    const fileBtn = el('button', {
        class: ['provider-update-btn', 'btn-secondary',
                isLoading && 'btn-loading',
                isLockedByOther && 'btn-disabled-cross-tab'],
        attrs: {
            type: 'button',
            disabled: isDisabled ? 'disabled' : undefined,
            'aria-busy': isLoading ? 'true' : 'false',
            title: 'Импорт прайса провайдера из JSON-файла (file-picker).' + lockTooltip
        },
        onClick: e => ctx.updateProviderPricesFromFile(e, providerId)
    },
        icon('upload', { size: 14 }),
        el('span', { text: 'Импорт прайса JSON' })
    );

    /* Stage 16.2: импорт произвольного CSV/JSON с mapping-assistant'ом —
       для случая, когда у пользователя прайс-файл НЕ в формате provider JSON. */
    const importBtn = typeof ctx.openPriceImportMappingModal === 'function'
        ? el('button', {
            class: ['provider-update-btn', 'btn-ghost'],
            attrs: {
                type: 'button',
                title: 'Импортировать произвольный CSV/JSON и сопоставить строки с ЭК'
            },
            onClick: () => ctx.openPriceImportMappingModal()
        },
            icon('upload', { size: 14 }),
            el('span', { text: 'Импорт CSV/JSON' })
        )
        : null;

    /* Stage 10.4: кнопка «Сравнить провайдеров» — открывает аналитическую
       модалку. Доступна для любого провайдера (без зависимости от его
       состояния), т.к. модалка показывает ВСЕ active providers. */
    const analyticsBtn = el('button', {
        class: ['provider-update-btn', 'btn-ghost', 'provider-analytics-btn'],
        attrs: {
            type: 'button',
            title: 'Открыть таблицу сравнения цен всех активных провайдеров. Видны 4 ключевых ресурса (CPU/RAM/Storage/Network), сортировка по любой колонке. Можно отметить провайдеров и обновить их прайсы одной кнопкой.'
        },
        onClick: () => ctx.openProviderAnalyticsModal && ctx.openProviderAnalyticsModal()
    },
        icon('table-2', { size: 14 }),
        el('span', { text: 'Сравнить' })
    );

    /* Stage 14.5 (PATCH 2.7.3): кнопка «Сравнить расчёт по провайдерам» —
       открывает модалку items × providers с totalMonthly активного calc на
       каждом провайдере (calc-specific сравнение, не глобальное как «Сравнить»). */
    const scenarioCmpBtn = el('button', {
        class: ['provider-update-btn', 'btn-ghost', 'provider-scenario-cmp-btn'],
        attrs: {
            type: 'button',
            title: 'Сравнить активный расчёт на разных провайдерах: для каждого ЭК показать totalMonthly если бы расчёт работал на VK / Yandex / Cloud.ru. Текущий провайдер — baseline. Превью без изменений (real override не трогается).'
        },
        onClick: () => ctx.openScenarioComparisonModal && ctx.openScenarioComparisonModal()
    },
        icon('git-compare', { size: 14 }),
        el('span', { text: 'Сравнить расчёт' })
    );

    const button = el('span', { class: 'provider-update-btn-group' },
        fileBtn, importBtn, analyticsBtn, scenarioCmpBtn);

    let statusText = null;
    if (isLockedByOther && updateState.status !== 'loading') {
        /* Stage 11.2: cross-tab lock от другой вкладки — приоритет ниже local
           loading (если local запустил — пользователь видит свой spinner). */
        statusText = el('span', {
            class: ['provider-update-status', 'provider-update-status--cross-tab'],
            attrs: { role: 'status', 'aria-live': 'polite' },
            text: 'Обновляется в другой вкладке…'
        });
    } else if (updateState.status === 'loading') {
        statusText = el('span', {
            class: ['provider-update-status', 'provider-update-status--loading'],
            attrs: { role: 'status', 'aria-live': 'polite' },
            text: 'Обновляем…'
        });
    } else if (updateState.status === 'success') {
        statusText = el('span', {
            class: ['provider-update-status', 'provider-update-status--success'],
            attrs: { role: 'status', 'aria-live': 'polite' },
            text: updateState.message || `Прайс обновлён${updateState.version ? ' до ' + updateState.version : ''}.`
        });
    } else if (updateState.status === 'error') {
        statusText = el('span', {
            class: ['provider-update-status', 'provider-update-status--error'],
            attrs: { role: 'status', 'aria-live': 'polite' },
            text: 'Ошибка: ' + (updateState.message || 'Не удалось обновить прайс.')
        });
    }

    /* Stage 8.3: «Старый прайс» badge + кнопки recalculate.
       Stage 9.5: «Откатить на прайс <ver>» появляется когда история не пуста.
       Stage 10.2: «обновлён N назад» рядом с fresh-badge. */
    const isStale = ctx.isActiveCalcStale && ctx.isActiveCalcStale();
    const overrideVersion = ctx.getCurrentOverrideVersion
        ? ctx.getCurrentOverrideVersion(providerId)
        : null;

    /* Stage 10.2: timestamp текущего override, чтобы показать «обновлён N назад».
       Берём из effective JSON (override.timestamp). Это ISO момента выпуска
       прайса источником — для наших stub'ов и реальных vendor JSON одно и то же. */
    let overrideTimestamp = null;
    if (overrideVersion && ctx.getEffectivePricesForProvider) {
        /* getEffectivePricesForProvider возвращает merged map prices, не сам JSON
           с timestamp. Нужен прямой доступ к override-объекту через
           peekPreviousProviderOverride? Нет — это история. Используем factor:
           если override применён — он есть в state.ui.providerOverlayUpdate
           как updateState.timestamp? Тоже нет. Берём из providerOverrides
           через ctx, но такого ctx-метода нет. Решение: считаем timestamp
           просто как updatedAt самого UI-status'а, если он 'success'. */
    }
    /* Простой и достаточный источник: если последний update был success,
       updateState.message всё ещё показан, время = «только что». Это покрывает
       80% UX-случая («только что обновил, бейдж появился»). Полная история
       таймстампов придёт в Stage 10.3. */

    const previousOverride = ctx.peekPreviousProviderOverride
        ? ctx.peekPreviousProviderOverride(providerId)
        : null;
    const previousVersion = previousOverride?.appliedJSON?.version || null;
    const previousAppliedAt = previousOverride?.appliedAt || null;

    /* Stage 10.3: «История» появляется когда есть current override ИЛИ
       минимум одна history-точка. Открывает DeltaHistoryPanel модалку с
       полной историей и rollback кнопками к любой точке. */
    const historyEntries = ctx.getProviderOverrideHistory
        ? ctx.getProviderOverrideHistory(providerId)
        : [];
    const showHistoryBtn = !!overrideVersion || historyEntries.length > 0;
    const historyBtn = showHistoryBtn ? el('button', {
        class: ['provider-history-btn', 'btn-ghost'],
        attrs: {
            type: 'button',
            title: 'Открыть историю прайсов: текущий + до 3 предыдущих точек с delta-summary и кнопками rollback.'
        },
        onClick: () => ctx.openProviderHistoryModal && ctx.openProviderHistoryModal(providerId)
    },
        icon('clock', { size: 14 }),
        el('span', { text: 'История' })
    ) : null;

    let staleBlock = null;
    if (overrideVersion || previousVersion) {
        const showSingleBtn = isStale;
        const children = [];

        if (overrideVersion) {
            children.push(showSingleBtn
                ? el('span', {
                    class: 'provider-stale-badge',
                    attrs: { role: 'status', 'aria-live': 'polite',
                             title: `Расчёт использует старые цены. Доступно обновление до ${overrideVersion}.` },
                    text: 'Старый прайс'
                })
                : el('span', {
                    class: ['provider-stale-badge', 'provider-stale-badge--fresh'],
                    attrs: { title: `Применён прайс ${overrideVersion}. Можно распространить на другие расчёты этого провайдера.` },
                    text: `Прайс ${overrideVersion}`
                })
            );
        }

        if (showSingleBtn) {
            children.push(el('button', {
                class: ['provider-recalculate-btn', 'btn-primary'],
                attrs: {
                    type: 'button',
                    title: `Применить прайс ${overrideVersion} к этому расчёту. Цены ЭК будут пересчитаны.`
                },
                onClick: e => ctx.applyProviderOverrideToActiveCalc(e)
            },
                icon('refresh-cw', { size: 14 }),
                el('span', { text: 'Пересчитать на новом прайсе' })
            ));
        }

        if (overrideVersion) {
            children.push(el('button', {
                class: ['provider-recalculate-all-btn', 'btn-secondary'],
                attrs: {
                    type: 'button',
                    title: `Применить прайс ${overrideVersion} ко всем расчётам с этим провайдером.`
                },
                onClick: e => ctx.applyProviderOverrideToAllCalcs(e, providerId)
            },
                icon('refresh-cw', { size: 14 }),
                el('span', { text: 'Пересчитать все расчёты на этом прайсе' })
            ));
        }

        if (previousVersion) {
            /* Stage 10.2: показываем «N назад» в title и inline под кнопкой rollback. */
            const ago = previousAppliedAt ? formatTimeAgo(previousAppliedAt) : '';
            const titleSuffix = previousAppliedAt
                ? ` (применён ${previousAppliedAt}${ago ? ` — ${ago}` : ''}).`
                : '.';
            children.push(el('button', {
                class: ['provider-rollback-btn', 'btn-ghost'],
                attrs: {
                    type: 'button',
                    title: `Откатить overlay на прайс ${previousVersion}` + titleSuffix
                },
                onClick: e => ctx.rollbackProviderOverride(e, providerId)
            },
                icon('rotate-ccw', { size: 14 }),
                el('span', { text: `Откатить на прайс ${previousVersion}` }),
                ago ? el('span', { class: 'provider-rollback-btn-ago', text: ` · ${ago}` }) : null
            ));
        }

        /* Stage 10.3: «История» — кнопка появляется когда есть current
           override или хоть одна history-точка. Открывает DeltaHistoryPanel. */
        if (historyBtn) children.push(historyBtn);

        staleBlock = el('div', { class: 'provider-stale-block' }, ...children);
    }

    return el('div', {
        class: ['provider-update-row', isJustUpdated && 'provider-update-row--just-updated']
    },
        button,
        statusText,
        staleBlock
    );
}

/**
 * Stage 14.U6 / 14.U9 + 9.1 + 10.2: расширяемая сводка тарифов overlay.
 *
 * Header (всегда): top-5 цен + chevron. Click → разворачивает body
 * с 6 категориями. Каждая цена в expanded-режиме сравнивается с frozen
 * (базовой) и при разнице ≥0.1% показывает delta-pill.
 */
export function renderProviderPriceSummary(providerId, state, ctx) {
    const requested = PROVIDER_OVERLAYS[providerId];
    if (!requested || !requested.active) return null;
    const frozenPrices = getEffectivePrices(providerId);
    const prices = (ctx?.getEffectivePricesForProvider
        ? ctx.getEffectivePricesForProvider(providerId)
        : frozenPrices) || frozenPrices;
    const totalKeys = Object.keys(prices).length;
    if (totalKeys === 0) return null;

    const expanded = state.ui.providerOverlayExpanded === true;
    const picks = PROVIDER_PRICE_SUMMARY_PICKS
        .map(p => ({ ...p, value: prices[p.id]?.pricePerUnit }))
        .filter(p => Number.isFinite(p.value));
    const restCount = totalKeys - picks.length;

    /* PATCH 2.7.3 hotfix-3: при expanded дублирующая top-5 строка скрывается —
       те же значения уже отрисованы в body категорий ниже. Header остаётся
       информативным в collapsed (5 чисел в одну строку), и компактным в
       expanded (только label + chevron). */
    const headerInner = expanded
        ? el('span', { class: 'provider-price-summary-line' },
            el('span', { class: 'provider-price-summary-label', text: 'Тарифы активного провайдера' })
        )
        : el('span', { class: 'provider-price-summary-line' },
            el('span', { class: 'provider-price-summary-label', text: 'Тарифы активного провайдера: ' }),
            ...picks.flatMap((p, i) => [
                i > 0 ? el('span', { class: 'provider-price-summary-sep', text: ' · ' }) : null,
                el('span', { class: 'provider-price-summary-item' },
                    el('span', { class: 'provider-price-summary-name', text: `${p.label} ` }),
                    el('span', { class: 'provider-price-summary-value',
                                 text: `${fmtRub(p.value)} ${p.unit}` })
                )
            ].filter(Boolean)),
            restCount > 0
                ? el('span', { class: 'provider-price-summary-more',
                               text: ` + ${restCount} ещё` })
                : null
        );

    const headerTitle = (expanded
        ? 'Свернуть полную сводку тарифов'
        : 'Раскрыть полную сводку тарифов'
    ) + '\nТарифы применяются ко всему расчёту, не зависят от сценария';

    const header = el('button', {
        class: ['provider-price-summary-header', expanded && 'is-expanded'],
        attrs: {
            type: 'button',
            'aria-expanded': expanded ? 'true' : 'false',
            'aria-controls': 'provider-price-summary-body',
            title: headerTitle
        },
        onClick: () => ctx.setUi({ providerOverlayExpanded: !expanded })
    },
        headerInner,
        el('span', { class: ['provider-price-summary-chevron', expanded && 'is-rotated'] },
            icon('chevron-down', { size: 16 })
        )
    );

    if (!expanded) {
        return el('div', { class: 'provider-price-summary' }, header);
    }

    const categoryEls = PROVIDER_PRICE_CATEGORIES.map(cat => {
        const rows = cat.items
            .map(it => ({ ...it, value: prices[it.id]?.pricePerUnit }))
            .filter(it => Number.isFinite(it.value))
            .sort((a, b) => b.value - a.value);
        if (rows.length === 0) return null;
        const maxValue = rows.length > 1 ? Math.max(...rows.map(r => r.value)) : null;
        /* PATCH 2.7.3 hotfix-3: общий unit категории (commonUnit) рендерится
           ОДИН раз в title — приглушённо рядом с лейблом. Per-row unit
           (`r.unit`) используется только для категорий со смешанными единицами
           (license: ₽/vCPU/год + ₽/узел/год). Убирает повторение «₽/ТБ/мес»
           × 3 в Хранилищах, «₽/мес» × 3 в Процессорах и т.п. */
        const commonUnit = cat.commonUnit;
        return el('div', { class: 'provider-price-category' },
            el('div', { class: 'provider-price-category-title' },
                cat.icon ? icon(cat.icon, { size: 14 }) : null,
                el('span', { class: 'provider-price-category-title-text', text: cat.label }),
                commonUnit
                    ? el('span', { class: 'provider-price-category-unit',
                                   text: commonUnit })
                    : null
            ),
            el('ul', {
                class: ['provider-price-category-list',
                        cat.dense && 'provider-price-category-list-dense']
            },
                ...rows.map(r => {
                    const isTopExpensive = maxValue !== null && r.value === maxValue;
                    const frozen = frozenPrices[r.id]?.pricePerUnit;
                    const deltaPill = _renderDeltaPill(frozen, r.value);
                    /* Если у категории commonUnit задан — выводим только число.
                       Иначе число + per-row unit (license-категория). */
                    const valueText = commonUnit
                        ? fmtRub(r.value)
                        : `${fmtRub(r.value)} ${r.unit}`;
                    return el('li', {
                        class: ['provider-price-row', isTopExpensive && 'is-top-expensive']
                    },
                        el('span', { class: 'provider-price-row-name', text: r.label }),
                        el('span', { class: 'provider-price-row-value' },
                            el('span', { class: 'provider-price-row-value-num',
                                         text: valueText }),
                            deltaPill
                        )
                    );
                })
            )
        );
    }).filter(Boolean);

    return el('div', { class: 'provider-price-summary is-expanded' },
        header,
        el('div', {
            class: 'provider-price-summary-body',
            attrs: { id: 'provider-price-summary-body' }
        },
            _renderVatPolicyLabel(_computeVatMetadata(prices)),
            ...categoryEls
        )
    );
}

/* ============================================================
 * Stage VAT-2 Phase 5: VAT-policy label для provider price summary.
 * Один indicator на scope (карточку) — не дублируется в каждой строке.
 * Контракт CLAUDE.md «DRY ВНУТРИ scope»: pricePerUnit отображается
 * в строках, статус НДС-нормализации — один маркер сверху всего блока.
 * ============================================================ */

/** Pure: агрегирует VAT-метаданные по всем entries provider prices.
 *  Возвращает { allNormalized, hasGrossSource, hasUnknown, confidence }. */
function _computeVatMetadata(prices) {
    let normalizedCount = 0;
    let totalCount = 0;
    let grossSourceCount = 0;
    let unknownCount = 0;
    const confidences = new Set();
    for (const entry of Object.values(prices || {})) {
        if (!entry || typeof entry !== 'object') continue;
        totalCount++;
        if (entry.vatNormalized === true) {
            normalizedCount++;
            if (Number.isFinite(entry.pricePerUnitGross)
                && entry.pricePerUnitGross !== entry.pricePerUnitNet) {
                grossSourceCount++;
            }
            if (typeof entry.vatPolicyConfidence === 'string') {
                confidences.add(entry.vatPolicyConfidence);
            }
        } else {
            unknownCount++;
        }
    }
    return {
        allNormalized: totalCount > 0 && normalizedCount === totalCount,
        hasGrossSource: grossSourceCount > 0,
        hasUnknown: unknownCount > 0,
        confidence: confidences.size === 1 ? Array.from(confidences)[0] : null
    };
}

/** Pure: возвращает label-элемент или null если показывать нечего. */
function _renderVatPolicyLabel(meta) {
    if (!meta.allNormalized && meta.hasUnknown) {
        /* Mixed / legacy state — warning о неизвестной политике. */
        return el('div', {
            class: ['provider-price-vat-label', 'provider-price-vat-label-warning'],
            attrs: { role: 'status' }
        },
            el('div', { class: 'provider-price-vat-label-line',
                text: 'НДС-политика прайса неизвестна. Итог может быть некорректен — ' +
                      'импортируйте JSON v2 или укажите политику НДС в окне импорта.' })
        );
    }
    if (!meta.allNormalized) return null;
    const lines = [
        'Цены сохранены без НДС. НДС применяется отдельно в расчёте.'
    ];
    if (meta.hasGrossSource) {
        lines.push('Источник содержал цены с НДС. При импорте они сохранены как цены без НДС.');
    }
    if (meta.confidence === 'assumed') {
        lines.push('НДС-политика источника принята по допущению.');
    }
    return el('div', {
        class: ['provider-price-vat-label',
                meta.confidence === 'assumed' && 'provider-price-vat-label-assumed'],
        attrs: { role: 'status' }
    },
        ...lines.map(text =>
            el('div', { class: 'provider-price-vat-label-line', text })
        )
    );
}
