/**
 * 2.22.22 — Managed RAG семантика (Variant B) + EMBEDDINGS operational vs billable.
 *
 * Variant B (решение по тарифной семантике): Managed RAG НЕ включает генерацию
 * эмбеддингов в один тариф. `rag-embeddings-1m` остаётся отдельным платным ЭК
 * для внешнего embedding-API независимо от managed/self-hosted. Формулы и
 * golden-суммы не меняются — правятся только тексты + добавляется пояснение
 * operational-объёма EMBEDDINGS на Dashboard/Details.
 *
 * Покрывает 4 контракта:
 *   A. managed + external API: managed-base>0, vector-db=0, embeddings>0
 *      (раздельная тарификация — embeddings не свёрнут в managed).
 *   B. on-prem GPU: платный rag-embeddings-1m PROD=0, но операционная
 *      метрика Dashboard EMBEDDINGS>0 (видимость нагрузки для планирования).
 *   C. guard: тексты модели (ЭК + вопрос) не обещают «embeddings + index +
 *      search-API в одном тарифе/SKU» и честно отсылают к отдельному ЭК.
 *   D. описание EMBEDDINGS содержит «операционный объём» и «не отдельный
 *      внешний API-счёт» (единая точка — DASHBOARD_AI_METRIC_DESCRIPTIONS).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    SEED_ITEMS,
    defaultAnswersFrom,
    buildSeedDictionaries
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';
import { aggregateAiMetrics } from '../../../js/ui/dashboardAggregates.js';
import { DASHBOARD_AI_METRIC_DESCRIPTIONS } from '../../../js/utils/constants.js';

const DICT = buildSeedDictionaries();
const BASE = defaultAnswersFrom(DICT.questions);

function calcWith(answers = {}) {
    return {
        id: 'rag-2-22-22',
        name: 'Managed RAG 2.22.22',
        answers: { ...BASE, ...answers },
        settings: { ...DICT.settings },
        answersMeta: {},
        dictionaries: { questions: DICT.questions, items: DICT.items },
        view: {}
    };
}

function itemDesc(id) {
    return SEED_ITEMS.find(it => it.id === id)?.description ?? '';
}
function questionDesc(id) {
    return DICT.questions.find(q => q.id === id)?.description ?? '';
}

/* RAG включён, корпус есть, daily-переиндексация → embeddings-объём заведомо >0. */
const RAG_BASE = {
    ai_llm_used: true,
    rag_needed: true,
    rag_corpus_size_gb: 10,
    rag_refresh_frequency: 'daily',
    rag_refresh_delta_percent: 100
};

/* Фраза-обещание all-in (cyrillic «тариф» матчим без \w — ловушка \w/кириллица). */
const ALL_IN_RE = /embeddings\s*\+\s*index\s*\+\s*search-?API\s+в\s+одном\s+(тариф|SKU)/i;

describe('2.22.22 / A — managed RAG не all-in: раздельная тарификация ЭК', () => {
    it('managed + external API: managed-base>0, vector-db=0, embeddings>0', () => {
        const r = calculate(calcWith({ ...RAG_BASE, ai_hosting_mode: 'external_api', rag_managed_used: true }));
        const q = id => r.items?.[id]?.stands?.PROD?.qty ?? 0;
        assert.ok(q('rag-managed-knowledge-base-gb') > 0,
            'managed база знаний должна быть >0 при rag_managed_used');
        assert.equal(q('rag-vector-db-gb'), 0,
            'self-hosted vector-db = 0 при managed (взаимоисключающие)');
        assert.ok(q('rag-embeddings-1m') > 0,
            'embeddings остаётся отдельным платным ЭК при external embedding-API');
    });
});

describe('2.22.22 / B — on-prem: платный embeddings=0, операционный объём виден', () => {
    it('on_prem_gpu: rag-embeddings-1m PROD qty=0, но Dashboard EMBEDDINGS>0', () => {
        const calc = calcWith({ ...RAG_BASE, ai_hosting_mode: 'on_prem_gpu' });
        const r = calculate(calc);
        assert.equal(r.items?.['rag-embeddings-1m']?.stands?.PROD?.qty ?? 0, 0,
            'при on_prem_gpu внешний embedding-API не тарифицируется → платный ЭК=0');
        const ai = aggregateAiMetrics(r, calc.dictionaries.items, [], false, calc);
        assert.ok((ai.total?.EMBEDDINGS?.qty ?? 0) > 0,
            'операционный объём EMBEDDINGS остаётся виден для планирования мощности');
    });
});

describe('2.22.22 / C — guard: тексты не обещают Managed RAG = embeddings all-in', () => {
    const TARGETS = [
        { kind: 'item', id: 'rag-managed-knowledge-base-gb' },
        { kind: 'item', id: 'rag-vector-db-gb' },
        { kind: 'question', id: 'rag_managed_used' }
    ];
    for (const t of TARGETS) {
        it(`${t.kind} ${t.id}: нет «embeddings + index + search-API в одном тарифе/SKU»`, () => {
            const text = t.kind === 'item' ? itemDesc(t.id) : questionDesc(t.id);
            assert.ok(text.length > 0, `${t.id}: текст должен существовать`);
            assert.ok(!ALL_IN_RE.test(text),
                `${t.id}: убрать обещание, что Managed RAG включает embeddings + index + ` +
                `search-API в одном тарифе/SKU (Variant B: генерация эмбеддингов тарифицируется отдельно)`);
        });
    }

    it('rag-managed-knowledge-base-gb честно отсылает к отдельному ЭК эмбеддингов', () => {
        const text = itemDesc('rag-managed-knowledge-base-gb');
        assert.match(text, /Эмбеддинги для RAG|rag-embeddings-1m/,
            'описание должно сослаться на отдельный ЭК эмбеддингов');
        assert.match(text, /отдельн|не вход|не объедин/i,
            'описание должно явно сказать: генерация эмбеддингов тарифицируется отдельно');
    });
});

describe('2.22.22 / D — EMBEDDINGS описание: operational vs billable', () => {
    it('содержит «операционный объём» и «не отдельный внешний API-счёт»', () => {
        const desc = DASHBOARD_AI_METRIC_DESCRIPTIONS.EMBEDDINGS;
        assert.equal(typeof desc, 'string');
        assert.match(desc, /операционный объём/i,
            'описание EMBEDDINGS должно назвать это операционным объёмом нагрузки');
        assert.match(desc, /не отдельный внешний API-счёт/i,
            'описание EMBEDDINGS должно пояснить: при on-prem это локальная нагрузка, ' +
            'а не отдельный внешний API-счёт');
    });
});
