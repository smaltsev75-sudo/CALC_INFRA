/**
 * Версионированные миграции схемы расчёта.
 *
 * Каждая миграция знает, с какой версии на какую переводит, и должна быть
 * идемпотентной. Миграция применяется к глубокой копии расчёта; исходный
 * объект не модифицируется.
 *
 * При добавлении новой миграции:
 *   1. Реализовать функцию `step.run(calc)`, которая мутирует свой аргумент.
 *   2. Добавить запись в массив MIGRATIONS в порядке возрастания `to`.
 *   3. Обновить `LATEST_SCHEMA_VERSION` ниже автоматически (вычисляется).
 */

import {
    DEFAULT_PHASE_DURATION_MONTHS,
    DEFAULT_K_INFLATION,
    DEFAULT_K_SEASONAL,
    DEFAULT_K_SCHEDULE_SHIFT,
    DEFAULT_K_CONTINGENCY,
    DEFAULT_VAT_ENABLED,
    DEFAULT_PLANNING_HORIZON_YEARS,
    DEFAULT_DAYS_PER_MONTH,
    DEFAULT_STAND_SIZE_RATIO,
    DEFAULT_RESOURCE_RATIO,
    DEFAULT_AI_STAND_FACTOR,
    DASHBOARD_RESOURCE_LABELS,
    STAND_IDS,
    STAND_RATIO_RANGES
} from '../utils/constants.js';
import { VAT_RATE_HISTORY, getCurrentVatRate } from '../domain/vatRateTable.js';
import { sanitizeDeprecatedQuestions } from '../domain/deprecatedQuestions.js';
import { uuid } from '../utils/uuid.js';

/**
 * Ошибка миграции схемы.
 *
 * Выбрасывается из {@link migrateCalculation}, если шаг `from → to` упал.
 * Содержит контекст для понятного сообщения пользователю и для отката
 * состояния в вызывающем коде (bundleExport, calcListController).
 *
 * @property {number} from исходная версия схемы шага
 * @property {number} to   целевая версия схемы шага
 * @property {*}      cause оригинальная причина (Error | string)
 */
export class MigrationError extends Error {
    constructor(from, to, cause) {
        super(`Migration ${from}→${to} failed: ${cause?.message || cause}`);
        this.name = 'MigrationError';
        this.from = from;
        this.to = to;
        this.cause = cause;
    }
}

function normalizeWizardSelectAnswers(calc) {
    const MONTH_BY_NUMBER = Object.freeze({
        1: 'jan', 2: 'feb', 3: 'mar', 4: 'apr', 5: 'may', 6: 'jun',
        7: 'jul', 8: 'aug', 9: 'sep', 10: 'oct', 11: 'nov', 12: 'dec'
    });
    const normalize = (answers) => {
        if (!answers || typeof answers !== 'object') return;

        if (answers.pdn_category !== undefined && answers.pdn_category !== null) {
            if (typeof answers.pdn_category === 'number' && Number.isInteger(answers.pdn_category)) {
                answers.pdn_category = String(answers.pdn_category);
            } else if (typeof answers.pdn_category === 'string') {
                const m = /^cat-([1-4])$/.exec(answers.pdn_category);
                if (m) answers.pdn_category = m[1];
            }
        }

        if (answers.audience_geography === 'ru_cis') answers.audience_geography = 'cis';

        if (typeof answers.peak_months === 'string') {
            try {
                const parsed = JSON.parse(answers.peak_months);
                if (Array.isArray(parsed)) {
                    answers.peak_months = parsed
                        .map(v => MONTH_BY_NUMBER[Number(v)] || v)
                        .filter(v => typeof v === 'string');
                }
            } catch {
                // keep original; validation will surface unknown custom strings
            }
        } else if (Array.isArray(answers.peak_months)) {
            answers.peak_months = answers.peak_months
                .map(v => MONTH_BY_NUMBER[Number(v)] || v)
                .filter(v => typeof v === 'string');
        }

        if (answers.ai_model_tier === 'medium') answers.ai_model_tier = 'mid';
        if (answers.ai_model_tier === 'large') answers.ai_model_tier = 'heavy';

        if (answers.ai_data_sensitivity === 'low') answers.ai_data_sensitivity = 'internal';
        if (answers.ai_data_sensitivity === 'medium') answers.ai_data_sensitivity = 'confidential';
        if (answers.ai_data_sensitivity === 'high') answers.ai_data_sensitivity = 'pdn';
    };

    normalize(calc.answers);
    if (Array.isArray(calc.scenarios)) {
        for (const scenario of calc.scenarios) {
            normalize(scenario?.answers);
        }
    }
}

