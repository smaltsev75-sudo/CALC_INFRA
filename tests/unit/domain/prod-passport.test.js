import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from '../../../js/domain/calculator.js';
import { repairUnknownAnswersWithDefaults } from '../../../js/domain/answerRepair.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { buildProdPassport } from '../../../js/domain/prodPassport.js';

function makeCalc(overrides = {}) {
    const dictionaries = overrides.dictionaries || buildSeedDictionaries();
    return {
        id: 'prod-passport-test',
        name: 'Prod passport test',
        schemaVersion: 20,
        settings: { ...SEED_SETTINGS, applyRiskFactors: false, vatEnabled: true, vatRate: 0.22, ...(overrides.settings || {}) },
        answers: {
            ...defaultAnswersFrom(dictionaries.questions || []),
            registered_users_total: 500,
            dau_share_of_registered_percent: 0.7,
            ai_users_share: 30,
            ai_requests_per_user_day: 30,
            ai_avg_input_tokens: 3000,
            ai_avg_output_tokens: 500,
            ai_llm_used: true,
            rag_needed: true,
            rag_managed_used: false,
            rag_embeddings_million: 1,
            rag_retrieval_calls_per_query: 4,
            peak_rps: 50,
            microservices_count: 5,
            async_workers_count: 3,
            ram_per_vcpu_ratio: 4,
            cache_size_gb: 8,
            ...(overrides.answers || {})
        },
        answersMeta: {
            peak_rps: { source: 'manual' },
            microservices_count: { source: 'manual' },
            async_workers_count: { source: 'manual' },
            ram_per_vcpu_ratio: { source: 'manual' },
            ...(overrides.answersMeta || {})
        },
        dictionaries,
        view: overrides.view || {}
    };
}

function prodCostTotal(calc, result) {
    return (calc.dictionaries.items || [])
        .filter(item => (item.applicableStands || []).includes('PROD'))
        .reduce((sum, item) => sum + (result.items[item.id]?.stands.PROD?.costFinal || 0), 0);
}

