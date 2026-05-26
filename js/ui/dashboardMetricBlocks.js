import { el, infoIcon } from './dom.js';
import {
    DASHBOARD_AI_METRIC_LABELS,
    DASHBOARD_AI_METRIC_TITLES,
    DASHBOARD_AI_METRIC_DESCRIPTIONS,
    DASHBOARD_AI_METRIC_GROUP_TITLE,
    DASHBOARD_AI_METRIC_GROUP_HINT,
    DASHBOARD_AI_METRIC_UNIT_SUFFIX,
    MONTHS_PER_YEAR
} from '../utils/constants.js';
import { DASHBOARD_RESOURCE_ORDER, formatResourceQty } from './dashboardAggregates.js';

function periodSlash(period) {
    return period === 'daily' ? '/ день' : period === 'annual' ? '/ год' : '/ мес';
}

function periodMul(period) {
    return period === 'daily' ? 1 / 30 : period === 'annual' ? MONTHS_PER_YEAR : 1;
}

/**
 * Рендерит блок «Объёмы ресурсов» — список Label : qty unit.
 * @param {boolean} showModeBadge — показывать ли бейдж «С РИСКАМИ» / «БЕЗ РИСКОВ».
 *   На Hero (ИТОГО) — true (бейдж режима виден один раз для всего дашборда).
 *   На стенд-карточках — false (Hero уже показал бейдж, дублировать на каждой
 *   карточке = визуальный шум). Tooltip всё равно объясняет режим.
 */
export function renderResourcesBlock(resourceMap, titleText, applyRisks = true, showModeBadge = false, period = 'monthly') {
    const rows = [];
    /* Tooltip несёт только режимную часть — НЕ дублирует видимое
       «CPU 100 vCPU». Объясняет, что объём ВКЛЮЧАЕТ или НЕ включает
       capacity-буферы (информация, которой нет в самой строке). */
    const modeNote = applyRisks
        ? 'Объём с capacity-буферами: задачи / проект / сезон / сдвиг / контингент. Без VAT и инфляции — это финансовые факторы, не capacity.'
        : 'Объём без capacity-буферов — голый расчёт. Включите «Учитывать риск-коэффициенты» в Опроснике для оценки с буферами.';
    for (const label of DASHBOARD_RESOURCE_ORDER) {
        const entry = resourceMap[label];
        if (!entry) continue;
        const displayQty = entry.qty;
        const displayUnit = entry.unit;
        const displayLabel = label;
        const formatted = formatResourceQty(displayQty, entry.unit);
        if (formatted === null) {
            /* 12.U10: метка известна (есть ЭК с такой меткой в каталоге), но qty=0.
               Показываем «—» вместо silent skip — иначе пользователь не поймёт,
               есть ли вообще такой ресурс или это баг. Tooltip объясняет ПОЧЕМУ:
               - applicable=false → стенд не предусмотрен текущим каталогом.
               - applicable=true → стенд предусмотрен, но input-данные = 0. */
            const tooltip = entry.zeroReasonHint
                ? entry.zeroReasonHint
                : (entry.applicable
                    ? 'При текущих ответах Опросника объём = 0. Заполните соответствующие вопросы (объёмы БД, файлов, пиковая нагрузка), чтобы появилась оценка.'
                    : 'Для этого стенда ресурс не предусмотрен текущим каталогом ЭК. Если он нужен в проекте, добавьте применимость ресурса в справочник или включите соответствующий ЭК.');
            rows.push(el('div', { class: 'dash-resource-row dash-resource-row-empty', title: tooltip },
                el('span', { class: 'dash-resource-row-label', text: displayLabel }),
                el('span', { class: 'dash-resource-row-value' },
                    el('span', { class: 'dash-resource-row-qty dash-resource-row-qty-empty', text: '—' })
                )
            ));
            continue;
        }
        rows.push(el('div', { class: 'dash-resource-row', title: modeNote },
            el('span', { class: 'dash-resource-row-label', text: displayLabel }),
            el('span', { class: 'dash-resource-row-value' },
                el('span', { class: 'dash-resource-row-qty', text: formatted }),
                el('span', { class: 'dash-resource-row-unit', text: displayUnit })
            )
        ));
    }
    if (rows.length === 0) return null;
    const modeBadge = (showModeBadge && applyRisks)
        ? el('span', { class: 'dash-resources-badge dash-resources-badge-risk',
            title: 'Объёмы включают capacity-буферы (задачи/проект/сезон/сдвиг/контингент). VAT и инфляция к объёмам не применяются — это финансовые, не capacity-факторы.',
            text: 'С РИСКАМИ' })
        : (showModeBadge ? el('span', { class: 'dash-resources-badge dash-resources-badge-base',
            title: 'Объёмы показаны без capacity-буферов — голый расчёт. Включите «Учитывать риск-коэффициенты в бюджете» в Опроснике, чтобы увидеть объёмы с буферами.',
            text: 'БЕЗ РИСКОВ' }) : null);
    return el('div', { class: 'dash-resources' },
        el('div', { class: 'dash-resources-header' },
            el('span', { class: 'dash-resources-title', text: titleText || 'Объёмы ресурсов' }),
            modeBadge
        ),
        el('div', { class: 'dash-resources-grid' }, ...rows)
    );
}

