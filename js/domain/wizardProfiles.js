/**
 * Quick Start Wizard — отраслевая матрица предзаполнения опросника.
 *
 * 7 макро-вопросов wizard'а → 87 полей детального опросника.
 *
 * АРХИТЕКТУРА (этап 14, 2026-05-08):
 *
 *   Две ортогональные оси:
 *     • product_type — КАК продукт потребляется (internal / b2b / b2c / b2g).
 *       Драйвит: pcu_share, peak_duration_hours, каналы коммуникации (push/sms/email),
 *       compliance defaults (b2g всегда строже, internal мягче).
 *     • industry — В КАКОЙ ВЕРТИКАЛИ продукт работает (corporate / edtech / fintech / ...).
 *       Драйвит: SLA recommendation, hot_data_share_percent, file_storage volumes,
 *       RAG settings, AI defaults, sector-specific compliance (152-ФЗ + ГОСТ для fintech).
 *
 *   Третья перпендикулярная ось — scale (xs/s/m/l/xl) — масштабирует
 *   количественные параметры (RPS, microservices, БД).
 *
 *   Compliance — функция от ВСЕХ трёх осей + явных флагов pdn / ai_used.
 *
 * ИНВАРИАНТЫ:
 *
 *   1. Pure-функция wizardToAnswers(input) → {answers, answersMeta} без побочных
 *      эффектов. Не читает store, не пишет в localStorage. Тестируется юнитами.
 *   2. Каждое значение в answers имеет parallel запись в answersMeta с указанием
 *      источника (profile / scale / sla_preset / default). Это позволяет UI
 *      показать badge «Из профиля» и реализовать reset-механику.

 *   3. Незаполненные wizard'ом поля (29 из 87 для стандартного B2B-профиля без AI;
 *      число зависит от профиля) НЕ кладутся в answers — они получат default
 *      из seed.js при расчёте. Так legacy-расчёты совместимы.
 *   4. Все таблицы Object.freeze'ены — никаких runtime-мутаций.
 *
 * Связанные документы:
 *   - WIZARD_PROFILES.md — полное design-описание матрицы и сценариев.
 *   - DECISIONS.md — журнал решений, запись 14.U1.
 */

import { STAND_IDS } from '../utils/constants.js';

// ============================================================================
// 0. SHORT LABELS — короткие подписи wizard-параметров для UI (баннер на дашборде).
// Длинные подписи живут в quickStartModal.js (там нужны полные пояснения для
// 7 макро-вопросов; здесь — компактные для inline-баннера и tooltip'ов).
// ============================================================================

export const PRODUCT_TYPE_LABELS = Object.freeze({
    internal: 'Internal',
    b2b:      'B2B',
    b2c:      'B2C',
    b2g:      'B2G'
});

export const INDUSTRY_LABELS = Object.freeze({
    corporate: 'Corporate',
    edtech:    'EdTech',
    fintech:   'FinTech',
    consumer:  'Consumer'
});

export const SCALE_LABELS = Object.freeze({
    xs: 'до 1k',
    s:  'до 10k',
    m:  'до 100k',
    l:  'до 1M',
    xl: 'свыше 1M'
});

export const GEOGRAPHY_LABELS = Object.freeze({
    ru:     'Россия',
    ru_cis: 'Россия + СНГ',
    global: 'Глобально'
});

export const ACTIVITY_LABELS = Object.freeze({
    very_low: 'Очень низкая',
    low:      'Низкая',
    medium:   'Средняя',
    high:     'Высокая'
});

// ============================================================================
// 1. SCALE RULES — общие числовые драйверы по 5 масштабам
// ============================================================================

/**
 * Базовые значения параметров для каждого масштаба.
 * Индустриальный профиль может умножать/заменять эти значения.
 */
