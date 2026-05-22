/**
 * Quick Start Wizard — модалка с 7 профильными параметрами,
 * выбором провайдера и 3 пресетами сверху.
 *
 * Заполняется новым пользователем за минуту. По submit:
 *   1. wizardToAnswers(input) → 40+ предзаполненных полей опросника + meta.
 *   2. Создаётся новый calc через createCalcFromWizard.
 *   3. Пользователь автоматически открывается на дашборде расчёта.
 *
 * Sprint 4 Stage 4.3 (2026-05-08): Launchpad-редизайн.
 *   - 3 пресет-карточки сверху (Стандартный B2B / Высокая нагрузка (AI) /
 *     Внутренний инструмент). Клик мгновенно заполняет всю форму.
 *   - 2-колоночная сетка для 6 полей (Тип/Индустрия, Размер/Активность,
 *     География+Провайдер). Без visible section-divider'ов — только gap.
 *   - География как chip-row (3 опции: Россия / Россия+СНГ / Глобально).
 *   - PDn + AI — пара toggle-row в grid 2-col (вместо stacked rows).
 *   - Auto-name: «{Type} {Ind-short} расчёт», обновляется при изменении
 *     Тип/Индустрия. После ручного ввода имени — lock'ится до закрытия модалки.
 *   - Анимация подсветки полей (300ms accent-flash) при apply preset.
 *
 * draft: {
 *   name:          string,
 *   product_type:  'internal' | 'b2b' | 'b2c' | 'b2g',
 *   industry:      'corporate' | 'edtech' | 'fintech' | 'consumer',
 *   scale:         'xs' | 's' | 'm' | 'l' | 'xl',
 *   geography:     'ru' | 'ru_cis' | 'global',
 *   provider:      string,
 *   pdn:           boolean,
 *   activity:      'very_low' | 'low' | 'medium' | 'high',
 *   ai_used:       boolean,
 *   nameLocked:    boolean   // true после ручного ввода имени — preset не перезатрёт
 * }
 */

import { el, trustedHtml } from '../dom.js';
import { modalShell } from './baseModal.js';
import {
    ACTIVITIES,
    GEOGRAPHIES,
    INDUSTRIES,
    PRODUCT_TYPES,
    SCALES,
    PRESETS,
    autoName,
    computePresetDelta,
    defaultDraft,
    defaultPdnFor,
    findActivePresetId,
    formatPresetParams,
    formatPresetTooltip,
    getDefaultProvider,
    getProviderOptions
} from './quickStartModel.js';
import { UI_TOOLTIPS_SHORT } from '../../utils/constants.js';

export {
    PRESETS,
    INDUSTRY_SHORT,
    autoName,
    computePresetDelta,
    findActivePresetId,
    formatPresetParams,
    formatPresetTooltip
} from './quickStartModel.js';

/** Inline-SVG info-иконки. 14px подобран под font-xs label'ов. */
const INFO_SVG_HTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="10"/>' +
    '<path d="M12 16v-4"/>' +
    '<path d="M12 8h.01"/>' +
    '</svg>';

/**
 * Триггер flash-анимации на полях формы. Двойной rAF гарантирует выполнение
 * ПОСЛЕ rerender'а от patchModal: первый rAF — тот же кадр, что и render
 * subscriber'а; второй — гарантированно следующий, когда DOM уже обновлён.
 */
function triggerFlash() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const root = document.querySelector('.quickstart-modal-body');
            if (!root) return;
            const targets = root.querySelectorAll('.qs-flash-target');
            targets.forEach(n => {
                n.classList.remove('qs-flash');
                // Reflow для re-trigger animation на повторном клике.
                void n.offsetWidth;
                n.classList.add('qs-flash');
                setTimeout(() => n.classList.remove('qs-flash'), 350);
            });
        });
    });
}

