import { el, infoIcon } from './dom.js';
import {
    STAND_IDS, STAND_LABELS, STAND_RATIO_RANGES,
    DEFAULT_STAND_SIZE_RATIO,
    DEFAULT_RESOURCE_RATIO,
    DEFAULT_AI_STAND_FACTOR,
    AI_STAND_FACTOR_RANGES,
    DASHBOARD_RESOURCE_LABELS
} from '../utils/constants.js';
import { formatNumber, parseNumberInput } from '../services/format.js';
import { DECIMAL_INPUT_TYPE, applyDecimalInputPrecision, decimalInputAttrs, formatDecimalInputValue } from './decimalInput.js';
import { SEED_ITEMS } from '../domain/seed.js';

// 12.U12: индекс ЭК из SEED для UI-fallback applicableStands/dashboardResource
// в существующих расчётах, у которых dictionary.items был сохранён без этих полей.
const SEED_ITEM_BY_ID = new Map(SEED_ITEMS.map(it => [it.id, it]));

/* ---------- Размеры стендов ---------- */

export function renderStandSizeRatios(calc, ctx) {
    const ratios = (calc.settings.standSizeRatio && typeof calc.settings.standSizeRatio === 'object')
        ? calc.settings.standSizeRatio
        : { ...DEFAULT_STAND_SIZE_RATIO };

    const updateStand = (stand, value) => {
        const range = STAND_RATIO_RANGES[stand];
        if (!range || range.fixed) return;
        if (!Number.isFinite(value)) return;
        const clamped = Math.min(range.max, Math.max(range.min, value));
        const next = { ...ratios, [stand]: clamped };
        // PROD всегда 1.00 — гарантия инварианта.
        next.PROD = 1.00;
        if (typeof ctx.setStandSizeRatio === 'function') {
            ctx.setStandSizeRatio(stand, clamped);
        } else {
            ctx.setSetting('standSizeRatio', next);
        }
    };

    // 12.U13: PROD не показываем — он эталон 1.00 (fixed) и поле было только
    // визуальным шумом (disabled, не редактируется). Согласуемся с таблицей
    // per-resource ratios, где PROD тоже не отрисован. Текст в hint напоминает
    // про инвариант. STAND_IDS глобально не трогаем — это только display order.
    const STAND_DISPLAY_ORDER = STAND_IDS.filter(s => s !== 'PROD' && s !== 'LOAD').concat(['LOAD']);

    const fields = STAND_DISPLAY_ORDER.map(stand => {
        const range = STAND_RATIO_RANGES[stand];
        const isFixed = !!range?.fixed;
        const cur = Number.isFinite(ratios[stand]) ? ratios[stand] : DEFAULT_STAND_SIZE_RATIO[stand];

        return el('label', { class: 'field' },
            el('span', { class: 'field-label', text: STAND_LABELS[stand] || stand }),
            el('input', {
                class: ['input', isFixed && 'input-readonly'],
                type: DECIMAL_INPUT_TYPE,
                value: formatDecimalInputValue(cur),
                title: isFixed
                    ? 'ПРОМ зафиксирован = 1.00 как эталон. Размеры остальных стендов задаются относительно ПРОМ.'
                    : `Множитель ресурсов стенда ${STAND_LABELS[stand]} относительно ПРОМ (` +
                      `${formatNumber(range.min, { min: 2, max: 2 })}…${formatNumber(range.max, { min: 2, max: 2 })}).`,
                attrs: decimalInputAttrs({
                    disabled: isFixed ? '' : undefined,
                    'data-focus-key': `setting:standSizeRatio.${stand}`
                }),
                onInput: e => {
                    const n = parseNumberInput(applyDecimalInputPrecision(e.target));
                    if (Number.isFinite(n)) updateStand(stand, n);
                }
            })
        );
    });

    return el('div', { class: 'stand-size-ratios' },
        el('div', { class: 'stand-size-ratios-title', text: 'Общий размер стендов (для Услуг, Лицензий, Безопасности, Трафика)' }),
        el('div', { class: 'stand-size-ratios-grid' }, ...fields),
        el('div', { class: 'stand-size-ratios-hint' },
            'ПРОМ зафиксирован = 1.00 (эталон, не редактируется). Эти множители применяются ТОЛЬКО к ЭК БЕЗ ' +
            'привязки к типу ресурса — Услугам, Лицензиям, Безопасности и Трафику. ' +
            'Для аппаратных ресурсов (CPU/GPU/RAM/SSD/HDD/S3) есть отдельная таблица ниже — ' +
            '«Размеры аппаратных ресурсов на стендах», где значение задаётся индивидуально для каждого ресурса × стенда. ' +
            'Два блока независимы: изменения здесь не затрагивают аппаратные ресурсы (и наоборот). ' +
            'Стенд «Нагрузка» может превышать единицу (нагрузочные испытания с запасом).'
        )
    );
}

