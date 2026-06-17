/**
 * Stage 5.3.C.1 — Tooltip Short/Full spread на секции «Бизнес и пользователи»
 * + «Профиль нагрузки».
 *
 * 17 полей: 9 в business (включая master `seasonal_activity` и dependent `peak_months`)
 * + 8 в load_profile. Покрытие через UI_TOOLTIPS_SHORT['q.<id>'].
 *
 * renderQuestionField менять не нужно — auto-resolve через ключ `q.${q.id}`
 * уже работает (Stage 5.3.B). Этот PATCH = чисто content (новые ключи в каталог)
 * + защита от дрейфа.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UI_TOOLTIPS_SHORT } from '../../../js/utils/constants.js';
import { SEED_QUESTIONS } from '../../../js/domain/seed.js';

const BUSINESS_QUESTION_IDS = [
    'users_total',
    'registered_users_total',
    'dau_share_of_registered_percent',
    'pcu_target',
    'product_type',
    'audience_geography',
    'seasonal_activity',
    'peak_months'
];

const LOAD_QUESTION_IDS = [
    'peak_rps',
    'avg_rps',
    'peak_duration_hours',
    'avg_request_size_kb',
    'avg_response_size_kb',
    'traffic_egress_tb_month',
    'traffic_ingress_tb_month',
    'microservices_count',
    'async_workers_count',
    'realtime_required',
    // Stage 4 (qty-модель ПРОМ): расширенная модель CPU.
    'cpu_advanced_model',
    'cpu_ms_per_request',
    'cpu_target_utilization_percent',
    'min_instances_per_stand'
];

describe('Stage 5.3.C.1 / Business секция — каталог покрывает все 9 полей', () => {
    it('UI_TOOLTIPS_SHORT содержит ключи q.<id> для всех вопросов секции business', () => {
        for (const id of BUSINESS_QUESTION_IDS) {
            const key = `q.${id}`;
            assert.ok(UI_TOOLTIPS_SHORT[key],
                `UI_TOOLTIPS_SHORT['${key}'] должен быть задан`);
        }
    });

    it('каждый business tooltipShort ≤ 120 символов', () => {
        for (const id of BUSINESS_QUESTION_IDS) {
            const text = UI_TOOLTIPS_SHORT[`q.${id}`];
            assert.ok(text.length <= 120,
                `q.${id} (${text.length} симв): «${text}» — должен быть ≤120`);
        }
    });

    it('каждый business tooltipShort заканчивается знаком препинания', () => {
        for (const id of BUSINESS_QUESTION_IDS) {
            const text = UI_TOOLTIPS_SHORT[`q.${id}`];
            assert.match(text, /[.!?…]$/,
                `q.${id} должен заканчиваться знаком препинания: «${text}»`);
        }
    });

    it('бизнес-русский: PCU развёрнут как «Пиковая одновременная аудитория (PCU)»', () => {
        // Конкретные критические аббревиатуры в business секции (Stage 4.15 правило).
        assert.match(UI_TOOLTIPS_SHORT['q.pcu_target'], /\(PCU\)/,
            'q.pcu_target должен содержать «(PCU)» — расшифровка для бизнес-русского');
        assert.match(UI_TOOLTIPS_SHORT['q.dau_share_of_registered_percent'], /DAU/,
            'q.dau_share_of_registered_percent должен упоминать DAU');
    });

    it('перекрёстная проверка: business секция в seed.js полностью покрыта', () => {
        const businessQuestions = SEED_QUESTIONS
            .filter(q => q.section === 'business')
            .map(q => q.id);
        for (const id of businessQuestions) {
            assert.ok(BUSINESS_QUESTION_IDS.includes(id),
                `Business-вопрос ${id} есть в seed.js, но отсутствует в каталоге BUSINESS_QUESTION_IDS — добавьте в UI_TOOLTIPS_SHORT и в массив теста`);
        }
        for (const id of BUSINESS_QUESTION_IDS) {
            assert.ok(businessQuestions.includes(id),
                `BUSINESS_QUESTION_IDS содержит ${id}, но в seed.js его нет — устаревшая запись`);
        }
    });
});

describe('Stage 5.3.C.1 / Load profile секция — каталог покрывает все поля', () => {
    it('UI_TOOLTIPS_SHORT содержит ключи q.<id> для всех вопросов load_profile', () => {
        for (const id of LOAD_QUESTION_IDS) {
            const key = `q.${id}`;
            assert.ok(UI_TOOLTIPS_SHORT[key],
                `UI_TOOLTIPS_SHORT['${key}'] должен быть задан`);
        }
    });

    it('каждый load_profile tooltipShort ≤ 120 символов', () => {
        for (const id of LOAD_QUESTION_IDS) {
            const text = UI_TOOLTIPS_SHORT[`q.${id}`];
            assert.ok(text.length <= 120,
                `q.${id} (${text.length} симв): «${text}» — должен быть ≤120`);
        }
    });

    it('каждый load_profile tooltipShort заканчивается знаком препинания', () => {
        for (const id of LOAD_QUESTION_IDS) {
            const text = UI_TOOLTIPS_SHORT[`q.${id}`];
            assert.match(text, /[.!?…]$/,
                `q.${id} должен заканчиваться знаком препинания: «${text}»`);
        }
    });

    it('бизнес-русский: RPS развёрнут как «(RPS)» хотя бы в одном поле', () => {
        // Хотя бы peak_rps должен расшифровать аббревиатуру (первое упоминание
        // в секции — стандарт Stage 4.15).
        assert.match(UI_TOOLTIPS_SHORT['q.peak_rps'], /\(RPS\)/,
            'q.peak_rps должен содержать «(RPS)» — расшифровка для бизнес-русского');
    });

    it('перекрёстная проверка: load_profile секция в seed.js полностью покрыта', () => {
        const loadQuestions = SEED_QUESTIONS
            .filter(q => q.section === 'load_profile')
            .map(q => q.id);
        for (const id of loadQuestions) {
            assert.ok(LOAD_QUESTION_IDS.includes(id),
                `Load-вопрос ${id} есть в seed.js, но отсутствует в каталоге LOAD_QUESTION_IDS`);
        }
        for (const id of LOAD_QUESTION_IDS) {
            assert.ok(loadQuestions.includes(id),
                `LOAD_QUESTION_IDS содержит ${id}, но в seed.js его нет`);
        }
    });
});

describe('Stage 5.3.C.1 / Накопительный каталог — общая статистика', () => {
    it('UI_TOOLTIPS_SHORT содержит >= 60 ключей после Stage 5.3.C.1 (Settings + QS + AI + Business + Load)', () => {
        const total = Object.keys(UI_TOOLTIPS_SHORT).length;
        // 14 settings + 8 QS + 26 AI + 17 business+load = 65
        assert.ok(total >= 65,
            `UI_TOOLTIPS_SHORT должен содержать ≥65 ключей, сейчас ${total}`);
    });

    it('Все q.<id> ключи покрывают существующие seed-вопросы (нет orphan-ключей)', () => {
        const seedIds = new Set(SEED_QUESTIONS.map(q => q.id));
        for (const key of Object.keys(UI_TOOLTIPS_SHORT)) {
            if (!key.startsWith('q.')) continue;
            const id = key.slice(2);
            assert.ok(seedIds.has(id),
                `UI_TOOLTIPS_SHORT['${key}'] ссылается на несуществующий seed-вопрос ${id}`);
        }
    });
});
