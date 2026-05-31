/**
 * Аудит коэффициентов (2026-05-31): прозрачность по AI-предложенным дефолтам.
 * Decision Memo выносит видимый список «Допущения по умолчанию (инженерная
 * оценка, не норматив)» — риск-коэффициенты (когда риски включены) и AI-факторы
 * стендов (когда AI используется), помечая значения «по умолчанию» vs «уточнено».
 * Цель — чтобы читатель memo (согласующий бюджет) видел, какие числа являются
 * инженерной оценкой разработчика модели, а не отраслевым нормативом.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionMemoMarkdown } from '../../../js/services/decisionMemoExport.js';

function calcWith(settings, answers = {}) {
    return { name: 'T', settings, answers, dictionaries: { items: [], questions: [] } };
}

const RISK_DEFAULTS = {
    applyRiskFactors: true, bufferTask: 0.30, bufferProject: 0.15,
    kInflation: 0.10, kSeasonal: 0, kScheduleShift: 0.15, kContingency: 0.05
};

describe('Decision Memo — допущения по умолчанию (инженерная оценка)', () => {
    it('при включённых рисках показывает риск-коэффициенты с дисклеймером', () => {
        const md = buildDecisionMemoMarkdown(calcWith({ ...RISK_DEFAULTS }), {});
        assert.match(md, /Допущения по умолчанию \(инженерная оценка, не норматив\)/);
        assert.match(md, /Буфер задач:\s*\+30/);
        assert.match(md, /Буфер проекта:\s*\+15/);
        assert.match(md, /Инфляция:\s*\+10/);
        assert.match(md, /Непредвиденные:\s*\+5/);
        // Сдвиг расписания — корректная семантика (только разовые затраты, не LOAD):
        assert.match(md, /Сдвиг расписания[^\n]*только разовые затраты/);
        assert.match(md, /не отраслевой норматив/);
    });

    it('помечает значение «по умолчанию» vs «уточнено»', () => {
        const md = buildDecisionMemoMarkdown(calcWith({ ...RISK_DEFAULTS, bufferProject: 0.40 }), {});
        assert.match(md, /Буфер задач:\s*\+30[^\n]*по умолчанию/);
        assert.match(md, /Буфер проекта:\s*\+40[^\n]*уточнено/);
    });

    it('AI-факторы стендов выводятся только при использовании AI', () => {
        const withAi = buildDecisionMemoMarkdown(calcWith(
            { ...RISK_DEFAULTS, aiStandFactor: { DEV: 0.02, IFT: 0.2, PSI: 0.5, LOAD: 1.0, PROD: 1.0 } },
            { ai_llm_used: true }), {});
        assert.match(withAi, /AI-нагрузка на стендах/);

        const noAi = buildDecisionMemoMarkdown(calcWith(
            { ...RISK_DEFAULTS, aiStandFactor: { DEV: 0.02 } }, {}), {});
        assert.doesNotMatch(noAi, /AI-нагрузка на стендах/);
    });

    it('в режиме «без рисков» риск-коэффициенты как применённые не выводятся', () => {
        const md = buildDecisionMemoMarkdown(calcWith({ applyRiskFactors: false, bufferTask: 0.30 }, {}), {});
        assert.doesNotMatch(md, /Буфер задач/);
    });
});
