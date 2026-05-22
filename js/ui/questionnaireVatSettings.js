import { el } from './dom.js';
import { SETTINGS_DESCRIPTIONS, UI_TOOLTIPS_SHORT } from '../utils/constants.js';
import { formatDate } from '../services/format.js';
import { SEED_QUESTIONS } from '../domain/seed.js';
import { getVatPeriodCrossings } from '../domain/vatRateTable.js';
import { renderPercentField } from './questionnairePercentField.js';

// 12.U3/VAT fallback: индекс актуальных UI-only/default полей по id вопроса.
const SEED_BY_ID = new Map(SEED_QUESTIONS.map(q => [q.id, q]));

/* Подгруппа 3 — НДС.
 *
 * 12.U20: НДС — НЕЗАВИСИМАЯ ось от риск-коэффициентов. НДС не «риск», а налог:
 * пользователь либо учитывает его в бюджете, либо нет, и это решение никак не
 * связано с тем, накручиваем ли мы буферы/инфляцию/сезонность сверху. Поэтому
 * группа НЕ блокируется при выключенном мастере «Учитывать риск-коэффициенты»
 * (ранее блокировалась — это была семантическая ошибка).
 *
 * Stage VAT-1 Phase 5: бейдж режима НДС (auto-by-date / manual / frozen),
 * 3 кнопки переключения режимов и multi-period warning, если расчёт пересекает
 * дату изменения ставки в справочнике. Прямое редактирование ставки переводит
 * расчёт в режим manual через `ctx.setVatRateManual(fraction)` — UI вводит
 * проценты, controller получает долю. */
export function renderSettingsGroupVat(s, ctx, calc) {
    const mode = s.vatRateMode || 'auto-by-date';
    const ratePct = Math.round((s.vatRate || 0) * 100);
    const effectiveDate = s.vatEffectiveDate || null;
    const planningHorizonYears = Number.isFinite(s.planningHorizonYears) ? s.planningHorizonYears : 1;

    /* VAT-1 Phase 7.1 (bugfix): multi-period warning должен проверять
       пользовательский период планирования (Год запуска + горизонт), а не
       vatEffectiveDate. Иначе при vatEffectiveDate = today=2026 и launchYear=2025
       warning не появлялся, хотя период 2025-2027 явно пересекает 01.01.2026. */
    const launchYearRaw = calc?.answers?.launch_year;
    const launchYear = Number.isFinite(launchYearRaw)
        ? launchYearRaw
        : SEED_BY_ID.get('launch_year')?.defaultIfUnknown ?? null;

    return el('div', { class: 'settings-group' },
        el('div', { class: 'settings-group-title', text: 'НДС' }),
        renderVatModeBadgeAndActions(mode, ratePct, effectiveDate, ctx),
        renderVatMultiPeriodWarning(launchYear, planningHorizonYears),
        el('div', { class: 'settings-grid' },
            el('label', { class: 'field' },
                el('span', { class: 'field-label', text: 'Учитывать НДС' }),
                el('label', {
                    class: ['switch', s.vatEnabled && 'switch-on'],
                    title: 'Если включено — итоговые суммы вырастут на процент НДС. ' +
                           'НДС применяется независимо от риск-коэффициентов: даже если мастер рисков выключен, ' +
                           'НДС всё равно учитывается в итоге, когда включён этот переключатель.'
                },
                    el('input', {
                        type: 'checkbox',
                        checked: !!s.vatEnabled,
                        attrs: { 'data-focus-key': 'setting:vatEnabled' },
                        onChange: e => {
                            const checked = !!e.target.checked;
                            const sw = e.target.closest('.switch');
                            if (sw) {
                                sw.classList.toggle('switch-on', checked);
                                const lab = sw.querySelector('.switch-label');
                                if (lab) lab.textContent = checked ? 'Да' : 'Нет';
                            }
                            ctx.setSetting('vatEnabled', checked);
                        }
                    }),
                    el('span', { class: 'switch-track' }),
                    el('span', { class: 'switch-label', text: s.vatEnabled ? 'Да' : 'Нет' })
                ),
                /* Stage 5.3.A: tooltipShort про независимость НДС от риск-коэффициентов. */
                el('span', { class: 'field-description', text: UI_TOOLTIPS_SHORT.vatEnabled })
            ),
            renderPercentField(
                'Ставка НДС',
                s.vatRate,
                v => ctx.setVatRateManual(v),   /* VAT-1 Phase 5: ручная правка → manual */
                SETTINGS_DESCRIPTIONS.vatRate,
                'setting:vatRate',
                false
            )
        )
    );
}

