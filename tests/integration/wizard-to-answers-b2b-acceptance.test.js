/**
 * PATCH 2.18.3 (внешний аудит #10, 2026-05-19, P3):
 * Acceptance-якорь для документации WIZARD_PROFILES.md.
 *
 * Аудит-10 P3 нашёл, что WIZARD_PROFILES.md:450 говорил «~40 полей из 87»
 * и «НЕ заполняется 47», но реальный `wizardToAnswers()` для стандартного
 * B2B-профиля возвращал 58 answers. После v2.20.80 добавлен явный флаг
 * коммерческой лицензии СУБД: 59 из 90. Тест фиксирует контракт между кодом
 * и доком — изменение матрицы заполнения должно сопровождаться обновлением
 * WIZARD_PROFILES.md.
 *
 * WIZARD_PROFILES.md в `.gitignore` (maintainer-only), но числа в acceptance
 * висят на одном инварианте: если матрица расширилась/ужалась — обновите
 * WIZARD_PROFILES.md.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { wizardToAnswers } from '../../js/domain/wizardProfiles.js';
import { SEED_QUESTIONS } from '../../js/domain/seed.js';

describe('wizardToAnswers: acceptance B2B-standard', () => {
    it('SEED_QUESTIONS.length = 126 — общее количество вопросов в детальном опроснике', () => {
        // ⚠ При изменении этого числа — синхронно обновите WIZARD_PROFILES.md «X полей из N».
        // Stage 1 (qty-модель ПРОМ): +3 RAG-параметра (rag_embeddings_manual,
        // rag_avg_chunk_tokens, rag_refresh_delta_percent).
        // Stage 2: +7 LLM-параметров (ai_token_breakdown_manual, 5 компонентов входных
        // токенов, ai_safety_overhead_percent).
        // Stage 3: +8 storage-параметров (db_index_ratio, db_wal_overhead_percent,
        // db_size_per_user_kb, hot/cold file share, s3 versioning ×2, backup_compression_ratio).
        // Stage 4: +7 CPU/RAM-параметров (cpu_advanced_model, cpu_ms_per_request,
        // cpu_target_utilization_percent, min_instances_per_stand, ram_advanced_model,
        // ram_app_baseline_gb_per_service, ram_per_realtime_connection_kb).
        // Stage 5B-Sec (audit-log completeness): +4 параметра объёма журналов аудита
        // (audit_events_per_day, audit_bytes_per_event, audit_retention_years,
        // audit_log_compression_ratio).
        // Stage 5B-Sec (SIEM scaling): +3 параметра масштаба SIEM
        // (siem_log_gb_per_day, siem_sources_count, siem_tier).
        // Stage 5B-Sec (DDoS tier-select): +1 параметр класса защиты (ddos_tier).
        // Stage 5B-Sec (WAF domains scaling): +1 параметр числа доменов (waf_domains_count).
        // Stage 5B-Sec (DLP seats/channels): +2 параметра (dlp_protected_users_count, dlp_channels_count).
        // Package 3A (OS license gate): +1 параметр (os_commercial_license_required).
        assert.equal(SEED_QUESTIONS.length, 127,
            'Если количество SEED_QUESTIONS изменилось — обновите WIZARD_PROFILES.md §7.2');
    });

    it('стандартный B2B-профиль без AI заполняет 60 из 127 (не заполняется 67)', () => {
        const result = wizardToAnswers({
            product_type: 'b2b',
            industry: 'corporate',
            scale: 'm',
            geography: 'ru',
            pdn: true,
            activity: 'medium',
            ai_used: false
        });
        const answers = result.answers || result;
        const count = Object.keys(answers).length;
        // ⚠ При изменении этого числа — синхронно обновите WIZARD_PROFILES.md §7.2
        //   («60 полей из 127» и «НЕ заполняется (67)»). Package 3A: +1 поле
        //   os_commercial_license_required (compliance пишет false для corporate/b2b).
        assert.equal(count, 60,
            `wizardToAnswers(B2B-standard).count = ${count}, ожидалось 60. ` +
            `Если матрица заполнения изменилась — обновите WIZARD_PROFILES.md §7.2.`);
    });

    it('B2B-стандарт с AI заполняет больше полей (AI-блок добавляется)', () => {
        const withoutAi = wizardToAnswers({
            product_type: 'b2b', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: false
        });
        const withAi = wizardToAnswers({
            product_type: 'b2b', industry: 'corporate', scale: 'm',
            geography: 'ru', pdn: true, activity: 'medium', ai_used: true
        });
        const withoutCount = Object.keys(withoutAi.answers || withoutAi).length;
        const withCount = Object.keys(withAi.answers || withAi).length;
        assert.ok(withCount > withoutCount,
            `AI=true должен заполнять >${withoutCount} полей, получено ${withCount}`);
    });
});