export const SCALE_RULES = Object.freeze({
    xs: Object.freeze({  // < 1k registered users — стартап-MVP
        registered_users_total: 500,
        dau_share_of_registered_percent: 30,
        peak_rps: 10,
        microservices_count: 1,
        async_workers_count: 1,
        db_count: 1,
        db_size_initial_gb: 10,
        db_growth_gb_month: 1,
        db_replicas_count: 0,
        cache_size_gb: 2,
        email_per_month: 1000,
        sms_per_month: 0,
        push_per_month: 10000,
        external_api_calls_per_month: 10000,
        traffic_egress_tb_month: 0.1,
        traffic_ingress_tb_month: 0.05,
        avg_request_size_kb: 4,
        avg_response_size_kb: 16
    }),
    s: Object.freeze({  // < 10k — small B2B / нишевой B2C
        registered_users_total: 5000,
        dau_share_of_registered_percent: 25,
        peak_rps: 50,
        microservices_count: 3,
        async_workers_count: 2,
        db_count: 1,
        db_size_initial_gb: 50,
        db_growth_gb_month: 5,
        db_replicas_count: 1,
        cache_size_gb: 8,
        email_per_month: 10000,
        sms_per_month: 1000,
        push_per_month: 100000,
        external_api_calls_per_month: 100000,
        traffic_egress_tb_month: 1,
        traffic_ingress_tb_month: 0.5,
        avg_request_size_kb: 4,
        avg_response_size_kb: 16
    }),
    m: Object.freeze({  // < 100k — стандарт SMB
        registered_users_total: 50000,
        dau_share_of_registered_percent: 20,
        peak_rps: 200,
        microservices_count: 5,
        async_workers_count: 3,
        db_count: 2,
        db_size_initial_gb: 200,
        db_growth_gb_month: 20,
        db_replicas_count: 1,
        cache_size_gb: 16,
        email_per_month: 100000,
        sms_per_month: 10000,
        push_per_month: 1000000,
        external_api_calls_per_month: 1000000,
        traffic_egress_tb_month: 5,
        traffic_ingress_tb_month: 2,
        avg_request_size_kb: 4,
        avg_response_size_kb: 16
    }),
    l: Object.freeze({  // < 1M — enterprise / mid-B2C
        registered_users_total: 500000,
        dau_share_of_registered_percent: 15,
        peak_rps: 1000,
        microservices_count: 10,
        async_workers_count: 5,
        db_count: 3,
        db_size_initial_gb: 1000,
        db_growth_gb_month: 100,
        db_replicas_count: 2,
        cache_size_gb: 32,
        email_per_month: 1000000,
        sms_per_month: 100000,
        push_per_month: 10000000,
        external_api_calls_per_month: 10000000,
        traffic_egress_tb_month: 30,
        traffic_ingress_tb_month: 10,
        avg_request_size_kb: 4,
        avg_response_size_kb: 16
    }),
    xl: Object.freeze({  // > 1M — крупный enterprise / mass B2C
        registered_users_total: 2000000,
        dau_share_of_registered_percent: 10,
        peak_rps: 5000,
        microservices_count: 20,
        async_workers_count: 10,
        db_count: 5,
        db_size_initial_gb: 5000,
        db_growth_gb_month: 500,
        db_replicas_count: 3,
        cache_size_gb: 64,
        email_per_month: 5000000,
        sms_per_month: 500000,
        push_per_month: 50000000,
        external_api_calls_per_month: 50000000,
        traffic_egress_tb_month: 150,
        traffic_ingress_tb_month: 50,
        avg_request_size_kb: 4,
        avg_response_size_kb: 16
    })
});

// ============================================================================
// 2. PCU_SHARE — индустриальная формула pcu_target
// ============================================================================

/**
 * Доля DAU, одновременно использующих продукт в пик. Зависит от типа
 * потребления (внутренний — синхронные часы; B2C — вечерние пики; B2G —
 * распределённый).
 *
 * pcu_target = registered_users × (dau_share/100) × pcu_share
 */
export const PCU_SHARE_BY_TYPE = Object.freeze({
    internal: Object.freeze({ xs: 0.30, s: 0.25, m: 0.20, l: 0.15, xl: 0.10 }),
    b2b:      Object.freeze({ xs: 0.04, s: 0.05, m: 0.05, l: 0.04, xl: 0.03 }),
    b2c:      Object.freeze({ xs: 0.04, s: 0.07, m: 0.10, l: 0.12, xl: 0.15 }),
    b2g:      Object.freeze({ xs: 0.05, s: 0.05, m: 0.05, l: 0.05, xl: 0.05 })
});

// ============================================================================
// 3. SLA_PRESETS — таблица «SLA → 5 связанных полей»
// ============================================================================

