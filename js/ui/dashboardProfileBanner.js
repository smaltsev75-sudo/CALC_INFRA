import { el } from './dom.js';
import { icon } from './icons.js';
import {
    PRODUCT_TYPE_LABELS, INDUSTRY_LABELS, SCALE_LABELS,
    GEOGRAPHY_LABELS, ACTIVITY_LABELS
} from '../domain/wizardProfiles.js';
/* ---------- Profile banner (14.U3 / Sprint 2.2 пункт 2) ----------
   Показывается ТОЛЬКО для расчётов, созданных через Quick Start Wizard
   (calc.wizard !== null). Для legacy-расчётов и созданных через «Новый расчёт»
   баннер отсутствует — это намеренный выбор пользователя (см. DECISIONS 14.U3).

   Содержимое:
     1) ⚡ «Профиль: {industryLabel} ({scaleLabel})» — компактная сводка.
     2) Три мини-счётчика источников полей: manual / profile / scale.
        Видимый сразу summary «насколько глубоко расчёт уже посещён»: пользователь
        видит, что он, например, изменил вручную 3 поля поверх 23-х предзаполненных
        из профиля и 14-ти от масштаба. Это ключевой сигнал перед re-apply
        (Sprint 2.2 пункт 3) — заранее понимать, сколько manual'ок пострадает.
     3) Кнопка «Изменить параметры» — открывает Quick Start в режиме edit
        с предзаполненным draft из calc.wizard.

   Tooltip всех элементов — полный состав wizard-параметров. */

/* Считает количество полей по каждому source. ~7 источников возможны
   (см. wizardProfiles.js: scale / profile / wizard / product_type /
   geography / activity / derived / sla_preset / compliance + manual).
   Группы для бейджа в баннере: manual, profile (объединяет profile/wizard/
   product_type/geography/activity), scale. Остальные (derived/sla_preset/
   compliance) — в общую группу «auto».

   PATCH 2.18.3 (audit-10, P2.1 defensive): опциональный второй аргумент `calc`
   фильтрует orphan-meta-keys — id, для которого нет ни вопроса в dictionary,
   ни валидного ответа в answers (типичный случай — stale meta после удаления
   вопроса миграцией). Без calc — backward-compatible поведение «count all». */
export function countAnswerSources(answersMeta, calc) {
    const counts = { manual: 0, profile: 0, scale: 0, auto: 0 };
    if (!answersMeta || typeof answersMeta !== 'object') return counts;

    // Orphan-filter активен только когда передан calc (новый API).
    let liveIds = null;
    if (calc && typeof calc === 'object') {
        const answers = calc.answers || {};
        const qIds = new Set(
            (calc.dictionaries?.questions || [])
                .filter(q => q && typeof q.id === 'string')
                .map(q => q.id)
        );
        liveIds = new Set();
        for (const [id, value] of Object.entries(answers)) {
            if (!qIds.has(id)) continue;
            if (value === null || value === undefined) continue;
            if (Array.isArray(value) && value.length === 0) continue;
            if (value === '') continue;
            liveIds.add(id);
        }
    }

    for (const [id, meta] of Object.entries(answersMeta)) {
        if (liveIds && !liveIds.has(id)) continue; // orphan — нет вопроса/ответа
        const s = meta?.source;
        if (s === 'manual') counts.manual++;
        else if (s === 'scale') counts.scale++;
        else if (s === 'profile' || s === 'wizard' || s === 'product_type'
              || s === 'geography' || s === 'activity') counts.profile++;
        else if (s === 'derived' || s === 'sla_preset' || s === 'compliance') counts.auto++;
    }
    return counts;
}

