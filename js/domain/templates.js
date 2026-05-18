/**
 * 12.U16: Шаблоны расчётов — 5 пресетов с готовыми ответами для типичных
 * сценариев. Цель — пользователь не отвечает на 80 вопросов с нуля, а
 * стартует с близкого по масштабу шаблона и точечно уточняет.
 *
 * Градация по числу зарегистрированных пользователей (registered_users_total):
 *   - tier1-mvp:        до 5 000
 *   - tier2-small-saas: от 5 000 до 50 000
 *   - tier3-medium-saas: от 50 000 до 100 000
 *   - tier4-large-saas: от 100 000 до 500 000
 *   - tier5-enterprise: более 500 000
 *
 * Каждый шаблон содержит верхнюю границу диапазона как канонический
 * `registered_users_total` (consistent baseline для расчётов). Пользователь
 * правит вручную после создания.
 *
 * Структура: { id, label, rangeText, summary, answers, settings? }
 *   - answers: object Q.id → value, мерджится поверх defaultAnswersFrom().
 *   - settings: опциональный override SEED_SETTINGS (например, для Enterprise
 *     задаём более консервативный contingency).
 *
 * Источник числовых параметров — SANITY_REPORT.md (валидированные сценарии).
 * При правке этого файла прогнать `node tests/_sanity-check.mjs` и сверить.
 */

/** Множитель «гипотетический pessimistic-сценарий» для Enterprise-резерва. */
const ENTERPRISE_CONTINGENCY = 0.07;  // 7% (при типичных 5%)