/**
 * Package 3A (OS license gate): для legacy-расчётов без явного
 * os_commercial_license_required до-вносим true ТОЛЬКО при явном регулируемом
 * сигнале (pdn_152fz===true ИЛИ fstec_certification_required===true) в
 * сохранённых answers — чтобы regulated-расчёты не потеряли ОС-лицензию молча.
 * Нерегулируемые остаются без флага (formula default=false) — намеренное
 * исправление фантомной безусловной ОС-лицензии. Явно заданный флаг (в т.ч.
 * false) НЕ перезаписываем — уважаем выбор пользователя. seed-default
 * pdn_152fz=false основанием для backfill НЕ является (проверяем === true).
 */
function backfillOsLicenseFlag(calc) {
    const backfill = (answers) => {
        if (!answers || typeof answers !== 'object') return;
        if (answers.os_commercial_license_required !== undefined) return;
        if (answers.pdn_152fz === true || answers.fstec_certification_required === true) {
            answers.os_commercial_license_required = true;
        }
    };
    backfill(calc.answers);
    if (Array.isArray(calc.scenarios)) {
        for (const scenario of calc.scenarios) {
            backfill(scenario?.answers);
        }
    }
}

export const MIGRATIONS = [
    {
        from: 0, to: 1,
        description: 'Перенос длительности фазы из ответа в settings.phaseDurationMonths',
        run(calc) {
            if (!calc.settings) calc.settings = {};
            if (!calc.answers)  calc.answers  = {};
            if (calc.settings.phaseDurationMonths === undefined) {
                const fromAnswer = Number(calc.answers.phase_duration_months);
                calc.settings.phaseDurationMonths = Number.isFinite(fromAnswer) && fromAnswer > 0
                    ? fromAnswer
                    : DEFAULT_PHASE_DURATION_MONTHS;
            }
            delete calc.answers.phase_duration_months;
        }
    },
    {
        from: 1, to: 2,
        description: 'Удаление мультивалютности; indexation → kInflation; ' +
                     'добавление риск-коэффициентов, НДС, standSizeRatio; tariff → billingInterval; resourceClass у ЭК',
        run(calc) {
            const s = calc.settings || (calc.settings = {});

            // Мультивалютность удалена — RUB only.
            delete s.currency;

            // Переименовываем indexation → kInflation, сохраняя значение.
            if (s.indexation !== undefined && s.kInflation === undefined) {
                s.kInflation = s.indexation;
            }
            delete s.indexation;

            // Дозаполняем недостающие коэффициенты дефолтами.
            if (s.kInflation       === undefined) s.kInflation       = DEFAULT_K_INFLATION;
            if (s.kSeasonal        === undefined) s.kSeasonal        = DEFAULT_K_SEASONAL;
            if (s.kScheduleShift   === undefined) s.kScheduleShift   = DEFAULT_K_SCHEDULE_SHIFT;
            if (s.kContingency     === undefined) s.kContingency     = DEFAULT_K_CONTINGENCY;
            if (s.vatEnabled       === undefined) s.vatEnabled       = DEFAULT_VAT_ENABLED;
            if (s.vatRate          === undefined) s.vatRate          = getCurrentVatRate();
            if (s.planningHorizonYears === undefined) s.planningHorizonYears = DEFAULT_PLANNING_HORIZON_YEARS;
            if (s.daysPerMonth     === undefined) s.daysPerMonth     = DEFAULT_DAYS_PER_MONTH;

            if (!s.standSizeRatio || typeof s.standSizeRatio !== 'object') {
                s.standSizeRatio = { ...DEFAULT_STAND_SIZE_RATIO };
            } else {
                for (const stand of STAND_IDS) {
                    if (typeof s.standSizeRatio[stand] !== 'number') {
                        s.standSizeRatio[stand] = DEFAULT_STAND_SIZE_RATIO[stand];
                    }
                }
                // ПРОМ — эталон, всегда 1.00 независимо от импорта.
                s.standSizeRatio.PROD = 1.00;
            }

            // Миграция ЭК словаря: tariff → billingInterval, добавление resourceClass.
            const items = calc.dictionaries?.items || [];
            for (const item of items) {
                if (item.tariff !== undefined && item.billingInterval === undefined) {
                    item.billingInterval = item.tariff;
                }
                delete item.tariff;
                if (!item.resourceClass) {
                    // Эвристика по category — Этап 2 переопределит точнее.
                    // 12.U31 (E.2): добавлены SECURITY → SERVICE, AI → AI_LLM.
                    // Раньше эти категории падали в fallback 'SERVICE', что для AI
                    // было семантически неверно: AI_LLM в SEASONAL_RESOURCE_CLASSES,
                    // SERVICE тоже — но если в будущем разделятся, drift проявится тихо.
                    const map = {
                        HW:       'CPU',
                        LICENSE:  'LICENSE',
                        TRAFFIC:  'TRAFFIC',
                        SERVICES: 'SERVICE',
                        RESERVES: 'RESERVE',
                        SECURITY: 'SERVICE',
                        AI:       'AI_LLM'
                    };
                    item.resourceClass = map[item.category] || 'SERVICE';
                }
            }
        }
    },
    {
        from: 2, to: 3,
        description: 'Per-resource standSizeRatio: settings.resourceRatio = ' +
                     '{STAND: {CPU, GPU, RAM, SSD, HDD, S3}}. По умолчанию каждый ресурс ' +
                     'наследует общее значение standSizeRatio[STAND], так что поведение ' +
                     'мигрированного расчёта идентично прежнему до явной правки в Опроснике.',
        run(calc) {
            const s = calc.settings || (calc.settings = {});

            // Берём общий стенд-ratio как fallback для каждого ресурса.
            const generalRatio = (s.standSizeRatio && typeof s.standSizeRatio === 'object')
                ? s.standSizeRatio
                : { ...DEFAULT_STAND_SIZE_RATIO };

            if (!s.resourceRatio || typeof s.resourceRatio !== 'object') {
                s.resourceRatio = {};
            }
            for (const stand of STAND_IDS) {
                const standDefault = stand === 'PROD'
                    ? 1.00
                    : (Number.isFinite(generalRatio[stand]) ? generalRatio[stand] : DEFAULT_STAND_SIZE_RATIO[stand]);

                if (!s.resourceRatio[stand] || typeof s.resourceRatio[stand] !== 'object') {
                    s.resourceRatio[stand] = {};
                }
                for (const resource of DASHBOARD_RESOURCE_LABELS) {
                    if (typeof s.resourceRatio[stand][resource] !== 'number') {
                        // PROD всегда 1.00 для всех ресурсов; остальные — из общего стенд-ratio.
                        s.resourceRatio[stand][resource] = stand === 'PROD' ? 1.00 : standDefault;
                    }
                }
                if (stand === 'PROD') {
                    // ПРОМ — эталон, гарантируем 1.00 везде.
                    for (const r of DASHBOARD_RESOURCE_LABELS) {
                        s.resourceRatio.PROD[r] = 1.00;
                    }
                }
            }
        }
    },
    {
        from: 3, to: 4,
        description: '12.U18: dau_target → dau_share_of_registered_percent (% активных в день ' +
                     'от зарегистрированных). Старые dau_target пересчитываются в share = ' +
                     'dau_target/registered×100, clamp 0.1..100. Пустые/инвалидные → дефолт 5%.',
        run(calc) {
            const a = calc.answers || (calc.answers = {});
            if (typeof a.dau_share_of_registered_percent !== 'number') {
                const dau = Number(a.dau_target);
                const reg = Number(a.registered_users_total);
                if (Number.isFinite(dau) && Number.isFinite(reg) && reg > 0 && dau > 0) {
                    /* Если расчёт был с dau > registered (e.g., dau_target=10000, registered=500),
                       это инконсистентность legacy. Получим share > 100%; clamp до 100.
                       Минимум 0.1% — нулевая активность ≈ невозможна для рабочего продукта. */
                    const share = Math.max(0.1, Math.min(100, (dau / reg) * 100));
                    a.dau_share_of_registered_percent = share;
                } else {
                    a.dau_share_of_registered_percent = 5;
                }
            }
            // Удаляем устаревший ответ — формулы теперь не используют Q.dau_target.
            delete a.dau_target;
            // И удаляем устаревший вопрос из dictionary, иначе UI legacy-расчёта
            // покажет оба поля. Опросник на UI-fallback подтянет новый dau_share
            // из SEED_QUESTIONS, а старый dau_target должен исчезнуть.
            const dict = calc.dictionaries;
            if (dict && Array.isArray(dict.questions)) {
                dict.questions = dict.questions.filter(q => q.id !== 'dau_target');
            }
        }
    },
    {
        from: 4, to: 5,
        description: '12.U19: удаление устаревшего mau_target (был «мёртвым» вопросом — ' +
                     'не используется ни одной формулой, дублирует контекст с registered+dau_share). ' +
                     'mau_growth_rate_percent оставляем как perspective-input для будущего прогноза.',
        run(calc) {
            const a = calc.answers || (calc.answers = {});
            delete a.mau_target;
            const dict = calc.dictionaries;
            if (dict && Array.isArray(dict.questions)) {
                dict.questions = dict.questions.filter(q => q.id !== 'mau_target');
            }
        }
    },
    {
        from: 5, to: 6,
        description: '12.U25-fix-13: удаление res-project-risk (плейсхолдер с pricePerUnit=1, ' +
                     'давал ~0₽ и ломал «Резервы=0» в дашборде). Семантически дублировал ' +
                     'kContingency, который уже добавляет global +N% надбавку поверх всех статей. ' +
                     'Категория RESERVES теперь содержит только реальные ЭК — георезерв и DR-кластер ' +
                     '(оба активируются явно через Q.georedundancy_required и Q.sla_target≥99.95).',
        run(calc) {
            const dict = calc.dictionaries;
            if (dict && Array.isArray(dict.items)) {
                dict.items = dict.items.filter(it => it.id !== 'res-project-risk');
            }
        }
    },
    {
        from: 6, to: 7,
        description: '12.U30-fix-3: переименование 5 ЭК — убрали слово-дубль категории из имени ' +
                     '(аккордеон сверху уже показывает категорию). LICENSE: «Лицензия СУБД/ОС/СЗИ» → ' +
                     '«СУБД/ОС/СЗИ»; TRAFFIC: «Исходящий/Входящий трафик» → «Исходящий/Входящий».',
        run(calc) {
            const dict = calc.dictionaries;
            if (!dict || !Array.isArray(dict.items)) return;
            const RENAMES = {
                'license-db-per-vcpu':       'СУБД (на vCPU)',
                'license-os-per-node':       'ОС (на узел)',
                'license-siem-edr-per-node': 'СЗИ (на узел)',
                'traffic-egress-tb':         'Исходящий (TB/мес)',
                'traffic-ingress-tb':        'Входящий (TB/мес)'
            };
            for (const item of dict.items) {
                if (RENAMES[item.id]) item.name = RENAMES[item.id];
            }
        }
    },
    {
        from: 7, to: 8,
        description: 'Этап 13: AI-агенты и многоагентные системы. Master-toggle ai_agent_mode = false ' +
                     'для legacy (поведение идентично v7). Подмешивание новых seed-вопросов и ЭК делает ' +
                     'enrichLegacyDictionary() из seed.js — она вызывается калькуляционным контроллером ' +
                     'после миграции (избегает circular import seed.js ↔ migrations.js).',
        run(calc) {
            const a = calc.answers || (calc.answers = {});
            if (a.ai_agent_mode === undefined) a.ai_agent_mode = false;
        }
    },
    {
        from: 8, to: 9,
        description: 'Этап 13.U7: per-stand AI factor — независимый множитель объёма AI/RAG/агентов ' +
                     'на стенд (sensible defaults: DEV=0, IFT=0.2, PSI=0.5, PROD=1.0, LOAD=1.0). ' +
                     'Применяется к AI-формулам ВМЕСТО общего standSizeRatio. PROD заперт = 1.00 как эталон. ' +
                     'BREAKING для legacy AI-расчётов: на DEV AI-расходы становятся 0 (раньше шли через ' +
                     'standSizeRatio.DEV ≈ 0.16). Это намеренно — пользователь явно правит per-stand в Опроснике.',
        run(calc) {
            const s = calc.settings || (calc.settings = {});
            if (!s.aiStandFactor || typeof s.aiStandFactor !== 'object') {
                s.aiStandFactor = { ...DEFAULT_AI_STAND_FACTOR };
                return;
            }
            // Идемпотентность: если объект уже есть, проставляем недостающие стенды
            // дефолтами, не затирая существующие значения.
            for (const stand of STAND_IDS) {
                if (typeof s.aiStandFactor[stand] !== 'number') {
                    s.aiStandFactor[stand] = DEFAULT_AI_STAND_FACTOR[stand];
                }
            }
            // PROD всегда 1.00 — гарантия инварианта (даже если в JSON прислали другое).
            s.aiStandFactor.PROD = 1.00;
        }
    },
    {
        from: 9, to: 10,
        description: 'Этап 13.U10: разработческий AI-traffic на DEV. Старый дефолт ' +
                     'aiStandFactor.DEV = 0 → 0.02 (2% от PROD). Раньше на DEV AI был полностью выкл., ' +
                     'из-за чего возникала логическая дыра: RAG_VECTORS на DEV показывал floor 1 ГБ ' +
                     '(через max(1, ...)), но TOKENS/EMBEDDINGS были 0 — индекс есть, нагрузки нет. ' +
                     'Теперь на DEV пропорционально считаются регрессионные тесты + ad-hoc разработка + демо. ' +
                     'Migration переключает 0 на 0.02 ТОЛЬКО для расчётов с дефолтным значением (legacy v9). ' +
                     'Если пользователь явно менял DEV-фактор — не трогаем.',
        run(calc) {
            const s = calc.settings || (calc.settings = {});
            if (!s.aiStandFactor || typeof s.aiStandFactor !== 'object') {
                s.aiStandFactor = { ...DEFAULT_AI_STAND_FACTOR };
                return;
            }
            // Если DEV был ровно 0 — это старый legacy default, поднимаем до 0.02.
            // Промежуточные значения (0.05, 0.1) трогать нельзя — пользователь
            // явно настроил dev-traffic. PROD всегда 1.00 как и раньше.
            if (s.aiStandFactor.DEV === 0) {
                s.aiStandFactor.DEV = DEFAULT_AI_STAND_FACTOR.DEV;
            }
            s.aiStandFactor.PROD = 1.00;
        }
    },
    {
        from: 10, to: 11,
        description: 'Этап 13.U10-fix: автовосстановление seed-defaults у дочерних полей ' +
                     'master-toggle ai_agent_mode. Реальный кейс: пользователь когда-то выключал ' +
                     'мастер агентов → каскад сбросил agent_tool_use_share / agent_tool_avg_seconds ' +
                     '/ agent_complexity / ai_agent_type / agent_parallel_specialists в null. Затем ' +
                     'включил мастер обратно — ДО v11 поля оставались null. В формуле AGENT_CPU ' +
                     'agent_tool_use_share=null давал toolShare=0 → agentToolFactor=0 → AGENT_CPU=0 ' +
                     'на ВСЕХ стендах. Пользователь видел «—» в Сводке AI-метрик, хотя в Опроснике ' +
                     'мастер был включен. Миграция восстанавливает дефолты ТОЛЬКО для null/undefined ' +
                     'полей — введённые пользователем значения не трогаются. Запускается только при ' +
                     'ai_agent_mode === true (если мастер выключен — дочерние и так должны быть null).',
        run(calc) {
            const a = calc.answers || (calc.answers = {});
            if (a.ai_agent_mode !== true) return;
            // Дефолты идентичны seed.js (defaultValue в SEED_QUESTIONS).
            // Дублируем здесь, чтобы избежать circular import migrations.js ↔ seed.js
            // (тот же приём, что для enrichLegacyDictionaryWithAgentSeed).
            const RESTORE = {
                agent_tool_use_share:       50,           // %
                agent_tool_avg_seconds:     3,            // секунд
                agent_complexity:           'medium',
                ai_agent_type:              'tool_use',
                agent_parallel_specialists: 3
            };
            for (const [key, def] of Object.entries(RESTORE)) {
                if (a[key] === null || a[key] === undefined) {
                    a[key] = def;
                }
            }
        }
    },
    {
        from: 11, to: 12,
        description: 'Per-stand clamp standSizeRatio и resourceRatio. Stage 19 ' +
                     '(MINOR 2.19.0) — инвариант «стенд ≤ ПРОМ» снят для LOAD ' +
                     '(теперь 0.20..1.20 для capacity-запаса). DEV/IFT/PSI ' +
                     'остаются ≤ 1.00. Clamp идёт через STAND_RATIO_RANGES — ' +
                     'если в будущем диапазоны изменятся, миграция автоматически ' +
                     'согласуется. Audit-14 P1#2 (PATCH 2.19.1): двусторонний ' +
                     'clamp [min..max], не только сверху. Раньше bundle-export ' +
                     'legacy calc с LOAD=0.10 проходил буду validateBundle, ' +
                     'падал на LOAD<0.20. PROD=1.00 (min=max=1.00) — clamp ' +
                     'возвращает 1.00 для любого значения.',
        run(calc) {
            const s = calc.settings;
            if (!s) return;
            const standRange = (stand) => {
                const r = STAND_RATIO_RANGES[stand];
                return r ? { min: r.min, max: r.max } : { min: 0, max: 1.00 };
            };
            const clamp = (v, range) => {
                if (v < range.min) return range.min;
                if (v > range.max) return range.max;
                return v;
            };
            if (s.standSizeRatio && typeof s.standSizeRatio === 'object') {
                for (const stand of STAND_IDS) {
                    const v = s.standSizeRatio[stand];
                    if (!Number.isFinite(v)) continue;
                    const range = standRange(stand);
                    if (v < range.min || v > range.max) {
                        s.standSizeRatio[stand] = clamp(v, range);
                    }
                }
            }
            if (s.resourceRatio && typeof s.resourceRatio === 'object') {
                for (const stand of STAND_IDS) {
                    const row = s.resourceRatio[stand];
                    if (!row || typeof row !== 'object') continue;
                    const range = standRange(stand);
                    for (const r of DASHBOARD_RESOURCE_LABELS) {
                        const v = row[r];
                        if (!Number.isFinite(v)) continue;
                        if (v < range.min || v > range.max) {
                            row[r] = clamp(v, range);
                        }
                    }
                }
            }
        }
    },
    {
        from: 12, to: 13,
        description: 'Этап 14.U1 (Quick Start Wizard): добавляем 3 поля. ' +
                     'calc.wizard — null для legacy (расчёт создан вручную), либо объект ' +
                     '{ product_type, industry, scale, geography, pdn, activity, ai_used } ' +
                     'для wizard-расчётов. calc.answersMeta — параллель к answers, описывает ' +
                     'источник каждого значения (profile/scale/sla_preset/manual/...) для UI-бейджей. ' +
                     'calc.settings.provider — выбранный провайдер для overlay-цен (default sbercloud).',
        run(calc) {
            // Legacy-расчёт: wizard=null значит «создан вручную в expert-mode».
            if (calc.wizard === undefined) {
                calc.wizard = null;
            }
            // answersMeta пустой — все поля без бейджа (исторически совместимо).
            if (calc.answersMeta === undefined) {
                calc.answersMeta = {};
            }
            // provider дефолтный — SberCloud (наш приоритетный провайдер).
            if (!calc.settings) calc.settings = {};
            if (calc.settings.provider === undefined) {
                calc.settings.provider = 'sbercloud';
            }
        }
    },
    {
        from: 13, to: 14,
        description: 'Этап 14.U4 (Provider-dropdown): добавляем флаг ' +
                     'calc.settings.providerSetByWizard для UI-бейджа источника ' +
                     'провайдера. true — provider пришёл из Quick Start (default ' +
                     'sbercloud); false — пользователь выбрал вручную через dropdown ' +
                     'в Опроснике. Legacy-расчёты получают false (в их время wizard ' +
                     'ещё не существовал, provider — это manual default).',
        run(calc) {
            if (!calc.settings) calc.settings = {};
            if (calc.settings.providerSetByWizard === undefined) {
                /* wizard !== null значит — расчёт создан Quick Start'ом, провайдер
                   пришёл из мастера (default sbercloud). Иначе — legacy/manual. */
                calc.settings.providerSetByWizard = (calc.wizard != null);
            }
        }
    },
    {
        from: 14, to: 15,
        description: 'Sprint 3.0 Stage 1 (multi-profile): ввод calc.scenarios[] и ' +
                     'calc.activeScenarioId. Legacy {wizard, answers, answersMeta} ' +
                     'переезжают в scenarios[0] с label "Базовый". root остаётся ' +
                     'зеркалом активного scenario — calculator.js и UI продолжают ' +
                     'читать calc.answers напрямую, без знания о scenarios. ' +
                     'commit() в calcController.js поддерживает зеркало через ' +
                     'syncActiveScenarioFromRoot после каждой записи.',
        run(calc) {
            // Идемпотентность: если scenarios уже есть и непуст — досоздаём
            // только activeScenarioId при необходимости. Это страхует от
            // полу-выполненных миграций (например, если пользователь руками
            // отредактировал JSON и добавил scenarios).
            if (Array.isArray(calc.scenarios) && calc.scenarios.length > 0) {
                const hasActive = calc.activeScenarioId
                    && calc.scenarios.some(s => s && s.id === calc.activeScenarioId);
                if (!hasActive) {
                    calc.activeScenarioId = calc.scenarios[0].id || uuid();
                    if (!calc.scenarios[0].id) calc.scenarios[0].id = calc.activeScenarioId;
                }
                return;
            }
            const scenarioId = uuid();
            calc.scenarios = [{
                id: scenarioId,
                label: 'Базовый',
                wizard: calc.wizard !== undefined ? calc.wizard : null,
                answers: calc.answers ? { ...calc.answers } : {},
                answersMeta: calc.answersMeta ? { ...calc.answersMeta } : {}
            }];
            calc.activeScenarioId = scenarioId;
            // calc.wizard / calc.answers / calc.answersMeta ОСТАЮТСЯ на root —
            // это mirror. Calculator и UI продолжают читать root, не зная про scenarios.
        }
    },
    {
        from: 15, to: 16,
        description: 'Sprint 4 Stage 4.5.1 (hot-fix дубля): провайдер «cloud_ru» ' +
                     'был alias на «sbercloud», но показывался в UI как отдельный ' +
                     'пункт — пользователь видел дубль одного и того же провайдера. ' +
                     'Entry cloud_ru удалён из PROVIDER_OVERLAYS, label у sbercloud ' +
                     'обновлён на «Cloud.ru (бывший SberCloud)». Расчёты с ' +
                     'settings.provider==="cloud_ru" перетираются на "sbercloud" — ' +
                     'overlay-prices идентичны (всегда были alias), пользователь ' +
                     'не заметит смены поведения, только смену имени бренда.',
        run(calc) {
            if (calc.settings && calc.settings.provider === 'cloud_ru') {
                calc.settings.provider = 'sbercloud';
            }
        }
    },
    {
        from: 16, to: 17,
        description: 'Stage VAT-1: Calc VAT modes (auto-by-date / manual / frozen) + ' +
                     'vatEffectiveDate. До этой миграции в расчёте была только ' +
                     'плоская settings.vatRate (число), что не позволяло отличить ' +
                     'историческое значение от текущего и приводило к скрытым ошибкам ' +
                     'при смене ставки НДС в РФ (01.01.2026: 20% → 22%). ' +
                     'Решение Q1-Q7 + multi-period C + auto-frozen для legacy. ' +
                     'Правила (без хардкода дат — справочник VAT_RATE_HISTORY): ' +
                     '(1) если vatRate отсутствует → mode=auto-by-date, ' +
                     'vatEffectiveDate=createdAt; (2) если vatRate входит в ' +
                     'исторические ставки справочника (все, кроме текущей) → ' +
                     'mode=frozen, сумма НЕ меняется; (3) если vatRate=текущая ' +
                     'И createdAt >= дата начала текущего периода → ' +
                     'mode=auto-by-date; (4) если vatRate=текущая, но createdAt ' +
                     'раньше начала текущего периода (или отсутствует) → ' +
                     'mode=frozen (странный случай — безопаснее не трогать); ' +
                     '(5) иначе (custom rate, не из справочника) → mode=manual.',
        run(calc) {
            if (!calc.settings || typeof calc.settings !== 'object') return;
            const s = calc.settings;

            /* Идемпотентность: если mode уже выставлен, ничего не делаем. */
            if (s.vatRateMode !== undefined) return;

            /* createdAt существует с момента введения этого поля в
               calcListController.createCalc/duplicate/import. Для очень
               старых расчётов может отсутствовать — обрабатываем как null. */
            const createdAtRaw = calc.createdAt;
            const createdAtIso = (typeof createdAtRaw === 'string' && createdAtRaw.length >= 10)
                ? createdAtRaw.slice(0, 10)
                : null;

            /* Источник правды для классификации «историческая vs текущая ставка» —
               справочник VAT_RATE_HISTORY. При будущем добавлении новой ставки
               (например 2027-01-01: 22% → 24%) логика миграции продолжит работать
               без правок: 0.22 станет «исторической» автоматически. */
            const currentPeriod = VAT_RATE_HISTORY[VAT_RATE_HISTORY.length - 1];
            const currentRate = currentPeriod.rate;
            const currentRateFromIso = currentPeriod.from;
            const historicalRates = VAT_RATE_HISTORY.slice(0, -1).map(p => p.rate);

            if (s.vatRate === undefined) {
                s.vatRateMode = 'auto-by-date';
                s.vatEffectiveDate = createdAtIso;
                /* vatRate проставится в openCalc при mode='auto-by-date'.
                   Контракт: при отсутствующем vatEffectiveDate openCalc
                   подставит todayIso() при первой загрузке. */
            } else if (historicalRates.includes(s.vatRate)) {
                /* Историческая ставка (18% / 20% / любая прошлая) — заморозить.
                   Это главное acceptance: сумма согласованного расчёта 2024 года
                   НЕ должна измениться после обновления приложения. */
                s.vatRateMode = 'frozen';
                s.vatEffectiveDate = createdAtIso;
            } else if (s.vatRate === currentRate) {
                if (createdAtIso !== null && createdAtIso >= currentRateFromIso) {
                    /* Активный расчёт под текущей ставкой. */
                    s.vatRateMode = 'auto-by-date';
                    s.vatEffectiveDate = createdAtIso;
                } else {
                    /* Странный случай: vatRate=22%, но createdAt < 2026-01-01
                       или отсутствует. Возможно ручная правка. Безопаснее
                       заморозить — не менять сумму неожиданно. */
                    s.vatRateMode = 'frozen';
                    s.vatEffectiveDate = createdAtIso;
                }
            } else {
                /* Custom rate (не в справочнике) — пользователь явно указал
                   особую ставку: нерезидент, льгота, спецрежим. */
                s.vatRateMode = 'manual';
                s.vatEffectiveDate = null;
            }
        }
    },
    {
        from: 17, to: 18,
        description: 'Внешний аудит #3 (2026-05-18): нормализовать item.priceSource ' +
                     'к whitelist [manual | csv | seed | provider]. Раньше applyOverrideToItems ' +
                     'переносил сырой vendor-specific ref (например, «cloud.ru/2026-Q3-test») ' +
                     'из provider overlay в item.priceSource — это значение не проходило ' +
                     'validateItem и приводило к 19 ошибкам при re-import bundle (item.priceSource ' +
                     'не из whitelist). Миграция: priceSource не в whitelist → "provider"; ' +
                     'оригинальное значение копируем в priceSourceRef (для UI tooltip).',
        run(calc) {
            const items = calc?.dictionaries?.items;
            if (!Array.isArray(items)) return;
            const ALLOWED = new Set(['manual', 'csv', 'seed', 'provider']);
            for (const item of items) {
                if (!item || typeof item !== 'object') continue;
                const src = item.priceSource;
                if (src === undefined || src === null) continue;
                if (typeof src !== 'string') continue;
                if (ALLOWED.has(src)) continue;
                /* Сохраняем оригинальный label для UI tooltip; затем нормализуем. */
                if (!item.priceSourceRef) item.priceSourceRef = src;
                item.priceSource = 'provider';
            }
        }
    },
    {
        from: 18, to: 19,
        description: 'MINOR 2.18.0 (2026-05-19): удаление dead-вопроса mau_growth_rate_percent. ' +
                     'Был добавлен как perspective-input для будущей фичи «прогноз бюджета на ' +
                     'год N+1» (см. миграцию 12.U19 v4→v5, где симметрично удалён mau_target). ' +
                     'За 12+ месяцев фича прогноза не появилась; поле продолжало занимать место ' +
                     'в Опроснике, в Quick Start и в templates без влияния на расчёт текущего ' +
                     'OPEX — и сам description прямо предупреждал об этом пользователя, что ' +
                     'разрушительно для доверия к инструменту. Удаляем поле из answers и из ' +
                     'snapshot dictionaries.questions (симметрично 12.U19).',
        run(calc) {
            const a = calc.answers || (calc.answers = {});
            delete a.mau_growth_rate_percent;
            const dict = calc.dictionaries;
            if (dict && Array.isArray(dict.questions)) {
                dict.questions = dict.questions.filter(q => q.id !== 'mau_growth_rate_percent');
            }
        }
    },
    {
        from: 19, to: 20,
        description: 'PATCH 2.20.20: нормализация legacy Quick Start select-answer values. ' +
                     'До фикса wizard писал audience_geography="ru_cis", peak_months как "[8, 9, 12]", pdn_category числом (2/3), ai_model_tier как ' +
                     '"medium"/"large", ai_data_sensitivity как "low"/"medium"/"high", ' +
                     'а seed-справочник уже ожидал "cis", month-id массив, "2"/"3", "mid"/"heavy" и ' +
                     '"internal"/"confidential"/"pdn". Такие расчёты считались и ' +
                     'отображались, но не проходили validateCalculation, из-за чего ' +
                     'JSON-import показывал validation modal, а bundle export пропускал calc. ' +
                     'Миграция чинит root.answers и все scenarios[*].answers.',
        run(calc) {
            normalizeWizardSelectAnswers(calc);
        }
    },
    {
        from: 20, to: 21,
        description: 'Package 3A (PATCH): OS license gate. license-os-per-node теперь зависит ' +
                     'от Q.os_commercial_license_required (по умолчанию false). Чтобы regulated ' +
                     'legacy-расчёты не потеряли платную ОС молча — до-вносим ' +
                     'os_commercial_license_required=true при ЯВНОМ pdn_152fz===true или ' +
                     'fstec_certification_required===true в сохранённых answers. Нерегулируемые ' +
                     'остаются без флага (ОС-лицензия становится 0) — намеренное исправление ' +
                     'фантомной безусловной ОС-лицензии. Явный флаг (в т.ч. false) не трогаем.',
        run(calc) {
            backfillOsLicenseFlag(calc);
        }
    }
];

