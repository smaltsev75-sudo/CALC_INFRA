/**
 * Stage 3 (Storage/backup) — доработка qty-модели ПРОМ (вариант 1: новые дефолты
 * меняют storage-суммы осознанно).
 *
 * Решения (DECISIONS.md + уточнения E):
 *   - db_index_ratio (×1.3), db_wal_overhead_percent (+10%) → SSD выше и реалистичнее.
 *   - backup_compression_ratio (÷2, валидируется ≥1) → HDD-бэкап корректнее.
 *   - s3_versioning_enabled/overhead → S3 с версиями.
 *   - параметризация 0.10/0.5/50КБ: hot_file_ssd_share_percent, cold_file_hdd_share_percent,
 *     db_size_per_user_kb (только fallback через max(), не аддитивно).
 *   - нет фантомного storage: нет файлов → нет hot/cold-слоя; БД+retention → объяснимый HDD.
 *   - health: backup_retention>0 + БД, но бэкап не формируется; старый JSON → пометка про новые допущения.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SEED_QUESTIONS, defaultAnswersFrom, buildSeedDictionaries } from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { evaluateCalculationHealth } from '../../../js/domain/calculationHealth.js';

const DICT = buildSeedDictionaries();
const BASE = defaultAnswersFrom(DICT.questions);

function calcWith(answers = {}) {
    return {
        id: 'storage-stage3',
        answers: { ...BASE, ...answers },
        settings: { ...DICT.settings },
        answersMeta: {},
        dictionaries: { questions: DICT.questions, items: DICT.items },
        view: {}
    };
}
function qty(answers, itemId, stand = 'PROD') {
    return calculate(calcWith(answers)).items?.[itemId]?.stands?.[stand]?.qty ?? 0;
}
function q(id) { return SEED_QUESTIONS.find(x => x.id === id); }

const ST = {
    db_size_initial_gb: 100, db_growth_gb_month: 10, db_count: 2, db_replicas_count: 1,
    users_total: 1_000_000, file_storage_volume_tb: 10, file_storage_growth_tb_year: 5,
    hot_data_share_percent: 20, backup_retention_days: 30
};

describe('Stage 3 Storage — новые параметры', () => {
    for (const id of ['db_index_ratio', 'db_wal_overhead_percent', 'backup_compression_ratio',
        's3_versioning_enabled', 's3_versioning_overhead_percent', 'hot_file_ssd_share_percent',
        'cold_file_hdd_share_percent', 'db_size_per_user_kb']) {
        it(`вопрос ${id} опционален с defaultIfUnknown`, () => {
            const def = q(id);
            assert.ok(def, `${id} в SEED_QUESTIONS`);
            assert.equal(def.allowUnknown, true);
            assert.ok(Object.prototype.hasOwnProperty.call(def, 'defaultIfUnknown'));
        });
    }
    it('дефолты: index 1.3 / WAL 10 / compression 2 / hot 10 / cold 50 / perUser 50', () => {
        assert.equal(q('db_index_ratio').defaultIfUnknown, 1.3);
        assert.equal(q('db_wal_overhead_percent').defaultIfUnknown, 10);
        assert.equal(q('backup_compression_ratio').defaultIfUnknown, 2);
        assert.equal(q('hot_file_ssd_share_percent').defaultIfUnknown, 10);
        assert.equal(q('cold_file_hdd_share_percent').defaultIfUnknown, 50);
        assert.equal(q('db_size_per_user_kb').defaultIfUnknown, 50);
    });
    it('backup_compression_ratio.min >= 1 (условие 6)', () => {
        assert.ok(q('backup_compression_ratio').min >= 1);
    });
});

describe('Stage 3 Storage — SSD: индексы + WAL', () => {
    it('index_ratio и WAL увеличивают SSD относительно нейтральных значений', () => {
        const withFactors = qty({ ...ST, db_index_ratio: 1.3, db_wal_overhead_percent: 10 }, 'storage-ssd-tb');
        const neutral = qty({ ...ST, db_index_ratio: 1.0, db_wal_overhead_percent: 0 }, 'storage-ssd-tb');
        assert.ok(withFactors > neutral, 'индексы+WAL должны увеличивать SSD');
    });
    it('SSD без файлов = только БД (нет фантомного hot-слоя)', () => {
        const withFiles = qty({ ...ST, file_storage_volume_tb: 10, file_storage_growth_tb_year: 5 }, 'storage-ssd-tb');
        const noFiles = qty({ ...ST, file_storage_volume_tb: 0, file_storage_growth_tb_year: 0 }, 'storage-ssd-tb');
        assert.ok(withFiles > noFiles, 'hot-слой не должен появляться без файлов');
    });
});

describe('Stage 3 Storage — db_size_per_user_kb только fallback (условие 3)', () => {
    it('при заданном размере БД per_user не влияет (max, не аддитивно)', () => {
        const a = qty({ ...ST, db_size_initial_gb: 100, db_size_per_user_kb: 50 }, 'storage-ssd-tb');
        const b = qty({ ...ST, db_size_initial_gb: 100, db_size_per_user_kb: 500 }, 'storage-ssd-tb');
        assert.equal(a, b, 'при заданном db_size_gb рост per_user не должен менять SSD');
    });
    it('при нулевом размере БД per_user работает как оценка', () => {
        const lo = qty({ ...ST, db_size_initial_gb: 0, db_growth_gb_month: 0, db_size_per_user_kb: 50 }, 'storage-ssd-tb');
        const hi = qty({ ...ST, db_size_initial_gb: 0, db_growth_gb_month: 0, db_size_per_user_kb: 5000 }, 'storage-ssd-tb');
        assert.ok(hi > lo, 'без размера БД per_user-оценка должна влиять');
    });
});

describe('Stage 3 Storage — HDD: компрессия бэкапов', () => {
    it('compression=2 даёт меньше HDD, чем compression=1', () => {
        const c2 = qty({ ...ST, backup_compression_ratio: 2 }, 'storage-hdd-tb');
        const c1 = qty({ ...ST, backup_compression_ratio: 1 }, 'storage-hdd-tb');
        assert.ok(c2 < c1, 'компрессия должна уменьшать HDD-бэкап');
    });
    it('compression<1 не ломает (защита деления, трактуется как >=1)', () => {
        const bad = qty({ ...ST, backup_compression_ratio: 0 }, 'storage-hdd-tb');
        const one = qty({ ...ST, backup_compression_ratio: 1 }, 'storage-hdd-tb');
        assert.ok(Number.isFinite(bad) && bad > 0);
        assert.equal(bad, one, 'compression=0 трактуется как 1 (без деления на 0)');
    });
});

describe('Stage 3 Storage — S3 versioning', () => {
    it('versioning увеличивает S3', () => {
        const off = qty({ ...ST, s3_versioning_enabled: false }, 'storage-object-tb');
        const on = qty({ ...ST, s3_versioning_enabled: true, s3_versioning_overhead_percent: 30 }, 'storage-object-tb');
        assert.equal(off, 15, 'S3 без версий = file_vol+growth = 15');
        assert.ok(on > off, 'версии должны увеличивать S3');
    });
});

describe('Stage 3 Storage — Health Checks', () => {
    function findings(answers) { return evaluateCalculationHealth(calcWith(answers)).findings; }

    it('retention>0 + размер БД, но db_count=0 → backup без БД-инстансов', () => {
        const f = findings({ backup_retention_days: 30, db_size_initial_gb: 100, db_count: 0 });
        assert.ok(f.some(x => x.id === 'storage-backup-retention-without-db'));
    });
    it('retention>0 + БД есть (db_count>0) → нет такого warning', () => {
        const f = findings({ ...ST });
        assert.ok(!f.some(x => x.id === 'storage-backup-retention-without-db'));
    });
    it('старый JSON (нет новых storage-параметров) + есть БД → info про новые допущения', () => {
        // имитируем старый расчёт: явно убираем ключи новых параметров из answers
        const old = calcWith({ ...ST });
        for (const k of ['db_index_ratio', 'db_wal_overhead_percent', 'backup_compression_ratio',
            'hot_file_ssd_share_percent', 'cold_file_hdd_share_percent', 'db_size_per_user_kb']) {
            delete old.answers[k];
        }
        const f = evaluateCalculationHealth(old).findings;
        assert.ok(f.some(x => x.id === 'storage-model-assumptions-updated'));
    });
    it('новый расчёт (параметры заданы) → нет info про новые допущения', () => {
        const f = findings({ ...ST });
        assert.ok(!f.some(x => x.id === 'storage-model-assumptions-updated'));
    });
});
