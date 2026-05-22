/**
 * Settings panel for the Questionnaire tab.
 *
 * Kept separate from questionnaire.js so section/question rendering can stay
 * focused on answers, while calculation-level settings keep their own UI surface.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import {
    SETTINGS_DESCRIPTIONS,
    UI_TOOLTIPS_SHORT
} from '../utils/constants.js';
import { parseNumberInput, percent } from '../services/format.js';
import { DECIMAL_INPUT_TYPE, applyDecimalInputPrecision, decimalInputAttrs, formatDecimalInputValue } from './decimalInput.js';
import { PROVIDER_OVERLAYS } from '../domain/providerOverlay.js';
import { renderPercentField } from './questionnairePercentField.js';
import { renderProviderField } from './questionnaireProviderSettings.js';
import { renderStandSizeRatios, renderResourceRatios } from './questionnaireStandSettings.js';
import { renderSettingsGroupVat } from './questionnaireVatSettings.js';

function settingsOpened(state) {
    return state.ui.questionnaireSettingsOpen !== false;
}

function toggleSettings(state, ctx) {
    ctx.setUi({ questionnaireSettingsOpen: !settingsOpened(state) });
}
/* ---------- Панель «Параметры расчёта» (12.U1: accordion + 3 подгруппы) ---------- */

export function renderSettingsPanel(calc, state, ctx) {
    const s = calc.settings;
    const horizon = Number.isFinite(s.planningHorizonYears) ? s.planningHorizonYears : 1;
    const inflationMul = Math.pow(1 + (s.kInflation || 0), horizon);
    // 12.U20: НДС отделён от риск-коэффициентов. totalFactor — только риски (без НДС).
    const totalFactor =
        (1 + (s.bufferTask || 0)) *
        (1 + (s.bufferProject || 0)) *
        inflationMul *
        (1 + (s.kContingency || 0));
    const applyRisks = s.applyRiskFactors !== false;
    const isOpen = settingsOpened(state);

    /* Stage 5.5.4: расширенная сводка settings-panel — 4 ключевых решения
       одной строкой. Нужно, чтобы пользователь видел контекст без раскрытия
       панели — раньше для проверки провайдера или ставки НДС нужно было
       свернуть/развернуть. Comma-decimal (×1,42) — ru-locale стандарт.
       Square brackets — визуальный маркер «это сводка состояния», отделяет
       от free-form текста. */
    const providerId = s.provider || 'sbercloud';
    const providerOverlay = PROVIDER_OVERLAYS[providerId];
    const providerLabel = providerOverlay?.label || providerId;
    const riskFmt = totalFactor.toFixed(2).replace('.', ',');
    const summaryParts = [
        `${s.phaseDurationMonths ?? 12} мес`,
        applyRisks ? `риски ×${riskFmt}` : 'без рисков',
        s.vatEnabled ? `НДС ${Math.round((s.vatRate || 0) * 100)}%` : 'без НДС',
        providerLabel
    ];
    const summary = `[${summaryParts.join(' · ')}]`;

    const header = el('button', {
        class: 'settings-panel-header',
        attrs: {
            type: 'button',
            'aria-expanded': isOpen ? 'true' : 'false',
            'aria-controls': 'settings-panel-body'
        },
        title: isOpen ? 'Свернуть параметры расчёта' : 'Раскрыть параметры расчёта',
        onClick: () => toggleSettings(state, ctx)
    },
        el('span', { class: ['accordion-chevron', isOpen && 'accordion-chevron-open'] },
            icon('chevron-right', { size: 16 })),
        el('span', { class: 'settings-title', text: 'Параметры расчёта' }),
        el('span', { class: 'settings-summary', text: summary })
    );

    if (!isOpen) {
        return el('div', { class: 'settings-panel settings-panel-collapsed' }, header);
    }

    return el('div', { class: 'settings-panel' },
        header,
        el('div', { class: 'settings-panel-body', id: 'settings-panel-body' },
            // Срок проекта + НДС — узкие группы, экономим место и кладём в один ряд.
            // 12.U20: НДС не зависит от мастера рисков — он либо учитывается, либо нет
            // независимо от того, накручиваем ли мы риски сверху.
            el('div', { class: 'settings-row-2col' },
                renderSettingsGroupPeriod(s, ctx),
                renderSettingsGroupVat(s, ctx, calc)
            ),
            renderSettingsGroupRisks(s, ctx, applyRisks, totalFactor, horizon),
            renderProviderField(s, state, ctx),
            renderStandSizeRatios(calc, ctx),
            renderResourceRatios(calc, ctx)
        )
    );
}

