/**
 * Вкладка «Опросник» — ответы на вопросы по разделам + блок настроек расчёта.
 *
 * UX-принципы:
 *   - Все тултипы — для нетехнического пользователя, без жаргона.
 *   - Валюта — только в шапке (НЕ дублируется в settings).
 *   - Подгруппы внутри раздела задаются полем `q.subgroup` у вопросов в seed.js.
 *   - Поля с `allowUnknown=true` поддерживают режим «Не знаю» —
 *     ответ становится null, в калькуляторе подставляется defaultIfUnknown.
 *
 * Этап 12.U1 (Опросник UX-Hardening, Фазы 1+2):
 *   - Sticky прогресс-индикатор «N / M ответов уточнено».
 *   - Каждая секция и settings-panel — accordion с persist состоянием
 *     (state.ui.questionnaireOpenSections / questionnaireSettingsOpen).
 *   - Settings разбиты на 3 логические подгруппы (Период / Риск-коэффициенты / НДС).
 *   - Master-toggle «Учитывать риск-коэффициенты» — наверху своей группы.
 *   - «Не знаю» — компактный pill с Lucide-иконкой (без ASCII-чекбоксов).
 *   - Дублирующая ⓘ-иконка убрана — tooltip остаётся на field-label.
 *   - Recent-glow на field после change (subtle confirmation).
 *   - Empty state с CTA «Создать расчёт» вместо текстовой подсказки.
 */

import { el, infoIcon } from './dom.js';
import { icon } from './icons.js';
import {
    SECTION_IDS, SECTION_LABELS,
    STAND_IDS, STAND_LABELS, STAND_RATIO_RANGES,
    DEFAULT_STAND_SIZE_RATIO,
    DEFAULT_RESOURCE_RATIO,
    DEFAULT_AI_STAND_FACTOR,
    AI_STAND_FACTOR_RANGES,
    DASHBOARD_RESOURCE_LABELS,
    SETTINGS_DESCRIPTIONS,
    UI_TOOLTIPS_SHORT
} from '../utils/constants.js';
import { parseNumberInput, percent, formatDate } from '../services/format.js';
import { SEED_QUESTIONS, SEED_ITEMS, DEPRECATED_QUESTION_IDS } from '../domain/seed.js';
import { listProviders, DEFAULT_PROVIDER, PROVIDER_OVERLAYS } from '../domain/providerOverlay.js';
import {
    renderProviderUpdateRow,
    renderProviderPriceSummary
} from './providerPriceSummary.js';
import { renderHealthStickyChip } from './healthChip.js';
import { renderScenarioBadge } from './scenarioBadge.js';
import { getVatPeriodCrossings } from '../domain/vatRateTable.js';

// 12.U12: индекс ЭК из SEED для UI-fallback applicableStands/dashboardResource
// в существующих расчётах, у которых dictionary.items был сохранён без этих полей.
const SEED_ITEM_BY_ID = new Map(SEED_ITEMS.map(it => [it.id, it]));

// 12.U3: индекс актуальных UI-only полей (dependsOn, layout) по id вопроса.
// Существующие расчёты в localStorage могли быть созданы до того, как поле
// появилось в seed — dictionaries.questions хранит снимок на момент создания
// calc и нового поля в нём нет. Чтобы не делать миграцию ради UI-only поля,
// при рендере добираем из текущего SEED_QUESTIONS как fallback.
const SEED_BY_ID = new Map(SEED_QUESTIONS.map(q => [q.id, q]));
const SEED_DEPS_BY_ID = new Map(SEED_QUESTIONS.map(q => [q.id, q.dependsOn]));

/** Получить UI-only поле вопроса (layout, dependsOn и т.п.) с fallback на SEED. */
function uiField(q, fieldName) {
    return q[fieldName] ?? SEED_BY_ID.get(q.id)?.[fieldName];
}

/* 12.U14: для select/multiselect-опций ВСЕГДА предпочитаем SEED (если вопрос там есть),
   иначе пользователь, у которого расчёт в localStorage сохранён до расширения seed,
   никогда не увидит новые опции (dictionary хранит снимок на момент создания расчёта).
   Для пользовательских вопросов, добавленных вручную в «Справочнике вопросов» и
   отсутствующих в SEED, fallback на q.options. */
function questionOptions(q) {
    const seedOpts = SEED_BY_ID.get(q.id)?.options;
    return seedOpts ?? q.options ?? [];
}

/* ---------- 12.U1 helpers: accordion-состояния + прогресс ---------- */

/** Какие секции опросника считаются открытыми. По умолчанию — первая. */
function openedSections(state) {
    const v = state.ui.questionnaireOpenSections;
    return Array.isArray(v) ? v : [SECTION_IDS[0]];
}

/** Открыта ли панель «Параметры расчёта». По умолчанию — раскрыта при первом
 * заходе (`null` означает «пользователь ещё не управлял»). После первого toggle
 * запоминаем явный выбор. */
function settingsOpened(state) {
    return state.ui.questionnaireSettingsOpen !== false;
}

/** Toggle одной секции в state.ui.questionnaireOpenSections. */
function toggleSection(state, ctx, sectionId) {
    const cur = openedSections(state);
    const next = cur.includes(sectionId)
        ? cur.filter(s => s !== sectionId)
        : [...cur, sectionId];
    ctx.setUi({ questionnaireOpenSections: next });
}

/** Toggle settings-панели. */
function toggleSettings(state, ctx) {
    ctx.setUi({ questionnaireSettingsOpen: !settingsOpened(state) });
}

/* Stage 6.2.B (PATCH 2.4.23): collapsible подгруппы внутри секций.
   state.ui.questionnaireCollapsedSubgroups = { [sectionId]: string[] }
   Дефолт {} = все подгруппы развёрнуты. */
function subgroupCollapsed(state, sectionId, title) {
    const map = state.ui.questionnaireCollapsedSubgroups;
    if (!map || typeof map !== 'object') return false;
    const list = map[sectionId];
    return Array.isArray(list) && list.includes(title);
}

function toggleSubgroup(state, ctx, sectionId, title) {
    const cur = state.ui.questionnaireCollapsedSubgroups || {};
    const list = Array.isArray(cur[sectionId]) ? cur[sectionId] : [];
    const next = list.includes(title)
        ? list.filter(t => t !== title)
        : [...list, title];
    ctx.setUi({ questionnaireCollapsedSubgroups: { ...cur, [sectionId]: next } });
}

/* ---------- 14.U2: бейджи происхождения значений (Source-бейджи) ----------
   Показываются рядом с label вопроса, когда `calc.answersMeta[q.id].source`
   задан wizard'ом или ручной правкой. Источники задаёт wizardToAnswers
   (см. js/domain/wizardProfiles.js): scale / profile / wizard / product_type /
   geography / activity / derived / sla_preset / compliance. Любой setAnswer
   из UI помечает поле как 'manual'. */