/**
 * При выборе sla_target автоматически выставляются:
 *   - georedundancy_required
 *   - rto_hours
 *   - rpo_minutes
 *   - maintenance_window_hours_month
 *   - dr_drills_per_year
 *
 * Уровни округлены до канонических SLA-значений рынка. Промежуточные
 * значения округляются вверх (98.5% → пресет 99.0).
 */
export const SLA_PRESETS = Object.freeze({
    93:    Object.freeze({ georedundancy_required: false, rto_hours: 24,   rpo_minutes: 1440, maintenance_window_hours_month: 8,   dr_drills_per_year: 0 }),
    95:    Object.freeze({ georedundancy_required: false, rto_hours: 24,   rpo_minutes: 1440, maintenance_window_hours_month: 8,   dr_drills_per_year: 0 }),
    96:    Object.freeze({ georedundancy_required: false, rto_hours: 8,    rpo_minutes: 240,  maintenance_window_hours_month: 4,   dr_drills_per_year: 1 }),
    98:    Object.freeze({ georedundancy_required: false, rto_hours: 8,    rpo_minutes: 240,  maintenance_window_hours_month: 4,   dr_drills_per_year: 1 }),
    99.0:  Object.freeze({ georedundancy_required: false, rto_hours: 4,    rpo_minutes: 60,   maintenance_window_hours_month: 2,   dr_drills_per_year: 2 }),
    99.5:  Object.freeze({ georedundancy_required: false, rto_hours: 2,    rpo_minutes: 30,   maintenance_window_hours_month: 1,   dr_drills_per_year: 2 }),
    99.9:  Object.freeze({ georedundancy_required: true,  rto_hours: 1,    rpo_minutes: 5,    maintenance_window_hours_month: 0.5, dr_drills_per_year: 4 }),
    99.95: Object.freeze({ georedundancy_required: true,  rto_hours: 0.5,  rpo_minutes: 1,    maintenance_window_hours_month: 0,   dr_drills_per_year: 4 }),
    99.99: Object.freeze({ georedundancy_required: true,  rto_hours: 0.25, rpo_minutes: 0.5,  maintenance_window_hours_month: 0,   dr_drills_per_year: 6 })
});

/**
 * Округлить произвольный SLA-уровень до ближайшего канонического вверх.
 * Например 97 → 98, 99.3 → 99.5, 99.93 → 99.95.
 */
export function snapSlaToPreset(sla) {
    const levels = Object.keys(SLA_PRESETS).map(Number).sort((a, b) => a - b);
    for (const lvl of levels) {
        if (sla <= lvl + 0.001) return lvl;
    }
    return 99.99;  // hard cap
}

// ============================================================================
// 4. INDUSTRY_PROFILES — overrides от вертикали (отрасли)
// ============================================================================

/**
 * Industry-specific defaults и multipliers.
 *
 * `defaults` — фиксированные значения для всех масштабов.
 * `scaleMultipliers` — коэффициенты к SCALE_RULES (умножаются).
 * `scaleOverrides` — фиксированные override'ы для конкретных масштабов
 *   (когда множитель не подходит — например, file_storage_volume_tb по таблице).
 * `ai` — AI-блок (применяется только если wz_ai_used = true).
 *
 * MVP: 4 отрасли — corporate / edtech / fintech / consumer.
 *
 * ВАЖНО ОБ ОРТОГОНАЛЬНОСТИ:
 *   industry — это ВЕРТИКАЛЬ (предметная область), а НЕ тип потребления.
 *   Например, `corporate` (CRM/ERP/HR) обычно встречается с product_type=b2b,
 *   но `consumer` (соцсети/маркетплейсы) — обычно с b2c. При этом FinTech
 *   может быть и b2b (платёжные процессоры), и b2c (мобильный банкинг),
 *   и b2g (ФНС-интеграции). Engine поддерживает любую комбинацию.
 */