export function renderProfileBanner(calc, ctx) {
    const w = calc?.wizard;
    if (!w) return renderProfileBannerEmptyState(calc, ctx);

    const industry = INDUSTRY_LABELS[w.industry] || w.industry || '—';
    const scale    = SCALE_LABELS[w.scale]       || w.scale    || '—';
    const type     = PRODUCT_TYPE_LABELS[w.product_type] || w.product_type || '—';
    const geo      = GEOGRAPHY_LABELS[w.geography]       || w.geography    || '—';
    const activity = ACTIVITY_LABELS[w.activity]         || w.activity     || '—';
    const pdn      = w.pdn ? 'да' : 'нет';
    const ai       = w.ai_used ? 'используется' : 'нет';

    const counts = countAnswerSources(calc.answersMeta, calc);

    /* Sprint 3.0 Stage 2: scenario-aware label. Если у calc есть scenarios[]
       (миграция v15+), показываем активный scenario.label рядом с профилем —
       пользователь видит «Корпоративный SaaS · сценарий Базовый». Для legacy
       calc без scenarios скрываем — нет смысла показывать одну вкладку. */
    const scenarios = Array.isArray(calc.scenarios) ? calc.scenarios : [];
    const activeScenario = scenarios.length > 0
        ? (scenarios.find(s => s.id === calc.activeScenarioId) || scenarios[0])
        : null;
    const scenarioLabel = activeScenario && scenarios.length >= 1 ? activeScenario.label : null;
    /* Re-apply целит в активный scenario; manualCount тоже считается по
       answersMeta активного scenario (mirror на root, который читает
       countAnswerSources). */
    const manualCount = counts.manual;

    const tooltip = [
        `Тип продукта: ${type}`,
        `География: ${geo}`,
        `Активность: ${activity}`,
        `ПДн: ${pdn}`,
        `AI: ${ai}`,
        scenarioLabel ? '' : null,
        scenarioLabel ? `Активный сценарий: ${scenarioLabel}` : null,
        '',
        `Полей из профиля/мастера: ${counts.profile}`,
        `Полей из масштаба: ${counts.scale}`,
        `Изменено вручную: ${counts.manual}`,
        '',
        '7 макро-ответов задают предзаполнение полей опросника.',
        'Нажмите «Изменить параметры», чтобы пересмотреть профиль.'
    ].filter(line => line !== null).join('\n');

    const headerLabel = scenarioLabel
        ? `Профиль: ${industry} (${scale}) · сценарий ${scenarioLabel}`
        : `Профиль: ${industry} (${scale})`;

    return el('div', { class: 'profile-banner', attrs: { 'aria-label': 'Информация о профиле расчёта' } },
        el('span', { class: 'profile-banner-icon', attrs: { title: tooltip, 'aria-hidden': 'true' } },
            icon('zap', { size: 14 })
        ),
        el('span', { class: 'profile-banner-label', attrs: { title: tooltip },
            text: headerLabel }),
        el('span', { class: 'profile-banner-counts', attrs: { 'aria-label': 'Происхождение полей расчёта' } },
            renderSourceCount('profile', counts.profile),
            renderSourceCount('scale',   counts.scale),
            renderSourceCount('manual',  counts.manual)
        ),
        el('button', {
            class: 'btn btn-ghost btn-sm profile-banner-edit',
            attrs: { type: 'button', title: 'Открыть Quick Start с текущими параметрами профиля для активного сценария' },
            onClick: () => { if (typeof ctx.openQuickStartForEdit === 'function') ctx.openQuickStartForEdit(); }
        },
            icon('settings', { size: 14 }),
            el('span', { text: 'Изменить параметры' })
        ),
        /* Sprint 3.0 Stage 2: Re-apply кнопка рядом с «Изменить». Scope = активный
           scenario, manualCount = из mirror на root (который зеркалит
           scenarios[active].answersMeta). */
        el('button', {
            class: 'btn btn-ghost btn-sm profile-banner-reapply',
            attrs: {
                type: 'button',
                /* Stage 5.2: явное «к АКТИВНОМУ сценарию» — пользователь должен
                   понимать, что re-apply через mirror-pattern не затронет другие
                   сценарии (calcController.js:227-244 описывает механику). */
                title: scenarioLabel
                    ? `Применить профиль повторно к активному сценарию «${scenarioLabel}». Другие сценарии не изменятся. Можно сохранить ${manualCount} ручных правок или перезаписать всё.`
                    : `Применить профиль повторно к активному расчёту. ${manualCount} ручных правок будет предложено сохранить или перезаписать.`
            },
            onClick: () => { if (typeof ctx.openReapplyConfirm === 'function') ctx.openReapplyConfirm(); }
        },
            icon('refresh-cw', { size: 14 }),
            el('span', { text: 'Применить заново' })
        )
    );
}

/**
 * Stage 18.2 (v2.13.1) — empty-state карточка для сценариев без profile-wizard'а.
 *
 * Когда показывается:
 *   - У активного сценария `wizard === null`. Это случается в двух кейсах:
 *     a) legacy-сценарии, добавленные через `+ Сценарий` до v2.13.1 (тогда
 *        addScenario создавал `wizard: null`).
 *     b) пользователь явно завёл «голый» сценарий программно/через импорт.
 *
 *   С v2.13.1 новые сценарии через `+ Сценарий` наследуют wizard от активного,
 *   поэтому таких case'ов становится меньше — но empty-state остаётся для
 *   legacy и явных пустых.
 *
 * Что показывает:
 *   - Подпись «Профиль сценария не задан».
 *   - Короткое объяснение почему это важно.
 *   - CTA «Задать профиль сценария» → openQuickStartForActiveScenarioProfile.
 *
 * Что НЕ показывает:
 *   - source-counts (нет wizard'а — нет «полей из профиля»).
 *   - кнопку «Применить заново» (нечего применять).
 */
