/**
 * Quick Start UI model.
 *
 * This module keeps preset data and pure-ish draft helpers out of the modal
 * renderer. The renderer still owns DOM composition and event handlers.
 */

import {
    PRODUCT_TYPE_LABELS,
    INDUSTRY_LABELS,
    GEOGRAPHY_LABELS,
    ACTIVITY_LABELS
} from '../../domain/wizardProfiles.js';

export const PRODUCT_TYPES = Object.freeze([
    Object.freeze({ value: 'b2b',      label: 'B2B — продаём бизнесам' }),
    Object.freeze({ value: 'b2c',      label: 'B2C — массовый потребительский продукт' }),
    Object.freeze({ value: 'internal', label: 'Внутренний инструмент компании' }),
    Object.freeze({ value: 'b2g',      label: 'B2G — для госорганов / госуслуги' })
]);

export const INDUSTRIES = Object.freeze([
    Object.freeze({ value: 'corporate', label: 'Корпоративные сервисы (CRM / ERP / HR / биллинг)' }),
    Object.freeze({ value: 'edtech',    label: 'EdTech — образование, курсы, LMS' }),
    Object.freeze({ value: 'fintech',   label: 'FinTech — финансы, банкинг, инвестиции' }),
    Object.freeze({ value: 'consumer',  label: 'Потребительские сервисы (соцсети / маркетплейс / медиа)' })
]);

export const SCALES = Object.freeze([
    Object.freeze({ value: 'xs', label: 'до 1 тыс. пользователей (MVP, прототип)' }),
    Object.freeze({ value: 's',  label: 'до 10 тыс. (стартап, нишевой продукт)' }),
    Object.freeze({ value: 'm',  label: 'до 100 тыс. (стандарт SMB)' }),
    Object.freeze({ value: 'l',  label: 'до 1 млн (mid-enterprise)' }),
    Object.freeze({ value: 'xl', label: 'свыше 1 млн (масштабный продукт)' })
]);

export const GEOGRAPHIES = Object.freeze([
    Object.freeze({ value: 'ru',     label: 'Россия' }),
    Object.freeze({ value: 'ru_cis', label: 'Россия + СНГ' }),
    Object.freeze({ value: 'global', label: 'Глобально' })
]);

export const ACTIVITIES = Object.freeze([
    Object.freeze({ value: 'very_low', label: 'Очень низкая (раз в месяц — отчётность, сезонные процессы)' }),
    Object.freeze({ value: 'low',      label: 'Низкая (раз в неделю — внутренний CRM, ревью документов)' }),
    Object.freeze({ value: 'medium',   label: 'Средняя (ежедневно — корпоративные приложения, рабочие сервисы)' }),
    Object.freeze({ value: 'high',     label: 'Высокая (несколько раз в день — соцсети, торговля, мессенджеры)' })
]);

export const FALLBACK_PROVIDER_OPTIONS = Object.freeze([
    Object.freeze({ id: 'sbercloud', label: 'Cloud.ru (бывший SberCloud)' })
]);

/* ============================================================================
 * PRESETS - 3 преднастройки сверху модалки. Утверждены 2026-05-08.
 *   - Стандартный B2B = классический корпоративный сервис.
 *   - Высокая нагрузка (AI) = масштабный B2C-продукт с AI-нагрузкой.
 *   - Внутренний инструмент = корпоративный для штатных сотрудников.
 * Клик заполняет 7 полей формы целиком. Активный пресет вычисляется в render
 * через сравнение draft с preset.draft (НЕ хранится в state - никаких
 * рассогласований с draft при ручной правке поля).
 * ============================================================================ */
/* Stage 4.3.3 (3-я UX-итерация): пресет = shortcut, не дубль формы. Labels
   очищены от Type-префикса (Type сам в селекте формы). Карточки показывают
   3 различающих параметра - AI / География / ПДн (то, что отделяет пресет
   от пресета). Type и Размер аудитории НЕ повторяются на карточке.

   Принцип «пресет показывает то, чем отличается от других, всё остальное -
   в форме». Form = source of truth, preset = shortcut. */
export const PRESETS = Object.freeze([
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
       только через «Расчёты -> Новый расчёт» - отдельный CRUD-flow, который
       не дублирует wizard. */
]);