export const INDUSTRY_PROFILES = Object.freeze({
    corporate: Object.freeze({
        label: 'Корпоративные сервисы',
        description: 'CRM, ERP, HR-tech, биллинг, корпоративные порталы — горизонтальные B2B-продукты',
        defaults: Object.freeze({
            ram_per_vcpu_ratio: 4,
            hot_data_share_percent: 30,
            sla_target: 98,
            backup_retention_days: 30,
            seasonal_activity: false,
            realtime_required: false,
            file_storage_growth_tb_year: 0.5
        }),
        scaleMultipliers: Object.freeze({
            microservices_count: 1.0,
            db_count: 1.0,
            cache_size_gb: 1.0,
            traffic_egress_tb_month: 1.0
        }),
        scaleOverrides: Object.freeze({
            file_storage_volume_tb: Object.freeze({ xs: 0.1, s: 0.5, m: 5, l: 50, xl: 200 })
        }),
        ai: Object.freeze({
            ai_users_share: 20,
            ai_requests_per_user_day: 10,
            ai_avg_input_tokens: 2000,
            ai_avg_output_tokens: 300,
            ai_caching_share: 30,
            ai_model_tier: 'medium',
            rag_needed: false,
            rag_corpus_size_gb: 5,
            rag_refresh_frequency: 'monthly',
            ai_safety_layer: false,
            ai_data_sensitivity: 'low'
        })
    }),

    edtech: Object.freeze({
        label: 'EdTech / образование',
        description: 'Онлайн-курсы, LMS, репетиторство, тренажёры',
        defaults: Object.freeze({
            ram_per_vcpu_ratio: 4,
            hot_data_share_percent: 50,
            sla_target: 98,
            backup_retention_days: 90,
            seasonal_activity: true,
            peak_months: '[8, 9, 12]',  // back-to-school + winter session
            realtime_required: true,
            file_storage_growth_tb_year: 5
        }),
        scaleMultipliers: Object.freeze({
            microservices_count: 0.7,  // EdTech часто на старте = монолит
            cache_size_gb: 1.5,         // контент-кэш
            traffic_egress_tb_month: 2.0  // видео-стриминг
        }),
        scaleOverrides: Object.freeze({
            file_storage_volume_tb: Object.freeze({ xs: 0.5, s: 5, m: 50, l: 500, xl: 2000 })  // видео + материалы
        }),
        ai: Object.freeze({
            ai_users_share: 40,
            ai_requests_per_user_day: 20,
            ai_avg_input_tokens: 2500,
            ai_avg_output_tokens: 500,
            ai_caching_share: 40,
            ai_model_tier: 'medium',
            rag_needed: true,
            rag_corpus_size_gb_by_scale: Object.freeze({ xs: 10, s: 10, m: 50, l: 200, xl: 500 }),
            rag_refresh_frequency: 'monthly',
            ai_safety_layer: false,
            ai_data_sensitivity: 'low'
        })
    }),

    fintech: Object.freeze({
        label: 'Финансы / FinTech',
        description: 'Банкинг, инвест-платформы, кредиты, P2P-финансы, трейдинг',
        defaults: Object.freeze({
            ram_per_vcpu_ratio: 8,  // СУБД-heavy
            hot_data_share_percent: 40,
            sla_target: 99.9,  // financial-grade
            backup_retention_days: 365,
            seasonal_activity: false,
            realtime_required: true,
            file_storage_growth_tb_year: 2
        }),
        scaleMultipliers: Object.freeze({
            microservices_count: 1.5,  // compliance boundaries
            db_count: 1.5,             // транзакции / профили / документы
            cache_size_gb: 1.0,
            email_per_month: 2.0,      // OTP + выписки + уведомления
            sms_per_month: 5.0,        // OTP — главный канал
            traffic_egress_tb_month: 0.7  // меньше чем SaaS — нет тяжёлого контента
        }),
        scaleOverrides: Object.freeze({
            file_storage_volume_tb: Object.freeze({ xs: 0.2, s: 1, m: 10, l: 100, xl: 500 }),
            db_replicas_count: Object.freeze({ xs: 1, s: 2, m: 2, l: 3, xl: 4 })  // финансы требуют реплик
        }),
        ai: Object.freeze({
            ai_users_share: 15,
            ai_requests_per_user_day: 8,
            ai_avg_input_tokens: 3000,
            ai_avg_output_tokens: 400,
            ai_caching_share: 25,
            ai_model_tier: 'large',  // финансы требуют лучшего качества
            rag_needed: true,
            rag_corpus_size_gb_by_scale: Object.freeze({ xs: 5, s: 5, m: 20, l: 100, xl: 300 }),
            rag_refresh_frequency: 'weekly',  // регламенты меняются быстрее
            ai_safety_layer: true,
            ai_data_sensitivity: 'high'
        })
    }),

    consumer: Object.freeze({
        label: 'Потребительские сервисы (массовый B2C)',
        description: 'Соцсети, маркетплейсы, медиа-платформы, геймдев, контент-сервисы для широкой аудитории',
        defaults: Object.freeze({
            ram_per_vcpu_ratio: 4,
            hot_data_share_percent: 60,  // свежий контент = горячий
            sla_target: 98,
            backup_retention_days: 30,
            seasonal_activity: false,
            realtime_required: true,     // чаты, уведомления, live-стримы
            file_storage_growth_tb_year: 20  // UGC растёт быстро
        }),
        scaleMultipliers: Object.freeze({
            microservices_count: 1.3,    // feed / search / recommendation / social graph
            db_count: 1.3,                // профили / контент / аналитика — разные хранилища
            cache_size_gb: 2.0,           // агрессивное кэширование критично для B2C
            traffic_egress_tb_month: 5.0  // просмотры контента, медиа-стриминг
        }),
        scaleOverrides: Object.freeze({
            // UGC-storage — главный потребитель file storage в consumer-вертикали
            file_storage_volume_tb: Object.freeze({ xs: 1, s: 10, m: 100, l: 2000, xl: 20000 })
        }),
        ai: Object.freeze({
            ai_users_share: 30,             // рекомендации / поиск / умный фид
            ai_requests_per_user_day: 15,   // рекомендации каждое посещение
            ai_avg_input_tokens: 1500,
            ai_avg_output_tokens: 300,
            ai_caching_share: 50,            // высокий кэш для повторяющихся запросов
            ai_model_tier: 'medium',
            rag_needed: true,                // поиск по контенту
            rag_corpus_size_gb_by_scale: Object.freeze({ xs: 20, s: 20, m: 100, l: 1000, xl: 5000 }),
            rag_refresh_frequency: 'daily',  // свежий контент должен индексироваться сразу
            ai_safety_layer: true,           // модерация UGC + AI-output обязательна для масс-аудитории
            ai_data_sensitivity: 'medium'
        })
    })
});