/* VAT-1 Phase 5: бейдж текущего режима НДС + 3 кнопки смены режима. */
function renderVatModeBadgeAndActions(mode, ratePct, effectiveDate, ctx) {
    const isAuto = mode === 'auto-by-date';
    const isManual = mode === 'manual';
    const isFrozen = mode === 'frozen';

    /* VAT-1 Phase 7: дата в RU-формате dd.mm.yyyy (правило date-format-ru). */
    const dateRu = effectiveDate ? formatDate(effectiveDate) : '';
    let badgeText, badgeClass, badgeTitle;
    if (isAuto) {
        const dateSuffix = dateRu ? ` · ${dateRu}` : '';
        badgeText = `Авто ${ratePct}%${dateSuffix}`;
        badgeClass = 'vat-mode-badge-auto';
        badgeTitle = 'Ставка НДС берётся из справочника РФ по дате расчёта. При смене ставки в государстве — пересчитывается автоматически (если дата расчёта попадает в новый период).';
    } else if (isManual) {
        badgeText = `Вручную ${ratePct}%`;
        badgeClass = 'vat-mode-badge-manual';
        badgeTitle = 'Ставка задана вручную. Не пересчитывается автоматически — используйте, если у вашего проекта особая ставка (нерезидент / экспорт / льгота).';
    } else {
        const dateSuffix = dateRu ? `, ${dateRu}` : '';
        badgeText = `Заморожено ${ratePct}%${dateSuffix}`;
        badgeClass = 'vat-mode-badge-frozen';
        badgeTitle = 'Ставка зафиксирована — бюджет согласован, обновления справочника НДС не должны менять итог. Снимите заморозку, чтобы перейти в авто-режим.';
    }

    return el('div', { class: 'vat-mode-row' },
        el('span', {
            class: ['vat-mode-badge', badgeClass],
            title: badgeTitle,
            text: badgeText
        }),
        el('div', { class: 'vat-mode-actions' },
            el('button', {
                type: 'button',
                class: ['vat-mode-action', isAuto && 'vat-mode-action-active'],
                attrs: { 'aria-pressed': isAuto ? 'true' : 'false' },
                title: 'Перевести в автоматический режим — ставка из справочника по дате расчёта.',
                onClick: () => ctx.setVatRateMode('auto-by-date')
            }, 'Авто'),
            el('button', {
                type: 'button',
                class: ['vat-mode-action', isManual && 'vat-mode-action-active'],
                attrs: { 'aria-pressed': isManual ? 'true' : 'false' },
                title: 'Перевести в ручной режим — задать ставку самостоятельно. Текущая ставка сохранится, дата сбросится.',
                onClick: () => ctx.setVatRateMode('manual')
            }, 'Вручную'),
            el('button', {
                type: 'button',
                class: ['vat-mode-action', isFrozen && 'vat-mode-action-active'],
                attrs: { 'aria-pressed': isFrozen ? 'true' : 'false' },
                title: 'Заморозить текущую ставку. Используйте после согласования бюджета — обновления справочника НДС не повлияют на расчёт.',
                onClick: () => ctx.freezeVatRate()
            }, 'Заморозить')
        )
    );
}

/* VAT-1 Phase 5 / Phase 7.1: warning, если пользовательский период планирования
 * пересекает дату изменения ставки НДС в справочнике.
 *
 * Bugfix Phase 7.1: источник периода — `launchYear` (Q.launch_year, ответ
 * пользователя «Год запуска промышленной версии») + `planningHorizonYears`,
 * НЕ `vatEffectiveDate`. Иначе при `launchYear=2025` + горизонт 2 года и
 * `vatEffectiveDate=2026-05-12` (текущая дата создания расчёта) warning не
 * показывался, хотя период 2025-2027 явно содержит 01.01.2026.
 *
 * Текст строится из справочника динамически — никаких хардкоженных 2026/20%/22%. */
function renderVatMultiPeriodWarning(launchYear, planningHorizonYears) {
    if (!Number.isFinite(launchYear) || !Number.isFinite(planningHorizonYears)) return null;
    if (planningHorizonYears <= 0) return null;
    /* Период расчёта: от 1 января года запуска. */
    const startDate = `${launchYear}-01-01`;
    const crossings = getVatPeriodCrossings(startDate, planningHorizonYears);
    if (crossings.length === 0) return null;
    /* Строим текст из реальных crossings: «01.01.2026, 20 % → 22 %; ...».
       Дата в RU-формате (правило date-format-ru). */
    const crossingsText = crossings.map(c => {
        const fromPct = Math.round(c.from * 100);
        const toPct = Math.round(c.to * 100);
        return `${formatDate(c.date)}, ${fromPct}% → ${toPct}%`;
    }).join('; ');
    return el('div', {
        class: 'vat-multiperiod-warning',
        attrs: { role: 'status', 'aria-live': 'polite' }
    },
        el('span', { class: 'vat-multiperiod-warning-text',
            text: `Расчёт пересекает дату изменения НДС: ${crossingsText}. ` +
                  `Сейчас применяется ставка НДС на дату расчёта. ` +
                  `Для точной оценки разделите бюджет по периодам или задайте ставку вручную.` })
    );
}
