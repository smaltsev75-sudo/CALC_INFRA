import { buildProdPassport } from '../domain/prodPassport.js';
import { csvSafeQuote, downloadCsv } from '../services/csvExport.js';
import { CATEGORY_LABELS } from '../utils/constants.js';
import { el, trustedHtml } from './dom.js';
import { error as showError } from './snackbar.js';

const SEARCH_PATCH_DELAY_MS = 120;

/* Сколько крупнейших ЭК показываем отдельными плитками; остальные сворачиваются
 * в плитку «Прочее (N ЭК)». В драфте это 9 видимых + «Прочее». */
const TREEMAP_TOP_TILES = 9;
/* На сколько колонок раскладывается карта (как 3 колонки в драфте). */
const TREEMAP_COLUMNS = 3;

let searchPatchTimer = null;
let restoreSearchFocusOnce = false;

/* ============================================================
 * Категории: маппинг ВЕРХНЕРЕГИСТРОВОГО id ЭК (HW/LICENSE/…) на
 * lowercase-суффикс CSS-классов драфта (c-hw, cat-dot и т.д.),
 * человекочитаемую подпись и глиф иконки детализации.
 * ============================================================ */
const CATEGORY_CLASS_SUFFIX = Object.freeze({
    HW: 'hw',
    LICENSE: 'license',
    TRAFFIC: 'traffic',
    SERVICES: 'services',
    SECURITY: 'security',
    AI: 'ai',
    RESERVES: 'reserves'
});

function categorySuffix(category) {
    return CATEGORY_CLASS_SUFFIX[category] || 'reserves';
}

function categoryLabel(category) {
    return CATEGORY_LABELS[category] || 'Резервы';
}

/* Глиф иконки детализации по категории (стиль Lucide, stroke=currentColor) —
 * меняется вместе с цветом при выборе другой плитки на карте. SVG здесь, а не
 * через icon(), потому что нужны категорийные глифы вне общего набора icons.js. */
const DETAIL_ICON_ATTR =
    'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const CATEGORY_DETAIL_ICON = Object.freeze({
    hw: `<svg ${DETAIL_ICON_ATTR}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3"/></svg>`,
    license: `<svg ${DETAIL_ICON_ATTR}><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.6-8.6"/><path d="m16 5 3 3"/><path d="m19.5 8.5 1.5-1.5"/></svg>`,
    traffic: `<svg ${DETAIL_ICON_ATTR}><path d="M8 3v18M8 3 4 7M8 3l4 4"/><path d="M16 21V3M16 21l-4-4M16 21l4-4"/></svg>`,
    services: `<svg ${DETAIL_ICON_ATTR}><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>`,
    security: `<svg ${DETAIL_ICON_ATTR}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    ai: `<svg ${DETAIL_ICON_ATTR}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"/></svg>`,
    reserves: `<svg ${DETAIL_ICON_ATTR}><path d="M3 7a2 2 0 0 1 2-2h13v3"/><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H5"/><path d="M16 13h.01"/></svg>`
});

/* Inline-SVG, повторяющие глифы драфта (вне общего набора icons.js). */
const SVG = Object.freeze({
    grid: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h7v7H3z"/><path d="M14 3h7v4h-7z"/><path d="M14 11h7v10h-7z"/><path d="M3 14h7v7H3z"/></svg>',
    countTile: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    legend: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="13.5" r="2.5"/><circle cx="17" cy="17" r="2.5"/><circle cx="6.5" cy="6.5" r="2.5"/></svg>',
    factors: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>',
    info: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    flagDefault: '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
    flagRepair: '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    flagWarning: '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    quantityLabel: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>',
    paramsLabel: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    stepArrow: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
    costLabel: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 7.5h.01"/><path d="M3 11V5a2 2 0 0 1 2-2h6l9.3 9.3a1.7 1.7 0 0 1 0 2.4l-5.6 5.6a1.7 1.7 0 0 1-2.4 0L3 11z"/></svg>',
    srcInfo: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>'
});

function inlineSvg(markup, className) {
    return el('span', {
        class: className ? ['pp-svg', className] : 'pp-svg',
        trustedHtml: trustedHtml(markup),
        attrs: { 'aria-hidden': 'true' }
    });
}

