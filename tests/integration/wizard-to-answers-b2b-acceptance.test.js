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
    it('SEED_QUESTIONS.length = 100 — общее количество вопросов в детальном опроснике', () => {
        // ⚠ При изменении этого числа — синхронно обновите WIZARD_PROFILES.md «X полей из N».
        // Stage 1 (qty-модель ПРОМ): +3 RAG-параметра (rag_embeddings_manual,
        // rag_avg_chunk_tokens, rag_refresh_delta_percent).
        // Stage 2: +7 LLM-параметров (ai_token_breakdown_manual, 5 компонентов входных
        // токенов, ai_safety_overhead_percent).
        assert.equal(SEED_QUESTIONS.length, 100,
            'Если количество SEED_QUESTIONS изменилось — обновите WIZARD_PROFILES.md §7.2');
    });

    it('стандартный B2B-профиль без AI заполняет 59 из 90 (не заполняется 31)', () => {
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
        //   («59 полей из 90» и «НЕ заполняется (31)»).
        assert.equal(count, 59,
            `wizardToAnswers(B2B-standard).count = ${count}, ожидалось 59. ` +
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