/**
 * Tooltip для preset-card: показывает 5 параметров - Индустрия, Активность,
 * География, ПДн, AI. Без Тип и Размер: они отображаются в самой форме.
 */
export function formatPresetTooltip(preset) {
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
   corporate -> CRM, остальные - самоназвание (EdTech/FinTech/Consumer). */
export const INDUSTRY_SHORT = Object.freeze({
    corporate: 'CRM',
    edtech:    'EdTech',
    fintech:   'FinTech',
    consumer:  'Consumer'
});

/**
 * Сгенерировать имя расчёта из Type+Industry. Шаблон: «{Type} {Ind-short} расчёт».
 */
export function autoName(productType, industry) {
    const pt = PRODUCT_TYPE_LABELS[productType] || '';
    const ind = INDUSTRY_SHORT[industry] || '';
    return `${pt} ${ind} расчёт`.replace(/\s+/g, ' ').trim();
}

/* Stage 5.5.3: компактные labels для delta-pill. */
const DELTA_SHORT_LABELS = Object.freeze({
    product_type: { b2b: 'B2B', b2c: 'B2C', internal: 'Внутренний', b2g: 'B2G' },
    industry:     { corporate: 'Corporate', edtech: 'EdTech', fintech: 'FinTech', consumer: 'Consumer' },
    scale:        { xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL' },
    geography:    { ru: 'Россия', ru_cis: 'РФ + СНГ', global: 'Глобально' },
    activity:     { very_low: 'Очень низкая', low: 'Низкая', medium: 'Средняя', high: 'Высокая' }
});

const DELTA_FIELD_LABELS = Object.freeze([
    Object.freeze({ key: 'product_type', label: 'Тип' }),
    Object.freeze({ key: 'industry',     label: 'Индустрия' }),
    Object.freeze({ key: 'scale',        label: 'Размер' }),
    Object.freeze({ key: 'geography',    label: 'География' }),
    Object.freeze({ key: 'activity',     label: 'Активность' }),
    Object.freeze({ key: 'pdn',          label: 'ПДн' }),
    Object.freeze({ key: 'ai_used',      label: 'AI' })
]);

function formatDeltaValue(key, val) {
    if (typeof val === 'boolean') return val ? 'Да' : 'Нет';
    const map = DELTA_SHORT_LABELS[key];
    return (map && map[val]) || String(val);
}

/**
 * PATCH 2.18.1: вернуть абсолютные параметры пресета - стабильный список,
 * который не зависит от текущего draft и не меняется при кликах.
 */
export function formatPresetParams(preset) {
    if (!preset || !preset.draft) return [];
    return DELTA_FIELD_LABELS.map(field => ({
        key: field.key,
        label: field.label,
        value: formatDeltaValue(field.key, preset.draft[field.key])
    }));
}

/**
 * Stage 5.5.3: посчитать различия draft vs ближайший пресет.
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
 * Найти пресет, чьи 7 полей точно совпадают с draft. null - пресет не выбран.
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

/** Стартовый draft (Стандартный B2B по умолчанию - самый частый кейс). */
export function defaultDraft(providerId) {
    const std = PRESETS[0].draft;
    return {
        name: autoName(std.product_type, std.industry),
        nameLocked: false,
        provider: providerId,
        ...std
    };
}

/**
 * `wz_pdn` default зависит от product_type:
 *   - internal -> false
 *   - b2b/b2c/b2g -> true
 */
export function defaultPdnFor(productType) {
    return productType !== 'internal';
}

export function getProviderOptions(ctx) {
    const fromCtx = typeof ctx.listActiveProvidersForQuickStart === 'function'
        ? ctx.listActiveProvidersForQuickStart()
        : [];
    const safe = Array.isArray(fromCtx)
        ? fromCtx
            .filter(p => p && typeof p.id === 'string' && p.id && typeof p.label === 'string' && p.label)
            .map(p => ({ id: p.id, label: p.label }))
        : [];
    return safe.length > 0 ? safe : FALLBACK_PROVIDER_OPTIONS;
}

export function getDefaultProvider(ctx, providerOptions) {
    const fromCtx = typeof ctx.getDefaultProviderId === 'function' ? ctx.getDefaultProviderId() : '';
    if (providerOptions.some(p => p.id === fromCtx)) return fromCtx;
    return providerOptions[0]?.id || FALLBACK_PROVIDER_OPTIONS[0].id;
}
