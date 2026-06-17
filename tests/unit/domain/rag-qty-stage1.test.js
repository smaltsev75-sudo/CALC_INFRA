/**
 * Stage 1 (RAG) — доработка qty-модели ПРОМ.
 *
 * Покрывает решения из DECISIONS.md «ПЛАН: Доработка qty-модели ПРОМ»:
 *   1. Размер vector-DB НЕ зависит от rag_retrieval_calls_per_query (P1-фикс).
 *   2. Число эмбеддингов считается автоматически из размера корпуса
 *      (rag_corpus_size_gb / rag_avg_chunk_tokens), с ручным override
 *      (rag_embeddings_manual + rag_embeddings_million).
 *   3. realtime-частота = ×2 (непрерывная дельта), а не ×30 (== daily full).
 *   4. rag_refresh_delta_percent масштабирует токены переиндексации,
 *      defaultIfUnknown=100% сохраняет прежнее поведение daily/weekly/monthly.
 *   5. rag_retrieval_calls_per_query переехал из размера хранилища в
 *      «эмбеддинги запросов» recurring-формулы (стоимость поиска).
 *   + Health-checks: manual↔авто mismatch (×3), full-reindex большого корпуса.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    SEED_QUESTIONS,
    SEED_ITEMS,
    defaultAnswersFrom,
    buildSeedDictionaries
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { evaluateCalculationHealth } from '../../../js/domain/calculationHealth.js';

const DICT = buildSeedDictionaries();
const BASE_ANSWERS = defaultAnswersFrom(DICT.questions);

function calcWith(answers = {}) {
    return {
        id: 'rag-stage1',
        name: 'RAG Stage 1',
        answers: { ...BASE_ANSWERS, ...answers },
        settings: { ...DICT.settings },
        answersMeta: {},
        dictionaries: { questions: DICT.questions, items: DICT.items },
        view: {}
    };
}

function qty(answers, itemId, stand = 'PROD') {
    const r = calculate(calcWith(answers));
    return r.items?.[itemId]?.stands?.[stand]?.qty ?? 0;
}

function q(id) {
    return SEED_QUESTIONS.find(x => x.id === id);
}

/* Базовый RAG-сетап: внешний API, RAG включён, self-hosted vector DB. */
const RAG_ON = {
    ai_llm_used: true,
    ai_hosting_mode: 'external_api',
    rag_needed: true,
    rag_managed_used: false
};

/* Обнуляем пользовательскую базу — чтобы изолировать indexing-токены
 * от query-embedding токенов в rag-embeddings-1m. */
const NO_QUERY_LOAD = { registered_users_total: 0 };

describe('Stage 1 RAG — новые параметры опросника', () => {
    for (const id of ['rag_refresh_delta_percent', 'rag_avg_chunk_tokens', 'rag_embeddings_manual']) {
        it(`вопрос ${id} существует, опционален, имеет defaultIfUnknown`, () => {
            const def = q(id);
            assert.ok(def, `${id} должен быть в SEED_QUESTIONS`);
            assert.equal(def.allowUnknown, true, `${id}.allowUnknown=true`);
            assert.ok(Object.prototype.hasOwnProperty.call(def, 'defaultIfUnknown'),
                `${id} должен иметь defaultIfUnknown`);
        });
    }

    it('rag_refresh_delta_percent.defaultIfUnknown=100 (сохранение прежнего поведения)', () => {
        assert.equal(q('rag_refresh_delta_percent').defaultIfUnknown, 100);
    });
    it('rag_avg_chunk_tokens.defaultIfUnknown=512', () => {
        assert.equal(q('rag_avg_chunk_tokens').defaultIfUnknown, 512);
    });
    it('rag_embeddings_manual — boolean, по умолчанию false (авто из корпуса)', () => {
        const def = q('rag_embeddings_manual');
        assert.equal(def.type, 'boolean');
        assert.equal(def.defaultIfUnknown, false);
    });
});

describe('Stage 1 RAG — размер vector-DB не зависит от частоты поисков (P1)', () => {
    it('rag-vector-db-gb одинаков при retrieval_calls=4 и retrieval_calls=40', () => {
        const a = qty({ ...RAG_ON, rag_corpus_size_gb: 10, rag_retrieval_calls_per_query: 4 }, 'rag-vector-db-gb');
        const b = qty({ ...RAG_ON, rag_corpus_size_gb: 10, rag_retrieval_calls_per_query: 40 }, 'rag-vector-db-gb');
        assert.equal(a, b, 'размер хранилища vector DB не должен меняться от числа поисков');
        assert.ok(a > 0, 'при corpus>0 размер должен быть положительным');
    });

    it('rag-managed-knowledge-base-gb одинаков при разных retrieval_calls', () => {
        const m = { ...RAG_ON, rag_managed_used: true, rag_corpus_size_gb: 10 };
        const a = qty({ ...m, rag_retrieval_calls_per_query: 4 }, 'rag-managed-knowledge-base-gb');
        const b = qty({ ...m, rag_retrieval_calls_per_query: 40 }, 'rag-managed-knowledge-base-gb');
        assert.equal(a, b);
        assert.ok(a > 0);
    });
});