/* Подгруппа 1 — срок проекта (12.U2: убран «Период отображения» как дубль с
 * переключателем день/мес/год на Дашборде, «Горизонт планирования» уехал в
 * группу рисков — он напрямую связан с инфляцией). */
function renderSettingsGroupPeriod(s, ctx) {
    return el('div', { class: 'settings-group' },
        el('div', { class: 'settings-group-title', text: 'Срок проекта' }),
        el('div', { class: 'settings-grid' },
            el('label', { class: 'field' },
                el('span', { class: 'field-label', text: 'Длительность этапа проекта, мес.' }),
                el('input', {
                    class: 'input',
                    type: DECIMAL_INPUT_TYPE,
                    value: formatDecimalInputValue(s.phaseDurationMonths ?? 12),
                    title: SETTINGS_DESCRIPTIONS.phaseDurationMonths,
                    attrs: decimalInputAttrs({ 'data-focus-key': 'setting:phaseDurationMonths' }),
                    onInput: e => {
                        const n = parseNumberInput(applyDecimalInputPrecision(e.target));
                        if (Number.isFinite(n) && n > 0) ctx.setSetting('phaseDurationMonths', n);
                    }
                }),
                /* Stage 5.3.A: видимый tooltipShort под полем. Полный текст
                   (диапазоны, влияние) — в title (UI_TOOLTIPS_SHORT.phaseDurationMonths
                   из constants.js). */
                el('span', { class: 'field-description', text: UI_TOOLTIPS_SHORT.phaseDurationMonths })
            )
        )
    );
}