/* AI-фактор на стенд: для каждого стенда отдельно задаём ДОЛЮ
   AI-нагрузки (LLM-токены, RAG-эмбеддинги, vCPU агентов).

   Зачем нужно: AI-расходы НЕ масштабируются как железо. На DEV железо
   обычно 16% от ПРОМ (потому что компиляция и юнит-тесты), но LLM-вызовы
   там обычно нулевые (используется mock). Поэтому AI получил свой
   множитель отдельно от standSizeRatio.

   Граничные значения:
     0   = AI на стенде полностью выключен (ноль токенов, ноль эмбеддингов).
     0.5 = половина продовой нагрузки.
     1.0 = как на ПРОМ (полный объём).
   PROD заперт = 1.00 (эталон, не редактируется).

   Defaults: DEV=0, ИФТ=0.2, ПСИ=0.5, Нагрузка=1.0. Пользователь
   уточняет под свой проектный факт (например для PSI-ручных-проверок
   ставит 0.1 — чтобы не платить за полный продовый трафик при приёмке).

   В UI: ряд из 4 чисел 0..100% (PROD не показываем, он всегда 100%).
   Применяется ко ВСЕМ AI-ЭК (item.category === 'AI'). Если ai_llm_used
   выключен — поля приглушены, но значения сохраняются. */
export function renderAiStandFactors(calc, ctx) {
    const factors = (calc.settings.aiStandFactor && typeof calc.settings.aiStandFactor === 'object')
        ? calc.settings.aiStandFactor
        : { ...DEFAULT_AI_STAND_FACTOR };

    const aiUsed = calc.answers?.ai_llm_used === true;

    const updateStand = (stand, percent) => {
        if (!Number.isFinite(percent)) return;
        const range = AI_STAND_FACTOR_RANGES[stand];
        if (!range || range.fixed) return;
        const fraction = Math.min(range.max, Math.max(range.min, percent / 100));
        if (typeof ctx.setAiStandFactor === 'function') {
            ctx.setAiStandFactor(stand, fraction);
        }
    };

    // PROD не редактируем — отдельная плашка-подсказка показывает «100% (эталон)».
    const STAND_DISPLAY_ORDER = STAND_IDS.filter(s => s !== 'PROD' && s !== 'LOAD').concat(['LOAD']);

    const fields = STAND_DISPLAY_ORDER.map(stand => {
        const range = AI_STAND_FACTOR_RANGES[stand];
        const cur = Number.isFinite(factors[stand]) ? factors[stand] : DEFAULT_AI_STAND_FACTOR[stand];
        const curPercent = cur * 100;

        const tooltip =
            `Доля AI-нагрузки на стенде ${STAND_LABELS[stand]}: 0% = AI выкл., 100% = как на ПРОМ. ` +
            `Применяется к токенам LLM, эмбеддингам RAG, vCPU агентов. ` +
            (aiUsed ? '' : 'Поле приглушено: AI выключен мастер-переключателем «Используется LLM».');

        return el('label', { class: ['field', !aiUsed && 'field-disabled'] },
            el('span', { class: 'field-label', text: `${STAND_LABELS[stand] || stand}, %` }),
            el('input', {
                class: 'input',
                type: DECIMAL_INPUT_TYPE,
                value: formatDecimalInputValue(curPercent),
                title: tooltip,
                disabled: !aiUsed,
                attrs: decimalInputAttrs({
                    'data-focus-key': `setting:aiStandFactor.${stand}`
                }),
                onInput: e => {
                    const n = parseNumberInput(applyDecimalInputPrecision(e.target));
                    if (Number.isFinite(n)) updateStand(stand, n);
                }
            })
        );
    });

    // PATCH 2.4.33: PROD больше не disabled-input. Юзер-feedback: «зачем
    // выводишь ПРОМ если его нельзя корректировать?». Disabled-input визуально
    // выглядит как поле — пользователь пытается на него кликнуть. Заменяем
    // на визуально-отличный anchor-блок «100% эталон» с dashed-border —
    // явно non-input, понятно что reference value.
    const prodField = el('div', { class: 'field stand-prod-anchor-field' },
        el('span', { class: 'field-label', text: `${STAND_LABELS.PROD || 'ПРОМ'}, %` }),
        el('div', {
            class: 'stand-prod-anchor',
            title: 'ПРОМ — эталон AI-нагрузки = 100% по определению. Все остальные стенды задаются как доля от ПРОМ; редактирование ПРОМ нарушило бы инвариант «стенд ≤ ПРОМ».',
            attrs: { 'aria-label': 'ПРОМ = 100% (эталон, не редактируется)' }
        },
            el('span', { class: 'stand-prod-anchor-value', text: '100%' }),
            el('span', { class: 'stand-prod-anchor-suffix', text: 'эталон' })
        )
    );

    // PATCH 2.4.35: ПРОМ — последний (после Нагрузки). Логика чтения слева
    // направо повторяет жизненный цикл стенда: DEV → IFT → PSI → LOAD → PROD,
    // где PROD = эталон, к которому стремятся остальные. fields = [DEV, IFT,
    // PSI, LOAD], prodField добавляется в конец.
    const ordered = [...fields, prodField];

    return el('div', { class: 'stand-size-ratios ai-stand-factors' },
        el('div', { class: 'stand-size-ratios-title' },
            el('span', { text: 'AI-нагрузка на стендах' }),
            infoIcon(
                ev => {
                    ev?.preventDefault?.();
                    ev?.stopPropagation?.();
                    if (typeof ctx.openMessageModal === 'function') {
                        ctx.openMessageModal({
                            title: 'AI-нагрузка на стендах — что это',
                            message:
                                'Для каждого стенда отдельно задаём ДОЛЮ AI-нагрузки от продовой ' +
                                '(0..100%). Применяется к токенам LLM, эмбеддингам RAG, vCPU агентов.\n\n' +
                                'Зачем отдельно от «Размеров стендов»: AI не масштабируется как железо. ' +
                                'На DEV железо ~16% ПРОМ (компиляция/тесты), но LLM-вызовы там обычно ' +
                                'нулевые (mock). Поэтому AI получил свой множитель.\n\n' +
                                'Значения:\n' +
                                '  • 0% — AI на стенде полностью выключен.\n' +
                                '  • 50% — половина продовой нагрузки.\n' +
                                '  • 100% — как на ПРОМ.\n\n' +
                                'Defaults: DEV=0%, ИФТ=20%, ПСИ=50%, Нагрузка=100%, ПРОМ=100% (эталон).\n\n' +
                                'Когда менять: если на ПСИ делаете только ручную приёмку (10 запросов в день, ' +
                                'не полный продовый трафик) — поставьте 5-10% и сэкономите токенный бюджет.'
                        });
                    }
                },
                'AI-нагрузка на стендах: что это и когда менять'
            )
        ),
        el('div', { class: 'stand-size-ratios-grid' }, ...ordered),
        el('div', { class: 'stand-size-ratios-hint' },
            aiUsed
                ? '0% = AI на стенде выключен (ноль токенов и эмбеддингов). 100% = полный объём как на ПРОМ. ' +
                  'ПРОМ заперт = 100% (эталон). Применяется ко всем AI-ЭК — токенам, RAG, vCPU агентов.'
                : 'AI выключен мастер-переключателем «Используется LLM». Включите его в подгруппе ' +
                  '«Использование LLM» выше, чтобы редактировать факторы.'
        )
    );
}

