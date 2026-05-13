/**
 * Quick Start Wizard — модалка с 7 макро-вопросами + 3 пресета сверху.
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
 *   pdn:           boolean,
 *   activity:      'very_low' | 'low' | 'medium' | 'high',
 *   ai_used:       boolean,
 *   nameLocked:    boolean   // true после ручного ввода имени — preset не перезатрёт
 * }
 */

import { el, trustedHtml } from '../dom.js';
import { modalShell } from './baseModal.js';
import {
    PRODUCT_TYPE_LABELS,
    INDUSTRY_LABELS,
    GEOGRAPHY_LABELS,
    ACTIVITY_LABELS
} from '../../domain/wizardProfiles.js';
import { UI_TOOLTIPS_SHORT } from '../../utils/constants.js';

/** Inline-SVG info-иконки. 14px подобран под font-xs label'ов. */
const INFO_SVG_HTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="10"/>' +
    '<path d="M12 16v-4"/>' +
    '<path d="M12 8h.01"/>' +
    '</svg>';

const PRODUCT_TYPES = [
    { value: 'b2b',      label: 'B2B — продаём бизнесам' },
    { value: 'b2c',      label: 'B2C — массовый потребительский продукт' },
    { value: 'internal', label: 'Внутренний инструмент компании' },
    { value: 'b2g',      label: 'B2G — для госорганов / госуслуги' }
];

const INDUSTRIES = [
    { value: 'corporate', label: 'Корпоративные сервисы (CRM / ERP / HR / биллинг)' },
    { value: 'edtech',    label: 'EdTech — образование, курсы, LMS' },
    { value: 'fintech',   label: 'FinTech — финансы, банкинг, инвестиции' },
    { value: 'consumer',  label: 'Потребительские сервисы (соцсети / маркетплейс / медиа)' }
];

const SCALES = [
    { value: 'xs', label: 'до 1 тыс. пользователей (MVP, прототип)' },
    { value: 's',  label: 'до 10 тыс. (стартап, нишевой продукт)' },
    { value: 'm',  label: 'до 100 тыс. (стандарт SMB)' },
    { value: 'l',  label: 'до 1 млн (mid-enterprise)' },
    { value: 'xl', label: 'свыше 1 млн (масштабный продукт)' }
];

const GEOGRAPHIES = [
    { value: 'ru',     label: 'Россия' },
    { value: 'ru_cis', label: 'Россия + СНГ' },
    { value: 'global', label: 'Глобально' }
];

const ACTIVITIES = [
    { value: 'very_low', label: 'Очень низкая (раз в месяц — отчётность, сезонные процессы)' },
    { value: 'low',      label: 'Низкая (раз в неделю — внутренний CRM, ревью документов)' },
    { value: 'medium',   label: 'Средняя (ежедневно — корпоративные приложения, рабочие сервисы)' },
    { value: 'high',     label: 'Высокая (несколько раз в день — соцсети, торговля, мессенджеры)' }
];

/* ============================================================================
 * PRESETS — 3 преднастройки сверху модалки. Утверждены 2026-05-08.
 *   - Стандартный B2B = классический корпоративный сервис.
 *   - Высокая нагрузка (AI) = масштабный B2C-продукт с AI-нагрузкой.
 *   - Внутренний инструмент = корпоративный для штатных сотрудников.
 * Клик заполняет 7 полей формы целиком. Активный пресет вычисляется в render
 * через сравнение draft с preset.draft (НЕ хранится в state — никаких
 * рассогласований с draft при ручной правке поля).
 * ============================================================================ */
/* Stage 4.3.3 (3-я UX-итерация): пресет = shortcut, не дубль формы. Labels
   очищены от Type-префикса (Type сам в селекте формы). Карточки показывают
   3 различающих параметра — AI / География / ПДн (то, что отделяет пресет
   от пресета). Type и Размер аудитории НЕ повторяются на карточке.

   Принцип «пресет показывает то, чем отличается от других, всё остальное —
   в форме». Form = source of truth, preset = shortcut. */
