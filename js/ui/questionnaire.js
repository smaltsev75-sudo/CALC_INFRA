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

import { el } from './dom.js';
import { icon } from './icons.js';
import {
    SECTION_IDS, SECTION_LABELS,
    UI_TOOLTIPS_SHORT
} from '../utils/constants.js';
import { SEED_QUESTIONS, DEPRECATED_QUESTION_IDS } from '../domain/seed.js';
import { renderHealthStickyChip } from './healthChip.js';
import { renderScenarioBadge } from './scenarioBadge.js';
import { renderSettingsPanel } from './questionnaireSettings.js';
import { renderAiStandFactors } from './questionnaireStandSettings.js';
import { renderNumberInput } from './questionnaireNumberInput.js';

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

/** Toggle одной секции в state.ui.questionnaireOpenSections. */
function toggleSection(state, ctx, sectionId) {
    const cur = openedSections(state);
    const next = cur.includes(sectionId)
        ? cur.filter(s => s !== sectionId)
        : [...cur, sectionId];
    ctx.setUi({ questionnaireOpenSections: next });
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

const QUESTION_FORMULA_IMPACT_CACHE = new WeakMap();
const DERIVED_CALCULATION_QUESTION_IDS = new Set([
    'ai_agent_type',
    'agent_complexity',
    'agent_parallel_specialists',
    'agent_tool_use_share'
]);

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildQuestionFormulaImpactMap(calc) {
    if (!calc || typeof calc !== 'object') return new Map();
    const cached = QUESTION_FORMULA_IMPACT_CACHE.get(calc);
    if (cached) return cached;

    const formulas = [];
    for (const item of calc.dictionaries?.items || []) {
        for (const formula of Object.values(item?.qtyFormulas || {})) {
            if (typeof formula === 'string' && formula) formulas.push(formula);
        }
    }
    const joined = formulas.join('\n');
    const map = new Map();
    for (const q of getRenderableQuestions(calc)) {
        const re = new RegExp(`\\bQ\\.${escapeRegExp(q.id)}\\b`);
        map.set(q.id, re.test(joined) || DERIVED_CALCULATION_QUESTION_IDS.has(q.id));
    }
    QUESTION_FORMULA_IMPACT_CACHE.set(calc, map);
    return map;
}

function renderFormulaImpactBadge(q, calc) {
    const impactMap = buildQuestionFormulaImpactMap(calc);
    const affects = impactMap.get(q.id) === true;
    const tip = affects
        ? 'Ответ используется в формулах ЭК и влияет на расчёт бюджета.'
        : 'Ответ сохраняется для контекста и пояснений; текущие формулы ЭК его не используют.';
    return el('span', {
        class: ['field-impact-badge', affects ? 'field-impact-badge--active' : 'field-impact-badge--info'],
        attrs: { title: tip, 'aria-label': tip },
        text: affects ? 'Влияет на расчёт' : 'Информационное поле'
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
                    title: 'Открыть Quick Start: заполнить 8 параметров (Ctrl+Alt+N).',
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
                attrs: {
                    disabled: isDisabled ? '' : undefined,
                    'data-focus-key': focusKey,
                    'data-testid': `answer-${q.id}`
                },
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
                            'data-focus-key': isSel ? focusKey : undefined,
                            'data-testid': `answer-${q.id}-option-${o.value}`
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
                attrs: {
                    'data-focus-key': focusKey,
                    'data-testid': `answer-${q.id}`,
                    disabled: isDisabled ? '' : undefined
                },
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
            attrs: {
                type: 'button',
                'aria-pressed': isUnknown ? 'true' : 'false',
                'data-testid': `answer-${q.id}-unknown`
            },
            title: isUnknown
                ? 'Калькулятор подставляет значение по умолчанию. Нажмите, чтобы ввести своё.'
                : 'Если точное значение неизвестно — нажмите, и калькулятор подставит разумное значение по умолчанию.',
            onClick: () => {
                if (isUnknown) {
                    const fallback = q.defaultIfUnknown ?? q.defaultValue ?? null;
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
    const formulaImpactBadge = renderFormulaImpactBadge(q, calc);

    // 12.U1: дублирующая ⓘ-иконка убрана — tooltip уже навешен на field-label
    // через title=fullHint (см. ниже). Это снижает визуальный шум и убирает
    // вторую цель для попадания курсором с одной и той же функцией.
    const labelRow = el('span', { class: 'field-label', title: fullHint },
        el('span', { class: 'field-label-text', text: q.title }),
        sourceBadge,
        formulaImpactBadge,
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

    return el('div', {
        class: fieldClass,
        id: `field-${q.id}`,
        attrs: { 'data-testid': `question-field-${q.id}` }
    },
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
