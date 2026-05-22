/**
 * Этап 13.U6: AI / RAG / агенты — отдельная секция дашборда.
 *
 * Тест защищает 3 контракта:
 *   1. Константы экспортируются, заморожены, длина 4, описания ≥ 30 симв.
 *   2. SEED_ITEMS содержит ЭК с каждым из 4 значений `dashboardAiMetric`.
 *   3. Двойное тегирование: `ai-agent-sandbox-vcpu` имеет ОБА поля
 *      (`dashboardResource: 'CPU'` + `dashboardAiMetric: 'AGENT_CPU'`) —
 *      это намеренная информационная подсветка «из общего CPU столько-то
 *      под агентов». Удаление любого из полей сломает контракт.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    DASHBOARD_AI_METRIC_LABELS,
    DASHBOARD_AI_METRIC_TITLES,
    DASHBOARD_AI_METRIC_DESCRIPTIONS,
    DASHBOARD_AI_METRIC_GROUP_TITLE,
    DASHBOARD_AI_METRIC_GROUP_HINT
} from '../../../js/utils/constants.js';
import { SEED_ITEMS } from '../../../js/domain/seed.js';

const REQUIRED = ['TOKENS', 'RAG_VECTORS', 'EMBEDDINGS', 'AGENT_CPU'];

describe('Dashboard AI metrics — константы', () => {

    it('DASHBOARD_AI_METRIC_LABELS — заморожен, length=4, точный список', () => {
        assert.ok(Object.isFrozen(DASHBOARD_AI_METRIC_LABELS));
        assert.equal(DASHBOARD_AI_METRIC_LABELS.length, 4);
        assert.deepEqual([...DASHBOARD_AI_METRIC_LABELS], REQUIRED);
    });

    it('DASHBOARD_AI_METRIC_TITLES — заморожен, ключи покрывают все labels', () => {
        assert.ok(Object.isFrozen(DASHBOARD_AI_METRIC_TITLES));
        for (const key of REQUIRED) {
            assert.ok(key in DASHBOARD_AI_METRIC_TITLES,
                `DASHBOARD_AI_METRIC_TITLES["${key}"] должен существовать`);
            assert.equal(typeof DASHBOARD_AI_METRIC_TITLES[key], 'string');
            assert.ok(DASHBOARD_AI_METRIC_TITLES[key].length > 0);
        }
    });

    it('DASHBOARD_AI_METRIC_DESCRIPTIONS — все описания ≥ 30 символов', () => {
        assert.ok(Object.isFrozen(DASHBOARD_AI_METRIC_DESCRIPTIONS));
        for (const key of REQUIRED) {
            const desc = DASHBOARD_AI_METRIC_DESCRIPTIONS[key];
            assert.equal(typeof desc, 'string', `${key}: должен быть string`);
            assert.ok(desc.trim().length >= 30,
                `${key}: описание ${desc.length} симв. — слишком коротко для ` +
                `отображения в info-tooltip согласования с заказчиком.`);
        }
    });

    it('AGENT_CPU описание явно говорит «уже учтено в CPU»', () => {
        // Защита от удаления критического хинта: AGENT_CPU тегируется ДВОЙНО
        // (CPU + AGENT_CPU) — без напоминания пользователь решит сложить.
        const desc = DASHBOARD_AI_METRIC_DESCRIPTIONS.AGENT_CPU;
        assert.match(desc, /уже\s+(?:ВКЛЮЧЕНА?|включена?|учтена?)|не складывайте/i,
            'AGENT_CPU описание ОБЯЗАНО предупредить про двойное тегирование. ' +
            'Иначе пользователь увидит CPU=130 + AGENT_CPU=30 и сложит 160.');
    });

    it('GROUP_TITLE и GROUP_HINT — непустые строки', () => {
        assert.equal(typeof DASHBOARD_AI_METRIC_GROUP_TITLE, 'string');
        assert.ok(DASHBOARD_AI_METRIC_GROUP_TITLE.length > 0);
        assert.equal(typeof DASHBOARD_AI_METRIC_GROUP_HINT, 'string');
        assert.ok(DASHBOARD_AI_METRIC_GROUP_HINT.length >= 50,
            'group-hint должен быть содержательным — пользователь читает его, ' +
            'чтобы понять отличие AI-метрик от железа.');
    });
});

describe('Dashboard AI metrics — теги в SEED', () => {

    it('SEED_ITEMS содержит ЭК с каждым из 4 значений dashboardAiMetric', () => {
        const found = new Map();
        for (const item of SEED_ITEMS) {
            if (!item.dashboardAiMetric) continue;
            if (!found.has(item.dashboardAiMetric)) found.set(item.dashboardAiMetric, []);
            found.get(item.dashboardAiMetric).push(item.id);
        }
        for (const label of REQUIRED) {
            assert.ok(found.has(label),
                `Ни один ЭК в SEED не имеет dashboardAiMetric="${label}". ` +
                `Без этого секция AI-метрик не покажет данные. ` +
                `Добавьте поле к соответствующему ЭК в seed.js.`);
        }
    });

    it('ai-agent-sandbox-vcpu имеет ОБА: dashboardResource=CPU и dashboardAiMetric=AGENT_CPU', () => {
        const item = SEED_ITEMS.find(it => it.id === 'ai-agent-sandbox-vcpu');
        assert.ok(item, 'ЭК ai-agent-sandbox-vcpu должен существовать в seed');
        assert.equal(item.dashboardResource, 'CPU',
            'dashboardResource: "CPU" обязателен — vCPU агентов учтён в общем CPU-агрегате.');
        assert.equal(item.dashboardAiMetric, 'AGENT_CPU',
            'dashboardAiMetric: "AGENT_CPU" обязателен — информационная подсветка ' +
            '«из общего CPU столько-то отдано под sandbox агентов».');
    });

    it('llm-tokens-input-1m и llm-tokens-output-1m оба имеют dashboardAiMetric=TOKENS', () => {
        const items = SEED_ITEMS.filter(it =>
            it.id === 'llm-tokens-input-1m' || it.id === 'llm-tokens-output-1m');
        assert.equal(items.length, 2, 'оба ЭК токенов должны быть в seed');
        for (const it of items) {
            assert.equal(it.dashboardAiMetric, 'TOKENS',
                `${it.id}: должен агрегироваться в метрике TOKENS (input+output).`);
        }
    });
});