const PRESETS = Object.freeze([
    Object.freeze({
        id: 'std_b2b',
        label: 'Стандартный',
        chips: Object.freeze(['Без AI', 'Россия', 'ПДн: да']),
        draft: Object.freeze({
            product_type: 'b2b',
            industry:     'corporate',
            scale:        'm',
            geography:    'ru',
            activity:     'medium',
            pdn:          true,
            ai_used:      false
        })
    }),
    Object.freeze({
        id: 'high_ai',
        label: 'Высокая нагрузка',
        chips: Object.freeze(['С AI', 'Глобально', 'ПДн: да']),
        draft: Object.freeze({
            product_type: 'b2c',
            industry:     'consumer',
            scale:        'l',
            geography:    'global',
            activity:     'high',
            pdn:          true,
            ai_used:      true
        })
    }),
    Object.freeze({
        id: 'internal',
        label: 'Внутренний инструмент',
        chips: Object.freeze(['Без AI', 'Россия', 'Без ПДн']),
        draft: Object.freeze({
            product_type: 'internal',
            industry:     'corporate',
            scale:        's',
            geography:    'ru',
            activity:     'low',
            pdn:          false,
            ai_used:      false
        })
    })
    /* Stage 17.2: 4-й preset (пустой расчёт) удалён. Пустой расчёт создаётся
       только через «Расчёты → Новый расчёт» — отдельный CRUD-flow, который
       не дублирует wizard. */
]);

/**
 * Tooltip для preset-card: показывает 5 параметров — Индустрия, Активность,
 * География, ПДн, AI. **БЕЗ Тип и Размер** — они отображаются в самой форме
 * как отдельные select'ы и дублирование в tooltip создаёт путаницу (Stage 4.3.3).
 *
 * Native title-attr поддерживает \n как разрыв строки в Chrome/Firefox/Safari.
 *
 * Формат:
 *   Этот пресет настраивает:
 *   • Индустрия: Corporate
 *   • Активность: Средняя
 *   • География: Россия
 *   • ПДн (ФЗ-152): да
 *   • AI / LLM: выключен
 */
function formatPresetTooltip(preset) {
    const d = preset.draft;
    const lines = [
        'Этот пресет настраивает:',
        `• Индустрия: ${INDUSTRY_LABELS[d.industry] || d.industry}`,
        `• Активность: ${ACTIVITY_LABELS[d.activity] || d.activity}`,
        `• География: ${GEOGRAPHY_LABELS[d.geography] || d.geography}`,
        `• ПДн (ФЗ-152): ${d.pdn ? 'да' : 'нет'}`,
        `• AI / LLM: ${d.ai_used ? 'включён' : 'выключен'}`
    ];
    return lines.join('\n');
}

/* Короткие теги индустрий для autoName(). Маппинг утверждён 2026-05-08:
   corporate→CRM, остальные — самоназвание (EdTech/FinTech/Consumer). */
const INDUSTRY_SHORT = Object.freeze({
    corporate: 'CRM',
    edtech:    'EdTech',
    fintech:   'FinTech',
    consumer:  'Consumer'
});

/**
 * Сгенерировать имя расчёта из Type+Industry. Шаблон: «{Type} {Ind-short} расчёт».
 * Примеры: «B2B CRM расчёт», «B2C Consumer расчёт», «Internal CRM расчёт».
 */
export function autoName(productType, industry) {
    const pt = PRODUCT_TYPE_LABELS[productType] || '';
    const ind = INDUSTRY_SHORT[industry] || '';
    return `${pt} ${ind} расчёт`.replace(/\s+/g, ' ').trim();
}

/* Stage 5.5.3: компактные labels для delta-pill. Полные labels (PRODUCT_TYPES
   и т.п.) — длинные «B2C — массовый потребительский продукт» — на pill не
   умещаются. Используем тег-уровень. */
