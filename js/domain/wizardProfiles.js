/**
 * Quick Start Wizard — отраслевая матрица предзаполнения опросника.
 *
 * 7 макро-вопросов wizard'а → 126 полей детального опросника.
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

 *   3. Незаполненные wizard'ом поля (67 из 126 для стандартного B2B-профиля без AI;
 *      число зависит от профиля) НЕ кладутся в answers — они получат default
 *      из seed.js при расчёте. Так legacy-расчёты совместимы.
 *   4. Все таблицы Object.freeze'ены — никаких runtime-мутаций.
 *
 * Связанные документы:
 *   - WIZARD_PROFILES.md — полное design-описание матрицы и сценариев.
 *   - DECISIONS.md — журнал решений, запись 14.U1.
 */

import {
    SCALE_RULES,
    PCU_SHARE_BY_TYPE,
    SLA_PRESETS,
    snapSlaToPreset,
    INDUSTRY_PROFILES,
    PRODUCT_TYPE_OVERRIDES
} from './wizardProfileData.js';

export {
    PRODUCT_TYPE_LABELS,
    INDUSTRY_LABELS,
    SCALE_LABELS,
    GEOGRAPHY_LABELS,
    ACTIVITY_LABELS,
    SCALE_RULES,
    PCU_SHARE_BY_TYPE,
    SLA_PRESETS,
    snapSlaToPreset,
    INDUSTRY_PROFILES,
    PRODUCT_TYPE_OVERRIDES
} from './wizardProfileData.js';
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
        pdn_category: isFin ? '2' : (isEdu && pdn ? '2' : (pdn ? '3' : null)),

        // Сертификации
        fstec_certification_required: isFin || isB2G,
        iso_27001_required: isFin,
        db_commercial_license_required: isFin || isB2G,

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
    set('audience_geography', geography === 'ru_cis' ? 'cis' : geography, 'wizard');

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
