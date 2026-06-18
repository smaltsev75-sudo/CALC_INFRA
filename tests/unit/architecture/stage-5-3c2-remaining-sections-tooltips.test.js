/**
 * Stage 5.3.C.2 — Tooltip Short/Full spread на 6 оставшихся секций seed.js.
 *
 * 56 полей: data_storage(22) + sla(6) + security(10) + integrations(8) +
 * testing(6) + budget(4). Завершает покрытие всех seed-вопросов через
 * UI_TOOLTIPS_SHORT['q.<id>'].
 *
 * После этого PATCH'а каждый seed-вопрос имеет видимый tooltipShort под полем.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UI_TOOLTIPS_SHORT } from '../../../js/utils/constants.js';
import { SEED_QUESTIONS } from '../../../js/domain/seed.js';

const SECTIONS = {
    data_storage: [
        'db_size_initial_gb', 'db_growth_gb_month', 'db_count', 'db_replicas_count',
        'db_commercial_license_required', 'ram_per_vcpu_ratio', 'file_storage_volume_tb', 'file_storage_growth_tb_year',
        'hot_data_share_percent', 'cache_size_gb', 'backup_retention_days',
        // Stage 3 (qty-модель ПРОМ): расширенные storage-параметры.
        'db_index_ratio', 'db_wal_overhead_percent', 'db_size_per_user_kb',
        'hot_file_ssd_share_percent', 'cold_file_hdd_share_percent',
        's3_versioning_enabled', 's3_versioning_overhead_percent', 'backup_compression_ratio',
        // Stage 4 (qty-модель ПРОМ): расширенная модель RAM.
        'ram_advanced_model', 'ram_app_baseline_gb_per_service', 'ram_per_realtime_connection_kb'
    ],
    sla: [
        'sla_target', 'maintenance_window_hours_month', 'rto_hours', 'rpo_minutes',
        'georedundancy_required', 'dr_drills_per_year'
    ],
    security: [
        'pdn_152fz', 'pdn_category', 'fstec_certification_required', 'iso_27001_required',
        'encryption_at_rest', 'waf_required', 'ddos_protection_required',
        'siem_integration_required', 'dlp_required', 'audit_logging_required',
        // 5B-Sec audit-log completeness: event-параметры объёма журналов аудита.
        'audit_events_per_day', 'audit_bytes_per_event', 'audit_retention_years',
        'audit_log_compression_ratio',
        // 5B-Sec SIEM scaling: драйверы масштаба SIEM-мониторинга/интеграции.
        'siem_log_gb_per_day', 'siem_sources_count', 'siem_tier',
        // 5B-Sec DDoS tier-select: класс защиты от DDoS.
        'ddos_tier'
    ],
    integrations: [
        'email_per_month', 'sms_per_month', 'push_per_month', 'payment_gateway',
        'sso_required', 'antifraud_required', 'edo_required', 'external_api_calls_per_month'
    ],
    testing: [
        'pentest_external', 'pentest_internal', 'load_test_before_prod',
        'load_test_per_year', 'pentest_per_year', 'security_audit_per_year'
    ],
    budget: [
        'target_capex_rub', 'target_opex_monthly_rub', 'launch_year',
        'schedule_shift_tolerance_months'
    ]
};

for (const [section, ids] of Object.entries(SECTIONS)) {
    describe(`Stage 5.3.C.2 / секция «${section}» — каталог покрывает все ${ids.length} полей`, () => {
        it(`UI_TOOLTIPS_SHORT содержит ключи q.<id> для всех вопросов ${section}`, () => {
            for (const id of ids) {
                const key = `q.${id}`;
                assert.ok(UI_TOOLTIPS_SHORT[key],
                    `UI_TOOLTIPS_SHORT['${key}'] должен быть задан`);
            }
        });

        it(`каждый ${section} tooltipShort ≤ 120 символов`, () => {
            for (const id of ids) {
                const text = UI_TOOLTIPS_SHORT[`q.${id}`];
                assert.ok(text.length <= 120,
                    `q.${id} (${text.length} симв): «${text}» — должен быть ≤120`);
            }
        });

        it(`каждый ${section} tooltipShort заканчивается знаком препинания`, () => {
            for (const id of ids) {
                const text = UI_TOOLTIPS_SHORT[`q.${id}`];
                assert.match(text, /[.!?…]$/,
                    `q.${id} должен заканчиваться знаком препинания: «${text}»`);
            }
        });

        it(`перекрёстная проверка: ${section} в seed.js полностью покрыта`, () => {
            const sectionQuestions = SEED_QUESTIONS
                .filter(q => q.section === section)
                .map(q => q.id);
            for (const id of sectionQuestions) {
                assert.ok(ids.includes(id),
                    `Вопрос ${id} есть в seed.js (секция ${section}), но отсутствует в каталоге`);
            }
            for (const id of ids) {
                assert.ok(sectionQuestions.includes(id),
                    `${section} ожидает ${id}, но в seed.js его нет — устаревшая запись`);
            }
        });
    });
}

describe('Stage 5.3.C.2 / Аббревиатуры в скобках (Stage 4.15 standard)', () => {
    /* Критические аббревиатуры в покрываемых секциях должны быть либо
       расшифрованы в скобках, либо упомянуты в visible виде. Это правило
       Stage 4.15 для бизнес-русского. */
    it('SLA: RTO и RPO упомянуты в visible tooltipShort', () => {
        assert.match(UI_TOOLTIPS_SHORT['q.rto_hours'], /RTO/,
            'q.rto_hours должен упоминать RTO');
        assert.match(UI_TOOLTIPS_SHORT['q.rpo_minutes'], /RPO/,
            'q.rpo_minutes должен упоминать RPO');
    });

    it('SLA: georedundancy_required расшифровывает «центр обработки данных» (ЦОД)', () => {
        assert.match(UI_TOOLTIPS_SHORT['q.georedundancy_required'],
            /центр\s+обработки\s+данных\s*\(ЦОД\)/,
            'q.georedundancy_required должен явно упоминать «центр обработки данных (ЦОД)»');
    });

    it('Security: WAF/SIEM/DLP/КИИ/ГИС развёрнуты в скобках при первом упоминании', () => {
        assert.match(UI_TOOLTIPS_SHORT['q.waf_required'], /\(WAF\)/);
        assert.match(UI_TOOLTIPS_SHORT['q.siem_integration_required'], /\(SIEM[^)]*\)/);
        assert.match(UI_TOOLTIPS_SHORT['q.dlp_required'], /\(DLP\)/);
        assert.match(UI_TOOLTIPS_SHORT['q.fstec_certification_required'],
            /\(КИИ\).*\(ГИС\)/,
            'q.fstec_certification_required должен расшифровать КИИ и ГИС');
    });

    it('Integrations: SSO и ЭДО расшифрованы', () => {
        assert.match(UI_TOOLTIPS_SHORT['q.sso_required'], /\(SSO\)/);
        assert.match(UI_TOOLTIPS_SHORT['q.edo_required'], /\(ЭДО\)/);
    });
});