const DELTA_SHORT_LABELS = Object.freeze({
    product_type: { b2b: 'B2B', b2c: 'B2C', internal: 'Внутренний', b2g: 'B2G' },
    industry:     { corporate: 'Corporate', edtech: 'EdTech', fintech: 'FinTech', consumer: 'Consumer' },
    scale:        { xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL' },
    geography:    { ru: 'Россия', ru_cis: 'РФ + СНГ', global: 'Глобально' },
    activity:     { very_low: 'Очень низкая', low: 'Низкая', medium: 'Средняя', high: 'Высокая' }
});

const DELTA_FIELD_LABELS = [
    { key: 'product_type', label: 'Тип' },
    { key: 'industry',     label: 'Индустрия' },
    { key: 'scale',        label: 'Размер' },
    { key: 'geography',    label: 'География' },
    { key: 'activity',     label: 'Активность' },
    { key: 'pdn',          label: 'ПДн' },
    { key: 'ai_used',      label: 'AI' }
];

function formatDeltaValue(key, val) {
    if (typeof val === 'boolean') return val ? 'Да' : 'Нет';
    const map = DELTA_SHORT_LABELS[key];
    return (map && map[val]) || String(val);
}

/**
 * Stage 6.3.B (PATCH 2.4.24): посчитать, что изменится при применении
 * конкретного пресета относительно текущего draft.
 *
 * Используется для hover-preview: при наведении на preset-карточку
 * пользователь видит mini-pill'ы того, что станет. Возвращает null
 * для empty-preset (его «применение» не меняет ничего видимого) и
 * для пресета, точно совпадающего с draft (нечего показывать).
 *
 * Возвращаемый формат: array of { key, label, now } или null.
 * `was` не передаётся — preview показывает «куда», а не «откуда»
 * (для «откуда» есть delta-pill между preset-grid и формой).
 */
export function computeChangesForPreset(preset, draft) {
    if (!preset || !draft) return null;
    const ref = preset.draft;
    if (!ref) return null;
    const diffs = [];
    for (const field of DELTA_FIELD_LABELS) {
        const refVal = ref[field.key];
        const draftVal = draft[field.key];
        const same = typeof refVal === 'boolean'
            ? !!draftVal === refVal
            : draftVal === refVal;
        if (same) continue;
        diffs.push({
            key: field.key,
            label: field.label,
            now: formatDeltaValue(field.key, refVal)
        });
    }
    return diffs.length > 0 ? diffs : null;
}

/**
 * Stage 5.5.3: посчитать различия draft vs ближайший пресет.
 *
 * Возвращает null когда:
 *   - draft пуст / null
 *   - draft точно совпадает с одним из пресетов (findActivePresetId !== null)
 *
 * Иначе сравнивает с ПЕРВЫМ пресетом (Стандартный B2B) и возвращает
 * { presetLabel, diffs: [{ key, label, was, now }] }. Используется как
 * progressive disclosure: пользователь видит, чем его настройка отличается
 * от стандарта, без явного сброса draft при ручной правке поля.
 */
export function computePresetDelta(draft) {
    if (!draft) return null;
    if (findActivePresetId(draft)) return null;
    const baseline = PRESETS[0];
    if (!baseline) return null;
    const ref = baseline.draft;
    const diffs = [];
    for (const field of DELTA_FIELD_LABELS) {
        const draftVal = draft[field.key];
        const refVal = ref[field.key];
        const same = typeof refVal === 'boolean'
            ? !!draftVal === refVal
            : draftVal === refVal;
        if (!same) {
            diffs.push({
                key: field.key,
                label: field.label,
                was: formatDeltaValue(field.key, refVal),
                now: formatDeltaValue(field.key, draftVal)
            });
        }
    }
    return diffs.length > 0 ? { presetLabel: baseline.label, diffs } : null;
}

/**
 * Найти пресет, чьи 7 полей точно совпадают с draft. null — пресет не выбран
 * (либо draft уже отклонён от любого пресета ручной правкой).
 */
export function findActivePresetId(draft) {
    if (!draft) return null;
    for (const p of PRESETS) {
        const d = p.draft;
        if (draft.product_type === d.product_type &&
            draft.industry === d.industry &&
            draft.scale === d.scale &&
            draft.geography === d.geography &&
            draft.activity === d.activity &&
            !!draft.pdn === d.pdn &&
            !!draft.ai_used === d.ai_used) {
            return p.id;
        }
    }
    return null;
}

/** Стартовый draft (Стандартный B2B по умолчанию — самый частый кейс). */
function defaultDraft() {
    const std = PRESETS[0].draft;
    return {
        name: autoName(std.product_type, std.industry),
        nameLocked: false,
        ...std
    };
}

/**
 * `wz_pdn` default зависит от product_type:
 *   - internal → false (внутренний сервис может быть без ПДн)
 *   - b2b/b2c/b2g → true (всегда содержат данные клиентов или граждан)
 */
function defaultPdnFor(productType) {
    return productType !== 'internal';
}

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

    const draft = m.draft || defaultDraft();
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
            pdn:          !!draft.pdn,
            activity:     draft.activity,
            ai_used:      !!draft.ai_used
        });
    };

    return modalShell({
        title: isEdit ? 'Параметры профиля — изменение' : 'Quick Start — расчёт за минуту',
        size: 'lg',
        onClose,
        children: el('div', { class: 'quickstart-modal-body' },
            !isEdit && renderProgressDots(draft),

            !isEdit && el('div', { class: 'quickstart-intro quickstart-intro-soft',
                attrs: { role: 'note' }
            },
                el('span', { class: 'quickstart-intro-text',
                    text: 'Выберите шаблон или заполните 7 параметров — калькулятор предзаполнит детальный опросник готовыми значениями для вашей отрасли. Любой ответ потом можно поправить вручную.'
                })
            ),

            // 1. Название (только в create) — ПЕРЕД пресетами, как утверждено п.4 (а)
            !isEdit && el('label', { class: 'field' },
                el('span', { class: 'field-label', text: 'Название расчёта' }),
                el('input', {
                    class: 'input',
                    value: draft.name,
                    placeholder: 'Например: «Финтех-MVP, оценка 2026»',
                    attrs: { 'data-autofocus': '', 'data-focus-key': 'qs-name', maxlength: 120 },
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
                        onChange: v => patchTypeOrIndustry('product_type', v),
                        flash: true
                    }),
                    renderSelectField({
                        label: 'Индустрия',
                        value: draft.industry,
                        options: INDUSTRIES,
                        info: 'Отрасль, в которой работает продукт. Влияет на требования к надёжности (целевой SLA), типовые настройки AI и поиска по корпоративной базе знаний, отраслевые требования регуляторов (например, 152-ФЗ и ГОСТ для FinTech).',
                        infoShort: UI_TOOLTIPS_SHORT['qs.industry'],
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
                        onChange: v => patch({ scale: v }),
                        flash: true
                    }),
                    renderSelectField({
                        label: 'Активность пользователей',
                        value: draft.activity,
                        options: ACTIVITIES,
                        info: 'Как часто типичный пользователь заходит в продукт. Влияет на ежедневную активную аудиторию и пиковую нагрузку на серверы.',
                        infoShort: UI_TOOLTIPS_SHORT['qs.activity'],
                        onChange: v => patch({ activity: v }),
                        flash: true
                    }),
                    // Ряд 3: География (chips) | Облачный провайдер
                    renderGeoChipsField({
                        value: draft.geography,
                        infoShort: UI_TOOLTIPS_SHORT['qs.geography'],
                        onChange: v => patch({ geography: v })
                    }),
                    renderProviderField()
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
                        onChange: v => patch({ pdn: v })
                    }),
                    renderToggleRow({
                        checked: !!draft.ai_used,
                        label: 'AI / LLM (чат, поиск, рекомендации)',
                        info: 'Включает в опросник вопросы про модель AI, стоимость токенов, поиск по корпоративной базе знаний и серверы для AI-нагрузки — с типовыми значениями для вашей отрасли. Если выключено — раздел AI пустой, можно заполнить позже вручную.',
                        infoShort: UI_TOOLTIPS_SHORT['qs.ai_used'],
                        onChange: v => patch({ ai_used: v })
                    })
                )
            )
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-ghost',
                title: 'Отменить (Esc)',
                onClick: onClose
            }, 'Отмена'),
            el('button', {
                class: 'btn btn-primary btn-large',
                title: isEdit
                    ? 'Применение изменений в следующем релизе. Пока — ручная правка в Опроснике.'
                    : 'Создать расчёт с заполненным опросником',
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
            /* Stage 6.3.B (PATCH 2.4.24): preview того, что изменится при клике.
               Показывается только при hover/focus-visible (CSS), не дублирует
               chips. Для empty-preset и для preset, точно совпадающего с draft,
               null → preview не рендерится (нечего показывать). */
            const previewDiffs = computeChangesForPreset(p, draft);
            return el('button', {
                class: ['qs-preset-card',
                        p.id === activeId && 'qs-preset-card-active'],
                attrs: { type: 'button', 'aria-pressed': p.id === activeId ? 'true' : 'false' },
                // Native title-attr с \n даёт многострочный tooltip — пользователь
                // на hover видит 5 параметров (Индустрия / Активность / География /
                // ПДн / AI) — БЕЗ Type и Размер (они в самой форме).
                // Для empty-карточки tooltip объясняет, что это «без пресета».
                title: formatPresetTooltip(p),
                onClick: () => applyPreset(p)
            },
                el('span', { class: 'qs-preset-card-label', text: p.label }),
                // Stage 4.3.3: 3 mini-chips вместо sub-строки. Показывают ТОЛЬКО
                // те параметры, которыми пресет отличается от других — AI / Геогр /
                // ПДн. Type и Audience не дублируются. Для empty-карточки chips
                // объясняют поведение (заполнить вручную / опросник пуст).
                el('div', { class: 'qs-preset-card-chips' },
                    ...p.chips.map(text => el('span', { class: 'qs-preset-mini-chip', text }))
                ),
                /* Stage 6.3.B: hover/focus-preview блок «что изменится». Скрыт
                   по умолчанию через CSS opacity 0, показывается на hover/
                   focus-visible. role="status" + aria-label обеспечивают
                   доступность keyboard-пользователям (screen-reader озвучит). */
                previewDiffs ? el('span', {
                    class: 'qs-preset-preview',
                    attrs: {
                        role: 'status',
                        'aria-label': `Изменится при выборе: ${previewDiffs.map(d => `${d.label}: ${d.now}`).join(', ')}`
                    }
                },
                    el('span', { class: 'qs-preset-preview-label', text: 'Изменится: ' }),
                    ...previewDiffs.map(d => el('span', {
                        class: 'qs-preset-preview-pill',
                        text: `${d.label}: ${d.now}`
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
function renderSelectField({ label, value, options, info, infoShort, onChange, flash }) {
    return el('label', { class: 'field' },
        renderFieldLabel({ label, info }),
        el('select', {
            class: ['input', flash && 'qs-flash-target'],
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
function renderGeoChipsField({ value, infoShort, onChange }) {
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
                    'aria-checked': o.value === value ? 'true' : 'false'
                },
                onClick: () => onChange(o.value)
            }, o.label))
        ),
        /* Stage 5.3.A: tooltipShort под chip-row — короткое объяснение влияния. */
        infoShort ? el('span', { class: 'field-description', text: infoShort }) : null
    );
}

/**
 * Облачный провайдер инфраструктуры — disabled select с одной опцией.
 * Поддержка других провайдеров (Yandex Cloud, VK Cloud, on-premise) появится
 * в следующих обновлениях.
 */
function renderProviderField() {
    return el('label', { class: 'field' },
        renderFieldLabel({
            label: 'Облачный провайдер',
            info: 'Поставщик облачной инфраструктуры — серверов, хранилищ и сетевых каналов. Поставщики других услуг (тестирование безопасности, интеграция, лицензии на ПО) настраиваются отдельно в Опроснике в соответствующих категориях. В текущей версии активен Cloud.ru (бывший SberCloud) — поддержка Yandex Cloud, VK Cloud и собственной инфраструктуры (on-premise) появится в следующих обновлениях.'
        }),
        el('select', { class: 'input', attrs: { disabled: 'disabled' } },
            el('option', { value: 'sbercloud', attrs: { selected: 'selected' } }, 'Cloud.ru (бывший SberCloud)')
        )
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
function renderToggleRow({ checked, label, info, infoShort, onChange }) {
    const row = el('label', { class: 'qs-toggle-row qs-flash-target' },
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
                attrs: checked ? { checked: 'checked' } : {},
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
 * Прогресс-индикатор: 7 точек в шапке. Все активны (зелёные) когда draft.*
 * заполнен — все 7 параметров имеют значения по умолчанию, поэтому индикатор
 * успокаивает «всё готово, можно нажать Создать».
 */
function renderProgressDots(draft) {
    const filled = [
        draft.product_type, draft.industry, draft.scale, draft.geography,
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
            text: filledCount === 7
                ? 'Все 7 параметров заданы — можно создавать расчёт.'
                : `Заполнено ${filledCount} из 7 параметров.`
        })
    );
}

/* Экспорты для тестов и внешнего использования (preset block). */
export { PRESETS, INDUSTRY_SHORT, formatPresetTooltip };