const SOURCE_BADGES = {
    wizard:       { label: 'Из мастера',    cls: 'wizard',     tip: 'Значение задано в Quick Start (тип/индустрия/география). Можно переопределить вручную.' },
    profile:      { label: 'Из профиля',    cls: 'profile',    tip: 'Значение из индустриального профиля (Corporate / EdTech / FinTech / Consumer). Можно переопределить вручную.' },
    scale:        { label: 'Из масштаба',   cls: 'scale',      tip: 'Значение зависит от выбранного размера аудитории (XS / S / M / L / XL).' },
    product_type: { label: 'Из типа',       cls: 'type',       tip: 'Значение скорректировано под тип продукта (B2B / B2C / Internal / B2G).' },
    geography:    { label: 'Из географии',  cls: 'geography',  tip: 'Значение скорректировано под географию (RU / RU+СНГ / Глобально).' },
    activity:     { label: 'Активность',    cls: 'activity',   tip: 'Значение скорректировано под уровень активности пользователей (Low / Medium / High).' },
    derived:      { label: 'Производное',   cls: 'derived',    tip: 'Вычислено на основе других ответов (пиковая одновременная аудитория, среднее число запросов в секунду, общая аудитория).' },
    sla_preset:   { label: 'Из SLA',        cls: 'sla',        tip: 'Значение из канонического уровня SLA — параметры аварийного восстановления рассчитаны автоматически.' },
    compliance:   { label: 'По регуляторам', cls: 'compliance', tip: 'Значение продиктовано требованиями регуляторов и стандартов (152-ФЗ / ФСТЭК / межсетевой экран приложений / геоРезидентность данных).' },
    /* Sprint 3.0 Stage 2: AI-prefill из toggle'а «AI/LLM в продукте?» в Quick Start.
       Отдельный фиолетовый бейдж — пользователь сразу видит, какие поля
       заполнились из-за ai_used=true и при необходимости их корректирует. */
    ai_default:   { label: 'Из мастера AI', cls: 'ai-default', tip: 'Значение предзаполнено автоматически потому, что в Quick Start вы отметили «Используется AI / LLM». Можно переопределить вручную.' },
    manual:       { label: 'Вы изменили',   cls: 'manual',     tip: 'Значение изменено вручную в Опроснике — приоритет над профилем и масштабом.' }
};

function renderSourceBadge(meta) {
    if (!meta || !meta.source) return null;
    const cfg = SOURCE_BADGES[meta.source];
    if (!cfg) return null;
    return el('span', {
        class: ['field-source-badge', `field-source-badge--${cfg.cls}`],
        attrs: { title: cfg.tip, 'aria-label': cfg.tip },
        text: cfg.label
    });
}

/**
 * Объединённый источник списка вопросов для рендера + счётчиков.
 *
 * Шаги (идентичны логике `renderSection`, чтобы шапочный progress-bar и
 * фактически-видимое количество вопросов не расходились — audit-9 P2):
 *   1) Берём `calc.dictionaries.questions` (snapshot legacy-расчёта).
 *   2) Доливаем недостающие вопросы из текущего SEED (forward-compat: новые
 *      seed-вопросы видны и в старых расчётах без миграции).
 *   3) Фильтруем `DEPRECATED_QUESTION_IDS` (defense-in-depth поверх
 *      sanitizeDeprecatedQuestions в migrateCalculation).
 *   4) Опционально фильтруем по `sectionId`.
 *   5) Сортируем по `order` если фильтр по секции.
 *
 * @param {object} calc          расчёт (any schemaVersion)
 * @param {object} [opts]
 * @param {string} [opts.sectionId] если задан — оставляем только вопросы секции, отсортированные по order
 * @returns {Array<object>}      нормализованный список вопросов
 */
export function getRenderableQuestions(calc, opts = {}) {
    const dictQuestions = calc?.dictionaries?.questions || [];
    const dictById = new Map(dictQuestions.map(q => [q.id, q]));
    const merged = dictQuestions.slice();
    for (const seedQ of SEED_QUESTIONS) {
        if (!dictById.has(seedQ.id)) merged.push(seedQ);
    }
    const filtered = merged.filter(q => q && !DEPRECATED_QUESTION_IDS.has(q.id));
    if (opts.sectionId) {
        return filtered
            .filter(q => q.section === opts.sectionId)
            .slice()
            .sort((a, b) => a.order - b.order);
    }
    return filtered;
}

/** Сколько вопросов уточнено: answer не null и не undefined. */
function countAnswered(calc) {
    const all = getRenderableQuestions(calc);
    const answers = calc?.answers || {};
    let answered = 0;
    for (const q of all) {
        const v = answers[q.id];
        if (v === null || v === undefined) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        if (v === '') continue;
        answered++;
    }
    return { answered, total: all.length };
}

export function renderQuestionnaire(state, ctx) {
    const calc = state.activeCalc;
    if (!calc) return renderEmptyState(ctx);

    const sections = SECTION_IDS.map(sec => renderSection(sec, calc, state, ctx));

    return el('section', { class: 'tab-pane' },
        renderCalcHeader(calc, state, ctx),
        renderProgressBar(calc),
        // Stage 15.1: компактный health-chip под прогресс-баром — синхронизирован
        // с дашбордовым health-block'ом через общий evaluateCalculationHealth.
        renderHealthStickyChip(calc, ctx),
        renderProdHint(),
        renderSettingsPanel(calc, state, ctx),
        ...sections,

        /* 12.U26-fix: «Печать ответов (PDF)» удалена — это был дубль кнопки PDF
           в шапке. Шапочный PDF теперь маршрутизирует: на вкладке «Опросник» →
           табличный printAnswers (см. ctx.printPdf в app.js). Остаётся одна
           кнопка-сброс. */
        el('div', { class: 'questionnaire-footer' },
            el('button', {
                class: 'btn btn-ghost',
                title: 'Вернуть все ответы к рекомендуемым значениям. Сам расчёт не удаляется.',
                onClick: () => ctx.confirm({
                    title: 'Сбросить ответы',
                    message: 'Все ответы вернутся к рекомендуемым значениям. Текущий расчёт сохранится.',
                    confirmLabel: 'Сбросить',
                    onConfirm: () => ctx.resetAnswers()
                })
            }, '↺ Сбросить ответы к рекомендуемым')
        )
    );
}

/* ---------- 12.U1: empty state ---------- */

function renderEmptyState(ctx) {
    return el('section', { class: 'tab-pane' },
        el('div', { class: 'empty-state' },
            el('div', { class: 'empty-state-icon' }, icon('clipboard-list', { size: 48 })),
            el('div', { class: 'empty-state-title', text: 'Опросник заполняется для конкретного расчёта' }),
            el('div', { class: 'empty-state-subtitle',
                text: 'Создайте новый расчёт или откройте существующий — и здесь появятся ' +
                      'вопросы, ответы на которые подбирают параметры инфраструктуры.' }),
            el('div', { class: 'empty-state-actions' },
                /* Stage 4.9/4.14 → Stage 17.2: «Новый расчёт» убран — единственная
                   primary-точка создания теперь Quick Start (3 preset'а). */
                el('button', {
                    class: 'btn btn-primary btn-large btn-icon-text',
                    title: 'Открыть Quick Start: заполнить 7 макро-параметров (Ctrl+Alt+N).',
                    onClick: () => ctx.openQuickStart()
                },
                    icon('sparkles', { size: 18 }),
                    el('span', { text: 'Quick Start' })
                ),
                el('button', {
                    class: 'btn btn-ghost btn-large btn-icon-text',
                    title: 'Перейти на вкладку «Расчёты», чтобы открыть существующий',
                    onClick: () => ctx.setActiveTab('calculations')
                },
                    icon('folder-open', { size: 18 }),
                    el('span', { text: 'Открыть из списка' })
                )
            )
        )
    );
}

/* ---------- 12.U2: пояснение «все ответы — про ПРОМ» ---------- */

function renderProdHint() {
    return el('div', {
        class: 'questionnaire-prod-hint',
        attrs: { role: 'note' },
        title: 'Размеры тестовых стендов задаются множителями от ПРОМ в «Параметры расчёта → Размеры стендов».'
    },
        icon('info', { size: 14 }),
        el('span', { class: 'questionnaire-prod-hint-text' },
            'Все вопросы относятся к ',
            el('strong', { text: 'ПРОМ стенду' }),
            '. Конфигурация стендов DEV / ИФТ / ПСИ / Нагрузка калькулятор вычислит автоматически как доли от ПРОМ ',
            '(коэффициенты см. в «Размеры стендов» параметров расчёта).'
        )
    );
}

/* ---------- 12.U1: sticky прогресс-бар ---------- */