export const TEMPLATES = [
    /* ============================================================
     * Tier 1: MVP / пилот — до 5 000 пользователей
     * ============================================================ */
    {
        id: 'tier1-mvp',
        label: 'MVP / пилот',
        rangeText: 'до 5 000 пользователей',
        summary:
            'Стартап на этапе MVP. Проверка идеи или ранний пилот. ' +
            'Минимум compliance (без 152-ФЗ, без WAF), простая архитектура (3 микросервиса), ' +
            'один регион, базовый SLA 99.5%. Ориентир по бюджету: ~2–2.5 М ₽/мес ' +
            '(включая SECURITY: пентест + аудит и SERVICES: внедрение/обучение, ' +
            'без которых даже MVP не запускают). Базовая инфра без security/services — ~0.4 М ₽/мес.',
        answers: {
            users_total: 5000,
            registered_users_total: 5000,
            dau_share_of_registered_percent: 10, // активная база MVP — 10% от 5k = 500 DAU
            pcu_target: 50,
            peak_rps: 20,
            avg_rps: 5,
            microservices_count: 3,
            async_workers_count: 1,
            db_count: 1,
            db_replicas_count: 0,
            db_size_initial_gb: 20,
            db_growth_gb_month: 2,
            backup_retention_days: 14,
            file_storage_volume_tb: 0.1,
            file_storage_growth_tb_year: 0.1,
            email_per_month: 5000,
            sms_per_month: 0,
            push_per_month: 100000,
            avg_response_size_kb: 5,
            avg_request_size_kb: 2,
            ram_per_vcpu_ratio: 4,
            cache_size_gb: 4,
            sla_target: 99.5,
            georedundancy_required: false,
            pdn_152fz: false,
            encryption_at_rest: false,
            waf_required: false,
            fstec_certification_required: false,
            pentest_external: true,
            pentest_internal: false,
            load_test_before_prod: true,
            pentest_per_year: 1,
            load_test_per_year: 1,
            ai_llm_used: false
        }
    },

    /* ============================================================
     * Tier 2: Малый SaaS — 5 000 до 50 000 пользователей
     * ============================================================ */
    {
        id: 'tier2-small-saas',
        label: 'Малый SaaS',
        rangeText: 'от 5 000 до 50 000 пользователей',
        summary:
            'Рабочий SaaS с первыми платящими клиентами. Базовый compliance (152-ФЗ, ' +
            'шифрование at-rest, WAF), без гео-резервирования, SLA 99.9%. ' +
            'Полный набор стендов с акцентом на ПРОМ. Ориентир: ~3–5 М ₽/мес.',
        answers: {
            users_total: 50000,
            registered_users_total: 50000,
            dau_share_of_registered_percent: 20, // 20% активность B2B SaaS = 10k DAU
            pcu_target: 1000,
            peak_rps: 200,
            avg_rps: 50,
            microservices_count: 10,
            async_workers_count: 4,
            db_count: 3,
            db_replicas_count: 1,
            db_size_initial_gb: 100,
            db_growth_gb_month: 10,
            backup_retention_days: 30,
            file_storage_volume_tb: 1,
            file_storage_growth_tb_year: 1,
            email_per_month: 50000,
            sms_per_month: 5000,
            push_per_month: 1000000,
            avg_response_size_kb: 5,
            avg_request_size_kb: 2,
            ram_per_vcpu_ratio: 4,
            cache_size_gb: 16,
            sla_target: 99.9,
            georedundancy_required: false,
            pdn_152fz: true,
            encryption_at_rest: true,
            waf_required: true,
            fstec_certification_required: false,
            pentest_external: true,
            pentest_internal: true,
            load_test_before_prod: true,
            pentest_per_year: 2,
            load_test_per_year: 2,
            ai_llm_used: false
        }
    },

    /* ============================================================
     * Tier 3: Средний SaaS — 50 000 до 100 000 пользователей
     * ============================================================ */
    {
        id: 'tier3-medium-saas',
        label: 'Средний SaaS',
        rangeText: 'от 50 000 до 100 000 пользователей',
        summary:
            'Средний SaaS на этапе активного масштабирования. Полный compliance, ' +
            'повышенный SLA 99.9%, расширенный мониторинг. Без гео-резервирования. ' +
            'Все стенды активны. Ориентир: ~6–10 М ₽/мес.',
        answers: {
            users_total: 100000,
            registered_users_total: 100000,
            dau_share_of_registered_percent: 25, // 25% активность среднего SaaS = 25k DAU
            pcu_target: 2500,
            peak_rps: 400,
            avg_rps: 100,
            microservices_count: 15,
            async_workers_count: 6,
            db_count: 4,
            db_replicas_count: 1,
            db_size_initial_gb: 250,
            db_growth_gb_month: 25,
            backup_retention_days: 30,
            file_storage_volume_tb: 5,
            file_storage_growth_tb_year: 3,
            email_per_month: 200000,
            sms_per_month: 20000,
            push_per_month: 10000000,
            avg_response_size_kb: 5,
            avg_request_size_kb: 2,
            ram_per_vcpu_ratio: 4,
            cache_size_gb: 32,
            sla_target: 99.9,
            georedundancy_required: false,
            pdn_152fz: true,
            encryption_at_rest: true,
            waf_required: true,
            fstec_certification_required: false,
            pentest_external: true,
            pentest_internal: true,
            load_test_before_prod: true,
            pentest_per_year: 3,
            load_test_per_year: 3,
            ai_llm_used: false
        }
    },

    /* ============================================================
     * Tier 4: Крупный SaaS — 100 000 до 500 000 пользователей
     * ============================================================ */
    {
        id: 'tier4-large-saas',
        label: 'Крупный SaaS',
        rangeText: 'от 100 000 до 500 000 пользователей',
        summary:
            'Крупный SaaS с серьёзной клиентской базой. Гео-резервирование, ' +
            'высокий SLA 99.95%, расширенное удержание бэкапов (90 дней), ' +
            'усиленный security-аудит (4 пентеста/год). Ориентир: ~20–30 М ₽/мес.',
        answers: {
            users_total: 500000,
            registered_users_total: 500000,
            dau_share_of_registered_percent: 20, // 20% активность зрелого SaaS = 100k DAU
            pcu_target: 10000,
            peak_rps: 1000,
            avg_rps: 200,
            microservices_count: 25,
            async_workers_count: 10,
            db_count: 5,
            db_replicas_count: 2,
            db_size_initial_gb: 1000,
            db_growth_gb_month: 100,
            backup_retention_days: 90,
            file_storage_volume_tb: 50,
            file_storage_growth_tb_year: 30,
            email_per_month: 1000000,
            sms_per_month: 100000,
            push_per_month: 50000000,
            avg_response_size_kb: 10,
            avg_request_size_kb: 4,
            ram_per_vcpu_ratio: 4,
            cache_size_gb: 128,
            sla_target: 99.95,
            georedundancy_required: true,
            pdn_152fz: true,
            encryption_at_rest: true,
            waf_required: true,
            fstec_certification_required: false,
            pentest_external: true,
            pentest_internal: true,
            load_test_before_prod: true,
            pentest_per_year: 4,
            load_test_per_year: 3,
            ai_llm_used: false
        }
    },

    /* ============================================================
     * Tier 5: Enterprise / Mass-market — более 500 000 пользователей
     * ============================================================ */
    {
        id: 'tier5-enterprise',
        label: 'Enterprise / Mass-market',
        rangeText: 'более 500 000 пользователей',
        summary:
            'Крупный продукт массового масштаба или с госкомпонентом. ФСТЭК-сертификация, ' +
            'гео-резервирование, max SLA 99.99%, годовой backup retention. ' +
            'Все стенды активны и крупные, повышенный contingency-резерв. ' +
            'Ориентир по бюджету: 60–120 М ₽/мес (зависит от профиля mass-market: ' +
            'контентные/медиа продукты дороже бизнес-приложений из-за storage и трафика). ' +
            'Sanity-точка для сравнения: Enterprise 500k registered = 18 М ₽/мес.',
        answers: {
            users_total: 2000000,
            registered_users_total: 2000000,
            dau_share_of_registered_percent: 20, // 20% массового продукта = 400k DAU
            pcu_target: 40000,
            peak_rps: 5000,
            avg_rps: 1000,
            microservices_count: 50,
            async_workers_count: 20,
            db_count: 10,
            db_replicas_count: 3,
            db_size_initial_gb: 5000,
            db_growth_gb_month: 500,
            backup_retention_days: 365,
            file_storage_volume_tb: 200,
            file_storage_growth_tb_year: 100,
            email_per_month: 10000000,
            sms_per_month: 1000000,
            push_per_month: 500000000,
            avg_response_size_kb: 10,
            avg_request_size_kb: 4,
            ram_per_vcpu_ratio: 4,
            cache_size_gb: 512,
            sla_target: 99.99,
            georedundancy_required: true,
            pdn_152fz: true,
            encryption_at_rest: true,
            waf_required: true,
            fstec_certification_required: true,
            pentest_external: true,
            pentest_internal: true,
            load_test_before_prod: true,
            pentest_per_year: 6,
            load_test_per_year: 4,
            ai_llm_used: false
        },
        settings: {
            kContingency: ENTERPRISE_CONTINGENCY  // 7% — для крупных проектов больше резерв
        }
    }
];

/** Найти шаблон по id (или undefined). */
export function getTemplateById(id) {
    return TEMPLATES.find(t => t.id === id);
}

/** Список для UI: id + label + rangeText + summary. */
export function listTemplates() {
    return TEMPLATES.map(t => ({
        id: t.id,
        label: t.label,
        rangeText: t.rangeText,
        summary: t.summary
    }));
}
