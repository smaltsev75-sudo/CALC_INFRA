/**
 * 12.U25-fix-6: разбивка суммы рисков для Hero и стенд-карточек на дашборде.
 *
 * По аналогии с [vatBadge.js](./vatBadge.js): статус-бейдж «С РИСКАМИ» / «БЕЗ
 * РИСКОВ» уже был в шапке карточек; здесь добавляем строку-разбивку «Риски: X ₽»
 * под суммой. Принцип «один маркер = одна грань» (12.U24): бейдж даёт СТАТУС,
 * строка даёт СУММУ в ₽. Без дублирования множителя/процента.
 *
 * Сумма риск-наценки на ячейку:
 *   costFinal = costBase × riskTotal × vatMul
 *   риск-наценка = costFinal − costBase × vatMul = costBase × (riskTotal − 1) × vatMul
 *
 * vatMul участвует, потому что НДС применяется поверх риск-наценки в финальной
 * сумме. Если показываете строку «Риски» рядом с «НДС» — обе видны как реальные
 * слагаемые итога.
 *
 * При applyRisks=false → 0 (риски НЕ зашиты в costFinal, бейдж «БЕЗ РИСКОВ»
 * сам всё сказал → строку не показываем).
 */

import { el } from './dom.js';
import { formatRub, formatRubThousands, formatNumber } from '../services/format.js';

/**
 * Сумма наценки от риск-коэффициентов в ₽ за тот же период, что и costBase
 * в cells (обычно — за месяц). Считается ПО РЕАЛЬНЫМ коэффициентам в
 * `cell.riskBreakdown` независимо от applyRisks-режима — это согласовано с
 * инвариантом из CLAUDE.md «cell.riskBreakdown ВСЕГДА содержит реальные
 * коэффициенты». Применение к UI зависит от режима (см. renderRiskBreakdownLine):
 *   - applyRisks=true: эта сумма УЖЕ зашита в costFinal (актуальная наценка).
 *   - applyRisks=false: эта сумма — ПОТЕНЦИАЛЬНАЯ (если применить риски).
 *
 * @param {Array<{costBase: number, riskBreakdown?: {total, vatMul}}>} cells
 * @returns {number} сумма риск-наценки за месяц
 */
export function extractRiskAmount(cells) {
    if (!Array.isArray(cells)) return 0;
    let sum = 0;
    for (const c of cells) {
        if (!c || !c.riskBreakdown) continue;
        const base = Number(c.costBase) || 0;
        const riskTotal = Number(c.riskBreakdown.total) || 1;
        const vatMul = Number(c.riskBreakdown.vatMul) || 1;
        sum += base * (riskTotal - 1) * vatMul;
    }
    return sum;
}

/**
 * DOM-строка «Риски: X ₽ /мес [+85.6% от базы]» под основной суммой.
 *
 * Поведение по режиму (12.U25-fix-7):
 *   - applyRisks=true  → «Риски: X ₽ /мес»            (актуальная сумма в итоге).
 *   - applyRisks=false → «Риски: X ₽ /мес если применить» (потенциальная сумма).
 *
 * Опциональный 5-й параметр surplusPct (12.U25-fix-8): если передан и |pct| ≥ 0.05,
 * к строке добавляется inline-пилл «+85.6% от базы» (или «+85.6% если применить
 * риски» в режиме off). Используется в Hero — раньше пилл стоял отдельной строкой
 * выше, теперь — на одной строке с риск-наценкой (% и сумма — одна сущность).
 * Стенд-карточки этот параметр не передают (для них пилл-процент = шум).
 *
 * Возвращает `null` только когда реальная риск-наценка ≤ 0 (все коэффициенты
 * нейтральны — нечего показывать в любом режиме).
 *
 * @param {Array} cells — список ячеек, чью риск-наценку суммируем
 * @param {boolean} applyRisks — режим расчёта (для текста «если применить»)
 * @param {number} periodMul — множитель периода (1=месяц, 12=год, 1/30=день)
 * @param {string} slash — «/мес», «/год», «/день» для подписи
 * @param {number} [surplusPct] — % наценки от базы (например, 86.6 = +86.6%);
 *        опционально; null/undefined = без inline-пилла. Порог отображения 0.05%.
 * @param {object} [opts]
 * @param {boolean} [opts.useThousands=false] — формат «X тыс. ₽» вместо полных
 *        рублей; используется на Дашборде, в Детализации остаётся false.
 * @returns {HTMLElement|null}
 */