/**
 * Sub-block «Метрики AI / RAG / агентов» — параллельный блок к
 * renderResourcesBlock. Возвращает null, если в текущем scope (ИТОГО или
 * конкретный стенд) нет ни одной AI-ЭК с qty>0 — для не-AI расчётов и для
 * стендов, на которых AI не разворачивается, блок не появляется.
 *
 * Встраивается:
 *   - в Hero — через scope `aiMetrics.total` ниже «Объёмов ресурсов · ИТОГО»;
 *   - в каждую стенд-карточку — через `aiMetrics.perStand[sid]` ниже
 *     «Объёмов ресурсов» этого стенда.
 *
 * Бейдж режима НЕ показывается — он живёт в шапке родительской карточки
 * (Hero / стенд-карточка), дубль на той же карточке = визуальный шум
 * (принцип «DRY ВНУТРИ scope», CLAUDE.md §11).
 *
 * @param {object} metricMap — { TOKENS: {qty, unit, applicable}, ... }
 * @param {string} titleText — заголовок блока
 * @param {boolean} applyRisks — режим расчёта (для tooltip-хинтов)
 * @param {object} ctx — нужен openMessageModal для info-кнопок
 */
/* Sub-block AI-метрик. period влияет ТОЛЬКО на flow-метрики (TOKENS,
   EMBEDDINGS — поток в течение периода): qty масштабируется на periodMul,
   suffix меняется с «/мес» на «/день» или «/год». Capacity-метрики
   (RAG_VECTORS — размер индекса в ГБ, AGENT_CPU — кол-во vCPU) от
   периода не зависят: размер на стенде сегодня = такой же завтра. */