export function renderQuickStartModal(state, ctx) {
    const m = state.modals.quickStart;
    if (!m.open) return null;

    /* mode='create' — создание нового расчёта. mode='edit' — редактирование
       параметров профиля (открыто из баннера на дашборде). В edit скрываем
       поле «Название» + блок пресетов + intro, меняем заголовок и submit-label. */
    const mode = m.mode === 'edit' ? 'edit' : 'create';
    const isEdit = mode === 'edit';

    const providerOptions = getProviderOptions(ctx);
    const defaultProvider = getDefaultProvider(ctx, providerOptions);
    const draft = { ...defaultDraft(defaultProvider), ...(m.draft || {}) };
    if (!providerOptions.some(p => p.id === draft.provider)) {
        draft.provider = defaultProvider;
    }
    const activePresetId = findActivePresetId(draft);

    const patch = (changes) => ctx.patchModal('quickStart', { draft: { ...draft, ...changes } });

    /**
     * Изменить product_type/industry: автогенерация имени, если пользователь
     * не блокировал поле ручным вводом. nameLocked=true → имя не трогаем.
     */
    const patchTypeOrIndustry = (key, value) => {
        const next = { ...draft, [key]: value };
        // ПДн default зависит от product_type — но только при первом изменении (когда
        // активный preset отслеживает «связку»). Если pdn уже отличается от дефолта,
        // пользователь явно сделал выбор — не перезатираем.
        if (key === 'product_type' && activePresetId !== null) {
            // активный preset → переключение типа всегда «начинает заново»
            next.pdn = defaultPdnFor(value);
        }
        if (!draft.nameLocked) {
            next.name = autoName(next.product_type, next.industry);
        }
        ctx.patchModal('quickStart', { draft: next });
    };

    const patchName = (value) => {
        ctx.patchModal('quickStart', { draft: { ...draft, name: value, nameLocked: true } });
    };

    const applyPreset = (preset) => {
        /* Stage 17.2: ветка preset.isEmpty удалена. Empty preset больше нет. */
        const next = {
            ...draft,
            ...preset.draft
        };
        if (!draft.nameLocked) {
            next.name = autoName(preset.draft.product_type, preset.draft.industry);
        }
        ctx.patchModal('quickStart', { draft: next });
        triggerFlash();
    };

    const onClose = () => ctx.closeModal('quickStart');
    const onSubmit = () => {
        if (isEdit) {
            const draftWizard = {
                product_type: draft.product_type,
                industry:     draft.industry,
                scale:        draft.scale,
                geography:    draft.geography,
                pdn:          !!draft.pdn,
                activity:     draft.activity,
                ai_used:      !!draft.ai_used
            };
            ctx.closeModal('quickStart');
            if (typeof ctx.openReapplyConfirm === 'function') {
                ctx.openReapplyConfirm(draftWizard);
            }
            return;
        }
        const name = (draft.name || '').trim() || autoName(draft.product_type, draft.industry);
        ctx.closeModal('quickStart');
        ctx.createCalcFromWizard(name, {
            product_type: draft.product_type,
            industry:     draft.industry,
            scale:        draft.scale,
            geography:    draft.geography,
            provider:     draft.provider || defaultProvider,
            pdn:          !!draft.pdn,
            activity:     draft.activity,
            ai_used:      !!draft.ai_used
        });
    };

    return modalShell({
        title: isEdit ? 'Параметры профиля — изменение' : 'Quick Start — расчёт за минуту',
        size: 'lg',
        onClose,
        children: el('div', { class: 'quickstart-modal-body', attrs: { 'data-testid': 'quickstart-modal' } },
            !isEdit && renderProgressDots(draft),

            !isEdit && el('div', { class: 'quickstart-intro quickstart-intro-soft',
                attrs: { role: 'note' }
            },
                el('span', { class: 'quickstart-intro-text',
                    text: 'Выберите шаблон или заполните 8 параметров — калькулятор предзаполнит детальный опросник готовыми значениями для вашей отрасли. Любой ответ потом можно поправить вручную.'
                })
            ),

            // 1. Название (только в create) — ПЕРЕД пресетами, как утверждено п.4 (а)
            !isEdit && el('label', { class: 'field' },
                el('span', { class: 'field-label', text: 'Название расчёта' }),
                el('input', {
                    class: 'input',
                    value: draft.name,
                    placeholder: 'Например: «Финтех-MVP, оценка 2026»',
                    attrs: {
                        'data-autofocus': '',
                        'data-focus-key': 'qs-name',
                        'data-testid': 'quickstart-name',
                        maxlength: 120
                    },
                    onInput: e => patchName(e.target.value),
                    onKeydown: e => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }
                })
            ),

            // 2. Шаблоны (только в create) — 3 пресета
            !isEdit && renderPresetGrid(activePresetId, applyPreset, draft),
            /* Stage 5.5.3: delta-pill показывает, чем draft отличается от
               стандартного пресета. Появляется только при ручных правках
               без точного match'а (draft ушёл от любого preset).draft. */
            !isEdit && renderPresetDelta(draft),

            // 3. Параметры — 2-col grid, БЕЗ visible section-dividers (gap-only)
            el('fieldset', { class: 'qs-fieldset qs-fieldset-grid' },
                el('legend', { class: 'qs-sr-only', text: 'Параметры продукта' }),
                el('div', { class: 'quickstart-grid-2col' },
                    // Ряд 1: Тип | Индустрия
                    renderSelectField({
                        label: 'Тип продукта',
                        value: draft.product_type,
                        options: PRODUCT_TYPES,
                        info: 'Кому продаётся продукт. От этого зависит размер пиковой аудитории, набор каналов коммуникации (push, SMS, email) и часть требований безопасности.',
                        infoShort: UI_TOOLTIPS_SHORT['qs.product_type'],
                        testId: 'quickstart-product-type',
                        onChange: v => patchTypeOrIndustry('product_type', v),
                        flash: true
                    }),
                    renderSelectField({
                        label: 'Индустрия',
                        value: draft.industry,
                        options: INDUSTRIES,
                        info: 'Отрасль, в которой работает продукт. Влияет на требования к надёжности (целевой SLA), типовые настройки AI и поиска по корпоративной базе знаний, отраслевые требования регуляторов (например, 152-ФЗ и ГОСТ для FinTech).',
                        infoShort: UI_TOOLTIPS_SHORT['qs.industry'],
                        testId: 'quickstart-industry',
                        onChange: v => patchTypeOrIndustry('industry', v),
                        flash: true
                    }),
                    // Ряд 2: Размер | Активность
                    renderSelectField({
                        label: 'Размер аудитории',
                        value: draft.scale,
                        options: SCALES,
                        info: 'Сколько зарегистрированных пользователей ожидаете. От этого зависит размер базы данных, количество серверов и виртуальных машин, объём оперативной памяти и пропускная способность каналов.',
                        infoShort: UI_TOOLTIPS_SHORT['qs.scale'],
                        testId: 'quickstart-scale',
                        onChange: v => patch({ scale: v }),
                        flash: true
                    }),
                    renderSelectField({
                        label: 'Активность пользователей',
                        value: draft.activity,
                        options: ACTIVITIES,
                        info: 'Как часто типичный пользователь заходит в продукт. Влияет на ежедневную активную аудиторию и пиковую нагрузку на серверы.',
                        infoShort: UI_TOOLTIPS_SHORT['qs.activity'],
                        testId: 'quickstart-activity',
                        onChange: v => patch({ activity: v }),
                        flash: true
                    }),
                    // Ряд 3: География (chips) | Облачный провайдер
                    renderGeoChipsField({
                        value: draft.geography,
                        infoShort: UI_TOOLTIPS_SHORT['qs.geography'],
                        testId: 'quickstart-geography',
                        onChange: v => patch({ geography: v })
                    }),
                    !isEdit ? renderProviderField({
                        value: draft.provider,
                        options: providerOptions,
                        infoShort: UI_TOOLTIPS_SHORT['qs.provider'],
                        testId: 'quickstart-provider',
                        onChange: v => patch({ provider: v })
                    }) : null
                )
            ),

            // 4. Безопасность и AI — пара toggle-row в grid 2-col
            el('fieldset', { class: 'qs-fieldset qs-fieldset-toggles' },
                el('legend', { class: 'qs-sr-only', text: 'Безопасность и AI' }),
                el('div', { class: 'qs-toggle-pair' },
                    renderToggleRow({
                        checked: !!draft.pdn,
                        label: 'Персональные данные (ФЗ-152)',
                        info: 'Включает в опросник вопросы про шифрование хранимых данных, журналирование действий пользователей и категорию персональных данных по 152-ФЗ. По умолчанию — да (большинство продуктов хранят как минимум ФИО или email).',
                        infoShort: UI_TOOLTIPS_SHORT['qs.pdn'],
                        testId: 'quickstart-pdn',
                        onChange: v => patch({ pdn: v })
                    }),
                    renderToggleRow({
                        checked: !!draft.ai_used,
                        label: 'AI / LLM (чат, поиск, рекомендации)',
                        info: 'Включает в опросник вопросы про модель AI, стоимость токенов, поиск по корпоративной базе знаний и серверы для AI-нагрузки — с типовыми значениями для вашей отрасли. Если выключено — раздел AI пустой, можно заполнить позже вручную.',
                        infoShort: UI_TOOLTIPS_SHORT['qs.ai_used'],
                        testId: 'quickstart-ai-used',
                        onChange: v => patch({ ai_used: v })
                    })
                )
            )
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-ghost',
                title: 'Отменить (Esc)',
                attrs: { type: 'button', 'data-testid': 'quickstart-cancel' },
                onClick: onClose
            }, 'Отмена'),
            el('button', {
                class: 'btn btn-primary btn-large',
                title: isEdit
                    ? 'Применение изменений в следующем релизе. Пока — ручная правка в Опроснике.'
                    : 'Создать расчёт с заполненным опросником',
                attrs: { type: 'button', 'data-testid': 'quickstart-submit' },
                onClick: onSubmit
            }, isEdit ? 'Применить' : 'Создать расчёт')
        )
    });
}