// ============================================================================
// 5. PRODUCT_TYPE_OVERRIDES — overrides от типа потребления продукта
// ============================================================================

/**
 * Product-type-specific overrides — драйвят каналы коммуникации (push/sms/email),
 * peak duration, и compliance defaults (b2g жёстче, internal мягче).
 */
export const PRODUCT_TYPE_OVERRIDES = Object.freeze({
    internal: Object.freeze({
        defaults: Object.freeze({
            peak_duration_hours: 4,    // рабочие часы, синхронный пик
            audience_geography: 'ru'   // обычно внутрироссийский периметр
        }),
        channelMultipliers: Object.freeze({
            email_per_month: 0.5,      // меньше уведомлений сотрудникам
            sms_per_month: 0.1,
            push_per_month: 0.5
        })
    }),
    b2b: Object.freeze({
        defaults: Object.freeze({
            peak_duration_hours: 4    // bizhrs
        }),
        channelMultipliers: Object.freeze({
            email_per_month: 1.5,
            sms_per_month: 0.5,
            push_per_month: 1.0
        })
    }),
    b2c: Object.freeze({
        defaults: Object.freeze({
            peak_duration_hours: 6     // вечерние пики 18:00–24:00 длиннее
        }),
        channelMultipliers: Object.freeze({
            email_per_month: 3.0,      // welcome + retention кампании
            sms_per_month: 0.5,        // push заменяет SMS в B2C
            push_per_month: 50.0,      // push — ключевой retention-канал
            external_api_calls_per_month: 2.0  // соц-логины, платежи, аналитика
        })
    }),
    b2g: Object.freeze({
        defaults: Object.freeze({
            peak_duration_hours: 6,    // распределённая нагрузка по госуслугам
            audience_geography: 'ru'   // госуслуги — российский периметр
        }),
        channelMultipliers: Object.freeze({
            email_per_month: 2.0,
            sms_per_month: 2.0,        // SMS-уведомления о госуслугах
            push_per_month: 0.5
        })
    })
});

