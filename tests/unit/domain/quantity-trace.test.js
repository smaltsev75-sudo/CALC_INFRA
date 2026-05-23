import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { wizardToAnswers } from '../../../js/domain/wizardProfiles.js';
import {
    auditQuantityLogic,
    buildQuantityTrace,
    resolvePathValue
} from '../../../js/domain/quantityTrace.js';

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function buildCalc(overrides = {}) {
    const dictionaries = buildSeedDictionaries();
    return {
        id: 'quantity-trace-test',
        name: 'Quantity trace test',
        version: '1.0',
        schemaVersion: 20,
        createdAt: '2026-05-23T00:00:00Z',
        updatedAt: '2026-05-23T00:00:00Z',
        settings: { ...SEED_SETTINGS },
        answers: defaultAnswersFrom(dictionaries.questions),
        answersMeta: {},
        dictionaries,
        ...overrides
    };
}

describe('quantityTrace: reference resolution', () => {
    it('resolvePathValue читает вложенные S.* пути', () => {
        const root = { standSizeRatio: { DEV: 0.2, PROD: 1 } };
        assert.deepEqual(resolvePathValue(root, 'standSizeRatio.DEV'), {
            exists: true,
            value: 0.2,
            missingAt: null
        });
        assert.deepEqual(resolvePathValue(root, 'standSizeRatio.LOAD'), {
            exists: false,
            value: 0,
            missingAt: 'LOAD'
        });
    });
});

describe('quantityTrace: explain one ЭК quantity', () => {
    it('cpu-vcpu-shared/PROD показывает входы формулы и qty', () => {
        const calc = buildCalc({
            settings: { ...SEED_SETTINGS, applyRiskFactors: false, vatEnabled: false },
            answers: {
                ...defaultAnswersFrom(buildSeedDictionaries().questions),
                peak_rps: 200,
                microservices_count: 10,
                async_workers_count: 4
            },
            answersMeta: {
                peak_rps: { source: 'manual' },
                microservices_count: { source: 'manual' },
                async_workers_count: { source: 'manual' }
            }
        });

        const trace = buildQuantityTrace(calc, 'cpu-vcpu-shared', 'PROD');

        assert.equal(trace.qty, 18);
        assert.equal(trace.evaluatedQty, 18);
        assert.match(trace.formulaHelp, /RPS/);
        assert.deepEqual(
            trace.questionInputs.map(input => input.ref).sort(),
            ['Q.async_workers_count', 'Q.microservices_count', 'Q.peak_rps']
        );
        assert.equal(
            trace.questionInputs.find(input => input.ref === 'Q.peak_rps').value,
            200
        );
        assert.equal(
            trace.questionInputs.find(input => input.ref === 'Q.peak_rps').source,
            'manual'
        );
        assert.equal(
            trace.costBase,
            trace.qty * trace.billing.pricePerUnit * trace.billing.billingIntervalMul
        );
    });

    it('RAM на DEV показывает эффективный ресурсный коэффициент, а не сырой общий', () => {
        const settings = deepClone(SEED_SETTINGS);
        settings.resourceRatio.DEV.RAM = 0.25;
        settings.standSizeRatio.DEV = 0.11;

        const calc = buildCalc({
            settings,
            answers: {
                ...defaultAnswersFrom(buildSeedDictionaries().questions),
                peak_rps: 100,
                microservices_count: 4,
                async_workers_count: 2,
                ram_per_vcpu_ratio: 4,
                cache_size_gb: 16
            }
        });

        const trace = buildQuantityTrace(calc, 'ram-gb', 'DEV');
        const ratioInput = trace.settingInputs.find(input => input.ref === 'S.standSizeRatio.DEV');

        assert.ok(ratioInput, 'RAM formula must reference S.standSizeRatio.DEV');
        assert.equal(ratioInput.value, 0.25);
        assert.equal(ratioInput.rawValue, 0.11);
        assert.equal(ratioInput.overriddenByContext, true);
        assert.equal(trace.qty, 12);
    });
});

describe('quantityTrace: audit calculation logic', () => {
    it('типовой Quick Start расчёт не имеет ошибок логики qty/cost', () => {
        const dictionaries = buildSeedDictionaries();
        const baseAnswers = defaultAnswersFrom(dictionaries.questions);
        const { answers, meta } = wizardToAnswers({
            product_type: 'b2b',
            industry: 'corporate',
            scale: 'm',
            geography: 'ru',
            pdn: true,
            activity: 'medium',
            ai_used: false
        });
        const calc = buildCalc({
            dictionaries,
            answers: { ...baseAnswers, ...answers },
            answersMeta: meta
        });

        const audit = auditQuantityLogic(calc);

        assert.deepEqual(audit.errors, []);
        assert.equal(audit.stats.items, dictionaries.items.length);
        assert.ok(audit.stats.formulas > 0);
        assert.ok(audit.stats.questionRefs > 0);
        assert.ok(audit.stats.settingRefs > 0);
    });

    it('аудит ловит битую ссылку Q.* даже если evaluator подставил бы 0', () => {
        const dictionaries = buildSeedDictionaries();
        const items = dictionaries.items.map(item => ({
            ...item,
            qtyFormulas: { ...item.qtyFormulas }
        }));
        items[0].qtyFormulas.PROD = 'Q.no_such_question + 1';

        const calc = buildCalc({
            providerVersion: 'test-snapshot',
            dictionaries: { ...dictionaries, items }
        });

        const audit = auditQuantityLogic(calc);

        assert.ok(
            audit.errors.some(error =>
                error.type === 'unknownQuestion' &&
                error.itemId === items[0].id &&
                error.stand === 'PROD'
            ),
            `unknownQuestion должен быть найден:\n${audit.errors.map(e => e.message).join('\n')}`
        );
    });
});