const csvCell = value => csvSafeQuote(value, ';');

function moneyThousands(value) {
    const n = Number(value) || 0;
    return Math.round(n / 1000);
}

/* «1 009 тыс.руб./мес.» → «1 009» (короткое число для плиток и KPI-крупных). */
function stripMonthlySuffix(text) {
    return String(text || '').replace(/\s*тыс\.руб\.\/мес\.\s*$/u, '').trim();
}

function stripAnnualSuffix(text) {
    return String(text || '').replace(/\s*тыс\.руб\.\/год\.?\s*$/u, '').trim();
}

/* «88 шт.» → «88», «88» (значение + единица отдельно) для KPI-карточки детали:
 * единица идёт ПОД значением. */
function splitQuantity(quantityText, unit) {
    const text = String(quantityText || '').trim();
    if (unit && text.endsWith(unit)) {
        return { value: text.slice(0, text.length - unit.length).trim(), unit };
    }
    return { value: text, unit: '' };
}

function factorSegColor(index) {
    /* те же 6 тонов, что в legend через CSS-классы prod-passport-factor-tone-*. */
    return `prod-passport-factor-tone-${index % 6}`;
}

/* ============================================================
 * Поиск
 * ============================================================ */
function scheduleSearchPatch(ctx, search) {
    if (searchPatchTimer) clearTimeout(searchPatchTimer);
    searchPatchTimer = setTimeout(() => {
        restoreSearchFocusOnce = true;
        ctx.patchModal('prodPassport', { search, selectedItemId: null });
    }, SEARCH_PATCH_DELAY_MS);
}

function restoreSearchFocus(input) {
    if (!restoreSearchFocusOnce || !input) return;
    restoreSearchFocusOnce = false;
    const schedule = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : callback => setTimeout(callback, 0);
    schedule(() => {
        if (!input.isConnected) return;
        input.focus();
        const end = String(input.value || '').length;
        try {
            input.setSelectionRange(end, end);
        } catch {
            /* search input may reject selection in older engines */
        }
    });
}

/* ============================================================
 * Treemap (карта бюджета)
 * ============================================================
 * Площадь плитки ∝ monthlyCost. Крупнейшие TREEMAP_TOP_TILES — отдельными
 * плитками; остальные сворачиваются в синтетическую плитку «Прочее (N ЭК)».
 * Плитки раскладываются на TREEMAP_COLUMNS колонок жадным балансом по сумме
 * стоимости: flex колонки = сумма стоимостей её плиток, flex плитки внутри
 * колонки = её стоимость. Это воспроизводит вложенную flex-структуру драфта
 * (tm-col → tile/tm-row) на реальных данных.
 */
function buildTreemapTiles(items, totalMonthly, expanded) {
    if (expanded) {
        return items.map(row => ({
            kind: 'item',
            row,
            weight: Math.max(0, Number(row.monthlyCost) || 0)
        }));
    }
    const tiles = items.slice(0, TREEMAP_TOP_TILES).map(row => ({
        kind: 'item',
        row,
        weight: Math.max(0, Number(row.monthlyCost) || 0)
    }));

    const rest = items.slice(TREEMAP_TOP_TILES);
    if (rest.length) {
        const restMonthly = rest.reduce((sum, row) => sum + (Number(row.monthlyCost) || 0), 0);
        const restShare = totalMonthly > 0 ? restMonthly / totalMonthly * 100 : 0;
        tiles.push({
            kind: 'other',
            count: rest.length,
            monthlyCost: restMonthly,
            budgetSharePercent: restShare,
            weight: Math.max(0, restMonthly)
        });
    }
    return tiles;
}

/* Жадно раскладываем плитки по колонкам, балансируя сумму weight каждой
 * колонки. Плитки уже отсортированы по убыванию — кладём каждую в наименее
 * заполненную колонку (классический LPT). Возвращает массив колонок с tiles. */
