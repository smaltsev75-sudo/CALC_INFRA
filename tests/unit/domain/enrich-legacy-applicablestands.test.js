/**
 * Regression-тест к 13.U10: enrichLegacyDictionaryWithAgentSeed обязан
 * обновлять applicableStands у целевых ЭК, не только qtyFormulas.
 *
 * Баг до фикса: я добавил формулы qtyFormulas.DEV в seed.js + расширил
 * applicableStands до ['DEV','IFT','PSI','PROD','LOAD'] для трёх AI-ЭК
 * (llm-tokens-input-1m, llm-tokens-output-1m, rag-embeddings-1m). Но
 * enrichLegacy обновляла только qtyFormulas. У legacy-calc'а formula
 * DEV появлялась, а applicableStands оставался ['IFT','PSI','PROD','LOAD']
 * (без DEV). Calculator пропускает стенд, которого нет в applicableStands
 * — qty на DEV оставался 0 даже после миграции и enrichLegacy.
 *
 * Симптом, который видел пользователь: на стенд-карточке DEV дашборда
 * блок «Метрики AI / RAG / агентов» показывал «—» для TOKENS, EMBEDDINGS
 * (а RAG_VECTORS = 1-2 ГБ через max(1,...) floor) — несмотря на все
 * остальные «правильные» правки.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSeedDictionaries,
    defaultAnswersFrom,
    SEED_SETTINGS,
    SEED_QUESTIONS,
    enrichLegacyDictionaryWithAgentSeed
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';

const REFRESH_IDS = ['llm-tokens-input-1m', 'llm-tokens-output-1m', 'rag-embeddings-1m'];

function buildLegacyCalc() {
    const dict = buildSeedDictionaries();
    // Симулируем legacy: applicableStands без DEV + удалённая qtyFormulas.DEV.
    for (const id of REFRESH_IDS) {
        const item = dict.items.find(i => i.id === id);
        item.applicableStands = ['IFT', 'PSI', 'PROD', 'LOAD'];
        delete item.qtyFormulas.DEV;
    }
    const answers = defaultAnswersFrom(SEED_QUESTIONS);
    answers.ai_llm_used = true;
    answers.ai_hosting_mode = 'external_api';
    answers.rag_needed = true;
    answers.ai_agent_mode = true;
    return { schemaVersion: 10, settings: { ...SEED_SETTINGS }, answers, dictionaries: dict };
}

describe('enrichLegacyDictionaryWithAgentSeed: обновляет applicableStands (13.U10)', () => {
    it('после enrichLegacy у целевых ЭК applicableStands включает DEV', () => {
        const calc = buildLegacyCalc();
        enrichLegacyDictionaryWithAgentSeed(calc);
        for (const id of REFRESH_IDS) {
            const item = calc.dictionaries.items.find(i => i.id === id);
            assert.ok(item.applicableStands.includes('DEV'),
                `${id}.applicableStands должен содержать 'DEV' после enrichLegacy ` +
                `(было: ${item.applicableStands.join(',')})`);
        }
    });

    it('после enrichLegacy у целевых ЭК есть qtyFormulas.DEV', () => {
        const calc = buildLegacyCalc();
        enrichLegacyDictionaryWithAgentSeed(calc);
        for (const id of REFRESH_IDS) {
            const item = calc.dictionaries.items.find(i => i.id === id);
            assert.ok(item.qtyFormulas.DEV,
                `${id}.qtyFormulas.DEV должна появиться после enrichLegacy`);
            assert.ok(item.qtyFormulas.DEV.includes('S.standSizeRatio.DEV'),
                `${id}.qtyFormulas.DEV должна использовать S.standSizeRatio.DEV ` +
                '(buildContext подменит на aiStandFactor.DEV)');
        }
    });

    it('end-to-end: после enrichLegacy calculate() даёт DEV qty > 0 при включённом AI', () => {
        const calc = buildLegacyCalc();
        enrichLegacyDictionaryWithAgentSeed(calc);
        const r = calculate(calc);
        for (const id of REFRESH_IDS) {
            const cell = r.items[id]?.stands?.DEV;
            assert.ok(cell, `${id}.stands.DEV должна существовать`);
            assert.ok(cell.qty > 0,
                `${id} DEV qty должна быть > 0 (получено ${cell.qty}). ` +
                'Это и есть симптом, который видел пользователь до 13.U10-fix.');
        }
    });
});