function renderProgressBar(calc) {
    const { answered, total } = countAnswered(calc);
    const pct = total > 0 ? Math.round(100 * answered / total) : 0;
    const subtitle = total > 0
        ? `${answered} / ${total} вопросов с ответом · ${pct}%`
        : 'В справочнике ещё нет вопросов';
    return el('div', {
        class: 'questionnaire-progress',
        attrs: { role: 'status', 'aria-live': 'polite' },
        title: 'Сколько вопросов имеют ответ (включая значения по умолчанию). ' +
               'Вопросы с пометкой «Не знаю» считаются без ответа — для них калькулятор ' +
               'использует значение по умолчанию.'
    },
        el('div', { class: 'questionnaire-progress-bar' },
            el('div', { class: 'questionnaire-progress-fill', style: { width: pct + '%' } })
        ),
        el('span', { class: 'questionnaire-progress-text', text: subtitle })
    );
}

function renderCalcHeader(calc, state, ctx) {
    // Оформляем как стандартный tab-toolbar (см. dashboard/details/...): h2.tab-title
    // обеспечивает визуальный отступ от sticky-шапки и единый стиль с другими вкладками.
    return el('div', { class: 'calc-header-edit tab-toolbar' },
        el('div', { class: 'calc-header-edit-title' },
            el('div', { class: 'tab-title-group' },
                el('h2', { class: 'tab-title', text: 'Опросник' }),
                renderScenarioBadge(calc)
            ),
            el('span', { class: 'tab-toolbar-hint', text: calc.name ? `Расчёт: ${calc.name}` : 'Безымянный расчёт' })
        ),
        el('label', { class: 'field calc-header-name-field' },
            el('span', { class: 'field-label', text: 'Название расчёта' }),
            el('input', {
                class: 'input input-name',
                type: 'text',
                value: calc.name || '',
                placeholder: 'Например: SaaS-платформа MVP',
                title: 'Дайте расчёту понятное имя, чтобы потом найти его в списке',
                attrs: { 'data-focus-key': 'calc-name' },
                onInput: e => ctx.setName(e.target.value)
            })
        )
    );
}

/* ---------- Панель «Параметры расчёта» (12.U1: accordion + 3 подгруппы) ---------- */

