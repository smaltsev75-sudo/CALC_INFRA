/**
 * Фикс 2026-06-17: в «Входных параметрах расчёта» Паспорта показывались сырые
 * snake_case-идентификаторы (db_index_ratio и т.п.) со значением 0 / «нет значения».
 *
 * Корень — асимметрия enrichLegacyDictionaryWithAgentSeed: формулы storage
 * рефрешились (ссылались на новые Stage 1-4 вопросы), но сами вопросы в legacy-
 * словарь не до-вносились. Итог: (1) qById не находит вопрос → questionLabel
 * показывает сырой id (нарушение «нет code-идентификаторов в UI»), и (2)
 * значение берётся 0 вместо дефолта (1.3) → неверный storage.
 *
 * Два слоя защиты:
 *   A. questionLabel НИКОГДА не возвращает сырой id — fallback на title из
 *      SEED_QUESTIONS (всегда есть русское имя), затем humanize.
 *   B. enrichment добавляет в legacy-словарь все вопросы, на которые ссылаются
 *      формулы → применяются дефолты → storage считается верно.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    SEED_QUESTIONS, buildSeedDictionaries, defaultAnswersFrom,
    enrichLegacyDictionaryWithAgentSeed
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { questionLabel } from '../../../js/domain/prodPassport.js';

const STORAGE_Q = ['db_index_ratio', 'db_wal_overhead_percent', 'hot_file_ssd_share_percent',
    'cold_file_hdd_share_percent', 'db_size_per_user_kb'];

describe('Passport questionLabel — никогда не сырой snake_case (A)', () => {
    it('db_index_ratio без title в словаре → возвращает русский title из SEED, не id', () => {
        const label = questionLabel({ id: 'db_index_ratio', title: null });
        assert.notEqual(label, 'db_index_ratio');
        assert.match(label, /индекс/i);
    });
    it('ни один id из SEED_QUESTIONS не утекает как сырая подпись', () => {
        const leaks = SEED_QUESTIONS
            .filter(q => questionLabel({ id: q.id, title: null }) === q.id)
            .map(q => q.id);
        assert.deepEqual(leaks, [], `сырые id в подписи: ${leaks.join(', ')}`);
    });
    it('даже неизвестный id не показывается как snake_case (underscore убран)', () => {
        const label = questionLabel({ id: 'totally_unknown_xyz', title: null });
        assert.ok(!/_/.test(label), `подпись не должна содержать "_": ${label}`);
    });
    it('явный title из словаря имеет приоритет', () => {
        assert.equal(questionLabel({ id: 'db_index_ratio', title: 'Мой заголовок' }), 'Мой заголовок');
    });
});

describe('Passport enrichment — добавляет недостающие вопросы формул (B)', () => {
    function legacyCalc() {
        const D = buildSeedDictionaries();
        // legacy: формулы storage свежие (как после рефреша), но storage-вопросов нет
        const questions = D.questions.filter(q => !STORAGE_Q.includes(q.id));
        const answers = defaultAnswersFrom(questions);
        Object.assign(answers, {
            db_size_initial_gb: 200, db_growth_gb_month: 20, db_count: 2, db_replicas_count: 1,
            file_storage_volume_tb: 0, file_storage_growth_tb_year: 0
        });
        return {
            id: 'legacy', answers, settings: { ...D.settings },
            dictionaries: { items: D.items, questions }
        };
    }
    function ssdQty(calc) { return calculate(calc).items?.['storage-ssd-tb']?.stands?.PROD?.qty ?? 0; }

    it('до enrichment storage-вопросов нет в словаре', () => {
        const calc = legacyCalc();
        const ids = new Set(calc.dictionaries.questions.map(q => q.id));
        assert.ok(!ids.has('db_index_ratio'));
    });
    it('после enrichment db_index_ratio добавлен (с title)', () => {
        const calc = legacyCalc();
        enrichLegacyDictionaryWithAgentSeed(calc);
        const q = calc.dictionaries.questions.find(x => x.id === 'db_index_ratio');
        assert.ok(q, 'db_index_ratio должен быть добавлен');
        assert.ok(q.title && q.title.length > 0);
    });
    it('после enrichment storage-ssd считается с дефолтом 1.3 (не 0): qty растёт', () => {
        const calc = legacyCalc();
        const before = ssdQty(calc);              // db_index_ratio отсутствует → 0 → член БД обнулён
        enrichLegacyDictionaryWithAgentSeed(calc); // мутирует dictionaries in-place
        const after = ssdQty(calc);                // дефолт 1.3 применён → больше
        assert.ok(after > before, `после enrichment SSD должен вырасти: before=${before} after=${after}`);
    });
    it('enriched-legacy совпадает с fresh-seed расчётом при тех же ответах', () => {
        const calc = legacyCalc();
        enrichLegacyDictionaryWithAgentSeed(calc);
        const D = buildSeedDictionaries();
        const fresh = {
            id: 'fresh', answers: { ...calc.answers }, settings: { ...D.settings },
            dictionaries: D
        };
        assert.equal(ssdQty(calc), ssdQty(fresh));
    });
});