describe('buildProdPassport', () => {
    it('строит паспорт ПРОМ из calculate(): суммы и строки ЭК совпадают с результатом расчёта', () => {
        const calc = makeCalc();
        const result = calculate(calc);

        const passport = buildProdPassport(calc, { result, stand: 'PROD', limit: 10 });

        assert.equal(passport.stand, 'PROD');
        assert.equal(passport.summary.totalMonthly, prodCostTotal(calc, result));
        assert.equal(passport.summary.totalAnnual, passport.summary.totalMonthly * 12);
        assert.equal(passport.page.items.length, 10);
        assert.equal(passport.page.offset, 0);
        assert.equal(passport.page.limit, 10);
        assert.ok(passport.page.total >= passport.page.items.length);

        for (let i = 1; i < passport.items.length; i += 1) {
            assert.ok(
                passport.items[i - 1].monthlyCost >= passport.items[i].monthlyCost,
                'ЭК должны быть отсортированы по убыванию Бюджет/мес.'
            );
        }

        for (const row of passport.items) {
            const expected = result.items[row.itemId]?.stands.PROD;
            assert.equal(row.quantity, expected?.qty || 0, `${row.itemId}: количество должно совпадать с calculate()`);
            assert.equal(row.monthlyCost, expected?.costFinal || 0, `${row.itemId}: бюджет должен совпадать с calculate()`);
            assert.equal(row.annualCost, row.monthlyCost * 12);
        }
    });

    it('для раскрытия ЭК показывает формулу, подстановку, источники значений и состав стоимости', () => {
        const calc = makeCalc({
            answers: { cache_size_gb: undefined },
            answersMeta: {
                ram_per_vcpu_ratio: { source: 'manual' }
            }
        });
        delete calc.answers.cache_size_gb;
        const result = calculate(calc);

        const passport = buildProdPassport(calc, { result, stand: 'PROD' });
        const ram = passport.items.find(item => item.itemId === 'ram-gb');

        assert.ok(ram, 'RAM должен присутствовать в паспорте ПРОМ');
        assert.equal(ram.quantityFormula.technical, calc.dictionaries.items.find(item => item.id === 'ram-gb').qtyFormulas.PROD);
        assert.match(ram.quantityFormula.text, /RAM|ГБ|vCPU|кэш/i);
        assert.match(ram.quantityFormula.substitution, /=/);

        const ramRatio = ram.inputs.questions.find(input => input.id === 'ram_per_vcpu_ratio');
        assert.equal(ramRatio.label, 'RAM на 1 vCPU');
        assert.equal(ramRatio.sourceLabel, 'введено вручную');
        assert.equal(ramRatio.technicalRef, 'Q.ram_per_vcpu_ratio');

        const cache = ram.inputs.questions.find(input => input.id === 'cache_size_gb');
        assert.equal(cache.sourceLabel, 'значение по умолчанию');
        assert.equal(cache.technicalRef, 'Q.cache_size_gb');

        assert.equal(ram.costFormula.label, 'Стоимость = количество × цена × тариф × риски × НДС');
        assert.deepEqual(
            ram.costFormula.components.map(component => component.label),
            ['Количество', 'Цена', 'Тариф', 'Риски', 'НДС', 'Итог']
        );
        assert.match(ram.costFormula.resultText, /тыс\.руб\.\/мес\./);
    });

    it('не маскирует неизвестный источник ответа как значение из опросника', () => {
        const calc = makeCalc({
            answersMeta: {
                ram_per_vcpu_ratio: { source: 'future-import' }
            }
        });
        const passport = buildProdPassport(calc, { result: calculate(calc), stand: 'PROD' });
        const ram = passport.items.find(item => item.itemId === 'ram-gb');
        const ramRatio = ram.inputs.questions.find(input => input.id === 'ram_per_vcpu_ratio');

        assert.equal(ramRatio.sourceLabel, 'неизвестный источник: future-import');
    });

    it('сводка влияния показывает конкретные факторы как пересекающийся охват бюджета', () => {
        const calc = makeCalc();
        const passport = buildProdPassport(calc, { result: calculate(calc), stand: 'PROD', topFactorsLimit: 8 });

        assert.ok(passport.summary.topFactors.length > 0);
        for (const factor of passport.summary.topFactors) {
            assert.ok(factor.label, 'у фактора должно быть русское название');
            assert.ok(factor.monthlyImpact >= 0);
            assert.ok(factor.coveragePercent >= 0);
            assert.match(factor.monthlyText, /тыс\.руб\.\/мес\./);
            assert.match(factor.coverageText, /%$/);
            assert.equal('isOverlappingAttribution' in factor, false);
        }

        for (let i = 1; i < passport.summary.topFactors.length; i += 1) {
            assert.ok(
                passport.summary.topFactors[i - 1].monthlyImpact >= passport.summary.topFactors[i].monthlyImpact,
                'факторы должны быть отсортированы по убыванию связанных затрат'
            );
        }
        assert.ok(
            passport.summary.topFactors.some(factor => factor.itemIds.length > 0),
            'фактор должен ссылаться на связанные ЭК, а не быть декоративной строкой'
        );
    });

    it('не называет ошибку парсинга зацикливанием формулы', () => {
        const dictionaries = {
            questions: [],
            settings: {},
            items: [{
                id: 'ram-gb',
                name: 'RAM',
                unit: 'ГБ',
                pricePerUnit: 1000,
                billingInterval: 'monthly',
                category: 'HW',
                resourceClass: 'RAM',
                applicableStands: ['PROD'],
                qtyFormulas: { PROD: 'ram-gb + 1' },
                formulaHelp: 'RAM test'
            }]
        };
        const calc = makeCalc({ dictionaries, answers: {}, answersMeta: {} });

        const passport = buildProdPassport(calc, {
            result: calculate(calc),
            stand: 'PROD',
            includeZero: true
        });
        const ram = passport.items.find(item => item.itemId === 'ram-gb');

        assert.ok(ram.errors.some(error => error.type === 'formula-error'));
        assert.doesNotMatch(ram.errorText, /зацикливание расчёта/);
        assert.match(ram.errorText, /Неизвестный идентификатор/);
        assert.equal(passport.summary.warningItemsCount, 1);
    });

    it('помечает нечисловой бюджет ЭК предупреждением, а не тихим нулём', () => {
        const dictionaries = {
            questions: [],
            settings: {},
            items: [{
                id: 'broken-cost',
                name: 'Broken cost',
                unit: 'шт.',
                pricePerUnit: 1000,
                billingInterval: 'monthly',
                category: 'SERVICE',
                resourceClass: 'SERVICE',
                applicableStands: ['PROD'],
                qtyFormulas: { PROD: '1' },
                formulaHelp: 'Broken cost test'
            }]
        };
        const calc = makeCalc({ dictionaries, answers: {}, answersMeta: {} });
        const result = calculate(calc);
        result.items['broken-cost'].stands.PROD.costFinal = Number.NaN;

        const passport = buildProdPassport(calc, {
            result,
            stand: 'PROD',
            includeZero: true
        });
        const row = passport.items.find(item => item.itemId === 'broken-cost');

        assert.equal(row.monthlyCost, 0);
        assert.ok(row.errors.some(error => error.type === 'non-finite-cost'));
        assert.ok(row.markers.some(marker => marker.type === 'warning'));
        assert.match(row.errorText, /Бюджет ЭК не является числом/);
        assert.equal(passport.summary.warningItemsCount, 1);
    });

    it('явно показывает, что Паспорт ПРОМ недоступен, если стенд ПРОМ скрыт', () => {
        const calc = makeCalc({ view: { disabledStands: ['PROD'] } });
        const passport = buildProdPassport(calc, { result: calculate(calc), stand: 'PROD' });

        assert.equal(passport.standDisabled, true);
        assert.equal(passport.items.length, 0);
        assert.equal(passport.page.items.length, 0);
        assert.equal(passport.summary.totalMonthly, 0);
        assert.match(passport.emptyStateMessage, /Стенд ПРОМ скрыт/);
    });

    it('после безопасного ремонта JSON показывает автоисправленные ЭК в сводке и маркерах', () => {
        const calc = makeCalc({
            answers: { cache_size_gb: null },
            answersMeta: {}
        });

        const repair = repairUnknownAnswersWithDefaults(calc);
        const passport = buildProdPassport(calc, { result: calculate(calc), stand: 'PROD' });
        const repairedRows = passport.items.filter(row => row.markers.some(marker => marker.type === 'repair'));

        assert.equal(repair.changed, true);
        assert.equal(passport.summary.repairedItemsCount, 1);
        assert.deepEqual(repairedRows.map(row => row.itemId), ['ram-gb']);
    });
});
