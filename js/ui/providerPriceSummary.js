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
import { formatNumber } from '../services/format.js';

export { renderProviderUpdateRow } from './providerUpdateRow.js';

const fmtRub = n => formatNumber(n, { min: 0, max: 2 });

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