function packIntoColumns(tiles, columnCount) {
    const count = Math.max(1, Math.min(columnCount, tiles.length || 1));
    const columns = Array.from({ length: count }, () => ({ tiles: [], weight: 0 }));
    for (const tile of tiles) {
        let target = columns[0];
        for (const column of columns) {
            if (column.weight < target.weight) target = column;
        }
        target.tiles.push(tile);
        target.weight += tile.weight;
    }
    return columns.filter(column => column.tiles.length > 0);
}

function tileSizeClass(weight, maxWeight) {
    if (maxWeight <= 0) return 'sm';
    const ratio = weight / maxWeight;
    if (ratio >= 0.6) return '';
    if (ratio >= 0.18) return 'sm';
    return 'xs';
}

function tileMarkerFlag(row) {
    const marker = row.markers && row.markers[0];
    if (!marker) return null;
    const svgMap = { default: SVG.flagDefault, repair: SVG.flagRepair, warning: SVG.flagWarning };
    return el('span', {
        class: 'pp-tile-flag',
        title: marker.title,
        attrs: { 'aria-hidden': 'true' },
        trustedHtml: trustedHtml(svgMap[marker.type] || SVG.flagWarning)
    });
}

function renderItemTile(tile, selectedItemId, sizeClass, ctx) {
    const row = tile.row;
    const suffix = categorySuffix(row.category);
    const selected = row.itemId === selectedItemId;
    const moneyShort = stripMonthlySuffix(row.monthlyText);
    const title = `${row.name} · ${row.quantityText} · ${row.monthlyText} · ${row.budgetShareText}`;
    return el('button', {
        class: [
            'pp-tile', `pp-c-${suffix}`,
            sizeClass && `pp-tile-${sizeClass}`,
            selected && 'pp-tile-sel'
        ],
        attrs: {
            type: 'button',
            'data-testid': `prod-passport-tile-${row.itemId}`,
            'aria-pressed': selected ? 'true' : 'false',
            'aria-label': `${row.name}, ${row.monthlyText}, ${row.budgetShareText}`
        },
        dataset: {
            itemId: row.itemId,
            monthlyCost: String(row.monthlyCost),
            budgetShare: String(row.budgetSharePercent)
        },
        title,
        style: { flex: String(Math.max(1, tile.weight)) },
        onClick: () => ctx.patchModal('prodPassport', { selectedItemId: row.itemId })
    },
        el('div', { class: 'pp-tile-top' },
            el('div', { class: 'pp-tile-name', text: row.name }),
            tileMarkerFlag(row)
        ),
        el('div', { class: 'pp-tile-meta' },
            row.quantityText ? el('div', { class: 'pp-tile-qty', text: row.quantityText }) : null,
            el('div', { class: 'pp-tile-bot' },
                el('span', { class: 'pp-tile-budget', text: moneyShort }),
                el('span', { class: 'pp-tile-pct', text: row.budgetShareText })
            )
        )
    );
}

function renderOtherTile(tile, sizeClass, ctx) {
    const moneyShort = stripMonthlySuffix(formatMonthlyText(tile.monthlyCost));
    const pct = formatShareText(tile.budgetSharePercent);
    const name = `Прочее · ${tile.count} ЭК`;
    return el('button', {
        class: ['pp-tile', 'pp-c-other', sizeClass && `pp-tile-${sizeClass}`],
        attrs: {
            type: 'button',
            'data-testid': 'prod-passport-tile-other',
            'aria-label': `Прочее, ${tile.count} ЭК, ${moneyShort} тыс.руб./мес., ${pct}. Показать все статьи.`
        },
        dataset: { other: String(tile.count) },
        title: `Прочее · ${tile.count} ЭК · ~${moneyShort} тыс.руб./мес. · ${pct} · показать все`,
        style: { flex: String(Math.max(1, tile.weight)) },
        onClick: () => ctx.patchModal('prodPassport', { treemapExpanded: true })
    },
        el('div', { class: 'pp-tile-top' },
            el('div', { class: 'pp-tile-name', text: name })
        ),
        el('div', { class: 'pp-tile-meta' },
            el('div', { class: 'pp-tile-bot' },
                el('span', { class: 'pp-tile-budget', text: `~${moneyShort}` }),
                el('span', { class: 'pp-tile-pct', text: pct })
            )
        )
    );
}

