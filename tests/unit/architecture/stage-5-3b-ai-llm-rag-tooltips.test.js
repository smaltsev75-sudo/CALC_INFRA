/**
 * Stage 5.3.B — Tooltip Short/Full spread на секцию AI / LLM / RAG.
 *
 * 26 полей: 5 master-toggles (ai_llm_used / ai_agent_mode / agent_memory_used /
 * rag_needed / ai_finetune_needed) + 21 зависимое поле. Каждое получает
 * UI_TOOLTIPS_SHORT['q.<id>'] и отображается через field-description под input.
 *
 * Pattern (тот же что в Stage 5.3.A): renderQuestionField резолвит short
 * по ключу `q.${q.id}`. Отсутствие ключа = поле без tooltipShort (no-op),
 * это позволяет постепенно покрывать остальные секции в Stage 5.3.C.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';
import { UI_TOOLTIPS_SHORT } from '../../../js/utils/constants.js';
import { SEED_QUESTIONS } from '../../../js/domain/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const AI_QUESTION_IDS = [
    'ai_llm_used',
    'ai_users_share',
    'ai_requests_per_user_day',
    'ai_model_tier',
    'ai_hosting_mode',
    'ai_inference_latency_ms',
    'ai_agent_mode',
    'ai_agent_type',
    'agent_complexity',
    'agent_parallel_specialists',
    'agent_tool_use_share',
    'agent_tool_avg_seconds',
    'agent_memory_used',
    'agent_memory_size_gb',
    'ai_avg_input_tokens',
    'ai_avg_output_tokens',
    'ai_caching_share',
    'rag_needed',
    'rag_managed_used',
    'rag_corpus_size_gb',
    'rag_embeddings_million',
    'rag_embeddings_manual',
    'rag_avg_chunk_tokens',
    'rag_refresh_frequency',
    'rag_refresh_delta_percent',
    'rag_retrieval_calls_per_query',
    'ai_finetune_needed',
    'ai_finetune_runs_per_year',
    'ai_data_sensitivity',
    'ai_safety_layer'
];

describe('Stage 5.3.B / UI_TOOLTIPS_SHORT — каталог AI/LLM/RAG', () => {
    it('покрывает все 26 AI-вопросов через ключи q.<id>', () => {
        for (const id of AI_QUESTION_IDS) {
            const key = `q.${id}`;
            assert.ok(UI_TOOLTIPS_SHORT[key],
                `UI_TOOLTIPS_SHORT['${key}'] должен быть задан (поле ${id})`);
            assert.equal(typeof UI_TOOLTIPS_SHORT[key], 'string');
            assert.ok(UI_TOOLTIPS_SHORT[key].length > 0);
        }
    });

    it('каждый AI tooltipShort ≤ 120 символов', () => {
        for (const id of AI_QUESTION_IDS) {
            const text = UI_TOOLTIPS_SHORT[`q.${id}`];
            assert.ok(text.length <= 120,
                `q.${id} (${text.length} симв): «${text}» — должен быть ≤120`);
        }
    });

    it('каждый AI tooltipShort заканчивается знаком препинания', () => {
        for (const id of AI_QUESTION_IDS) {
            const text = UI_TOOLTIPS_SHORT[`q.${id}`];
            assert.match(text, /[.!?…]$/,
                `q.${id} должен заканчиваться знаком препинания: «${text}»`);
        }
    });

    it('каждый AI-вопрос в seed.js имеет соответствующий ключ в UI_TOOLTIPS_SHORT', () => {
        // Перекрёстная проверка: список выше должен совпадать с реальным
        // составом seed.js секции 'ai_llm'. Защищает от дрейфа: если
        // в seed добавили/удалили AI-вопрос, тест об этом сообщит.
        const aiQuestions = SEED_QUESTIONS
            .filter(q => q.section === 'ai_llm')
            .map(q => q.id);
        for (const id of aiQuestions) {
            assert.ok(AI_QUESTION_IDS.includes(id),
                `AI-вопрос ${id} есть в seed.js, но отсутствует в AI_QUESTION_IDS теста — добавьте в каталог UI_TOOLTIPS_SHORT и в массив теста`);
        }
        // Обратная проверка
        for (const id of AI_QUESTION_IDS) {
            assert.ok(aiQuestions.includes(id),
                `AI_QUESTION_IDS содержит ${id}, но в seed.js его нет — устаревшая запись`);
        }
    });
});

describe('Stage 5.3.B / renderQuestionField — резолв и рендер field-description', () => {
    const src = stripJsComments(read('js/ui/questionnaire.js'));

    /* Берём «расширенное» тело функции — от начала до следующего `function `
       объявления на корневом уровне. renderQuestionField внутри questionnaire.js
       занимает ~10k символов после удаления комментариев — просто числовой slice
       не покрывает return. */
    function renderQuestionFieldBody() {
        const fnStart = src.indexOf('function renderQuestionField(');
        if (fnStart < 0) return '';
        // Ищем следующее `function ` после функции — это её конец.
        const after = src.indexOf('\nfunction ', fnStart + 30);
        return after < 0 ? src.slice(fnStart) : src.slice(fnStart, after);
    }

    it('renderQuestionField резолвит shortHint через UI_TOOLTIPS_SHORT[`q.${q.id}`]', () => {
        const fnBody = renderQuestionFieldBody();
        assert.ok(fnBody.length > 0, 'renderQuestionField должен существовать');
        assert.match(fnBody, /UI_TOOLTIPS_SHORT\[`q\.\$\{q\.id\}`\]/,
            'renderQuestionField должен использовать UI_TOOLTIPS_SHORT[`q.${q.id}`] для лookup tooltipShort');
    });

    it('renderQuestionField conditionally рендерит <span class="field-description">', () => {
        const fnBody = renderQuestionFieldBody();
        // shortHint = ...;  shortDescription = shortHint ? el('span', { class: 'field-description', ... }) : null;
        assert.match(fnBody, /shortHint\s*\?\s*el\(\s*['"]span['"][^)]*field-description/,
            'renderQuestionField должен conditionally рендерить field-description');
    });

    it('renderQuestionField возвращает div с labelRow + input + shortDescription', () => {
        const fnBody = renderQuestionFieldBody();
        // Порядок аргументов в return — labelRow, input, shortDescription
        // (последовательность важна: short появляется ПОСЛЕ input визуально).
        assert.match(fnBody, /labelRow,\s*input,\s*shortDescription/,
            'renderQuestionField должен возвращать labelRow, input, shortDescription в правильном порядке');
    });
});

describe('Stage 5.3.B / каталог не пересекается с другими секциями (защита от дрейфа)', () => {
    it('q.<id> в UI_TOOLTIPS_SHORT соответствует существующему seed-вопросу', () => {
        const seedIds = new Set(SEED_QUESTIONS.map(q => q.id));
        for (const key of Object.keys(UI_TOOLTIPS_SHORT)) {
            if (!key.startsWith('q.')) continue;
            const id = key.slice(2);
            assert.ok(seedIds.has(id),
                `UI_TOOLTIPS_SHORT['${key}'] ссылается на несуществующий seed-вопрос ${id}`);
        }
    });
});