export function renderAiMetricsBlock(metricMap, titleText, applyRisks, ctx, period = 'monthly') {
    // Скрываем блок, если в этом scope (total или per-stand) нет ни одной AI-ЭК.
    const hasAnyValue = DASHBOARD_AI_METRIC_LABELS.some(label => {
        const e = metricMap[label];
        return e && (e.qty > 0 || e.applicable);
    });
    if (!hasAnyValue) return null;

    const modeNote = applyRisks
        ? ' (с capacity-буферами: задачи/проект/сезон/сдвиг/контингент; без VAT и инфляции — финансовые факторы, не capacity)'
        : ' (без capacity-буферов — голый объём; включите «Учитывать риск-коэффициенты» в Опроснике для оценки с буферами)';

    /* period влияет только на flow-метрики (наличие непустого
       UNIT_SUFFIX = поток-семантика). Для capacity (пустой suffix)
       qty и unit остаются как есть, независимо от периода. */
    const periodMultiplier = periodMul(period);  // day=1/30, month=1, annual=12
    const periodSuffixText = periodSlash(period); // '/ день' | '/ мес' | '/ год'

    const rows = [];
    for (const label of DASHBOARD_AI_METRIC_LABELS) {
        const entry = metricMap[label];
        if (!entry) continue;
        const title = DASHBOARD_AI_METRIC_TITLES[label] || label;
        const desc = DASHBOARD_AI_METRIC_DESCRIPTIONS[label] || '';
        // Flow-метрика — есть непустой суффикс в DASHBOARD_AI_METRIC_UNIT_SUFFIX
        // (TOKENS, EMBEDDINGS). Capacity — пустой (RAG_VECTORS, AGENT_CPU).
        const isFlow = (DASHBOARD_AI_METRIC_UNIT_SUFFIX[label] || '').length > 0;

        // qty в periodMap всегда монтлы (агрегируется через capacity-буферы
        // по тому же правилу что hardware). Для flow-метрик умножаем на
        // periodMul, чтобы значение совпадало с выбранным периодом дашборда.
        const displayQty = isFlow ? entry.qty * periodMultiplier : entry.qty;
        const displaySuffix = isFlow ? ' ' + periodSuffixText : '';
        const fullUnit = entry.unit + displaySuffix;

        const intervalNote = isFlow
            ? ` Поток ${periodSuffixText.replace('/ ', 'за ')} — синхронен с переключателем периода.`
            : ' Размер на стенде — не зависит от интервала времени.';

        const openHint = (ev) => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            if (typeof ctx.openMessageModal === 'function') {
                ctx.openMessageModal({ title, message: desc });
            }
        };

        const formatted = formatResourceQty(displayQty, entry.unit);
        const isEmpty = formatted === null;

        /* Tooltip даёт ТОЛЬКО ту инфу, которой нет в видимой строке:
           для пустого qty — почему «—», для непустого — нюанс периода
           (поток vs. ёмкость) и режим расчёта (с буферами / без). Без
           префикса «Токены: 517 млн / мес» — это уже видно в самой строке. */
        const cellTooltip = isEmpty
            ? (entry.applicable
                ? 'При текущих ответах Опросника объём = 0. Заполните соответствующие вопросы про AI и поиск по корпоративной базе знаний, чтобы появилась оценка.'
                : 'На этом стенде эта нагрузка не предусмотрена (например, токены модели AI не закладываются на стенд разработки, если разработческие запросы не учитываются).')
            : `${intervalNote.trim()} ${modeNote.trim()}`.trim();

        const valueNode = isEmpty
            ? el('span', { class: 'dash-ai-metric-row-qty dash-ai-metric-row-qty-empty', text: '—' })
            : el('span', { class: 'dash-ai-metric-row-value' },
                el('span', { class: 'dash-ai-metric-row-qty', text: formatted }),
                el('span', { class: 'dash-ai-metric-row-unit', text: fullUnit })
            );

        rows.push(el('div', {
            class: ['dash-ai-metric-row', isEmpty && 'dash-ai-metric-row-empty'],
            title: cellTooltip
        },
            el('span', { class: 'dash-ai-metric-row-label-wrap' },
                el('span', { class: 'dash-ai-metric-row-label', text: title }),
                infoIcon(openHint, 'Подробное описание метрики')
            ),
            valueNode
        ));
    }

    const headerInfo = (typeof ctx.openMessageModal === 'function')
        ? infoIcon(
            (ev) => {
                ev?.preventDefault?.();
                ev?.stopPropagation?.();
                ctx.openMessageModal({
                    title: DASHBOARD_AI_METRIC_GROUP_TITLE,
                    message: DASHBOARD_AI_METRIC_GROUP_HINT
                });
            },
            'Что это за секция'
        )
        : null;

    return el('div', { class: 'dash-ai-metrics' },
        el('div', { class: 'dash-ai-metrics-header' },
            el('span', { class: 'dash-ai-metrics-title', text: titleText || DASHBOARD_AI_METRIC_GROUP_TITLE }),
            headerInfo
        ),
        el('div', { class: 'dash-ai-metrics-grid' }, ...rows)
    );
}