// ============================================================================
// 6. COMPLIANCE_RULES — флаги безопасности от (type, industry, scale, pdn)
// ============================================================================

const SCALE_ORDER = ['xs', 's', 'm', 'l', 'xl'];

/**
 * Сравнить два scale-уровня. Возвращает true, если `actual` >= `threshold`.
 */
function scaleAtLeast(actual, threshold) {
    return SCALE_ORDER.indexOf(actual) >= SCALE_ORDER.indexOf(threshold);
}

/**
 * Compute compliance flags for a given combination.
 *
 * @param {Object} input - { product_type, industry, scale, pdn }
 * @returns {Object} compliance answers (flags + counts)
 */
export function computeCompliance({ product_type, industry, scale, pdn }) {
    const isFin = industry === 'fintech';
    const isEdu = industry === 'edtech';
    const isB2C = product_type === 'b2c';
    const isB2G = product_type === 'b2g';
    const isInternal = product_type === 'internal';
    const ge = (lvl) => scaleAtLeast(scale, lvl);
    /* §5.1: для internal внешний периметр отсутствует — DDoS/WAF/external pentest
       НЕ требуются, кроме случаев когда индустрия forsefully их требует (fintech). */
    const hasPublicSurface = !isInternal;

    return {
        // ФЗ-152
        pdn_152fz: pdn || isFin || isB2G,
        pdn_category: isFin ? 2 : (isEdu && pdn ? 2 : (pdn ? 3 : null)),

        // Сертификации
        fstec_certification_required: isFin || isB2G,
        iso_27001_required: isFin,

        // Шифрование и защита (waf/ddos — только при публичном периметре)
        encryption_at_rest: pdn || isFin || isB2G,
        waf_required: isFin || isB2G ||
                      (hasPublicSurface && (isB2C || ge('m') || (isEdu && ge('s')))),
        ddos_protection_required: isFin ||
                      (hasPublicSurface && (ge('l') || (isB2C && ge('m')) || (isEdu && ge('m')))),
        siem_integration_required: isFin || ge('l'),
        dlp_required: isFin,
        audit_logging_required: isFin || isB2G || ge('m'),
        // §5.1: b2g всегда georedundancy (госрезерв обязателен по нормативам).
        // Иначе — управляется SLA_PRESETS через wizardToAnswers (compliance применяется
        // ПОСЛЕ sla_preset, поэтому здесь true перебивает preset-false для b2g).
        georedundancy_required: isFin || isB2G,

        // Интеграции (для compliance — sso/payment/antifraud/edo)
        sso_required: isFin || isB2C || ge('m'),
        payment_gateway: isFin || (isB2C && ge('m')) || (product_type === 'b2b' && ge('l')),
        antifraud_required: isFin,
        edo_required: isFin && ge('m'),  // ЭДО для финтеха среднего и выше

        // Тестирование (external pentest — только при публичном периметре)
        pentest_external: isFin ||
                      (hasPublicSurface && (ge('m') || (isEdu && ge('s')) || (isB2C && ge('m')))),
        pentest_internal: isFin || ge('l'),
        load_test_before_prod: isFin || ge('m'),
        pentest_per_year: isFin ? 2 :
                      (hasPublicSurface && (ge('m') || (isEdu && ge('s')) || (isB2C && ge('m'))) ? 1 : 0),
        security_audit_per_year: isFin ? 1 : (ge('m') ? 1 : 0),
        load_test_per_year: ge('m') ? 2 : (ge('s') ? 1 : 0)
    };
}

// ============================================================================
// 7. wizardToAnswers — главный engine
// ============================================================================

/**
 * Перевести 7 wizard-ответов в полный набор answers + answersMeta.
 *
 * @param {Object} wizard - {
 *     product_type: 'internal' | 'b2b' | 'b2c' | 'b2g',
 *     industry: 'corporate' | 'edtech' | 'fintech',
 *     scale: 'xs' | 's' | 'm' | 'l' | 'xl',
 *     geography: 'ru' | 'ru_cis' | 'global',
 *     pdn: boolean,
 *     activity: 'very_low' | 'low' | 'medium' | 'high',
 *     ai_used: boolean
 * }
 * @returns {{ answers: Object, answersMeta: Object }}
 *
 * answers — словарь Q.id → значение, для применения в calc.answers.
 * answersMeta — параллельный словарь Q.id → { source, profileId } для UI-бейджей.
 */