/* Подгруппа 2 — риск-коэффициенты с master-toggle НАВЕРХУ группы. */
function renderSettingsGroupRisks(s, ctx, applyRisks, totalFactor, horizon) {
    const masterRow = el('div', { class: 'settings-master-toggle' },
        el('label', {
            class: ['switch', applyRisks && 'switch-on'],
            title: 'Если включено — итог считается с буферами, инфляцией, сезонностью, сдвигом расписания и резервом (это сумма, которую видит заказчик). ' +
                   'Если выключено — Дашборд и Детализация показывают «голую» базовую стоимость по прайс-листам поставщиков. ' +
                   'В обоих режимах в карточке «Вклад риск-коэффициентов» видна потенциальная наценка для информации.'
        },
            el('input', {
                type: 'checkbox',
                checked: applyRisks,
                attrs: { 'data-focus-key': 'setting:applyRiskFactors' },
                onChange: e => {
                    const checked = !!e.target.checked;
                    const sw = e.target.closest('.switch');
                    if (sw) {
                        sw.classList.toggle('switch-on', checked);
                        const lab = sw.querySelector('.switch-label');
                        if (lab) lab.textContent = checked ? 'Да' : 'Нет';
                    }
                    ctx.setSetting('applyRiskFactors', checked);
                }
            }),
            el('span', { class: 'switch-track' }),
            el('span', { class: 'switch-label', text: applyRisks ? 'Да' : 'Нет' })
        ),
        el('div', { class: 'settings-master-toggle-text' },
            el('div', { class: 'settings-master-toggle-title', text: 'Учитывать риск-коэффициенты в бюджете' }),
            el('div', { class: 'settings-master-toggle-hint',
                text: applyRisks
                    ? 'Итог включает все буферы, инфляцию, сезонность и резервы. Если выключить — увидите базовую стоимость без наценок.'
                    : 'Сейчас итог считается без рисков — отображается «голая» стоимость ресурсов. Включите, чтобы добавить надбавки в бюджет.' })
        )
    );

    return el('div', { class: 'settings-group' },
        el('div', { class: 'settings-group-title', text: 'Риск-коэффициенты' }),
        masterRow,
        el('div', { class: ['settings-grid', !applyRisks && 'settings-grid-faded'] },
            renderPercentField(
                'Запас на риски задач',
                s.bufferTask,
                v => ctx.setSetting('bufferTask', v),
                SETTINGS_DESCRIPTIONS.bufferTask,
                'setting:bufferTask',
                !applyRisks
            ),
            renderPercentField(
                'Запас на проектные риски',
                s.bufferProject,
                v => ctx.setSetting('bufferProject', v),
                SETTINGS_DESCRIPTIONS.bufferProject,
                'setting:bufferProject',
                !applyRisks
            ),
            renderPercentField(
                'Годовая инфляция',
                s.kInflation,
                v => ctx.setSetting('kInflation', v),
                SETTINGS_DESCRIPTIONS.kInflation,
                'setting:kInflation',
                !applyRisks
            ),
            // 12.U2: «Горизонт планирования» переехал сюда — он напрямую связан
            // с полем «Годовая инфляция» (показывает на сколько лет применяется).
            // При выкл. master-toggle поле блокируется (как и инфляция).
            el('label', { class: ['field', !applyRisks && 'field-disabled'] },
                el('span', { class: 'field-label', text: 'Горизонт планирования, лет' }),
                el('input', {
                    class: 'input', type: DECIMAL_INPUT_TYPE,
                    value: formatDecimalInputValue(s.planningHorizonYears ?? 1),
                    title: !applyRisks
                        ? `${SETTINGS_DESCRIPTIONS.planningHorizonYears}\n\nПоле неактивно: выключен переключатель «Учитывать риск-коэффициенты в бюджете».`
                        : SETTINGS_DESCRIPTIONS.planningHorizonYears,
                    disabled: !applyRisks,
                    attrs: decimalInputAttrs({ 'data-focus-key': 'setting:planningHorizonYears' }),
                    onInput: e => {
                        const n = parseNumberInput(applyDecimalInputPrecision(e.target));
                        if (Number.isFinite(n) && n >= 0) ctx.setSetting('planningHorizonYears', n);
                    }
                }),
                /* Stage 5.3.A: tooltipShort под полем — видимое объяснение «зачем поле». */
                el('span', { class: 'field-description', text: UI_TOOLTIPS_SHORT.planningHorizonYears })
            ),
            renderPercentField(
                'Сезонный всплеск нагрузки',
                s.kSeasonal,
                v => ctx.setSetting('kSeasonal', v),
                SETTINGS_DESCRIPTIONS.kSeasonal,
                'setting:kSeasonal',
                !applyRisks
            ),
            renderPercentField(
                'Риск сдвига сроков работ',
                s.kScheduleShift,
                v => ctx.setSetting('kScheduleShift', v),
                SETTINGS_DESCRIPTIONS.kScheduleShift,
                'setting:kScheduleShift',
                !applyRisks
            ),
            renderPercentField(
                'Непредвиденные обстоятельства',
                s.kContingency,
                v => ctx.setSetting('kContingency', v),
                SETTINGS_DESCRIPTIONS.kContingency,
                'setting:kContingency',
                !applyRisks
            )
        ),
        el('div', {
            class: ['settings-formula', !applyRisks && 'settings-formula-disabled'],
            title:
                'Во сколько раз вырастет «голая» стоимость инфраструктуры после ' +
                'применения всех риск-коэффициентов. Например, ×1,50 — итог в 1,5 раза ' +
                'дороже базовой стоимости ресурсов.\n\n' +
                'Сюда входят коэффициенты, которые действуют на всё: буфер задач, ' +
                'буфер проекта, инфляция за горизонт планирования, резерв на риски.\n\n' +
                'НДС в этот множитель НЕ входит — это отдельный налог, не риск. ' +
                'Он включается/выключается независимо в группе «НДС» и применяется ' +
                'к итогу как отдельный множитель (×1,20 при ставке 20%).\n\n' +
                'Сезонный коэффициент и риск сдвига сроков применяются точечно: ' +
                'сезон — только к переменным ресурсам (сеть, трафик, сервисы, AI/LLM), ' +
                'сдвиг сроков — только к стенду «Нагрузка» и к разовым работам. ' +
                'Поэтому они не входят в общий множитель и показаны строкой ниже.'
        },
            el('span', { class: 'settings-formula-label',
                text: 'Итоговый коэффициент удорожания (во сколько раз дороже базы):' }),
            el('span', { class: 'settings-formula-value' },
                `(1 + ${percent(s.bufferTask)}) × (1 + ${percent(s.bufferProject)}) × ` +
                `(1 + ${percent(s.kInflation)})^${horizon} × (1 + ${percent(s.kContingency)})` +
                ` = ×${totalFactor.toFixed(3)}`
            )
        ),
        el('div', { class: 'settings-formula-note' },
            'Эти два коэффициента в итоговый множитель выше НЕ включены — они работают ' +
            'не на всю инфраструктуру, а на её часть:',
            el('br'),
            el('br'),
            el('strong', { text: 'Сезонный коэффициент ' + percent(s.kSeasonal || 0) }),
            ' — удорожает только сетевые ресурсы, трафик, внешние сервисы и AI/LLM ' +
            '(классы, которые гибко масштабируются под нагрузку).',
            el('br'),
            el('strong', { text: 'Риск сдвига сроков ' + percent(s.kScheduleShift || 0) }),
            ' — удорожает только стенд «Нагрузка» и все разовые работы (пентесты, аудит безопасности, миграция).'
        )
    );
}