export function renderRiskBreakdownLine(cells, applyRisks, periodMul, slash, surplusPct = null, opts = {}) {
    const monthlyRisk = extractRiskAmount(cells);
    if (!Number.isFinite(monthlyRisk) || monthlyRisk <= 0) return null;
    const periodRisk = monthlyRisk * periodMul;
    const isPotential = !applyRisks;
    const fmt = opts.useThousands ? formatRubThousands : formatRub;
    const amountText = isPotential
        ? `${fmt(periodRisk)} ${slash} если применить`
        : `${fmt(periodRisk)} ${slash}`;
    const titleText = isPotential
        ? `Потенциальная сумма наценки от риск-коэффициентов: ${formatRub(periodRisk)} ${slash}. ` +
          `Сейчас риски в Опроснике ВЫКЛЮЧЕНЫ — итог отображается без них; ` +
          `включите, чтобы добавить эту сумму в бюджет. Включает буферы, ` +
          `инфляцию, сезонность, сдвиг расписания и резерв.`
        : `Сумма наценки от риск-коэффициентов в этом итоге: ${formatRub(periodRisk)} ${slash}. ` +
          `Включает буферы (задачный + проектный), инфляцию за горизонт планирования, ` +
          `сезонность (только для NETWORK/TRAFFIC/SERVICE/AI/LLM), сдвиг расписания ` +
          `(только для стенда НТ и oneTime-работ) и резерв на непредвиденные. ` +
          `НДС применяется поверх — см. соседнюю строку «НДС».`;

    const children = [
        el('span', { class: 'risk-breakdown-label', text: 'Риски:' }),
        el('span', { class: 'risk-breakdown-amount', text: amountText })
    ];

    /* Inline-пилл «+X% от базы» — если передан surplusPct (в процентах, например 86.6)
     * и он не пренебрежимо мал (порог 0.05% — как в старом dash-hero-sub). */
    if (Number.isFinite(surplusPct) && Math.abs(surplusPct) >= 0.05) {
        // 12.U26-fix: ru-RU формат процентов (запятая) — согласован с дашбордом и категориями.
        const pctFmt = formatNumber(surplusPct, { min: 1, max: 1 });
        const pctText = isPotential
            ? `+${pctFmt}% если применить риски`
            : `${surplusPct >= 0 ? '+' : ''}${pctFmt}% от базы`;
        const pctTitle = isPotential
            ? `Если бы риски были включены, итог был бы НА ${pctFmt}% больше базы.`
            : `Сумма рисков выше выражена в % от базовой стоимости (без рисков и без НДС).`;
        /* 12.U25-fix-19: при наценке >80% pill окрашивается в красный — это
           сигнал «пересмотрите буферы/инфляцию». Порог фиксированный — практика
           на 3-х профилях (Startup/SMB/Enterprise) показывает, что нормальная
           суммарная риск-наценка лежит в 30-70%. */
        const isHot = !isPotential && Math.abs(surplusPct) > 80;
        children.push(el('span', {
            class: ['risk-breakdown-pct',
                isPotential ? 'risk-breakdown-pct-potential' : 'risk-breakdown-pct-actual',
                isHot && 'risk-breakdown-pct-hot'],
            title: isHot
                ? `${pctTitle} Превышает типовой диапазон (>80%) — стоит сверить буферы и инфляцию в Опроснике.`
                : pctTitle,
            text: pctText
        }));
    }

    return el('div', {
        class: ['risk-breakdown', isPotential && 'risk-breakdown-potential'],
        title: titleText
    }, ...children);
}
