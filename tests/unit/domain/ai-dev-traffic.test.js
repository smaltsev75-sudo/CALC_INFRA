/**
 * Этап 13.U10: AI-метрики симметрично появляются на DEV.
 *
 * Раньше на DEV-карточке дашборда было видно только RAG_VECTORS (через
 * max(1, ...) floor), но TOKENS/EMBEDDINGS были 0 — это логическая дыра:
 * индекс RAG нужен для тестирования RAG-функциональности, но без токенов
 * её не протестируешь.
 *
 * Фикс: aiStandFactor.DEV = 0.02 (default) + DEV-формулы для трёх ЭК
 * (llm-tokens-input-1m, llm-tokens-output-1m, rag-embeddings-1m). Все
 * AI-ЭК теперь имеют DEV в applicableStands.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_ITEMS } from '../../../js/domain/seed.js';

describe('AI items: DEV-формулы и applicable stands (Этап 13.U10)', () => {
    const itemsWithDev = ['llm-tokens-input-1m', 'llm-tokens-output-1m', 'rag-embeddings-1m'];

    for (const id of itemsWithDev) {
        it(`${id}: applicableStands включает DEV`, () => {
            const item = SEED_ITEMS.find(i => i.id === id);
            assert.ok(item, `${id} должен быть в SEED_ITEMS`);
            assert.ok(item.applicableStands.includes('DEV'),
                `${id}.applicableStands должен включать 'DEV' — иначе на DEV qty=0 несимметрично с RAG`);
        });

        it(`${id}: qtyFormulas.DEV определена и использует S.standSizeRatio.DEV`, () => {
            const item = SEED_ITEMS.find(i => i.id === id);
            assert.ok(item.qtyFormulas.DEV, `${id}.qtyFormulas.DEV должна быть строкой`);
            assert.ok(item.qtyFormulas.DEV.includes('S.standSizeRatio.DEV'),
                `${id}.qtyFormulas.DEV должна использовать S.standSizeRatio.DEV ` +
                '(buildContext подменит на aiStandFactor.DEV для AI-ЭК)');
        });
    }
});
