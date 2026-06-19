import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate, clearCalculationCache } from '../../../js/domain/calculator.js';
import {
    buildSeedDictionaries,
    defaultAnswersFrom,
    SEED_ITEMS,
    SEED_QUESTIONS,
    SEED_SETTINGS
} from '../../../js/domain/seed.js';
import { prepareLoadedCalc } from '../../../js/services/loadedCalc.js';

function makeCalc(answerOverride = {}) {
    const dictionaries = buildSeedDictionaries();
    const answers = {
        ...defaultAnswersFrom(dictionaries.questions),
        db_commercial_license_required: true,
        db_count: 2,
        db_replicas_count: 1,
        ...answerOverride
    };
    return {
        id: 'db-license-vcpu-override-8a',
        name: 'DB license vCPU override 8A',
        schemaVersion: 22,
        createdAt: '2026-06-19T00:00:00.000Z',
        updatedAt: '2026-06-19T00:00:00.000Z',
        settings: {
            ...structuredClone(SEED_SETTINGS),
            applyRiskFactors: false,
            vatEnabled: false,
            vatRate: 0
        },
        answers,
        dictionaries
    };
}

function prodQty(answerOverride = {}) {
    clearCalculationCache();
    return calculate(makeCalc(answerOverride)).items['license-db-per-vcpu'].stands.PROD.qty;
}

function makeLegacyCalcWithoutVcpuQuestion(answerOverride = {}) {
    const dictionaries = buildSeedDictionaries();
    dictionaries.questions = dictionaries.questions
        .filter(q => q.id !== 'db_license_vcpu_per_node');
    const answers = defaultAnswersFrom(dictionaries.questions);
    delete answers.db_license_vcpu_per_node;
    return {
        id: 'legacy-db-license-vcpu-override-8a',
        name: 'Legacy DB license vCPU override 8A',
        schemaVersion: 21,
        createdAt: '2026-06-19T00:00:00.000Z',
        updatedAt: '2026-06-19T00:00:00.000Z',
        settings: {
            ...structuredClone(SEED_SETTINGS),
            applyRiskFactors: false,
            vatEnabled: false,
            vatRate: 0
        },
        answers: {
            ...answers,
            db_commercial_license_required: true,
            db_count: 2,
            db_replicas_count: 1,
            ...answerOverride
        },
        dictionaries,
        view: {}
    };
}

describe('Package 8A / DB license vCPU per node override', () => {
    it('добавляет вопрос db_license_vcpu_per_node с no-drift default 4', () => {
        const q = SEED_QUESTIONS.find(row => row.id === 'db_license_vcpu_per_node');
        assert.ok(q, 'в seed должен быть вопрос db_license_vcpu_per_node');
        assert.equal(q.type, 'number');
        assert.equal(q.defaultValue, 4);
        assert.equal(q.defaultIfUnknown, 4);
        assert.equal(q.min, 1);
        assert.equal(q.step, 1);
    });

    it('default 4 сохраняет прежнюю qty, override 8 удваивает qty, opt-out даёт 0', () => {
        assert.equal(prodQty(), 16);
        assert.equal(prodQty({ db_license_vcpu_per_node: 8 }), 32);
        assert.equal(prodQty({
            db_commercial_license_required: false,
            db_license_vcpu_per_node: 16
        }), 0);
    });

    it('формула читает Q.db_license_vcpu_per_node вместо hardcoded 4 vCPU', () => {
        const item = SEED_ITEMS.find(row => row.id === 'license-db-per-vcpu');
        assert.ok(item, 'license-db-per-vcpu должен существовать');
        for (const [stand, formula] of Object.entries(item.qtyFormulas)) {
            assert.match(formula, /Q\.db_license_vcpu_per_node/,
                `${stand}: формула должна читать db_license_vcpu_per_node`);
            assert.doesNotMatch(formula, /\*\s*4\b|\b4\s*\*/,
                `${stand}: формула не должна содержать hardcoded * 4`);
        }
    });

    it('legacy refresh до-вносит вопрос через обновлённую формулу и сохраняет default 4', () => {
        const loaded = prepareLoadedCalc(makeLegacyCalcWithoutVcpuQuestion());
        assert.equal(loaded.error, null);
        assert.equal(loaded.needsPersist, true);
        assert.ok(loaded.calc.dictionaries.questions
            .some(q => q.id === 'db_license_vcpu_per_node'));
        assert.equal(loaded.calc.answers.db_license_vcpu_per_node, undefined,
            'legacy answers не надо мутировать — default берётся из словаря');
        const result = calculate(loaded.calc);
        assert.equal(result.items['license-db-per-vcpu'].stands.PROD.qty, 16);
    });

    it('license-db-per-vcpu уже покрыт formula-refresh для legacy-расчётов', () => {
        const seedSrc = SEED_ITEMS.find(row => row.id === 'license-db-per-vcpu');
        assert.ok(seedSrc);
        const legacy = makeLegacyCalcWithoutVcpuQuestion();
        const item = legacy.dictionaries.items.find(row => row.id === 'license-db-per-vcpu');
        item.qtyFormulas.PROD = 'if(Q.db_commercial_license_required, ceil(Q.db_count * 4), 0)';

        const loaded = prepareLoadedCalc(legacy);
        const refreshed = loaded.calc.dictionaries.items.find(row => row.id === 'license-db-per-vcpu');
        assert.match(refreshed.qtyFormulas.PROD, /Q\.db_license_vcpu_per_node/);
    });
});
