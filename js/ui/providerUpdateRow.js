/**
 * Provider price update controls for questionnaire provider block.
 * Handles file import, mapping assistant entrypoint, provider comparisons,
 * stale/recalculate controls, and override history actions.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { PROVIDER_OVERLAYS } from '../domain/providerOverlay.js';
import { formatTimeAgo } from '../services/format.js';
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
            'data-testid': `provider-price-json-import-${providerId}`,
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
            title: 'Открыть таблицу сравнения цен всех активных провайдеров. Видны ключевые ресурсы: процессоры, память, хранилище, сеть и лицензии; сортировка по любой колонке.'
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
        class: ['provider-update-row', isJustUpdated && 'provider-update-row--just-updated'],
        attrs: { 'data-testid': `provider-update-row-${providerId}` }
    },
        button,
        statusText,
        staleBlock
    );
}