function renderProfileBannerEmptyState(calc, ctx) {
    if (!calc) return null;

    /* Имя активного сценария — для подсказки пользователю, к какому именно
       сценарию применится профиль. Для legacy-calc'ов без scenarios[] —
       virtual «Базовый» из getActiveScenario. */
    const scenarios = Array.isArray(calc.scenarios) ? calc.scenarios : [];
    const activeScenario = scenarios.length > 0
        ? (scenarios.find(s => s.id === calc.activeScenarioId) || scenarios[0])
        : null;
    const scenarioLabel = activeScenario?.label || null;

    return el('div', {
        class: 'profile-banner profile-banner-empty',
        attrs: { 'aria-label': 'У активного сценария не задан профиль Quick Start' }
    },
        el('span', { class: 'profile-banner-icon', attrs: { 'aria-hidden': 'true' } },
            icon('settings', { size: 14 })
        ),
        el('div', { class: 'profile-banner-empty-text' },
            el('span', { class: 'profile-banner-empty-title',
                text: scenarioLabel
                    ? `Профиль сценария «${scenarioLabel}» не задан`
                    : 'Профиль сценария не задан' }),
            el('span', { class: 'profile-banner-empty-hint',
                text: 'Задайте профиль Quick Start, чтобы предзаполнить параметры продукта и пользоваться кнопкой «Изменить параметры».' })
        ),
        el('button', {
            class: 'btn btn-primary btn-sm profile-banner-empty-action',
            attrs: { type: 'button',
                title: scenarioLabel
                    ? `Открыть Quick Start и задать профиль для сценария «${scenarioLabel}»`
                    : 'Открыть Quick Start и задать профиль активного сценария' },
            onClick: () => {
                if (typeof ctx.openQuickStartForActiveScenarioProfile === 'function') {
                    ctx.openQuickStartForActiveScenarioProfile();
                }
            }
        },
            icon('sparkles', { size: 14 }),
            el('span', { text: 'Задать профиль сценария' })
        )
    );
}

/* Один счётчик-пилюля. Визуально совпадает с source-бейджами в Опроснике
   (forms.css → .field-source-badge--{cls}), чтобы пользователь сразу узнавал
   палитру: «зелёный = из профиля», «синий = из масштаба», «outlined = ручная правка». */
/* Чипы рядом с заголовком профиля показывают «откуда» взялись ответы
   опросника: из мастера Quick Start (профиль), по масштабу проекта или
   ручные правки. У каждого чипа visible short-label (Stage 4.7) и
   развёрнутый tooltip (3-4 строки), чтобы пользователь сразу понимал:
     1) Что именно лежит в этой группе.
     2) Откуда оно появилось (мастер / шкала / ручная правка).
     3) Как обновить или поменять (Quick Start / re-apply / Опросник). */
const PROFILE_COUNT_CONFIG = {
    profile: {
        shortLabel: 'Профиль',
        tooltipTitle: 'Из профиля',
        tooltipExplain:
            'Поля, заполненные автоматически по 7 макро-ответам Quick Start: тип продукта, ' +
            'индустрия, география, активность, ПДн, AI. ' +
            'Чтобы пересмотреть — нажмите «Изменить параметры» или «Применить заново».'
    },
    scale: {
        shortLabel: 'Масштаб',
        tooltipTitle: 'Из масштаба',
        tooltipExplain:
            'Поля, рассчитанные по выбранному в Quick Start масштабу проекта (число пользователей ' +
            'и нагрузка). Меняются при смене размера или профиля в Quick Start.'
    },
    manual: {
        shortLabel: 'Вручную',
        tooltipTitle: 'Вы изменили',
        tooltipExplain:
            'Поля, изменённые вручную в Опроснике. Имеют приоритет над профилем и масштабом — ' +
            'при «Применить заново» вам предложат сохранить эти правки или перезаписать.'
    }
};

function renderSourceCount(cls, count) {
    const cfg = PROFILE_COUNT_CONFIG[cls];
    if (!cfg) return null;
    const unit = count === 1 ? 'поле' : 'поля/полей';
    /* Native title atrabute разбивает '\n' на переводы строк во всех современных
       браузерах — даёт читаемый многострочный tooltip без кастомного popover'а. */
    const title = `${cfg.tooltipTitle}: ${count} ${unit}\n\n${cfg.tooltipExplain}`;
    return el('span', {
        class: ['profile-banner-count', `field-source-badge`, `field-source-badge--${cls}`],
        attrs: { title }
    },
        el('span', { class: 'profile-banner-count-label', text: cfg.shortLabel }),
        el('span', { class: 'profile-banner-count-num', text: String(count) })
    );
}
