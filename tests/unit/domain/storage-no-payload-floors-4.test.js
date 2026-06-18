import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom } from '../../../js/domain/seed.js';
import { STAND_IDS } from '../../../js/utils/constants.js';

/**
 * Package 4 — storage no-payload floors.
 *
 * Floors вида max(FLOOR, 0) не должны покупать минимальный объём, если в расчёте
 * нет соответствующего payload: БД, файлов, событий аудита или RAG-корпуса.
 * При наличии payload прежние минимумы сохраняются, чтобы не получить drift в
 * существующих golden-сценариях.
 */

function buildCalc(overrides = {}) {
    const dictionaries = buildSeedDictionaries();
    const answers = defaultAnswersFrom(dictionaries.questions);
    Object.assign(answers, {
        users_total: 0,
        registered_users_total: 0,
        dau_target: 0,
        pcu_target: 0,
        peak_rps: 0,
        avg_rps: 0,
        microservices_count: 0,
        async_workers_count: 0,
        db_count: 0,
        db_replicas_count: 0,
        db_size_initial_gb: 0,
        db_growth_gb_month: 0,
        backup_retention_days: 0,
        file_storage_volume_tb: 0,
        file_storage_growth_tb_year: 0,
        audit_logging_required: false,
        audit_events_per_day: 0,
        pdn_152fz: false,
        encryption_at_rest: false,
        ai_llm_used: false,
        rag_needed: false,
        rag_managed_used: false,
        rag_corpus_size_gb: 0,
        rag_embeddings_manual: false,
        rag_embeddings_million: 0
    }, overrides);
    return {
        id: 'storage-no-payload-floors-4',
        name: 'Storage no-payload floors Package 4',
        settings: {
            ...dictionaries.settings,
            applyRiskFactors: false,
            vatEnabled: false
        },
        answers,
        dictionaries
    };
}

function resultFor(overrides) {
    clearCalculationCache();
    return calculate(buildCalc(overrides));
}

function qtyByStand(result, itemId) {
    const item = result.items[itemId];
    return Object.fromEntries(STAND_IDS.map(stand => [
        stand,
        Number(item?.stands?.[stand]?.qty) || 0
    ]));
}

function assertAllZero(result, itemId) {
    assert.deepEqual(qtyByStand(result, itemId), {
        DEV: 0,
        IFT: 0,
        PSI: 0,
        PROD: 0,
        LOAD: 0
    }, `${itemId} должен быть 0 на всех стендах`);
}

describe('Package 4 / storage floors: no payload means no paid floor', () => {
    it('нулевой DB/file payload не покупает SSD/HDD/S3 floors', () => {
        const result = resultFor({});

        assertAllZero(result, 'storage-ssd-tb');
        assertAllZero(result, 'storage-hdd-tb');
        assertAllZero(result, 'storage-object-tb');
    });

    it('audit включён, но нет БД и событий аудита → audit-log storage = 0', () => {
        const result = resultFor({
            audit_logging_required: true,
            audit_events_per_day: 0
        });

        assertAllZero(result, 'security-audit-log-storage-gb');
    });

    it('RAG включён, но corpus/embeddings = 0 → vector DB floors не покупаются', () => {
        const selfHosted = resultFor({
            rag_needed: true,
            rag_managed_used: false
        });
        const managed = resultFor({
            rag_needed: true,
            rag_managed_used: true
        });

        assertAllZero(selfHosted, 'rag-vector-db-gb');
        assertAllZero(managed, 'rag-managed-knowledge-base-gb');
    });
});

describe('Package 4 / storage floors: payload still keeps existing minimums', () => {
    it('маленькая БД сохраняет SSD floor, но не включает HDD без backup/cold payload', () => {
        const result = resultFor({
            db_count: 1,
            db_size_initial_gb: 1,
            backup_retention_days: 0
        });

        assert.equal(qtyByStand(result, 'storage-ssd-tb').PROD, 0.5);
        assertAllZero(result, 'storage-hdd-tb');
    });

    it('маленькая БД с backup сохраняет HDD floor', () => {
        const result = resultFor({
            db_count: 1,
            db_size_initial_gb: 1,
            backup_retention_days: 30
        });

        assert.equal(qtyByStand(result, 'storage-hdd-tb').PROD, 1);
        assert.equal(qtyByStand(result, 'storage-hdd-tb').LOAD, 0.5);
    });

    it('маленький файловый payload сохраняет S3 floor', () => {
        const result = resultFor({
            file_storage_volume_tb: 0.01
        });

        assert.equal(qtyByStand(result, 'storage-object-tb').PROD, 0.5);
        assert.equal(qtyByStand(result, 'storage-object-tb').DEV, 0.1);
    });

    it('холодный файловый payload сохраняет HDD floor', () => {
        const result = resultFor({
            file_storage_volume_tb: 0.01,
            hot_data_share_percent: 0,
            cold_file_hdd_share_percent: 50
        });

        assert.equal(qtyByStand(result, 'storage-hdd-tb').PROD, 1);
        assert.equal(qtyByStand(result, 'storage-hdd-tb').LOAD, 0.5);
    });

    it('audit fallback floor сохраняется, когда есть DB payload', () => {
        const result = resultFor({
            db_count: 1,
            db_size_initial_gb: 1,
            audit_logging_required: true,
            audit_events_per_day: 0
        });

        assert.equal(qtyByStand(result, 'security-audit-log-storage-gb').PROD, 1000);
        assert.equal(qtyByStand(result, 'security-audit-log-storage-gb').PSI, 100);
    });

    it('audit event branch сохраняется без DB payload', () => {
        const result = resultFor({
            audit_logging_required: true,
            audit_events_per_day: 1000000,
            audit_retention_years: 1,
            audit_bytes_per_event: 1000,
            audit_log_compression_ratio: 1
        });

        assert.ok(qtyByStand(result, 'security-audit-log-storage-gb').PROD > 0);
    });

    it('RAG floor сохраняется, когда есть corpus payload', () => {
        const result = resultFor({
            rag_needed: true,
            rag_managed_used: true,
            rag_corpus_size_gb: 0.001
        });

        assert.equal(qtyByStand(result, 'rag-managed-knowledge-base-gb').DEV, 1);
        assert.equal(qtyByStand(result, 'rag-managed-knowledge-base-gb').IFT, 1);
    });
});
