/* ============================================================
 * Cost Optimization Planner — declarative configuration.
 *
 * Pure data: plan tiers, constraints, groups and lever specs. The engine lives
 * in costOptimizationPlanner.js and imports this module.
 * ============================================================ */

export const PLAN_IDS = Object.freeze({
    CONSERVATIVE: 'conservative',
    AMBITIOUS:    'ambitious',
    EXTREME:      'extreme'
});

export const PLAN_TIERS = Object.freeze([
    {
        id: PLAN_IDS.CONSERVATIVE,
        title: 'Консервативный',
        subtitle: 'Минимальная боль',
        description: 'Экономия без изменения ключевых требований.',
        range: { minPercent: 0, maxPercent: 5 },
        risk: 'low'
    },
    {
        id: PLAN_IDS.AMBITIOUS,
        title: 'Амбициозный',
        subtitle: 'Управляемый компромисс',
        description: 'Заметная экономия, требует согласования компромиссов.',
        range: { minPercent: 5, maxPercent: 15 },
        risk: 'medium'
    },
    {
        id: PLAN_IDS.EXTREME,
        title: 'Экстремальный',
        subtitle: 'Изменение требований / высокий риск',
        description: 'Существенное снижение за счёт пересмотра требований или принятия высокого риска.',
        range: { minPercent: 15, maxPercent: 25 },
        risk: 'high'
    }
]);

export const DEFAULT_CONSTRAINTS = Object.freeze({
    allowReliabilityTradeoff: false,
    allowNonProdReduction:    true,
    allowRiskBufferReduction: true,
    allowAiReduction:         false,
    allowRetentionReduction:  true,
    protectCompliance:        true
});

/**
 * Stage 18.1 (v2.13.0) — Default constraints per level.
 *
 * Каждый уровень задаёт «суггестию» по compromise-set'у. Pure conservative
 * не трогает AI/RAG и SLA; ambitious/extreme разрешают AI, но SLA остаётся
 * opt-in (allowReliabilityTradeoff=false по умолчанию даже в extreme).
 */
export const LEVEL_DEFAULT_CONSTRAINTS = Object.freeze({
    [PLAN_IDS.CONSERVATIVE]: Object.freeze({
        allowReliabilityTradeoff: false,
        allowNonProdReduction:    true,
        allowRiskBufferReduction: true,
        allowAiReduction:         false,
        allowRetentionReduction:  true,
        protectCompliance:        true
    }),
    [PLAN_IDS.AMBITIOUS]: Object.freeze({
        allowReliabilityTradeoff: false,
        allowNonProdReduction:    true,
        allowRiskBufferReduction: true,
        allowAiReduction:         true,
        allowRetentionReduction:  true,
        protectCompliance:        true
    }),
    [PLAN_IDS.EXTREME]: Object.freeze({
        allowReliabilityTradeoff: false,
        allowNonProdReduction:    true,
        allowRiskBufferReduction: true,
        allowAiReduction:         true,
        allowRetentionReduction:  true,
        protectCompliance:        true
    })
});

export const DEFAULT_LEVEL = PLAN_IDS.AMBITIOUS;

/**
 * Stage 18.1.1 — группы рычагов по области компромисса.
 */
export const OPTIMIZATION_LEVER_GROUPS = Object.freeze([
    {
        id: 'infrastructure',
        title: 'Инфраструктура и стенды',
        description: 'Изменение размеров стендов DEV / ИФТ / ПСИ / НТ.',
        constraintKey: 'allowNonProdReduction',
        constraintEnableLabel: 'Разрешить уменьшение стендов'
    },
    {
        id: 'reliability',
        title: 'Надёжность и SLA',
        description: 'Компромиссы по доступности и бизнес-непрерывности.',
        constraintKey: 'allowReliabilityTradeoff',
        constraintEnableLabel: 'Разрешить снижение SLA'
    },
    {
        id: 'retention',
        title: 'Данные и хранение',
        description: 'Сроки хранения резервных копий, логов и архивных данных.',
        constraintKey: 'allowRetentionReduction',
        constraintEnableLabel: 'Разрешить уменьшение retention'
    },
    {
        id: 'ai',
        title: 'AI / RAG',
        description: 'Объём AI-запросов, RAG-корпуса и эмбеддингов.',
        constraintKey: 'allowAiReduction',
        constraintEnableLabel: 'Разрешить уменьшение AI / RAG'
    },
    {
        id: 'risk',
        title: 'Риски и резервы',
        description: 'Буферы и резервы, уменьшающие неопределённость сметы.',
        constraintKey: 'allowRiskBufferReduction',
        constraintEnableLabel: 'Разрешить снижение риск-буферов'
    },
    {
        id: 'planning',
        title: 'Горизонт планирования',
        description: 'Период, на который строится оценка роста и затрат.',
        constraintKey: null,
        constraintEnableLabel: null
    }
]);