/**
 * 3 пресет-карточки в ряд. Активный (соответствует draft) подсвечен accent-рамкой.
 * Карточка — semantic <button>, чтобы клавиатурный пользователь мог Tab-Enter.
 */
/**
 * Stage 5.5.3: delta-pill ряд под пресет-карточками. Показывается только
 * когда draft не совпадает ни с одним пресетом (после ручной правки поля).
 * Каждый pill = одно различие, hover показывает «было / сейчас».
 */
function renderPresetDelta(draft) {
    const delta = computePresetDelta(draft);
    if (!delta) return null;
    return el('div', { class: 'qs-preset-delta', attrs: { role: 'status', 'aria-live': 'polite' } },
        el('span', { class: 'qs-preset-delta-label',
            text: `Отличается от «${delta.presetLabel}»: ` }),
        ...delta.diffs.map(d => el('span', {
            class: 'qs-preset-delta-pill',
            attrs: { title: `Раньше: ${d.was}. Сейчас: ${d.now}.` },
            text: `${d.label}: ${d.now}`
        }))
    );
}

function renderPresetGrid(activeId, applyPreset, draft) {
    return el('div', { class: 'qs-preset-grid', attrs: { role: 'group', 'aria-label': 'Шаблоны быстрого старта' } },
        ...PRESETS.map(p => {
            /* PATCH 2.18.1: абсолютные параметры пресета — стабильный список,
               не меняется при кликах между карточками, не исчезает у активной.
               Раньше (Stage 6.3.B / PATCH 2.4.24) использовался diff против
               draft под hover; после MINOR 2.18.0 (preview всегда виден)
               динамика дала «параметры перепрыгивают с карточки на карточку
               и исчезают на активной». */
            const presetParams = formatPresetParams(p);
            return el('button', {
                class: ['qs-preset-card',
                        p.id === activeId && 'qs-preset-card-active'],
                attrs: {
                    type: 'button',
                    'aria-pressed': p.id === activeId ? 'true' : 'false',
                    'data-testid': `quickstart-preset-${p.id}`
                },
                title: formatPresetTooltip(p),
                onClick: () => applyPreset(p)
            },
                el('span', { class: 'qs-preset-card-label', text: p.label }),
                // 3 mini-chips: AI / География / ПДн — самые отличающиеся
                // параметры. Type/Audience/Scale в самой форме под карточками.
                el('div', { class: 'qs-preset-card-chips' },
                    ...p.chips.map(text => el('span', { class: 'qs-preset-mini-chip', text }))
                ),
                presetParams.length > 0 ? el('span', {
                    class: 'qs-preset-preview',
                    attrs: {
                        role: 'note',
                        'aria-label': `Параметры пресета: ${presetParams.map(d => `${d.label}: ${d.value}`).join(', ')}`
                    }
                },
                    el('span', { class: 'qs-preset-preview-label', text: 'Параметры: ' }),
                    ...presetParams.map(d => el('span', {
                        class: 'qs-preset-preview-pill',
                        text: `${d.label}: ${d.value}`
                    }))
                ) : null
            );
        })
    );
}

