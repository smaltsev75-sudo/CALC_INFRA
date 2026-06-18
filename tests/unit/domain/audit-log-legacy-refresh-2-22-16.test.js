/**
 * PATCH 2.22.16 (adversarial-аудит 5B-Sec, оси A/B/E сошлись независимо):
 * security-audit-log-storage-gb сменил формулу на event-модель в v2.22.12,
 * но НЕ был добавлен в _AGENT_FORMULA_REFRESH_IDS → legacy-расчёты при открытии
 * не получали новую формулу и 4 новых вопроса (audit_events_per_day и др.) —
 * ввод пользователя в эти поля тихо игнорировался (оставалась оценка «15% от БД»).
 *
 * Регресс-замок: после enrichLegacyDictionaryWithAgentSeed старая flat-формула
 * рефрешится до event-модели; 4 новых вопроса до-вносятся (step-4); unit/price
 * НЕ меняются (audit-log не в _AGENT_UNIT_PRICE_REFRESH_IDS); числа сходятся с
 * fresh-расчётом (ввод больше не игнорируется).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSeedDictionaries, defaultAnswersFrom, enrichLegacyDictionaryWithAgentSeed
} from '../../../js/domain/seed.js';
import { calculate } from '../../../js/domain/calculator.js';

const ID = 'security-audit-log-storage-gb';
const AUDIT_QUESTIONS = [
    'audit_events_per_day', 'audit_bytes_per_event', 'audit_retention_years', 'audit_log_compression_ratio'
];

// Старая flat-модель «15% от годового объёма БД» (v2.20.59..v2.22.11).
const OLD_FORMULAS = {
    PSI:  'if(Q.audit_logging_required, max(100, (Q.db_size_initial_gb + Q.db_growth_gb_month * 12) * Q.db_count * 0.15 * S.standSizeRatio.PSI), 0)',
    PROD: 'if(Q.audit_logging_required, max(1000, (Q.db_size_initial_gb + Q.db_growth_gb_month * 12) * Q.db_count * 0.15), 0)',
    LOAD: 'if(Q.audit_logging_required, max(100, (Q.db_size_initial_gb + Q.db_growth_gb_month * 12) * Q.db_count * 0.15 * S.standSizeRatio.LOAD), 0)'
};

function mkCalc(dict, answers) {
    const A = defaultAnswersFrom(dict.questions);
    return {
        id: 'leg', name: 'legacy', schemaVersion: 12,
        answers: { ...A, ...answers }, answersMeta: {},
        settings: { ...dict.settings }, dictionaries: dict,
        view: { disabledStands: [] }, providerVersion: null
    };
}
function auditQty(r, sid) {
    const it = r.stands[sid] && r.stands[sid].items.find(x => x.itemId === ID);
    return it ? it.qty : null;
}

describe('2.22.16 audit-log legacy-enrichment: формула рефрешится до event-модели', () => {
    it('старая flat-формула получает event-model qtyFormula на всех стендах', () => {
        const D = buildSeedDictionaries();
        const dict = JSON.parse(JSON.stringify(D));
        const legacy = dict.items.find(i => i.id === ID);
        legacy.qtyFormulas = { ...OLD_FORMULAS };
        legacy.formulaHelp = 'OLD flat 15%';
        const calc = mkCalc(dict, {});
        enrichLegacyDictionaryWithAgentSeed(calc);
        const refreshed = calc.dictionaries.items.find(i => i.id === ID);
        assert.match(refreshed.qtyFormulas.PROD, /audit_events_per_day/, 'PROD должна стать event-моделью');
        assert.match(refreshed.qtyFormulas.PSI, /audit_events_per_day/, 'PSI должна стать event-моделью');
        assert.match(refreshed.qtyFormulas.LOAD, /audit_events_per_day/, 'LOAD должна стать event-моделью');
    });

    it('unit/price НЕ меняются (audit-log не в _AGENT_UNIT_PRICE_REFRESH_IDS)', () => {
        const D = buildSeedDictionaries();
        const dict = JSON.parse(JSON.stringify(D));
        const legacy = dict.items.find(i => i.id === ID);
        const oldUnit = legacy.unit, oldPrice = legacy.pricePerUnit;
        legacy.qtyFormulas = { ...OLD_FORMULAS };
        const calc = mkCalc(dict, {});
        enrichLegacyDictionaryWithAgentSeed(calc);
        const refreshed = calc.dictionaries.items.find(i => i.id === ID);
        assert.equal(refreshed.unit, oldUnit, 'единица не должна меняться');
        assert.equal(refreshed.pricePerUnit, oldPrice, 'цена не должна меняться');
    });

    it('step-4 авто-добавляет 4 новых audit_* вопроса в legacy-словарь', () => {
        const D = buildSeedDictionaries();
        const dict = JSON.parse(JSON.stringify(D));
        // Имитация legacy ДО v2.22.12: нет 4 новых вопросов + старая формула.
        dict.questions = dict.questions.filter(q => !AUDIT_QUESTIONS.includes(q.id));
        dict.items.find(i => i.id === ID).qtyFormulas = { ...OLD_FORMULAS };
        const calc = mkCalc(dict, {});
        enrichLegacyDictionaryWithAgentSeed(calc);
        const qids = new Set(calc.dictionaries.questions.map(q => q.id));
        for (const id of AUDIT_QUESTIONS) {
            assert.ok(qids.has(id), `вопрос ${id} должен быть до-внесён step-4 после рефреша формулы`);
        }
    });

    it('acceptance: после enrich legacy даёт ту же audit-qty, что fresh (ввод не игнорируется)', () => {
        const ANS = {
            audit_logging_required: true,
            audit_events_per_day: 1000000,
            audit_retention_years: 1,
            audit_bytes_per_event: 1000,
            audit_log_compression_ratio: 5,
            db_size_initial_gb: 500, db_growth_gb_month: 10, db_count: 2
        };
        const fresh = buildSeedDictionaries();
        const rFresh = calculate(mkCalc(fresh, ANS), null);

        const D = buildSeedDictionaries();
        const dict = JSON.parse(JSON.stringify(D));
        dict.questions = dict.questions.filter(q => !AUDIT_QUESTIONS.includes(q.id));
        dict.items.find(i => i.id === ID).qtyFormulas = { ...OLD_FORMULAS };
        const calc = mkCalc(dict, ANS);
        enrichLegacyDictionaryWithAgentSeed(calc);
        const rLegacy = calculate(calc, null);

        for (const sid of ['PSI', 'PROD', 'LOAD']) {
            assert.equal(auditQty(rLegacy, sid), auditQty(rFresh, sid),
                `${sid}: legacy audit qty должна совпасть с fresh после enrich`);
        }
        // Именно event-модель (73 ГБ ПРОМ при 1М событий), а не старый пол 1000 ГБ.
        assert.equal(auditQty(rLegacy, 'PROD'), 73, 'ПРОМ должен быть event-значением 73 ГБ, не flat-полом 1000');
    });
});