/* ---------- 12.U12: per-resource множители (CPU/GPU/RAM/SSD/HDD/S3 × DEV/IFT/PSI/LOAD) ----------
 *
 * Таблица 4×6: для каждого аппаратного ресурса (по `dashboardResource` ЭК) пользователь
 * может задать свой множитель относительно ПРОМ. Это даёт точный контроль над тем,
 * сколько vCPU / GB RAM / TB HDD / etc. зарезервировано на каждом стенде.
 *
 * Применимость ячейки определяется по `applicableStands` ЭК с этой меткой:
 * если ни один ЭК с `dashboardResource=HDD` не применим к DEV, то ячейка
 * (DEV,HDD) — disabled с tooltip «Не предусмотрено текущим каталогом».
 *
 * PROD не показывается — эталон 1.00 для всех ресурсов (фиксированно в schema v3).
 * Калькулятор подменяет `S.standSizeRatio.<STAND>` на per-resource значение в зависимости
 * от dashboardResource текущего ЭК — формулы в seed.js не правились (см. calculator.js).
 */
export function renderResourceRatios(calc, ctx) {
    // Источник истины для значений: settings.resourceRatio (после миграции v3 — обязательно есть).
    const matrix = (calc.settings.resourceRatio && typeof calc.settings.resourceRatio === 'object')
        ? calc.settings.resourceRatio
        : DEFAULT_RESOURCE_RATIO;

    // Применимость (stand, resource) — есть ли хоть один ЭК словаря с такой меткой
    // и applicableStands, включающим этот стенд. Если нет — ячейка disabled.
    const items = calc.dictionaries?.items || [];
    const labelStands = {};  // { CPU: Set('DEV','IFT',...), ... }
    for (const item of items) {
        const seed = SEED_ITEM_BY_ID.get(item.id);
        const label = item.dashboardResource ?? seed?.dashboardResource;
        if (!label || !DASHBOARD_RESOURCE_LABELS.includes(label)) continue;
        if (!labelStands[label]) labelStands[label] = new Set();
        const stands = (item.applicableStands && item.applicableStands.length > 0)
            ? item.applicableStands
            : (seed?.applicableStands || STAND_IDS);
        for (const sid of stands) labelStands[label].add(sid);
    }

    // Стенды без PROD (эталон) — DEV, IFT, PSI, LOAD.
    const editableStands = STAND_IDS.filter(s => s !== 'PROD');

    const updateCell = (stand, resource, percentValue) => {
        // Преобразуем процент в долю: 70 → 0.70.
        const ratio = Number.isFinite(percentValue) ? percentValue / 100 : null;
        if (ratio === null) return;
        // Диапазон: общий standSizeRatio range на этот стенд.
        const range = STAND_RATIO_RANGES[stand];
        const clamped = Math.min(range.max, Math.max(range.min, ratio));
        if (typeof ctx.setResourceRatio === 'function') {
            ctx.setResourceRatio(stand, resource, clamped);
        }
    };

    // 12.U13: транспонированная таблица — строки=ресурсы, колонки=стенды.
    // Заголовок: пустая первая ячейка (для лейблов ресурсов) + 4 метки стендов.
    const headerRow = el('div', { class: 'resource-ratio-row resource-ratio-header' },
        el('span', { class: 'resource-ratio-cell resource-ratio-cell-label' }, ''),
        ...editableStands.map(stand =>
            el('span', { class: 'resource-ratio-cell resource-ratio-cell-head', text: STAND_LABELS[stand] })
        )
    );

    const resourceRows = DASHBOARD_RESOURCE_LABELS.map(resource => {
        const cells = editableStands.map(stand => {
            const range = STAND_RATIO_RANGES[stand];
            const standMap = matrix[stand] || {};
            const applicable = labelStands[resource]?.has(stand) ?? false;
            const cur = Number.isFinite(standMap[resource])
                ? standMap[resource]
                : DEFAULT_RESOURCE_RATIO[stand][resource];
            const curPercent = cur * 100;
            const curPercentLabel = formatDecimalInputValue(curPercent);

            if (!applicable) {
                return el('span', {
                    class: 'resource-ratio-cell resource-ratio-cell-na',
                    title: `${resource} на стенде ${STAND_LABELS[stand]} не предусмотрено: ` +
                           `в каталоге нет ЭК с этой меткой и применимостью к этому стенду. ` +
                           `Изменение этой ячейки не повлияет на расчёт.`,
                    text: '—'
                });
            }
            return el('input', {
                class: 'resource-ratio-cell resource-ratio-cell-input input',
                type: DECIMAL_INPUT_TYPE,
                value: curPercentLabel,
                title: `Множитель ${resource} стенда ${STAND_LABELS[stand]} от ПРОМ, %. ` +
                       `Например, ${curPercentLabel}% означает: ${resource} на ${STAND_LABELS[stand]} = ` +
                       `${curPercentLabel}% от объёма ${resource} на ПРОМ. ` +
                       `Допустимый диапазон: ${formatNumber(range.min * 100, { min: 0, max: 0 })}…` +
                       `${formatNumber(range.max * 100, { min: 0, max: 0 })}%.`,
                attrs: decimalInputAttrs({
                    'data-focus-key': `setting:resourceRatio.${stand}.${resource}`,
                    'aria-label': `${resource} на ${STAND_LABELS[stand]}, % от ПРОМ`
                }),
                onInput: e => {
                    const n = parseNumberInput(applyDecimalInputPrecision(e.target));
                    if (Number.isFinite(n)) updateCell(stand, resource, n);
                }
            });
        });

        return el('div', { class: 'resource-ratio-row' },
            el('span', { class: 'resource-ratio-cell resource-ratio-cell-label', text: resource }),
            ...cells
        );
    });

    return el('div', { class: 'resource-ratios' },
        el('div', { class: 'resource-ratios-title', text: 'Размеры аппаратных ресурсов на стендах (% от ПРОМ)' }),
        el('div', { class: 'resource-ratios-table' }, headerRow, ...resourceRows),
        el('div', { class: 'resource-ratios-hint' },
            'Каждая ячейка — % от объёма соответствующего ресурса на ПРОМ. Например, CPU=15% на DEV ' +
            'означает: на DEV закладываем 15% от количества vCPU, заложенного на ПРОМ. ' +
            'ПРОМ = 100% по всем ресурсам (эталон, не редактируется). ' +
            'Прочерк (—) — ресурс не предусмотрен на этом стенде каталогом ЭК.'
        )
    );
}