export const CATEGORY_TO_GROUP = Object.freeze({
    non_prod:    'infrastructure',
    reliability: 'reliability',
    retention:   'retention',
    ai:          'ai',
    risk:        'risk',
    planning:    'planning'
});

export const HIGH_RISK_LEVER_SPEC_IDS = Object.freeze([
    'sla_target',
    'k_contingency',
    'k_schedule_shift'
]);

export const RECOMPUTE_DEBOUNCE_MS = 200;

const STAND_RATIO_CONSEQUENCE = (stand) =>
    stand === 'LOAD'
        ? 'Стенд НТ хуже приближен к ПРОМ, ниже уверенность перед релизом.'
        : 'Непромышленная среда дешевле, но тестирование хуже отражает промышленную конфигурацию.';

export const LEVER_SPECS = Object.freeze([
    {
        id: 'load_ratio',
        title: 'Уменьшить стенд НТ',
        category: 'non_prod',
        constraintKey: 'allowNonProdReduction',
        kind: 'settings_ratio',
        stand: 'LOAD',
        risk: 'low',
        consequence: STAND_RATIO_CONSEQUENCE('LOAD'),
        focusFieldId: 'setting:standSizeRatio.LOAD',
        multipliers: { conservative: 0.875, ambitious: 0.75, extreme: 0.5 },
        floor: 0.30
    },
    {
        id: 'psi_ratio',
        title: 'Уменьшить ПСИ-стенд',
        category: 'non_prod',
        constraintKey: 'allowNonProdReduction',
        kind: 'settings_ratio',
        stand: 'PSI',
        risk: 'low',
        consequence: STAND_RATIO_CONSEQUENCE('PSI'),
        focusFieldId: 'setting:standSizeRatio.PSI',
        multipliers: { conservative: 0.9, ambitious: 0.75, extreme: 0.5 },
        floor: 0.20
    },
    {
        id: 'ift_ratio',
        title: 'Уменьшить ИФТ-стенд',
        category: 'non_prod',
        constraintKey: 'allowNonProdReduction',
        kind: 'settings_ratio',
        stand: 'IFT',
        risk: 'low',
        consequence: STAND_RATIO_CONSEQUENCE('IFT'),
        focusFieldId: 'setting:standSizeRatio.IFT',
        multipliers: { conservative: 0.9, ambitious: 0.75, extreme: 0.5 },
        floor: 0.15
    },
    {
        id: 'dev_ratio',
        title: 'Уменьшить DEV-стенд',
        category: 'non_prod',
        constraintKey: 'allowNonProdReduction',
        kind: 'settings_ratio',
        stand: 'DEV',
        risk: 'low',
        consequence: STAND_RATIO_CONSEQUENCE('DEV'),
        focusFieldId: 'setting:standSizeRatio.DEV',
        multipliers: { conservative: 0.9, ambitious: 0.75, extreme: 0.5 },
        floor: 0.10
    },
    {
        id: 'buffer_task',
        title: 'Снизить буфер задачи',
        category: 'risk',
        constraintKey: 'allowRiskBufferReduction',
        kind: 'settings_field',
        field: 'bufferTask',
        risk: 'medium',
        consequence: 'Меньше резерв на неопределённость задач — риск переноса в будущее.',
        focusFieldId: 'setting:bufferTask',
        multipliers: { conservative: 0.9, ambitious: 0.75, extreme: 0.5 },
        floor: 0.0
    },
    {
        id: 'buffer_project',
        title: 'Снизить проектный буфер',
        category: 'risk',
        constraintKey: 'allowRiskBufferReduction',
        kind: 'settings_field',
        field: 'bufferProject',
        risk: 'medium',
        consequence: 'Меньше резерв на изменение требований — риск переноса в будущее.',
        focusFieldId: 'setting:bufferProject',
        multipliers: { conservative: 0.9, ambitious: 0.75, extreme: 0.5 },
        floor: 0.0
    },
    {
        id: 'k_contingency',
        title: 'Снизить непредвиденные расходы',
        category: 'risk',
        constraintKey: 'allowRiskBufferReduction',
        kind: 'settings_field',
        field: 'kContingency',
        risk: 'medium',
        consequence: 'Меньше подушка на непредвиденное — выше стресс при отклонениях.',
        focusFieldId: 'setting:kContingency',
        multipliers: { conservative: 0.9, ambitious: 0.7, extreme: 0.5 },
        floor: 0.0
    },
    {
        id: 'k_schedule_shift',
        title: 'Снизить запас на сдвиг расписания',
        category: 'risk',
        constraintKey: 'allowRiskBufferReduction',
        kind: 'settings_field',
        field: 'kScheduleShift',
        risk: 'medium',
        consequence: 'Меньше запас на сдвиг старта — выше риск опоздать с поставкой.',
        focusFieldId: 'setting:kScheduleShift',
        multipliers: { conservative: 0.9, ambitious: 0.7, extreme: 0.5 },
        floor: 0.0
    },
    {
        id: 'planning_horizon',
        title: 'Сократить горизонт планирования',
        category: 'planning',
        constraintKey: null,
        kind: 'settings_step',
        field: 'planningHorizonYears',
        risk: 'medium',
        consequence: 'Оценка покрывает меньше будущего роста; пересмотр через 1–2 года вероятнее.',
        focusFieldId: 'setting:planningHorizonYears',
        skipInTiers: [PLAN_IDS.CONSERVATIVE],
        appliesIf: (calc) => Number(calc?.settings?.planningHorizonYears) > 3,
        proposedValue: (cur, tierId) => {
            if (tierId === PLAN_IDS.AMBITIOUS) return Math.max(3, cur - 1);
            if (tierId === PLAN_IDS.EXTREME)   return Math.max(3, cur - 2);
            return cur;
        }
    },
    {
        id: 'sla_target',
        title: 'Снизить целевой SLA',
        category: 'reliability',
        constraintKey: 'allowReliabilityTradeoff',
        kind: 'answer_options_step',
        field: 'sla_target',
        risk: 'high',
        consequence: 'Выше допустимое время простоя; ниже требования к резервированию и непрерывности.',
        focusFieldId: 'answer:sla_target',
        skipInTiers: [PLAN_IDS.CONSERVATIVE],
        options: [93.0, 95.0, 96.0, 98.0, 98.5, 99.0, 99.5, 99.9, 99.95, 99.99],
        steps: { ambitious: 1, extreme: 2 },
        floor: 99.0
    },
    {
        id: 'backup_retention',
        title: 'Сократить срок хранения бэкапов',
        category: 'retention',
        constraintKey: 'allowRetentionReduction',
        kind: 'answer_options_step',
        field: 'backup_retention_days',
        risk: 'medium',
        consequence: 'Меньше глубина восстановления — выше риск потери нужной точки.',
        focusFieldId: 'answer:backup_retention_days',
        options: [7, 14, 30, 90, 180, 365, 1095, 2555],
        steps: { conservative: 1, ambitious: 2, extreme: 3 },
        floor: 30,
        complianceFloor: 90
    },
    {
        id: 'ai_output_tokens',
        title: 'Сократить длину ответов модели',
        category: 'ai',
        constraintKey: 'allowAiReduction',
        kind: 'answer_field',
        field: 'ai_avg_output_tokens',
        risk: 'low',
        consequence: 'Ответы модели могут стать короче и менее подробными.',
        focusFieldId: 'answer:ai_avg_output_tokens',
        appliesIf: (calc) => calc?.answers?.ai_llm_used === true,
        multipliers: { conservative: 0.85, ambitious: 0.65, extreme: 0.4 },
        floor: 100
    },
    {
        id: 'rag_corpus',
        title: 'Сократить корпус RAG',
        category: 'ai',
        constraintKey: 'allowAiReduction',
        kind: 'answer_field',
        field: 'rag_corpus_size_gb',
        risk: 'medium',
        consequence: 'ИИ хуже использует корпоративную базу знаний; качество ответов по внутренним данным снижается.',
        focusFieldId: 'answer:rag_corpus_size_gb',
        skipInTiers: [PLAN_IDS.CONSERVATIVE],
        appliesIf: (calc) => calc?.answers?.rag_needed === true,
        multipliers: { ambitious: 0.7, extreme: 0.5 },
        floor: 1
    },
    {
        id: 'rag_embeddings',
        title: 'Сократить объём эмбеддингов RAG',
        category: 'ai',
        constraintKey: 'allowAiReduction',
        kind: 'answer_field',
        field: 'rag_embeddings_million',
        risk: 'medium',
        consequence: 'Меньше векторов индекса — хуже покрытие запросов внутренними источниками.',
        focusFieldId: 'answer:rag_embeddings_million',
        skipInTiers: [PLAN_IDS.CONSERVATIVE],
        appliesIf: (calc) => calc?.answers?.rag_needed === true,
        multipliers: { ambitious: 0.7, extreme: 0.5 },
        floor: 0.1
    }
]);
