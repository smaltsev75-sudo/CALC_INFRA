import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { prepareLoadedCalc } from '../../../js/services/loadedCalc.js';

function makeLegacyTrafficCalc() {
    const dictionaries = buildSeedDictionaries();
    dictionaries.questions = dictionaries.questions
        .filter(q => q.id !== 'traffic_egress_tb_month' && q.id !== 'traffic_ingress_tb_month');

    const egress = dictionaries.items.find(item => item.id === 'traffic-egress-tb');
    egress.qtyFormulas = {
        IFT:  'ceil((Q.avg_rps * 86400 * Q.avg_response_size_kb * 30 / 1048576 / 1024) * S.standSizeRatio.IFT)',
        PSI:  'ceil((Q.avg_rps * 86400 * Q.avg_response_size_kb * 30 / 1048576 / 1024) * S.standSizeRatio.PSI)',
        PROD: 'ceil(Q.avg_rps * 86400 * Q.avg_response_size_kb * 30 / 1048576 / 1024)',
        LOAD: 'ceil((Q.avg_rps * 86400 * Q.avg_response_size_kb * 30 / 1048576 / 1024) * S.standSizeRatio.LOAD)'
    };

    const ingress = dictionaries.items.find(item => item.id === 'traffic-ingress-tb');
    ingress.qtyFormulas = {
        IFT:  'ceil((Q.avg_rps * 86400 * Q.avg_request_size_kb * 30 / 1048576 / 1024) * S.standSizeRatio.IFT)',
        PSI:  'ceil((Q.avg_rps * 86400 * Q.avg_request_size_kb * 30 / 1048576 / 1024) * S.standSizeRatio.PSI)',
        PROD: 'ceil(Q.avg_rps * 86400 * Q.avg_request_size_kb * 30 / 1048576 / 1024)',
        LOAD: 'ceil((Q.avg_rps * 86400 * Q.avg_request_size_kb * 30 / 1048576 / 1024) * S.standSizeRatio.LOAD)'
    };

    return {
        id: 'legacy-traffic',
        name: 'Legacy traffic',
        schemaVersion: 12,
        createdAt: '2026-05-25T00:00:00.000Z',
        updatedAt: '2026-05-25T00:00:00.000Z',
        settings: structuredClone(SEED_SETTINGS),
        answers: {
            ...defaultAnswersFrom(dictionaries.questions),
            avg_rps: 80,
            avg_response_size_kb: 20,
            avg_request_size_kb: 5,
            traffic_egress_tb_month: 15,
            traffic_ingress_tb_month: 2
        },
        dictionaries,
        view: {}
    };
}

describe('prepareLoadedCalc: legacy traffic answers refresh', () => {
    it('добавляет traffic-вопросы и обновляет формулы, чтобы Quick Start traffic не был orphan', () => {
        const loaded = prepareLoadedCalc(makeLegacyTrafficCalc());

        assert.equal(loaded.error, null);
        assert.equal(loaded.needsPersist, true);
        assert.ok(loaded.calc.dictionaries.questions.some(q => q.id === 'traffic_egress_tb_month'));
        assert.ok(loaded.calc.dictionaries.questions.some(q => q.id === 'traffic_ingress_tb_month'));

        const egress = loaded.calc.dictionaries.items.find(item => item.id === 'traffic-egress-tb');
        const ingress = loaded.calc.dictionaries.items.find(item => item.id === 'traffic-ingress-tb');
        assert.match(egress.qtyFormulas.PROD, /traffic_egress_tb_month/);
        assert.match(ingress.qtyFormulas.PROD, /traffic_ingress_tb_month/);

        const result = calculate(loaded.calc);
        assert.equal(result.items['traffic-egress-tb'].stands.PROD.qty, 15);
        assert.equal(result.items['traffic-ingress-tb'].stands.PROD.qty, 2);
    });
});