/**
 * Select-поле с info-tooltip иконкой справа от label. flash=true ставит
 * marker-class .qs-flash-target — на applyPreset поле подсвечивается.
 */
function renderSelectField({ label, value, options, info, infoShort, testId, onChange, flash }) {
    return el('label', { class: 'field' },
        renderFieldLabel({ label, info }),
        el('select', {
            class: ['input', flash && 'qs-flash-target'],
            attrs: testId ? { 'data-testid': testId } : undefined,
            onChange: e => onChange(e.target.value)
        },
            ...options.map(o => el('option', {
                value: o.value,
                attrs: o.value === value ? { selected: 'selected' } : {}
            }, o.label))
        ),
        /* Stage 5.3.A: видимый tooltipShort под полем (≤100 симв) — снижает
           когнитивную нагрузку и клики, hover полный текст по info-иконке. */
        infoShort ? el('span', { class: 'field-description', text: infoShort }) : null
    );
}

/**
 * География как chip-row из 3 опций. Заменяет старый <select> по ТЗ Stage 4.3.
 * Каждый chip — <button> с aria-pressed для screen-reader'а.
 */
function renderGeoChipsField({ value, infoShort, testId, onChange }) {
    return el('div', { class: 'field' },
        renderFieldLabel({
            label: 'География',
            info: 'Где живут пользователи. Глобальная аудитория втрое увеличивает исходящий интернет-трафик и количество обращений к внешним сервисам. «Россия + СНГ» — промежуточный вариант с латентностью к ближнему зарубежью.'
        }),
        el('div', { class: 'qs-geo-chips', attrs: { role: 'radiogroup', 'aria-label': 'География' } },
            ...GEOGRAPHIES.map(o => el('button', {
                class: ['qs-geo-chip', 'qs-flash-target', o.value === value && 'qs-geo-chip-active'],
                attrs: {
                    type: 'button',
                    role: 'radio',
                    'aria-checked': o.value === value ? 'true' : 'false',
                    'data-testid': testId ? `${testId}-${o.value}` : undefined
                },
                onClick: () => onChange(o.value)
            }, o.label))
        ),
        /* Stage 5.3.A: tooltipShort под chip-row — короткое объяснение влияния. */
        infoShort ? el('span', { class: 'field-description', text: infoShort }) : null
    );
}