export function wizardToAnswers(wizard) {
    const {
        product_type,
        industry,
        scale,
        geography,
        pdn,
        activity,
        ai_used
    } = wizard;

    // Базовые драйверы из scale
    const scaleBase = SCALE_RULES[scale];
    if (!scaleBase) {
        throw new Error(`Unknown scale: ${scale}. Expected one of ${SCALE_ORDER.join(', ')}`);
    }

    const profile = INDUSTRY_PROFILES[industry];
    if (!profile) {
        throw new Error(`Unknown industry: ${industry}. Available: ${Object.keys(INDUSTRY_PROFILES).join(', ')}`);
    }

    const typeOverride = PRODUCT_TYPE_OVERRIDES[product_type];
    if (!typeOverride) {
        throw new Error(`Unknown product_type: ${product_type}. Expected: internal / b2b / b2c / b2g`);
    }

    const answers = {};
    const meta = {};

    function set(id, value, source, extra = {}) {
        if (value === undefined || value === null) return;
        answers[id] = value;
        meta[id] = { source, ...extra };
    }

    // --- Wizard inputs themselves (для retroactive перерасчёта)
    set('product_type', product_type, 'wizard');
    set('audience_geography', geography, 'wizard');

    // --- Scale-driven базовые поля
    Object.entries(scaleBase).forEach(([id, value]) => {
        set(id, value, 'scale');
    });

    // --- Industry overrides: defaults
    Object.entries(profile.defaults).forEach(([id, value]) => {
        set(id, value, 'profile', { profileId: industry });
    });

    // --- Industry overrides: scale multipliers
    if (profile.scaleMultipliers) {
        Object.entries(profile.scaleMultipliers).forEach(([id, mul]) => {
            const baseValue = scaleBase[id];
            if (typeof baseValue === 'number') {
                const adjusted = (id === 'microservices_count' || id === 'db_count'
                    || id === 'db_replicas_count' || id === 'async_workers_count')
                    ? Math.max(1, Math.round(baseValue * mul))
                    : baseValue * mul;
                set(id, adjusted, 'profile', { profileId: industry });
            }
        });
    }

    // --- Industry overrides: scale-specific
    if (profile.scaleOverrides) {
        Object.entries(profile.scaleOverrides).forEach(([id, byScale]) => {
            if (byScale[scale] !== undefined) {
                set(id, byScale[scale], 'profile', { profileId: industry });
            }
        });
    }

    // --- Product-type defaults (peak_duration_hours, geography fallback)
    Object.entries(typeOverride.defaults).forEach(([id, value]) => {
        // Не перезаписываем wizard-input geography (если уже задан)
        if (id === 'audience_geography' && answers.audience_geography) return;
        set(id, value, 'product_type');
    });

    // --- Product-type channel multipliers (email/sms/push)
    Object.entries(typeOverride.channelMultipliers).forEach(([id, mul]) => {
        if (typeof answers[id] === 'number') {
            answers[id] = Math.max(0, Math.round(answers[id] * mul));
            meta[id] = { source: 'product_type' };
        }
    });

    // --- Geography multipliers (egress / external API)
    if (geography === 'global') {
        ['traffic_egress_tb_month', 'external_api_calls_per_month'].forEach(id => {
            if (typeof answers[id] === 'number') {
                answers[id] = Math.round(answers[id] * 3);
                meta[id] = { source: 'geography' };
            }
        });
    } else if (geography === 'ru_cis') {
        ['traffic_egress_tb_month'].forEach(id => {
            if (typeof answers[id] === 'number') {
                answers[id] = Math.round(answers[id] * 1.5 * 10) / 10;
                meta[id] = { source: 'geography' };
            }
        });
    }

    // --- Activity multiplier для DAU
    /* very_low — очень редкие пользовательские визиты (отчётность раз в месяц,
       сезонные процессы): множитель 0.25 = вдвое меньше low. Это снижает
       DAU-долю и пиковую нагрузку — для таких продуктов инфраструктура может
       быть рассчитана на минимальный capacity (например, ежемесячные финансовые
       отчёты, ежеквартальные ревью). */
    const activityMul = { very_low: 0.25, low: 0.5, medium: 1.0, high: 2.0 }[activity] ?? 1.0;
    if (activityMul !== 1.0 && typeof answers.dau_share_of_registered_percent === 'number') {
        const adj = Math.min(100, Math.max(1, Math.round(answers.dau_share_of_registered_percent * activityMul)));
        set('dau_share_of_registered_percent', adj, 'activity');
    }

    // --- pcu_target по индустриальной формуле
    const pcuShare = PCU_SHARE_BY_TYPE[product_type]?.[scale] ?? 0.05;
    const dau = (answers.registered_users_total || 0) * (answers.dau_share_of_registered_percent || 0) / 100;
    const pcu = Math.round(dau * pcuShare);
    set('pcu_target', pcu, 'derived');

    // --- avg_rps = 0.4 × peak_rps (универсально)
    if (typeof answers.peak_rps === 'number') {
        set('avg_rps', Math.round(answers.peak_rps * 0.4), 'derived');
    }

    // --- users_total = registered × 1.5
    if (typeof answers.registered_users_total === 'number') {
        set('users_total', Math.round(answers.registered_users_total * 1.5), 'derived');
    }

    // --- SLA preset → производные DR-поля
    const sla = answers.sla_target ?? 98;
    const slaPreset = SLA_PRESETS[snapSlaToPreset(sla)];
    Object.entries(slaPreset).forEach(([id, value]) => {
        set(id, value, 'sla_preset');
    });

    // --- Compliance флаги
    // Семантика: compliance перебивает sla_preset/profile ТОЛЬКО когда forces
    // positive flag (true). Negative-значения compliance (например, waf_required=false
    // для internal×corporate) не перезаписывают предыдущие — это сохраняет source
    // sla_preset для DR-полей, не trogая их false-значениями compliance, у которой
    // про эти поля нет «активного мнения». Если поле ещё не задано — записываем.
    const compliance = computeCompliance({ product_type, industry, scale, pdn });
    Object.entries(compliance).forEach(([id, value]) => {
        const alreadySet = answers[id] !== undefined;
        if (alreadySet && value === false) return;
        set(id, value, 'compliance');
    });

    // --- AI блок (только если ai_used = true)
    /* Sprint 3.0 Stage 2: AI-prefill помечается source='ai_default' (а не
       'wizard'/'profile'), чтобы UI отрисовал отдельный фиолетовый бейдж
       «AI-default». Это даёт пользователю понять, что значение появилось
       из-за toggle'а «AI/LLM в продукте?» в Quick Start, а не из profile/scale.
       Manual override любого ai_*-поля (через setAnswer) перезатирает
       answersMeta[id].source на 'manual' — стандартное поведение. */
    if (ai_used && profile.ai) {
        set('ai_llm_used', true, 'ai_default');
        Object.entries(profile.ai).forEach(([id, value]) => {
            // rag_corpus_size_gb_by_scale → разворачиваем в rag_corpus_size_gb
            if (id === 'rag_corpus_size_gb_by_scale') {
                if (value[scale] !== undefined) {
                    set('rag_corpus_size_gb', value[scale], 'ai_default', { profileId: industry });
                }
                return;
            }
            // ai_caching_share — реалистичное значение (доля кэша)
            if (id === 'ai_caching_share') {
                set('ai_caching_share', value, 'ai_default', { profileId: industry });
                return;
            }
            // peak_months из EdTech — это список (не AI), но лежит в defaults
            set(id, value, 'ai_default', { profileId: industry });
        });

        // ai_hosting_mode — по дефолту external API (GigaChat)
        set('ai_hosting_mode', 'external_api', 'ai_default');
    } else {
        // Явно выключаем AI — иначе legacy-defaults в seed.js могут включить
        set('ai_llm_used', false, 'ai_default');
    }

    // --- Бюджетные/плановые поля (НЕ заполняем — пользователь решит сам)
    // target_capex_rub, target_opex_monthly_rub, launch_year, schedule_shift_tolerance_months
    // остаются default из seed.js.

    return { answers, meta };
}