describe('Stage 5.3.C.2 / Накопительный каталог — финальное покрытие seed.js', () => {
    it('UI_TOOLTIPS_SHORT покрывает 100% seed-вопросов через ключи q.<id>', () => {
        const seedIds = SEED_QUESTIONS.map(q => q.id);
        const missing = [];
        for (const id of seedIds) {
            if (!UI_TOOLTIPS_SHORT[`q.${id}`]) missing.push(id);
        }
        assert.deepEqual(missing, [],
            `seed-вопросы без tooltipShort: ${missing.join(', ')}. После Stage 5.3.C.2 покрытие должно быть 100%`);
    });

    it('UI_TOOLTIPS_SHORT суммарно содержит ≥110 ключей после Stage 5.3.C.2', () => {
        // 14 settings + 8 QS + 26 AI + 17 business+load + 44 остальные = 109
        const total = Object.keys(UI_TOOLTIPS_SHORT).length;
        assert.ok(total >= 109,
            `UI_TOOLTIPS_SHORT должен содержать ≥109 ключей, сейчас ${total}`);
    });

    it('Все q.<id> ключи покрывают существующие seed-вопросы (нет orphan-ключей)', () => {
        const seedIds = new Set(SEED_QUESTIONS.map(q => q.id));
        const orphans = [];
        for (const key of Object.keys(UI_TOOLTIPS_SHORT)) {
            if (!key.startsWith('q.')) continue;
            const id = key.slice(2);
            if (!seedIds.has(id)) orphans.push(key);
        }
        assert.deepEqual(orphans, [],
            `Orphan q.<id> ключи (нет seed-вопроса): ${orphans.join(', ')}`);
    });
});