/**
 * Облачный провайдер инфраструктуры. Список приходит через ctx из app.js,
 * чтобы UI не импортировал provider-контроллеры напрямую.
 */
function openProviderSelectFromFieldClick(e) {
    const target = e.target;
    if (target?.tagName === 'SELECT') return;
    if (target?.closest?.('.qs-info-icon')) {
        e.preventDefault();
        return;
    }
    const select = e.currentTarget?.querySelector?.('select');
    if (!select || select.disabled) return;
    e.preventDefault();
    select.focus({ preventScroll: true });
    if (typeof select.showPicker === 'function') {
        try {
            select.showPicker();
        } catch {
            // showPicker может быть недоступен без user activation; фокус уже поставлен.
        }
    }
}

function renderProviderField({ value, options, infoShort, testId, onChange }) {
    return el('label', { class: 'field', onClick: openProviderSelectFromFieldClick },
        renderFieldLabel({
            label: 'Облачный провайдер',
            info: 'Поставщик облачной инфраструктуры — серверов, хранилищ и сетевых каналов. Поставщики других услуг (тестирование безопасности, интеграция, лицензии на ПО) настраиваются отдельно в Опроснике в соответствующих категориях.'
        }),
        el('select', {
            class: ['input', 'qs-flash-target'],
            attrs: testId ? { 'data-testid': testId } : undefined,
            onChange: e => onChange(e.target.value)
        },
            ...options.map(o => el('option', {
                value: o.id,
                attrs: o.id === value ? { selected: 'selected' } : {}
            }, o.label))
        ),
        infoShort ? el('span', { class: 'field-description', text: infoShort }) : null
    );
}