function renderSettingsPanel(calc, state, ctx) {
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

/* ---------- 14.U4 / 14.U8: Provider dropdown ----------
   Глобальная настройка расчёта — провайдер облака. Влияет на overlay-цены
   (применяются при расчёте через applyProviderOverlay в calculator.js).
   Хранится в calc.settings.provider; флаг calc.settings.providerSetByWizard
   используется только UI'ем для бейджа источника.

   Активные провайдеры (14.U8): SberCloud (реальный overlay), Cloud.ru
   (alias на SberCloud — ребрендинг 2024), Yandex Cloud (заглушка с
   правдоподобными ценами). Inactive (показаны как «(скоро)» в dropdown):
   VK Cloud (планируется), On-prem (другая модель — CAPEX, а не overlay). */
function renderProviderField(s, state, ctx) {
    const current  = s.provider || DEFAULT_PROVIDER;
    const setByWiz = !!s.providerSetByWizard;
    const providers = listProviders();
    /* Видимый текст под полем — одна строка ≤90 символов, чтобы поместиться
       в .settings-group-provider .field-description (max-width расширен до 800px).
       Простой язык, без жаргона «подменяет». Полная справка про ребрендинг
       Cloud.ru, заглушку Yandex и stub'ы VK/On-prem — в hover-tooltip'е (title),
       не на постоянно занятом месте. Scope-фраза «все сценарии» во второй
       части — страховка против ошибочного ожидания «сменю провайдера в
       сценарии Б — сравню с А». */
    const tooltipShort = 'Цены берутся из тарифов выбранного провайдера. Действуют на весь расчёт — все сценарии.';
    const tooltipFull = tooltipShort + ' ' +
        'Cloud.ru (бывший SberCloud) — это одна и та же платформа: ребрендинг 2024 года, ' +
        'тарифы и API идентичны. Yandex Cloud — заглушка с правдоподобными ценами для ' +
        'демонстрации эффекта переключения провайдера. VK Cloud и собственная инфраструктура (on-premise) — в следующих обновлениях.';

    /* Бейдж источника — рядом с label. Палитра совпадает с .field-source-badge
       из forms.css (этап 14.U2): зелёный для wizard-источника, outlined dashed
       для ручной правки. */
    const sourceBadge = el('span', {
        class: ['field-source-badge', `field-source-badge--${setByWiz ? 'wizard' : 'manual'}`],
        attrs: { title: setByWiz
            ? 'Провайдер был выбран автоматически в Quick Start. Изменить — вручную ниже.'
            : 'Провайдер изменён вручную в Опроснике (приоритет над Quick Start).' },
        text: setByWiz ? 'Из мастера' : 'Вы изменили'
    });

    return el('div', { class: 'settings-group settings-group-provider' },
        el('div', { class: 'settings-group-title', text: 'Облачный провайдер' }),
        el('div', { class: 'settings-grid' },
            el('label', { class: 'field' },
                el('span', { class: 'field-label', title: tooltipFull },
                    el('span', { class: 'field-label-text', text: 'Провайдер облака' }),
                    sourceBadge
                ),
                el('select', {
                    class: 'input',
                    title: tooltipFull,
                    attrs: { 'data-focus-key': 'setting:provider' },
                    onChange: e => {
                        const v = e.target.value;
                        /* Disabled-опции отбрасываем (browser обычно не даёт их
                           выбрать, но защищаемся на уровне controller'а). */
                        const target = providers.find(p => p.id === v);
                        if (target && target.active) ctx.setProvider(v);
                    }
                },
                    ...providers.map(p => el('option', {
                        value: p.id,
                        attrs: {
                            disabled: p.active ? undefined : 'disabled',
                            selected: p.id === current ? 'selected' : undefined,
                            title: p.description
                        }
                    }, p.active ? p.label : `${p.label} (скоро)`))
                ),
                renderProviderUpdateRow(current, state, ctx),
                renderProviderPriceSummary(current, state, ctx),
                el('span', { class: 'field-description', text: tooltipShort })
            )
        )
    );
}

/* Stage 10.2: renderProviderUpdateRow и renderProviderPriceSummary
   (вместе с PROVIDER_PRICE_SUMMARY_PICKS, PROVIDER_PRICE_CATEGORIES,
   _renderDeltaPill, fmtRub) перенесены в js/ui/providerPriceSummary.js.
   Импортируются вверху файла.  */

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
                    type: 'number',
                    value: s.phaseDurationMonths ?? 12,
                    title: SETTINGS_DESCRIPTIONS.phaseDurationMonths,
                    attrs: { min: 1, max: 1200, step: 'any', 'data-focus-key': 'setting:phaseDurationMonths' },
                    onInput: e => {
                        const n = parseNumberInput(e.target.value);
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
                    class: 'input', type: 'number',
                    value: s.planningHorizonYears ?? 1,
                    title: !applyRisks
                        ? `${SETTINGS_DESCRIPTIONS.planningHorizonYears}\n\nПоле неактивно: выключен переключатель «Учитывать риск-коэффициенты в бюджете».`
                        : SETTINGS_DESCRIPTIONS.planningHorizonYears,
                    disabled: !applyRisks,
                    attrs: { min: 0, max: 50, step: 'any', 'data-focus-key': 'setting:planningHorizonYears' },
                    onInput: e => {
                        const n = parseNumberInput(e.target.value);
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
function renderSettingsGroupVat(s, ctx, calc) {
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

function renderPercentField(label, value, onChange, hint, key, disabled = false, shortHint = null) {
    // 12.U2: добавлен slider-companion 0..100% для быстрой грубой оценки.
    // Number-input оставлен для точности и значений >100% или <0%.
    // Slider синхронизируется с input двусторонне через общий onChange.
    // Stage 5.3.A: shortHint — видимый <span class="field-description"> под полем.
    // Если null — берём из UI_TOOLTIPS_SHORT по setting-key (без префикса 'setting:').
    const pct = (value ?? 0) * 100;
    const sliderValue = Math.max(0, Math.min(100, pct));
    const settingKey = typeof key === 'string' ? key.replace(/^setting:/, '') : null;
    const resolvedShort = shortHint ?? (settingKey && UI_TOOLTIPS_SHORT[settingKey]) ?? null;

    return el('label', { class: ['field', 'field-percent', disabled && 'field-disabled'] },
        el('span', { class: 'field-label', text: label }),
        el('div', { class: 'percent-input-row' },
            el('div', { class: 'percent-input' },
                el('input', {
                    class: 'input',
                    type: 'number',
                    value: pct.toString().replace('.', ','),
                    title: disabled
                        ? hint + '\n\nПоле неактивно: в Опроснике выключен переключатель «Учитывать риск-коэффициенты в бюджете».'
                        : hint,
                    disabled,
                    attrs: { step: 'any', min: -100, max: 1000, 'data-focus-key': key },
                    onInput: e => {
                        const n = parseNumberInput(e.target.value);
                        if (Number.isFinite(n)) {
                            onChange(n / 100);
                            // Оптимистичный sync slider'а до перерендера, чтобы не было визуального лага.
                            const slider = e.target.closest('.percent-input-row')?.querySelector('input[type="range"]');
                            if (slider) slider.value = String(Math.max(0, Math.min(100, n)));
                        }
                    }
                }),
                el('span', { class: 'percent-input-suffix', text: '%' })
            ),
            el('input', {
                class: 'percent-slider',
                type: 'range',
                value: String(sliderValue),
                title: hint + '\n\nДвиньте слайдер для быстрой грубой оценки. Точное значение можно ввести числом слева.',
                disabled,
                attrs: {
                    min: 0, max: 100, step: 1,
                    'aria-label': `${label} — слайдер 0..100%`
                },
                /* Drag-state slider'а. Каждое движение мыши на 1px вызывает
                   `input`-событие; если в нём коммитить значение в store,
                   subscriber планирует rAF-render → DOM полностью пересоздаётся
                   через el(...) → старый <input type=range> заменяется новым →
                   pointer-capture теряется → drag прерывается уже на первом
                   mousemove. Пользователь видит «слайдер не двигается».
                   Решение: на `input` (живой drag) — только визуальный sync
                   number-input'а, без commit. На `change` (mouseup/keyup) —
                   собственно commit; render произойдёт один раз в конце drag'а. */
                onInput: e => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    const numInput = e.target.closest('.percent-input-row')?.querySelector('.percent-input input');
                    if (numInput) numInput.value = String(n).replace('.', ',');
                },
                onChange: e => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) onChange(n / 100);
                }
            })
        ),
        /* Stage 5.3.A: tooltipShort под полем (видимый, ≤100 симв). hint выше остаётся
           в title (полный текст с диапазонами и примерами). resolvedShort = null →
           field-description не рендерится (legacy-вызов до Stage 5.3.A). */
        resolvedShort && el('span', { class: 'field-description', text: resolvedShort })
    );
}

/* ---------- Размеры стендов ---------- */

function renderStandSizeRatios(calc, ctx) {
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
                type: 'number',
                value: cur,
                title: isFixed
                    ? 'ПРОМ зафиксирован = 1.00 как эталон. Размеры остальных стендов задаются относительно ПРОМ.'
                    : `Множитель ресурсов стенда ${STAND_LABELS[stand]} относительно ПРОМ (${range.min.toFixed(2)}…${range.max.toFixed(2)}).`,
                attrs: {
                    min: range.min,
                    max: range.max,
                    step: 'any',
                    disabled: isFixed ? '' : undefined,
                    'data-focus-key': `setting:standSizeRatio.${stand}`
                },
                onInput: e => {
                    const n = parseNumberInput(e.target.value);
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
function renderAiStandFactors(calc, ctx) {
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
        const curPercent = Math.round(cur * 100);

        const tooltip =
            `Доля AI-нагрузки на стенде ${STAND_LABELS[stand]}: 0% = AI выкл., 100% = как на ПРОМ. ` +
            `Применяется к токенам LLM, эмбеддингам RAG, vCPU агентов. ` +
            (aiUsed ? '' : 'Поле приглушено: AI выключен мастер-переключателем «Используется LLM».');

        return el('label', { class: ['field', !aiUsed && 'field-disabled'] },
            el('span', { class: 'field-label', text: `${STAND_LABELS[stand] || stand}, %` }),
            el('input', {
                class: 'input',
                type: 'number',
                value: curPercent,
                title: tooltip,
                disabled: !aiUsed,
                attrs: {
                    min: 0,
                    max: 100,
                    step: 'any',
                    'data-focus-key': `setting:aiStandFactor.${stand}`
                },
                onInput: e => {
                    const n = parseNumberInput(e.target.value);
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
 * если ни один ЭК с `dashboardResource=HDD` не применим к DEV, то ячейка (DEV,HDD) — disabled
 * с tooltip «Не предусмотрено: каталог не закладывает HDD на этом стенде».
 *
 * PROD не показывается — эталон 1.00 для всех ресурсов (фиксированно в schema v3).
 * Калькулятор подменяет `S.standSizeRatio.<STAND>` на per-resource значение в зависимости
 * от dashboardResource текущего ЭК — формулы в seed.js не правились (см. calculator.js).
 */
function renderResourceRatios(calc, ctx) {
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
            const curPercent = Math.round(cur * 100);

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
                type: 'number',
                value: curPercent,
                title: `Множитель ${resource} стенда ${STAND_LABELS[stand]} от ПРОМ, %. ` +
                       `Например, ${curPercent}% означает: ${resource} на ${STAND_LABELS[stand]} = ` +
                       `${curPercent}% от объёма ${resource} на ПРОМ. ` +
                       `Допустимый диапазон: ${(range.min * 100).toFixed(0)}…${(range.max * 100).toFixed(0)}%.`,
                attrs: {
                    min: Math.round(range.min * 100),
                    max: Math.round(range.max * 100),
                    step: 'any',
                    'data-focus-key': `setting:resourceRatio.${stand}.${resource}`,
                    'aria-label': `${resource} на ${STAND_LABELS[stand]}, % от ПРОМ`
                },
                onInput: e => {
                    const n = parseNumberInput(e.target.value);
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

/* ---------- 12.U3: явные сетки для подгрупп со специфическими требованиями ----------
 *
 * Для подгрупп, в которых auto-fit грид не даёт желаемой раскладки (например,
 * нужна жёсткая 2-колоночная компоновка с разной длиной колонок, или одно поле
 * на полную строку), задаём 2D-массив ID вопросов:
 *   - rows[i] — массив строки i, элементы — id вопроса или null (пустая ячейка)
 *   - все строки должны иметь одинаковое число колонок (для grid-template-columns)
 *
 * Если подгруппы здесь нет — рендерим обычный auto-fit грид по полю q.order.
 */
const SUBGROUP_LAYOUTS = {
    'Персональные данные и compliance': {
        // Категория ПДн — на всю ширину (длинные опции в select).
        // Дальше 4 booleans равномерно auto-fit.
        rows: [
            ['pdn_category'],
            ['pdn_152fz', 'fstec_certification_required', 'iso_27001_required', 'encryption_at_rest']
        ]
    },
    'Использование LLM': {
        // 2 строки × 3 ячейки. Master-toggle ai_llm_used идёт первой ячейкой.
        rows: [
            ['ai_llm_used', 'ai_users_share', 'ai_requests_per_user_day'],
            ['ai_model_tier', 'ai_hosting_mode', 'ai_inference_latency_ms']
        ]
    },
    'RAG (поиск по базе знаний)': {
        // 12.U6: вертикальный segmented «Частота обновления» уезжает в нижнюю
        // полную строку — иначе он торчит высокой колонкой рядом с маленькими
        // input'ами и они выглядят неровно. Сверху 2×2 — все короткие поля
        // одной высоты, выровнены по нижнему краю.
        rows: [
            ['rag_needed', 'rag_corpus_size_gb'],
            ['rag_embeddings_million', 'rag_retrieval_calls_per_query'],
            [{ id: 'rag_refresh_frequency', colSpan: 2 }]
        ]
    },
    'Кастомизация и приватность': {
        // 2×2: master-toggle fine-tune + его частота, и data_sensitivity + safety_layer.
        rows: [
            ['ai_finetune_needed', 'ai_finetune_runs_per_year'],
            ['ai_data_sensitivity', 'ai_safety_layer']
        ]
    }
};

/* ---------- Раздел вопросов (12.U1: accordion + answered/total counter) ---------- */

function renderSection(sectionId, calc, state, ctx) {
    /* 12.U18-U19: SEED-fallback для новых вопросов и для текстовых полей.
       1) Базовый список + фильтр deprecated + sort по секции — из общего
          getRenderableQuestions (один источник истины для counter+render,
          audit-9 P2).
       2) Для known-вопросов (есть в SEED): title/description/recommendation/impact
          ВСЕГДА берутся из SEED. Это даёт «живую» документацию даже для legacy-
          расчётов: при reword'е вопроса пользователь видит новый текст. Cost:
          теряются user-edited title (но в этом проекте редактирование title редко
          и обычно нежелательно — SEED-формулировки выверены). */
    const questions = getRenderableQuestions(calc, { sectionId }).map(q => {
        const seed = SEED_BY_ID.get(q.id);
        if (!seed) return q;  // user-defined custom question — оставляем as-is
        return {
            ...q,
            // Текстовые поля — всегда живая версия из SEED.
            title:           seed.title,
            description:     seed.description,
            recommendation:  seed.recommendation,
            impact:          seed.impact,
            // Validation-bounds (min/max/step/defaultValue) — тоже из SEED.
            // Если SEED расширил диапазон допустимых значений, legacy-расчёт
            // не должен ограничивать пользователя старыми границами.
            min:             seed.min,
            max:             seed.max,
            step:            seed.step,
            defaultValue:    seed.defaultValue,
            defaultIfUnknown: seed.defaultIfUnknown,
            // q.options — отдельная логика через questionOptions(q), здесь не трогаем.
        };
    });

    const isOpen = openedSections(state).includes(sectionId);

    /* Stage 5.4: счётчик отделяет реально-доступные (visible) вопросы от
       gated-by-master-toggle. Раньше «AI/LLM/RAG» показывал «0 / 14» при
       выключенном `ai_llm_used` — это было дезинформацией: 14 полей физически
       заблокированы, заполнять там нечего. Теперь:
         • Если ВСЕ вопросы секции gated (`dependsOnUnmet`) — chip = «—», добавляется
           class is-gated, title объясняет «включите master-переключатель».
         • Иначе chip = «${answered} / ${visibleTotal}», где visibleTotal — число
           НЕ-gated вопросов; answered считается только по visible. */
    const answers = calc.answers || {};
    let answered = 0;
    let visibleTotal = 0;
    for (const q of questions) {
        if (dependsOnUnmet(q, calc)) continue;
        visibleTotal++;
        const v = answers[q.id];
        if (v === null || v === undefined) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        if (v === '') continue;
        answered++;
    }
    const isGated = visibleTotal === 0 && questions.length > 0;
    const isDone = visibleTotal > 0 && answered === visibleTotal;
    const chipText = isGated ? '—' : `${answered} / ${visibleTotal}`;
    const chipTitle = isGated
        ? 'Раздел заблокирован: включите мастер-переключатель в зависимой секции, чтобы активировать поля.'
        : isDone
            ? `Все доступные вопросы уточнены: ${answered} из ${visibleTotal}.`
            : `Уточнено ответов в разделе: ${answered} из ${visibleTotal}.`;

    const header = el('button', {
        class: 'questionnaire-section-title',
        attrs: {
            type: 'button',
            'aria-expanded': isOpen ? 'true' : 'false',
            'aria-controls': `section-body-${sectionId}`
        },
        title: isOpen ? 'Свернуть раздел' : 'Раскрыть раздел',
        onClick: () => toggleSection(state, ctx, sectionId)
    },
        el('span', { class: ['accordion-chevron', isOpen && 'accordion-chevron-open'] },
            icon('chevron-right', { size: 16 })),
        el('span', { class: 'questionnaire-section-label', text: SECTION_LABELS[sectionId] }),
        el('span', {
            class: ['questionnaire-section-count',
                    isGated && 'questionnaire-section-count-gated',
                    isDone && 'questionnaire-section-count-done'],
            attrs: { title: chipTitle },
            text: chipText
        })
    );

    if (!isOpen) {
        return el('div', { class: 'questionnaire-section questionnaire-section-collapsed' }, header);
    }

    /* Stage 12.5 (PATCH 2.6.4): источник истины для двух уровней glow —
       подгруппа (точка изменения) и секция (каскад на родителя). Один decl,
       чтобы не сдвоить чтение state.ui.recentlyChangedKey. */
    const recentKey = state.ui.recentlyChangedKey;

    let content;
    if (questions.length === 0) {
        content = el('div', { class: 'empty-row', text: 'Нет вопросов в этом разделе. Перейдите во вкладку «Вопросы», чтобы добавить.' });
    } else {
        const hasAnySubgroup = questions.some(q => q.subgroup && String(q.subgroup).trim() !== '');

        if (hasAnySubgroup) {
            const order = [];
            const grouped = new Map();
            const ungrouped = [];

            for (const q of questions) {
                const sg = q.subgroup && String(q.subgroup).trim();
                if (sg) {
                    if (!grouped.has(sg)) { grouped.set(sg, []); order.push(sg); }
                    grouped.get(sg).push(q);
                } else {
                    ungrouped.push(q);
                }
            }

            content = el('div', { class: 'questionnaire-subgroups' },
                ...order.map(title => {
                    /* Stage 5.5.1: gated-subgroup detection — если все вопросы
                       подгруппы заблокированы master-toggle (rag_needed,
                       agent_memory_used и т.п.), вся карточка приглушается
                       opacity 0.4 + tooltip объясняет, какой master включить.
                       Принцип Gestalt «общая судьба»: пользователь видит
                       физически связанный блок, а не россыпь disabled-полей. */
                    const subQuestions = grouped.get(title);
                    const subgroupGated = subQuestions.length > 0
                        && subQuestions.every(q => dependsOnUnmet(q, calc));
                    /* Берём dependsOnUnmet первого вопроса как источник tooltip'а
                       (внутри подгруппы зависимости обычно общие — если RAG-параметры,
                       то все требуют rag_needed). */
                    const firstUnmet = subgroupGated ? dependsOnUnmet(subQuestions[0], calc) : null;
                    const subgroupTitle = subgroupGated && firstUnmet
                        ? `Подгруппа заблокирована: сначала включите ${firstUnmet}.`
                        : null;
                    /* Stage 6.2.A (PATCH 2.4.21): mini-chip с прогрессом ВНУТРИ
                       подгруппы. Расширение Stage 5.4 паттерна на subgroup-уровень:
                       пользователь видит «3 / 5» прямо в заголовке подгруппы,
                       не нужно сканировать все поля для оценки прогресса.
                       Семантика чипа полностью совпадает с .questionnaire-section-count
                       (gated/done/in-progress + tooltip-объяснение). */
                    let subAnswered = 0;
                    let subVisibleTotal = 0;
                    for (const q of subQuestions) {
                        if (dependsOnUnmet(q, calc)) continue;
                        subVisibleTotal++;
                        const v = answers[q.id];
                        if (v === null || v === undefined) continue;
                        if (Array.isArray(v) && v.length === 0) continue;
                        if (v === '') continue;
                        subAnswered++;
                    }
                    const subIsDone = subVisibleTotal > 0 && subAnswered === subVisibleTotal;
                    const subChipText = subgroupGated ? '—' : `${subAnswered} / ${subVisibleTotal}`;
                    const subChipTitle = subgroupGated
                        ? 'Подгруппа заблокирована: включите master-переключатель.'
                        : subIsDone
                            ? `Все доступные вопросы уточнены: ${subAnswered} из ${subVisibleTotal}.`
                            : `Уточнено в подгруппе: ${subAnswered} из ${subVisibleTotal}.`;

                    /* Stage 6.2.B (PATCH 2.4.23): collapsible подгруппы. Header
                       становится <button> с chevron'ом, body рендерится только
                       при !isCollapsed. Состояние persist'ится в localStorage
                       через state.ui.questionnaireCollapsedSubgroups. Дефолт —
                       все подгруппы развёрнуты (массив свёрнутых пуст). */
                    const isCollapsed = subgroupCollapsed(state, sectionId, title);
                    const headerTitle = isCollapsed
                        ? 'Раскрыть подгруппу'
                        : 'Свернуть подгруппу';
                    /* Stage 12.5 (PATCH 2.6.4): подгруппа загорается только
                       если изменённый вопрос лежит ИМЕННО в ней — secondary
                       визуальный якорь к .section-recent родителя. Проверка
                       по subQuestions.some, не по `questions.some` секции. */
                    const isRecentSubgroup = typeof recentKey === 'string'
                        && recentKey.startsWith('answer:')
                        && subQuestions.some(q => recentKey === `answer:${q.id}`);
                    return el('div', {
                        class: ['questionnaire-subgroup',
                                subgroupGated && 'questionnaire-subgroup-gated',
                                isCollapsed && 'questionnaire-subgroup-collapsed',
                                isRecentSubgroup && 'questionnaire-subgroup-recent'],
                        attrs: subgroupTitle ? { title: subgroupTitle } : undefined
                    },
                        el('button', {
                            class: 'questionnaire-subgroup-header',
                            attrs: {
                                type: 'button',
                                'aria-expanded': isCollapsed ? 'false' : 'true',
                                title: headerTitle
                            },
                            onClick: () => toggleSubgroup(state, ctx, sectionId, title)
                        },
                            el('span', {
                                class: ['accordion-chevron', !isCollapsed && 'accordion-chevron-open']
                            }, icon('chevron-right', { size: 14 })),
                            el('span', { class: 'questionnaire-subgroup-title', text: title }),
                            el('span', {
                                class: ['questionnaire-subgroup-count-chip',
                                        subgroupGated && 'questionnaire-subgroup-count-chip-gated',
                                        subIsDone && 'questionnaire-subgroup-count-chip-done'],
                                attrs: { title: subChipTitle },
                                text: subChipText
                            })
                        ),
                        !isCollapsed
                            ? renderSubgroupBody(title, subQuestions, calc, state, ctx)
                            : null
                    );
                }),
                ungrouped.length > 0 && el('div', { class: 'questionnaire-grid' },
                    ...ungrouped.map(q => renderQuestionField(q, calc, state, ctx))
                )
            );
        } else {
            content = el('div', { class: 'questionnaire-grid' },
                ...questions.map(q => renderQuestionField(q, calc, state, ctx)));
        }
    }

    /* Секция «AI / LLM / RAG» получает дополнительный блок в самом низу:
       таблица AI-фактора на стенд (5 чисел в %, ПРОМ заперт). Она НЕ
       привязана к конкретному вопросу seed — это setting-блок, как
       «Размеры стендов» в settings-панели. Логически тут — потому что
       пользователь проектирует AI-нагрузку и сразу видит на каких стендах
       включён AI. */
    const aiStandBlock = sectionId === 'ai_llm' ? renderAiStandFactors(calc, ctx) : null;

    /* Stage 6.6.B (PATCH 2.4.22) + 12.5 (PATCH 2.6.4): transient glow на
       секции после изменения любого поля внутри. recentlyChangedKey уже
       выставляется в setAnswer (calcController.js) — секция получает класс
       .section-recent, если её вопрос только что изменён, и одновременно
       соответствующая подгруппа получает .questionnaire-subgroup-recent
       (см. subgroup-map выше). CSS animation 1.2s ease на обоих — glow
       завершается синхронно. Источник `recentKey` — общий, объявлен в начале
       renderSection после проверки isOpen. */
    const isRecentSection = typeof recentKey === 'string'
        && recentKey.startsWith('answer:')
        && questions.some(q => recentKey === `answer:${q.id}`);

    return el('div', { class: ['questionnaire-section', isRecentSection && 'section-recent'] },
        header,
        el('div', { class: 'questionnaire-section-body', id: `section-body-${sectionId}` },
            content,
            aiStandBlock
        )
    );
}

/* ---------- Тело подгруппы: либо явная сетка из SUBGROUP_LAYOUTS, либо auto-fit ---------- */

function renderSubgroupBody(subgroupTitle, questions, calc, state, ctx) {
    const layout = SUBGROUP_LAYOUTS[subgroupTitle];
    if (!layout || !Array.isArray(layout.rows) || layout.rows.length === 0) {
        // Fallback — обычный auto-fit грид.
        return el('div', { class: 'questionnaire-grid' },
            ...questions.map(q => renderQuestionField(q, calc, state, ctx))
        );
    }

    const byId = new Map(questions.map(q => [q.id, q]));
    const used = new Set();

    // 12.U6: поддержка colSpan — ячейка может быть либо строкой 'id', либо
    // объектом { id, colSpan }. Ширина строки = sum(colSpan|1). Колонки grid'а —
    // максимум по всем строкам, чтобы все ряды выровнялись по одной сетке.
    const cellSpan = c => (c && typeof c === 'object' && c.colSpan) ? c.colSpan : 1;
    const cellId   = c => (c && typeof c === 'object') ? c.id : c;
    const cols = Math.max(...layout.rows.map(r => r.reduce((s, c) => s + cellSpan(c), 0)));

    const rowEls = layout.rows.map((row, ri) => {
        const cells = row.map((cell, ci) => {
            const id = cellId(cell);
            const span = cellSpan(cell);
            const spanStyle = span > 1 ? { gridColumn: `span ${span}` } : null;

            if (id === null || id === undefined) {
                return el('div', {
                    class: 'questionnaire-cell-empty',
                    style: spanStyle,
                    attrs: { 'aria-hidden': 'true' }
                });
            }
            const q = byId.get(id);
            if (!q) {
                // Защита от опечатки в SUBGROUP_LAYOUTS — не падаем, рисуем пустую ячейку.
                return el('div', {
                    class: 'questionnaire-cell-empty',
                    style: spanStyle,
                    attrs: { 'aria-hidden': 'true' }
                });
            }
            used.add(id);
            const fieldEl = renderQuestionField(q, calc, state, ctx);
            // Навешиваем gridColumn на корневой div поля (он уже создан).
            if (spanStyle && fieldEl && fieldEl.style) {
                fieldEl.style.gridColumn = `span ${span}`;
            }
            return fieldEl;
        });
        return el('div', {
            class: 'questionnaire-grid-explicit',
            style: { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
        }, ...cells);
    });

    // Вопросы, не упомянутые в layout (например, новые seed-добавления) — рендерим
    // обычным auto-fit гридом ниже, чтобы ничего не «потерять».
    const leftover = questions.filter(q => !used.has(q.id));
    if (leftover.length > 0) {
        rowEls.push(el('div', { class: 'questionnaire-grid' },
            ...leftover.map(q => renderQuestionField(q, calc, state, ctx))
        ));
    }

    return el('div', { class: 'questionnaire-explicit-rows' }, ...rowEls);
}

/* ---------- Поле одного вопроса ---------- */

/**
 * 12.U3: dependsOn — список ID вопросов, ответы на которые должны быть «truthy»
 * (true для boolean, или null/undefined считается «не выполнено», для select —
 * любое не-falsy значение). Если хотя бы одна зависимость не выполнена —
 * поле отображается приглушённым и блокируется. Это убирает «мёртвые» поля,
 * которые не имеют смысла при выключенном master-toggle (LLM/RAG/fine-tune).
 */
function dependsOnUnmet(q, calc) {
    // Сначала смотрим dependsOn в самом вопросе (новые / обновлённые расчёты).
    // Если его нет — fallback в SEED_DEPS_BY_ID для расчётов, созданных до 12.U3.
    const deps = q.dependsOn ?? SEED_DEPS_BY_ID.get(q.id);
    if (!deps || (Array.isArray(deps) && deps.length === 0)) return null;
    const list = Array.isArray(deps) ? deps : [deps];
    const answers = calc.answers || {};
    const unmet = [];
    for (const depId of list) {
        const v = answers[depId];
        // null = «Не знаю» → считаем зависимость НЕ выполненной (по умолчанию false).
        if (v === null || v === undefined || v === false || v === '') unmet.push(depId);
    }
    if (unmet.length === 0) return null;
    // Возвращаем titles для тултипа.
    const titles = unmet.map(id => {
        const dep = (calc.dictionaries?.questions || []).find(x => x.id === id);
        return dep ? `«${dep.title}»` : id;
    });
    return titles.join(' и ');
}

function renderQuestionField(q, calc, state, ctx) {
    const rawValue = calc.answers?.[q.id];
    const isUnknown = rawValue === null;
    const value = isUnknown ? undefined : rawValue;
    const isRecent = state.ui.recentlyChangedKey === `answer:${q.id}`;
    const depUnmet = dependsOnUnmet(q, calc);
    const isForceDisabled = !!depUnmet;
    const isDisabled = isUnknown || isForceDisabled;
    const fieldClass = ['field',
        isRecent && 'field-recent',
        isUnknown && 'field-unknown',
        isForceDisabled && 'field-disabled'
    ];

    const focusKey = `answer:${q.id}`;
    // Полная подсказка для input/label: заголовок + описание + рекомендация + влияние.
    // Длинные тексты прячем в системный tooltip (title=), чтобы не загромождать UI.
    const baseHint = composeHint(q);
    const fullHint = isForceDisabled
        ? `Поле неактивно: сначала включите ${depUnmet}.\n\n${baseHint}`
        : baseHint;
    const hoverHint = fullHint;

    let input;

    if (q.type === 'number') {
        input = renderNumberInput(q, value, isDisabled, focusKey, hoverHint, ctx);
    } else if (q.type === 'boolean') {
        input = el('label', { class: ['switch', value && 'switch-on', isForceDisabled && 'switch-disabled'], title: hoverHint },
            el('input', {
                type: 'checkbox',
                checked: !!value,
                attrs: { disabled: isDisabled ? '' : undefined, 'data-focus-key': focusKey },
                // Оптимистичное обновление локального DOM ДО полного rerender'а —
                // убирает мигание метки «Да/Нет» и подсветки между событием и rAF.
                onChange: e => {
                    const checked = !!e.target.checked;
                    const sw = e.target.closest('.switch');
                    if (sw) {
                        sw.classList.toggle('switch-on', checked);
                        const lab = sw.querySelector('.switch-label');
                        if (lab) lab.textContent = checked ? 'Да' : 'Нет';
                    }
                    ctx.setAnswer(q.id, checked);
                }
            }),
            el('span', { class: 'switch-track' }),
            el('span', { class: 'switch-label', text: value ? 'Да' : 'Нет' })
        );
    } else if (q.type === 'select') {
        const options = questionOptions(q);
        // 12.U2: если опций мало (≤4) — segmented control. Все варианты видны
        // сразу, 1 клик вместо 2 (без открытия dropdown). Закон Хика: видимые
        // варианты быстрее обрабатываются мозгом.
        if (options.length > 0 && options.length <= 4) {
            // 12.U4: layout='vertical' — для select с длинными подписями
            // (например, «Ежедневно (ночная переиндексация)») горизонтальный
            // segmented обрезает текст. Вертикальный — каждая опция на своей строке.
            const isVertical = uiField(q, 'layout') === 'vertical';
            input = el('div', {
                class: ['segmented', isVertical && 'segmented-vertical', isDisabled && 'segmented-disabled'],
                attrs: { role: 'radiogroup', 'aria-label': q.title, title: hoverHint }
            },
                ...options.map(o => {
                    const isSel = String(o.value) === String(value);
                    // Тултип на сам option НЕ ставим — он бы дублировал видимый текст
                    // кнопки. Подсказка по вопросу уже на родительском .segmented (title=hoverHint).
                    return el('button', {
                        class: ['segmented-option', isSel && 'segmented-option-active'],
                        attrs: {
                            type: 'button',
                            role: 'radio',
                            'aria-checked': isSel ? 'true' : 'false',
                            disabled: isDisabled ? '' : undefined,
                            'data-focus-key': isSel ? focusKey : undefined
                        },
                        onClick: () => { if (!isDisabled) ctx.setAnswer(q.id, o.value); }
                    }, el('span', { text: o.label }));
                })
            );
        } else {
            input = el('select', {
                class: 'input',
                value: value ?? '',
                title: hoverHint,
                attrs: { 'data-focus-key': focusKey, disabled: isDisabled ? '' : undefined },
                onChange: e => ctx.setAnswer(q.id, e.target.value)
            },
                el('option', { value: '' }, '— не выбрано —'),
                ...options.map(o =>
                    el('option', { value: o.value, attrs: { selected: String(o.value) === String(value) || undefined } }, o.label)
                )
            );
        }
    } else if (q.type === 'multiselect') {
        const selected = Array.isArray(value) ? value : [];
        const options = questionOptions(q);
        // 12.U2: если опций ≥5 — добавляем toolbar «Выбрать всё / Снять»
        // для массовых операций (например, 12 месяцев пиковой активности).
        const showToolbar = options.length >= 5 && !isDisabled;
        const allValues = options.map(o => o.value);
        const toolbar = showToolbar
            ? el('div', { class: 'multiselect-toolbar' },
                el('button', {
                    class: 'multiselect-toolbar-btn',
                    attrs: { type: 'button' },
                    title: 'Отметить все варианты',
                    onClick: () => ctx.setAnswer(q.id, allValues)
                },
                    icon('check-circle', { size: 12 }),
                    el('span', { text: 'Все' })
                ),
                el('button', {
                    class: 'multiselect-toolbar-btn',
                    attrs: { type: 'button' },
                    title: 'Снять все отметки',
                    onClick: () => ctx.setAnswer(q.id, [])
                },
                    icon('x-circle', { size: 12 }),
                    el('span', { text: 'Снять' })
                ),
                el('span', { class: 'multiselect-toolbar-counter',
                    text: `${selected.length} / ${options.length}` })
            )
            : null;

        // Для случая «12 месяцев» — фиксированная сетка 6×2 (симметричное
         // отображение года, легче сканируется глазом, чем неровный flex-wrap).
        const isMonthsGrid = options.length === 12;
        input = el('div', { class: 'multiselect-wrapper', title: hoverHint },
            toolbar,
            el('div', { class: ['multiselect', isMonthsGrid && 'multiselect-grid-6'] },
                options.map(o => {
                    const isSel = selected.includes(o.value);
                    return el('label', { class: ['chip', isSel && 'chip-active'], title: o.label },
                        el('input', {
                            type: 'checkbox',
                            checked: isSel,
                            attrs: { disabled: isDisabled ? '' : undefined },
                            onChange: e => {
                                const next = e.target.checked
                                    ? [...selected, o.value]
                                    : selected.filter(v => v !== o.value);
                                ctx.setAnswer(q.id, next);
                            }
                        }),
                        el('span', { text: o.label })
                    );
                })
            )
        );
    }

    // 12.U1: «Не знаю» — компактный pill с Lucide-иконкой (без ASCII-чекбоксов).
    // Иконка help-circle/check-circle отражает состояние, текст одинаковый.
    const unknownToggle = q.allowUnknown
        ? el('button', {
            class: ['field-unknown-toggle', isUnknown && 'field-unknown-toggle-active'],
            attrs: { type: 'button', 'aria-pressed': isUnknown ? 'true' : 'false' },
            title: isUnknown
                ? 'Калькулятор подставляет значение по умолчанию. Нажмите, чтобы ввести своё.'
                : 'Если точное значение неизвестно — нажмите, и калькулятор подставит разумное значение по умолчанию.',
            onClick: () => {
                if (isUnknown) {
                    const fallback = q.defaultValue ?? q.defaultIfUnknown ?? null;
                    ctx.setAnswer(q.id, fallback);
                } else {
                    ctx.setAnswer(q.id, null);
                }
            }
        },
            icon(isUnknown ? 'check-circle' : 'help-circle', { size: 12 }),
            el('span', { text: 'Не знаю' })
        )
        : null;

    // Значок предупреждения (когда «не знаю»). Содержимое тултипа берём
    // из второй части description (после \n\n) либо из assumptionRisk-метки.
    let warningIcon = null;
    if (isUnknown) {
        const descParts = (q.description || '').split('\n\n');
        const tail = descParts.length > 1 ? descParts.slice(1).join('\n\n').trim() : '';
        const riskLabel = riskTooltip(q.assumptionRisk);
        const tip = tail
            || riskLabel
            || (q.defaultIfUnknown !== undefined
                ? `Используется значение по умолчанию: ${q.defaultIfUnknown}.`
                : 'Используется значение по умолчанию.');
        warningIcon = el('span', { class: 'field-warning-icon', title: tip, ariaLabel: tip }, icon('alert-triangle', { size: 14 }));
    }

    // 14.U2: бейдж «Из профиля / Из масштаба / Вы изменили» рядом с label.
    // Скрываем для пустых полей (бессмысленно «Вы изменили» при null/'').
    const sourceBadge = !isUnknown ? renderSourceBadge(calc.answersMeta?.[q.id]) : null;

    // 12.U1: дублирующая ⓘ-иконка убрана — tooltip уже навешен на field-label
    // через title=fullHint (см. ниже). Это снижает визуальный шум и убирает
    // вторую цель для попадания курсором с одной и той же функцией.
    const labelRow = el('span', { class: 'field-label', title: fullHint },
        el('span', { class: 'field-label-text', text: q.title }),
        sourceBadge,
        warningIcon,
        unknownToggle
    );

    /* Stage 5.3.B: видимый tooltipShort под полем — берётся из UI_TOOLTIPS_SHORT
       по ключу `q.<id>`. Если ключа нет — span не рендерится (поле работает как
       раньше). Это позволяет постепенно покрывать секции seed.js без миграций
       схемы и без правки каждого render-сайта по отдельности. */
    const shortHint = UI_TOOLTIPS_SHORT[`q.${q.id}`] || null;
    const shortDescription = shortHint
        ? el('span', { class: 'field-description', text: shortHint })
        : null;

    return el('div', { class: fieldClass, id: `field-${q.id}` },
        labelRow,
        input,
        shortDescription
    );
}

/* Собираем единый текст подсказки для tooltip (title=). */
function composeHint(q) {
    const parts = [];
    if (q.title) parts.push(q.title);
    if (q.description) parts.push(q.description);
    if (q.recommendation) parts.push('Рекомендация: ' + q.recommendation);
    if (q.impact) parts.push('Влияет на: ' + q.impact);
    return parts.join('\n\n');
}

/* ---------- Числовое поле с inline-валидацией ---------- */

function renderNumberInput(q, value, isUnknown, focusKey, hoverHint, ctx) {
    // Placeholder при «нет информации»: показываем defaultIfUnknown курсивом серым.
    const placeholder = isUnknown && q.defaultIfUnknown !== undefined
        ? String(q.defaultIfUnknown)
        : (q.defaultValue !== undefined ? String(q.defaultValue) : '');

    const minAttr = q.min !== undefined ? q.min : undefined;
    const maxAttr = q.max !== undefined ? q.max : undefined;
    /* PATCH 2.20.5: всегда step="any" — HTML5-валидация принимает дробные.
     * SEED-уровневый q.step игнорируется в DOM (раньше step:1 из SEED отвергал
     * `5.5` через :invalid). Stepper-стрелки сохраняют дефолтный шаг 1.
     * min/max валидация продолжает работать как раньше. */
    const stepAttr = 'any';

    const node = el('input', {
        class: ['input', isUnknown && 'input-unknown'],
        type: 'number',
        value: isUnknown ? '' : (value ?? ''),
        placeholder,
        title: hoverHint,
        attrs: {
            min: minAttr,
            max: maxAttr,
            step: stepAttr,
            disabled: isUnknown ? '' : undefined,
            'data-focus-key': focusKey
        },
        onInput: e => {
            // Снимаем inline-ошибку при правке — пользователь должен видеть, что поле «жмётся».
            removeInlineError(e.target);
            const n = parseNumberInput(e.target.value);
            if (e.target.value === '' || !Number.isFinite(n)) {
                // Пустое или мусорное значение: пишем 0, но без всплывающих ошибок.
                ctx.setAnswer(q.id, 0);
                return;
            }
            // В границы — пишем; вне границ — НЕ пишем (старое значение сохраняется).
            if (isOutOfRange(n, minAttr, maxAttr)) {
                showInlineError(e.target, minAttr, maxAttr);
                return;
            }
            ctx.setAnswer(q.id, n);
        },
        onBlur: e => {
            const raw = e.target.value;
            if (raw === '') return;
            const n = parseNumberInput(raw);
            if (!Number.isFinite(n)) return;
            if (isOutOfRange(n, minAttr, maxAttr)) {
                // На blur: не молчим — клампим и пишем clamped значение.
                const clamped = clamp(n, minAttr, maxAttr);
                e.target.value = String(clamped).replace('.', ',');
                ctx.setAnswer(q.id, clamped);
                showInlineError(e.target, minAttr, maxAttr, /*persist*/ true);
            } else {
                removeInlineError(e.target);
            }
        }
    });

    return node;
}

function isOutOfRange(n, min, max) {
    if (min !== undefined && n < min) return true;
    if (max !== undefined && n > max) return true;
    return false;
}

function clamp(n, min, max) {
    let v = n;
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    return v;
}

function rangeLabel(min, max) {
    const lo = min !== undefined ? String(min) : '−∞';
    const hi = max !== undefined ? String(max) : '+∞';
    return `Допустимо: ${lo}…${hi}`;
}

/* WCAG 4.1.2 / WAI-ARIA 1.2: невалидное поле помечается `aria-invalid="true"`,
 * inline-сообщение получает уникальный id, поле связывается с ним через
 * `aria-describedby` — screen-reader озвучивает текст ошибки сразу после имени
 * поля. CSS-стиль красной рамки (.input[aria-invalid="true"]) — в components.css.
 * Сохраняем .input-invalid класс для обратной совместимости со старыми тестами. */
let _errIdSeq = 0;
function nextErrorId() {
    _errIdSeq += 1;
    return `field-err-${_errIdSeq}`;
}

function showInlineError(input, min, max, persist = false) {
    input.classList.add('input-invalid');
    input.setAttribute('aria-invalid', 'true');
    let err = input.parentElement && input.parentElement.querySelector(':scope > .field-inline-error');
    if (!err && input.parentElement) {
        const errId = input.getAttribute('aria-describedby') || nextErrorId();
        err = el('span', {
            class: 'field-inline-error',
            id: errId,
            attrs: { role: 'alert', 'aria-live': 'polite' }
        });
        if (input.nextSibling) input.parentElement.insertBefore(err, input.nextSibling);
        else input.parentElement.appendChild(err);
        input.setAttribute('aria-describedby', errId);
    }
    if (err) err.textContent = rangeLabel(min, max) + (persist ? ' — значение скорректировано' : '');
}

function removeInlineError(input) {
    input.classList.remove('input-invalid');
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    const err = input.parentElement && input.parentElement.querySelector(':scope > .field-inline-error');
    if (err) err.remove();
}

/* ---------- Утилиты для description / risk ---------- */

function riskTooltip(risk) {
    if (!risk) return '';
    switch (String(risk).toLowerCase()) {
        case 'low':    return 'Точность оценки: высокая. Значение по умолчанию подойдёт для большинства случаев.';
        case 'medium': return 'Точность оценки: средняя. Рекомендуется уточнить у бизнес-владельца.';
        case 'high':   return 'Точность оценки: низкая. Сильно влияет на итоговую стоимость — лучше уточнить.';
        default:       return '';
    }
}