/** Самая высокая известная версия схемы. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.length > 0
    ? MIGRATIONS[MIGRATIONS.length - 1].to
    : 0;

/**
 * Применить все необходимые миграции к расчёту.
 * Возвращает новый объект (исходный не модифицируется).
 * Признак того, что миграция что-то изменила: `result.schemaVersion !== input.schemaVersion`.
 *
 * Атомарность: каждый шаг применяется к свежей deep-copy. Если шаг бросил —
 * наполовину мутированная копия отбрасывается, выбрасывается {@link MigrationError},
 * и вызывающий код может откатить состояние (bundleExport / calcListController).
 *
 * @param {object} input расчёт (любой версии)
 * @param {Array}  [_migrations=MIGRATIONS] массив шагов миграции;
 *        опциональный параметр для dependency injection в тестах,
 *        в production всегда используется глобальный MIGRATIONS.
 * @returns {object} мигрированный расчёт
 * @throws {MigrationError} если хоть один шаг упал
 */
export function migrateCalculation(input, _migrations = MIGRATIONS) {
    if (!input || typeof input !== 'object') return input;
    // Downgrade-защита (Этап 11.3.2).
    // Расчёт из более новой версии приложения может содержать неизвестные поля
    // или DSL-конструкции, которые текущая логика молча проигнорирует или
    // повредит. Лучше явно отказать с понятным сообщением.
    const incomingVersion = Number.isFinite(input.schemaVersion) ? input.schemaVersion : 0;
    if (incomingVersion > LATEST_SCHEMA_VERSION) {
        throw new MigrationError(
            incomingVersion,
            LATEST_SCHEMA_VERSION,
            new Error(`Расчёт создан в более новой версии приложения (schemaVersion=${incomingVersion}). Обновите приложение.`)
        );
    }
    let calc = JSON.parse(JSON.stringify(input));
    if (!calc.settings) calc.settings = {};
    if (!calc.answers)  calc.answers  = {};
    let v = Number.isFinite(calc.schemaVersion) ? calc.schemaVersion : 0;
    for (const step of _migrations) {
        if (v < step.to) {
            // Атомарный per-step apply: работаем на свежей копии, и только при
            // успехе перенацеливаемся на неё. Это не даёт partial-mutated calc
            // утечь в localStorage даже при ошибке посередине шага.
            const copy = JSON.parse(JSON.stringify(calc));
            try {
                step.run(copy);
            } catch (e) {
                throw new MigrationError(step.from, step.to, e);
            }
            calc = copy;
            v = step.to;
        }
    }
    calc.schemaVersion = v;
    // Defense-in-depth (PATCH 2.18.2, audit-9 P1): финальная зачистка
    // deprecated-вопросов. Важно выполнять её только после полной цепочки:
    // при partial migration (dependency injection в тестах) ранний sanitize
    // может удалить legacy-ответ до шага, который должен прочитать и
    // сконвертировать это значение (пример: dau_target в v3→v4).
    if (v >= LATEST_SCHEMA_VERSION) {
        return sanitizeDeprecatedQuestions(calc);
    }
    return calc;
}