/* Форматтеры числа без суффикса для синтетической плитки «Прочее» и легенды
 * факторов — domain отдаёт уже готовый текст для реальных ЭК, но «Прочее»
 * агрегируется в UI, поэтому повторяем формат тыс.руб./мес. локально. */
function formatMonthlyText(rub) {
    const thousands = moneyThousands(rub);
    return `${new Intl.NumberFormat('ru-RU').format(thousands)} тыс.руб./мес.`;
}

function formatShareText(percent) {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(percent) || 0)}%`;
}

function renderTreemap(items, totalMonthly, selectedItemId, ctx, expanded) {
    const tiles = buildTreemapTiles(items, totalMonthly, expanded);
    const maxWeight = tiles.reduce((max, tile) => Math.max(max, tile.weight), 0);
    const columns = packIntoColumns(tiles, TREEMAP_COLUMNS);
    return el('div', {
        class: 'pp-treemap',
        attrs: { 'data-testid': 'prod-passport-treemap' }
    },
        columns.map(column => el('div', {
            class: 'pp-tm-col',
            style: { flex: String(Math.max(1, column.weight)) }
        },
            column.tiles.map(tile => {
                const sizeClass = tileSizeClass(tile.weight, maxWeight);
                return tile.kind === 'other'
                    ? renderOtherTile(tile, sizeClass, ctx)
                    : renderItemTile(tile, selectedItemId, sizeClass, ctx);
            })
        ))
    );
}

/* ============================================================
 * Легенда категорий
 * ============================================================ */
function renderCategoryLegend(items) {
    const present = new Set(items.map(row => row.category));
    const order = ['HW', 'LICENSE', 'TRAFFIC', 'SERVICES', 'SECURITY', 'AI', 'RESERVES'];
    const shown = order.filter(category => present.has(category));
    const legendCategories = shown.length ? shown : order;
    return el('div', { class: 'pp-legend-card' },
        el('h3', { class: 'pp-legend-title' },
            inlineSvg(SVG.legend),
            el('span', { text: 'Категории' })
        ),
        el('div', { class: 'pp-legend' },
            legendCategories.map(category => el('div', { class: 'pp-lg' },
                el('span', {
                    class: 'pp-lg-sw',
                    style: { background: `var(--cat-${categorySuffix(category)})` },
                    attrs: { 'aria-hidden': 'true' }
                }),
                el('span', { text: categoryLabel(category) })
            ))
        )
    );
}

/* ============================================================
 * Факторы влияния — Вариант 3: сегментированная полоса + легенда
 * ============================================================ */
function renderFactors(model) {
    const factors = model.summary.topFactors || [];
    const totalImpact = factors.reduce((sum, factor) => sum + (Number(factor.monthlyImpact) || 0), 0);
    const segmentAria = factors
        .map(factor => `${factor.label} ${moneyThousands(factor.monthlyImpact)} — ${formatRelativeShare(factor.monthlyImpact, totalImpact)}`)
        .join('; ');

    return el('section', {
        class: 'pp-factors-card',
        attrs: { 'data-testid': 'prod-passport-top-factors' }
    },
        el('div', { class: 'pp-factors-head' },
            el('div', { class: 'pp-factors-title' },
                el('h2', null,
                    inlineSvg(SVG.factors),
                    el('span', { text: 'Факторы влияния' })
                ),
                el('span', { class: 'pp-factors-caption', text: '· относительный вклад показанных факторов' })
            ),
            el('div', { class: 'pp-factors-right' },
                el('span', { class: 'pp-factors-unit', text: 'тыс.руб./мес.' }),
                el('span', {
                    class: 'pp-factors-info',
                    attrs: {
                        tabindex: '0',
                        role: 'img',
                        'aria-label': 'Доли среди показанных факторов, а не от всего бюджета: охваты пересекаются.'
                    },
                    title: 'Доли среди показанных факторов, а не от всего бюджета: охваты пересекаются.',
                    trustedHtml: trustedHtml(SVG.info)
                })
            )
        ),
        factors.length === 0
            ? el('div', { class: 'pp-empty', text: 'Нет факторов с заметным охватом.' })
            : [
                el('div', {
                    class: 'pp-fct3-bar',
                    attrs: { role: 'img', 'aria-label': `Состав вклада факторов: ${segmentAria}` }
                },
                    factors.map((factor, index) => el('div', {
                        class: ['pp-fct3-seg', factorSegColor(index)],
                        title: `${factor.label}: ${factor.monthlyText} — ${formatRelativeShare(factor.monthlyImpact, totalImpact)} состава`,
                        dataset: { fieldId: factor.fieldId },
                        style: { width: `${relativeSharePercent(factor.monthlyImpact, totalImpact)}%` }
                    }))
                ),
                el('div', { class: 'pp-fct3-legend' },
                    factors.map((factor, index) => el('div', { class: 'pp-fct3-item' },
                        el('span', {
                            class: ['pp-fct3-swatch', factorSegColor(index)],
                            attrs: { 'aria-hidden': 'true' }
                        }),
                        el('span', { class: 'pp-fct3-name', text: factor.label }),
                        el('span', { class: 'pp-fct3-sum', text: String(moneyThousands(factor.monthlyImpact)) })
                    ))
                )
            ]
    );
}

function relativeSharePercent(value, total) {
    if (total <= 0) return 0;
    return Math.round(((Number(value) || 0) / total) * 10000) / 100;
}

function formatRelativeShare(value, total) {
    return `${Math.round(relativeSharePercent(value, total))} %`;
}

/* ============================================================
 * Детализация выбранного ЭК (правая колонка)
 * ============================================================ */
function srcKind(input) {
    const label = input.sourceLabel || '';
    if (label === 'введено вручную') return 'manual';
    if (label === 'из опросника') return 'quiz';
    if (label === 'из Quick Start') return 'quiz';
    if (label === 'значение по умолчанию') return 'default';
    if (label === 'автоисправлено при загрузке') return 'default';
    return 'calc';
}

const SRC_HINT = Object.freeze({
    manual: 'Вы ввели это значение вручную в Опроснике.',
    quiz: 'Значение взято из вашего ответа в Опроснике.',
    default: 'Значение не было задано — подставлено значение по умолчанию из калькулятора.',
    calc: 'Общий параметр расчёта (буферы, НДС, размеры стендов), заданный в настройках.'
});

function renderParamRow(input) {
    const kind = srcKind(input);
    return el('div', { class: 'pp-params-row' },
        el('span', { class: 'pp-p-name', text: input.label }),
        el('span', { class: 'pp-p-val', text: input.valueText }),
        el('span', {
            class: ['pp-src', `pp-src-${kind}`],
            title: SRC_HINT[kind] || input.sourceLabel,
            attrs: { 'aria-label': `Источник: ${input.sourceLabel}` }
        },
            el('span', { class: 'pp-src-txt', text: input.sourceLabel }),
            inlineSvg(SVG.srcInfo, 'pp-src-info')
        )
    );
}

function renderDetailParams(row) {
    const inputs = [
        ...(row.inputs.questions || []),
        ...(row.inputs.settings || [])
    ];
    if (!inputs.length) return null;
    return el('div', { class: 'pp-params', attrs: { 'data-testid': 'prod-passport-detail-params' } },
        el('div', { class: 'pp-params-row pp-params-head' },
            el('span', { class: 'pp-p-head pp-p-head-l', text: 'Параметр' }),
            el('span', { class: 'pp-p-head pp-p-head-r', text: 'Значение' }),
            el('span', { class: 'pp-p-head pp-p-head-l', text: 'Источник' })
        ),
        inputs.map(renderParamRow)
    );
}

function renderCostChips(row) {
    const components = row.costFormula.components || [];
    return el('div', { class: 'pp-mult' },
        components.flatMap((component, index) => {
            const chip = el('span', {
                class: ['pp-mchip', index === 0 && 'pp-mchip-base'],
                title: component.hint
            },
                el('span', { class: 'pp-mchip-v', text: component.text }),
                el('span', { class: 'pp-mchip-l', text: component.label })
            );
            const times = index < components.length - 1
                ? el('span', { class: 'pp-mtimes', attrs: { 'aria-hidden': 'true' }, text: '×' })
                : null;
            return [chip, times];
        })
    );
}

function renderDetail(model, selectedItemId) {
    const row = model.items.find(item => item.itemId === selectedItemId) || model.items[0];
    if (!row) {
        return el('div', { class: 'pp-right-scroll' },
            el('div', { class: 'pp-empty', text: 'Выберите статью на карте для расшифровки.' })
        );
    }
    const suffix = categorySuffix(row.category);
    const catVar = `var(--cat-${suffix})`;
    const qty = splitQuantity(row.quantityText, row.unit);
    const monthShort = stripMonthlySuffix(row.monthlyText);
    const yearShort = stripAnnualSuffix(row.annualText);

    return el('div', {
        class: 'pp-right-scroll',
        attrs: { 'data-testid': 'prod-passport-detail' },
        dataset: {
            itemId: row.itemId,
            quantity: String(row.quantity),
            monthlyCost: String(row.monthlyCost),
            annualCost: String(row.annualCost)
        }
    },
        /* --- Шапка детали: иконка по категории + название + категория --- */
        el('div', { class: 'pp-detail-head' },
            el('span', {
                class: 'pp-detail-icon',
                attrs: { 'aria-hidden': 'true' },
                style: {
                    background: `color-mix(in srgb, ${catVar} 14%, transparent)`,
                    color: catVar,
                    borderColor: `color-mix(in srgb, ${catVar} 30%, transparent)`
                },
                trustedHtml: trustedHtml(CATEGORY_DETAIL_ICON[suffix] || CATEGORY_DETAIL_ICON.hw)
            }),
            el('div', { class: 'pp-detail-title' },
                el('h3', { text: row.name }),
                el('div', { class: 'pp-detail-cat' },
                    el('span', { class: 'pp-cat-dot', style: { background: catVar }, attrs: { 'aria-hidden': 'true' } }),
                    el('span', { text: categoryLabel(row.category) })
                )
            )
        ),

        /* --- KPI-карточки: ед.изм. ПОД значением --- */
        el('div', { class: 'pp-detail-kpis' },
            renderKpi('Количество', qty.value, qty.unit, false),
            renderKpi('Бюджет', monthShort, 'тыс.руб./мес.', true),
            renderKpi('В год', yearShort, 'тыс.руб./год', false),
            renderKpi('Доля', String(row.budgetShareText).replace('%', '').trim(), '%', false)
        ),

        /* --- Как получено количество (правило → подстановка) --- */
        el('p', { class: 'pp-section-label' },
            inlineSvg(SVG.quantityLabel),
            el('span', { text: 'Как получено количество' })
        ),
        row.errors.length
            ? el('div', {
                class: 'pp-error',
                attrs: { 'data-testid': 'prod-passport-formula-error' },
                text: row.errorText
            })
            : null,
        el('div', { class: 'pp-pipe' },
            el('div', { class: ['pp-step', 'pp-step-formula'] },
                el('span', { class: 'pp-step-num', attrs: { 'aria-hidden': 'true' }, text: '1' }),
                el('div', { class: 'pp-step-kicker', text: 'Правило расчёта' }),
                el('div', { class: 'pp-step-body', text: row.quantityFormula.text })
            ),
            el('div', { class: 'pp-step-connector', attrs: { 'aria-hidden': 'true' } },
                inlineSvg(SVG.stepArrow)
            ),
            el('div', {
                class: ['pp-step', 'pp-step-subst'],
                attrs: { 'data-testid': 'prod-passport-quantity-calculation' }
            },
                el('span', { class: 'pp-step-num', attrs: { 'aria-hidden': 'true' }, text: '2' }),
                el('div', { class: 'pp-step-kicker', text: 'Подстановка реальных значений' }),
                el('div', { class: 'pp-code', text: row.quantityFormula.substitution })
            )
        ),

        /* --- Входные параметры расчёта --- */
        el('p', { class: 'pp-section-label pp-section-label-mt' },
            inlineSvg(SVG.paramsLabel),
            el('span', { text: 'Входные параметры расчёта' })
        ),
        renderDetailParams(row),

        /* spacer для выравнивания низа «Стоимости» с нижним краем «Факторов» */
        el('div', { class: 'pp-detail-spacer', attrs: { 'aria-hidden': 'true' } }),

        /* --- Как получена стоимость --- */
        el('div', { class: 'pp-cost' },
            el('div', { class: 'pp-cost-head' },
                el('p', { class: 'pp-section-label' },
                    inlineSvg(SVG.costLabel),
                    el('span', { text: 'Как получена стоимость' })
                ),
                el('span', { class: 'pp-cost-total' },
                    el('span', { text: stripMonthlySuffix(row.costFormula.resultText) }),
                    el('span', { class: 'pp-cost-unit', text: 'тыс.руб./мес.' })
                )
            ),
            renderCostChips(row)
        )
    );
}

function renderKpi(label, value, unit, highlight) {
    return el('div', { class: ['pp-dk', highlight && 'pp-dk-hl'] },
        el('span', { class: 'pp-dk-l', text: label }),
        el('span', { class: 'pp-dk-v', text: value }),
        unit ? el('span', { class: 'pp-dk-u', text: unit }) : null
    );
}

/* ============================================================
 * Сводка-шапка (KPI strip + поиск)
 * ============================================================ */
function renderSummaryStrip(model, ctx) {
    const search = model.search || '';
    const searchInput = el('input', {
        class: 'pp-search-input',
        type: 'search',
        value: search,
        placeholder: 'Поиск статьи на карте…',
        attrs: {
            'data-testid': 'prod-passport-search',
            'data-focus-key': 'prod-passport-search',
            'aria-label': 'Поиск статьи по названию'
        },
        onInput: event => scheduleSearchPatch(ctx, event.target.value)
    });
    restoreSearchFocus(searchInput);

    return el('div', { class: 'pp-summary', attrs: { 'data-testid': 'prod-passport-summary' } },
        renderSummaryStat(
            'Элементов конфигурации',
            String(model.summary.itemsCount),
            '',
            false,
            'prod-passport-summary-items',
            SVG.countTile
        ),
        renderSummaryStat(
            'Бюджет',
            stripMonthlySuffix(model.summary.totalMonthlyText),
            'тыс.руб./мес.',
            true,
            'prod-passport-summary-month'
        ),
        renderSummaryStat(
            'За год',
            stripAnnualSuffix(model.summary.totalAnnualText),
            'тыс.руб./год',
            false,
            'prod-passport-summary-year'
        ),
        el('div', { class: 'pp-summary-sp' }),
        el('label', { class: 'pp-search' },
            inlineSvg(SVG.search),
            searchInput
        )
    );
}

function renderSummaryStat(label, value, small, highlight, testId, iconSvg) {
    return el('div', {
        class: ['pp-stat', highlight && 'pp-stat-hl'],
        attrs: { 'data-testid': testId }
    },
        el('span', { class: 'pp-stat-k' },
            iconSvg ? inlineSvg(iconSvg) : null,
            el('span', { text: label })
        ),
        el('span', { class: 'pp-stat-v' },
            el('span', { text: value }),
            small ? el('small', { text: small }) : null
        )
    );
}

/* ============================================================
 * CSV (переиспользуем существующие helpers сервиса)
 * ============================================================ */
export function buildProdPassportCsv(model) {
    const header = ['ЭК', 'Количество', 'Бюджет/мес., тыс.руб.', '% бюджета'];
    const rows = model.items.map(row => [
        row.name,
        row.quantityText,
        String(moneyThousands(row.monthlyCost)),
        row.budgetShareText
    ]);
    return '﻿' + [header, ...rows].map(line => line.map(csvCell).join(';')).join('\r\n');
}

export function buildProdPassportCsvFilename(calcName = 'calculation') {
    const safeName = String(calcName || 'calculation').replace(/[\\/:*?"<>|]+/g, '_');
    return `passport-prod-${safeName}.csv`;
}

export function exportProdPassportCsv(model, calcName = 'calculation') {
    try {
        downloadCsv(buildProdPassportCsvFilename(calcName), buildProdPassportCsv(model));
        return { ok: true };
    } catch (error) {
        console.error('[prodPassportReport] Не удалось скачать CSV Паспорта ПРОМ', error);
        showError('Не удалось скачать CSV Паспорта ПРОМ.');
        return { ok: false, error };
    }
}

/* ============================================================
 * Empty-state: стенд ПРОМ скрыт в Детализации
 * ============================================================ */
function renderStandDisabled(model) {
    return el('section', {
        class: 'pp-stand-disabled',
        attrs: { 'data-testid': 'prod-passport-stand-disabled' }
    },
        inlineSvg(SVG.info),
        el('div', null,
            el('strong', { text: 'Паспорт ПРОМ недоступен' }),
            el('p', { text: model.emptyStateMessage })
        )
    );
}

/**
 * Строит модель и собирает структуру драфта «Паспорт ПРОМ»:
 * шапка-сводка + поиск, ЛЕВО = карта бюджета (treemap) + категории + факторы,
 * ПРАВО = детализация выбранного ЭК (конвейер расчёта). Данные строго из
 * buildProdPassport(calc, {result}); UI ничего не пересчитывает.
 */
export function renderProdPassportReport(calc, result, modalState, ctx) {
    const model = buildProdPassport(calc, {
        result,
        stand: 'PROD',
        /* лимит >= числа всех ЭК: на карте показываем всё (пагинации нет) */
        limit: Number.MAX_SAFE_INTEGER,
        offset: 0,
        topFactorsLimit: 6,
        search: modalState?.search || ''
    });

    if (model.standDisabled) {
        return el('div', {
            class: 'pp-report pp-report-disabled',
            attrs: { 'data-testid': 'prod-passport-report' }
        },
            renderStandDisabled(model)
        );
    }

    const selectedItemId = (modalState?.selectedItemId
        && model.items.some(item => item.itemId === modalState.selectedItemId))
        ? modalState.selectedItemId
        : model.items[0]?.itemId || null;
    const treemapExpanded = !!modalState?.treemapExpanded;

    return el('div', {
        class: 'pp-report',
        attrs: { 'data-testid': 'prod-passport-report' }
    },
        renderSummaryStrip(model, ctx),
        el('div', { class: 'pp-body' },
            el('div', { class: 'pp-left' },
                el('div', { class: 'pp-section-cap' },
                    el('h2', null,
                        inlineSvg(SVG.grid),
                        el('span', { text: 'Карта бюджета ПРОМ' })
                    ),
                    treemapExpanded
                        ? el('button', {
                            class: 'pp-map-collapse',
                            attrs: { type: 'button', 'data-testid': 'prod-passport-treemap-collapse' },
                            onClick: () => ctx.patchModal('prodPassport', { treemapExpanded: false })
                        }, el('span', { text: 'Свернуть карту' }))
                        : el('span', { class: 'pp-hint-txt', text: 'цвет — категория · клик — детализация' })
                ),
                model.items.length === 0
                    ? el('div', { class: 'pp-empty', text: model.search ? 'По этому названию статьи не найдены.' : 'Для ПРОМ нет статей с количеством или бюджетом.' })
                    : renderTreemap(model.items, model.summary.totalMonthly, selectedItemId, ctx, treemapExpanded),
                el('div', { class: 'pp-left-bottom' },
                    renderCategoryLegend(model.items),
                    renderFactors(model)
                )
            ),
            el('div', { class: 'pp-right' },
                renderDetail(model, selectedItemId)
            )
        )
    );
}

/**
 * Строит модель Паспорта ПРОМ для внешних потребителей (кастомная шапка модалки
 * с кнопкой CSV). UI ничего не пересчитывает — данные берутся из
 * buildProdPassport(calc, {result}), детерминированно совпадая с отчётом.
 */
export function buildProdPassportModel(calc, result, modalState) {
    return buildProdPassport(calc, {
        result,
        stand: 'PROD',
        limit: Number.MAX_SAFE_INTEGER,
        offset: 0,
        topFactorsLimit: 6,
        search: modalState?.search || ''
    });
}