describe('Stage 1 RAG — авторасчёт эмбеддингов из корпуса + override', () => {
    it('auto: corpus=10 ГБ, chunk=512 → vector-DB ≈ ceil(10×200M/512/1e6 × 4) = 16 ГБ (PROD)', () => {
        const got = qty({ ...RAG_ON, rag_corpus_size_gb: 10, rag_embeddings_manual: false }, 'rag-vector-db-gb');
        // embeddings_million = 10*200000000/512/1e6 = 3.90625; ×4 = 15.625 → ceil 16
        assert.equal(got, 16);
    });

    it('manual override: rag_embeddings_million=1 → vector-DB = ceil(1×4) = 4 ГБ', () => {
        const got = qty({
            ...RAG_ON, rag_corpus_size_gb: 10,
            rag_embeddings_manual: true, rag_embeddings_million: 1
        }, 'rag-vector-db-gb');
        assert.equal(got, 4);
    });

    it('chunk меньше → эмбеддингов больше → размер больше', () => {
        const big = qty({ ...RAG_ON, rag_corpus_size_gb: 10, rag_avg_chunk_tokens: 256 }, 'rag-vector-db-gb');
        const small = qty({ ...RAG_ON, rag_corpus_size_gb: 10, rag_avg_chunk_tokens: 1024 }, 'rag-vector-db-gb');
        assert.ok(big > small, 'меньший chunk → больше эмбеддингов → больше ГБ');
    });
});

describe('Stage 1 RAG — recurring embeddings: realtime, delta%, query-токены', () => {
    it('realtime = ×2 (не ×30): indexing-токены 15× меньше daily при той же дельте', () => {
        const rt = qty({ ...RAG_ON, ...NO_QUERY_LOAD, rag_corpus_size_gb: 10, rag_refresh_frequency: 'realtime', rag_refresh_delta_percent: 100 }, 'rag-embeddings-1m');
        const daily = qty({ ...RAG_ON, ...NO_QUERY_LOAD, rag_corpus_size_gb: 10, rag_refresh_frequency: 'daily', rag_refresh_delta_percent: 100 }, 'rag-embeddings-1m');
        // realtime: 10*200M*2/1e6 = 4000; daily: 10*200M*30/1e6 = 60000
        assert.equal(rt, 4000);
        assert.equal(daily, 60000);
    });

    it('delta%=100 сохраняет прежнее daily-поведение (10×200M×30/1e6 = 60000)', () => {
        const got = qty({ ...RAG_ON, ...NO_QUERY_LOAD, rag_corpus_size_gb: 10, rag_refresh_frequency: 'daily', rag_refresh_delta_percent: 100 }, 'rag-embeddings-1m');
        assert.equal(got, 60000);
    });

    it('delta%=10 уменьшает indexing-токены в 10 раз', () => {
        const full = qty({ ...RAG_ON, ...NO_QUERY_LOAD, rag_corpus_size_gb: 10, rag_refresh_frequency: 'daily', rag_refresh_delta_percent: 100 }, 'rag-embeddings-1m');
        const delta = qty({ ...RAG_ON, ...NO_QUERY_LOAD, rag_corpus_size_gb: 10, rag_refresh_frequency: 'daily', rag_refresh_delta_percent: 10 }, 'rag-embeddings-1m');
        assert.equal(full, 60000);
        assert.equal(delta, 6000);
    });

    it('retrieval_calls теперь влияет на embeddings-1m через query-токены (corpus=0)', () => {
        const base = {
            ...RAG_ON, rag_corpus_size_gb: 0, rag_refresh_frequency: 'daily',
            registered_users_total: 1000, dau_share_of_registered_percent: 10,
            ai_users_share: 100, ai_requests_per_user_day: 5
        };
        // queries/month = 1000*0.1*1*5*30 = 15000; query tokens = 15000*retrieval*200
        const r4 = qty({ ...base, rag_retrieval_calls_per_query: 4 }, 'rag-embeddings-1m');
        const r8 = qty({ ...base, rag_retrieval_calls_per_query: 8 }, 'rag-embeddings-1m');
        // r4: 15000*4*200/1e6 = 12; r8: 24
        assert.equal(r4, 12);
        assert.equal(r8, 24);
    });
});

describe('Stage 1 RAG — Health Checks', () => {
    function findingsOf(answers) {
        return evaluateCalculationHealth(calcWith(answers)).findings;
    }

    it('manual эмбеддинги сильно (×3) ниже авторасчёта → warning', () => {
        // corpus=100 → derived ≈ 100*200M/512/1e6 ≈ 39M; manual=1 → расхождение огромное
        const f = findingsOf({ ...RAG_ON, rag_corpus_size_gb: 100, rag_embeddings_manual: true, rag_embeddings_million: 1 });
        assert.ok(f.some(x => x.id === 'ai-rag-embeddings-mismatch'),
            'должен сработать ai-rag-embeddings-mismatch');
    });

    it('manual эмбеддинги близки к авторасчёту → нет warning', () => {
        // corpus=10 → derived ≈ 3.9M; manual=4M в пределах ×3
        const f = findingsOf({ ...RAG_ON, rag_corpus_size_gb: 10, rag_embeddings_manual: true, rag_embeddings_million: 4 });
        assert.ok(!f.some(x => x.id === 'ai-rag-embeddings-mismatch'));
    });

    it('авто-режим (manual=false) не даёт mismatch-warning', () => {
        const f = findingsOf({ ...RAG_ON, rag_corpus_size_gb: 100, rag_embeddings_manual: false });
        assert.ok(!f.some(x => x.id === 'ai-rag-embeddings-mismatch'));
    });

    it('daily full reindex большого корпуса (delta=100, corpus≥100) → warning', () => {
        const f = findingsOf({ ...RAG_ON, rag_corpus_size_gb: 500, rag_refresh_frequency: 'daily', rag_refresh_delta_percent: 100 });
        assert.ok(f.some(x => x.id === 'ai-rag-full-reindex-large-corpus'));
    });

    it('delta-конвейер большого корпуса (delta=10) → нет full-reindex warning', () => {
        const f = findingsOf({ ...RAG_ON, rag_corpus_size_gb: 500, rag_refresh_frequency: 'daily', rag_refresh_delta_percent: 10 });
        assert.ok(!f.some(x => x.id === 'ai-rag-full-reindex-large-corpus'));
    });
});