function renderFieldLabel({ label, info }) {
    if (!info) {
        return el('span', { class: 'field-label', text: label });
    }
    return el('span', { class: 'field-label field-label-with-info' },
        el('span', { text: label }),
        el('span', {
            class: 'qs-info-icon',
            attrs: {
                'aria-label': info,
                title: info,
                role: 'img'
            },
            trustedHtml: trustedHtml(INFO_SVG_HTML)
        })
    );
}

/**
 * Toggle-row: компактная строка с label слева и switch справа. Используется
 * парно через .qs-toggle-pair (grid 2-col): ПДн + AI.
 *
 * Stage 5.3.A: infoShort — видимый текст под toggle-строкой (≤100 симв). Чтобы
 * grid 2-col не разбивал label и описание на разные ряды, оборачиваем оба
 * элемента в .qs-toggle-cell (один grid item).
 */
function renderToggleRow({ checked, label, info, infoShort, testId, onChange }) {
    const row = el('label', {
        class: 'qs-toggle-row qs-flash-target',
        attrs: testId ? { 'data-testid': testId } : undefined
    },
        el('span', { class: 'qs-toggle-row-text' },
            el('span', { class: 'qs-toggle-row-label', text: label }),
            info ? el('span', {
                class: 'qs-info-icon qs-toggle-row-info',
                attrs: { 'aria-label': info, title: info, role: 'img' },
                trustedHtml: trustedHtml(INFO_SVG_HTML)
            }) : null
        ),
        el('span', { class: 'switch qs-toggle-row-switch' },
            el('input', {
                type: 'checkbox',
                attrs: {
                    ...(checked ? { checked: 'checked' } : {}),
                    ...(testId ? { 'data-testid': `${testId}-input` } : {})
                },
                onChange: e => onChange(e.target.checked)
            }),
            el('span', { class: 'switch-track' })
        )
    );
    if (!infoShort) return row;
    /* Stage 5.3.A: оборачиваем в .qs-toggle-cell, чтобы grid (qs-toggle-pair)
       видел label + short как один grid-item. Иначе span попадёт в следующую
       колонку и сломает 2-col layout. */
    return el('div', { class: 'qs-toggle-cell' },
        row,
        el('span', { class: 'field-description', text: infoShort })
    );
}

/**
 * Прогресс-индикатор: 8 точек в шапке. Все активны (зелёные) когда draft.*
 * заполнен — все 8 параметров имеют значения по умолчанию, поэтому индикатор
 * успокаивает «всё готово, можно нажать Создать».
 */
function renderProgressDots(draft) {
    const filled = [
        draft.product_type, draft.industry, draft.scale, draft.geography,
        draft.provider,
        draft.activity, typeof draft.pdn === 'boolean' ? 'set' : null,
        typeof draft.ai_used === 'boolean' ? 'set' : null
    ].map(v => v != null && v !== '');
    const filledCount = filled.filter(Boolean).length;
    const dots = filled.map(on =>
        el('span', {
            class: ['qs-progress-dot', on && 'qs-progress-dot-on'],
            attrs: { 'aria-hidden': 'true' }
        })
    );
    return el('div', { class: 'qs-progress', attrs: { role: 'status', 'aria-live': 'polite' } },
        el('div', { class: 'qs-progress-dots' }, ...dots),
        el('span', { class: 'qs-progress-text',
            text: filledCount === 8
                ? 'Все 8 параметров заданы — можно создавать расчёт.'
                : `Заполнено ${filledCount} из 8 параметров.`
        })
    );
}
