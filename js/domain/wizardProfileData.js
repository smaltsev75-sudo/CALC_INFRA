/**
 * Frozen data tables for Quick Start Wizard profile expansion.
 * Kept separate from wizardProfiles.js so the engine can stay readable.
 */
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
