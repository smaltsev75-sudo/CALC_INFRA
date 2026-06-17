import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { calculate } from '../../../js/domain/calculator.js';
import { repairUnknownAnswersWithDefaults } from '../../../js/domain/answerRepair.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { buildProdPassport, settingLabel, questionUnit } from '../../../js/domain/prodPassport.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));

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

        const passport = buildProdPassport(calc, { result, stand: 'PROD', limit: Number.MAX_SAFE_INTEGER });

        assert.equal(passport.stand, 'PROD');
        assert.equal(passport.summary.totalMonthly, prodCostTotal(calc, result));
        assert.equal(passport.summary.totalAnnual, passport.summary.totalMonthly * 12);
        // карта показывает ВСЕ ЭК (пагинации в UI нет)
        assert.ok(passport.items.length > 0);
        assert.equal(passport.summary.itemsCount, passport.items.length);

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
        assert.doesNotMatch(ram.quantityFormula.substitution, /Q\./);
        assert.match(ram.quantityFormula.substitution, /4/);
        assert.match(ram.quantityFormula.substitution, /8/);

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
            ['Количество', 'Цена', 'Тариф', 'Риски', 'НДС']
        );
        assert.ok(!ram.costFormula.components.some(component => component.label === 'Итог'));
        assert.match(ram.costFormula.resultText, /тыс\.руб\.\/мес\./);
    });

    it('показывает расчёт количества теми же параметрами, которые выведены в подставленных значениях', () => {
        const calc = makeCalc({
            answers: {
                traffic_egress_tb_month: 15,
                peak_rps: 80,
                avg_rps: 80,
                peak_duration_hours: 2,
                avg_response_size_kb: 20
            },
            answersMeta: {
                traffic_egress_tb_month: { source: 'wizard' },
                peak_rps: { source: 'manual' },
                avg_rps: { source: 'manual' }
            }
        });
        const passport = buildProdPassport(calc, { result: calculate(calc), stand: 'PROD' });
        const traffic = passport.items.find(item => item.itemId === 'traffic-egress-tb');

        assert.ok(traffic);
        assert.equal(traffic.quantity, 15);
        assert.deepEqual(
            traffic.inputs.questions.map(input => input.label),
            ['Фактический исходящий трафик, ТБ/мес']
        );
        assert.match(traffic.quantityFormula.text, /Фактический исходящий трафик, ТБ\/мес/);
        assert.doesNotMatch(traffic.quantityFormula.text, /traffic_egress_tb_month|peak_rps|avg_rps/);
        assert.match(traffic.quantityFormula.substitution, /Фактический исходящий трафик, ТБ\/мес \(15\)/);
        assert.match(traffic.quantityFormula.substitution, /= 15 ТБ/);
        assert.doesNotMatch(traffic.quantityFormula.substitution, /86400|1048576|Пиковое число запросов|Среднее число запросов|Средний размер одного ответа/);
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

    it('сводка влияния = sensitivity (влияние на бюджет при ±10%/переключении), значения разные', () => {
        const calc = makeCalc();
        const passport = buildProdPassport(calc, { result: calculate(calc), stand: 'PROD', topFactorsLimit: 8 });

        assert.ok(passport.summary.topFactors.length > 0);
        for (const factor of passport.summary.topFactors) {
            assert.ok(factor.label, 'у фактора должно быть русское название');
            assert.ok(factor.monthlyImpact >= 0 && Number.isFinite(factor.monthlyImpact));
            assert.ok(factor.coveragePercent >= 0);
            assert.match(factor.monthlyText, /тыс\.руб\.\/мес\./);
            assert.match(factor.coverageText, /%$/);
        }

        // Отсортированы по убыванию влияния на бюджет.
        for (let i = 1; i < passport.summary.topFactors.length; i += 1) {
            assert.ok(
                passport.summary.topFactors[i - 1].monthlyImpact >= passport.summary.topFactors[i].monthlyImpact,
                'факторы должны быть отсортированы по убыванию влияния на бюджет'
            );
        }

        // Ключевой фикс: разные факторы дают РАЗНОЕ влияние (sensitivity), а не
        // одинаковые числа, как при прежней метрике «сумма стоимости затронутых ЭК».
        if (passport.summary.topFactors.length >= 2) {
            const impacts = passport.summary.topFactors.map(f => f.monthlyImpact);
            assert.ok(new Set(impacts).size > 1,
                `значения влияния должны различаться, получено: ${impacts.join(', ')}`);
        }
    });

    it('фильтрует список ЭК по названию без изменения сводки ПРОМ', () => {
        const calc = makeCalc();
        const result = calculate(calc);
        const full = buildProdPassport(calc, { result, stand: 'PROD', limit: 10 });
        const filtered = buildProdPassport(calc, {
            result,
            stand: 'PROD',
            limit: 10,
            search: 'оперативная'
        });

        assert.ok(full.items.length > filtered.items.length);
        assert.ok(filtered.items.length > 0);
        assert.ok(filtered.items.every(item => item.name.toLocaleLowerCase('ru-RU').includes('оперативная')));
        assert.equal(filtered.search, 'оперативная');
        assert.equal(filtered.summary.itemsCount, full.summary.itemsCount);
        assert.equal(filtered.summary.totalMonthly, full.summary.totalMonthly);
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

describe('Паспорт ПРОМ — единицы измерения и человекочитаемые метки', () => {
    it('questionUnit отдаёт единицу там, где короткая метка её потеряла, и пусто где она уже в метке', () => {
        // override-метки (Кэш, RAM на 1 vCPU, Доля…) срезали единицу из title
        assert.equal(questionUnit({ id: 'cache_size_gb' }), 'ГБ');
        assert.equal(questionUnit({ id: 'ram_per_vcpu_ratio' }), 'ГБ');
        assert.equal(questionUnit({ id: 'dau_share_of_registered_percent' }), '%');
        assert.equal(questionUnit({ id: 'ai_users_share' }), '%');
        // счётные параметры получают «шт.»
        assert.equal(questionUnit({ id: 'microservices_count' }), 'шт.');
        assert.equal(questionUnit({ id: 'async_workers_count' }), 'шт.');
        // где единица уже в словах метки — не дублируем
        assert.equal(questionUnit({ id: 'peak_rps' }), '');         // «Пиковый RPS»
        assert.equal(questionUnit({ id: 'ai_avg_input_tokens' }), ''); // «Входящие токены…»
    });

    it('unit прокидывается в inputs.questions модели Паспорта', () => {
        const calc = makeCalc();
        const passport = buildProdPassport(calc, { result: calculate(calc), stand: 'PROD' });
        const cache = passport.items
            .flatMap(row => row.inputs.questions)
            .find(input => input.id === 'cache_size_gb');
        assert.ok(cache, 'cache_size_gb присутствует во входных параметрах какого-то ЭК');
        assert.equal(cache.unit, 'ГБ');
    });

    it('производные AI-множители имеют человекочитаемые метки (не технический путь)', () => {
        assert.equal(settingLabel({ path: 'agentStepFactor' }), 'Множитель шагов AI-агента');
        assert.equal(settingLabel({ path: 'agentToolFactor' }), 'Множитель вызовов инструментов AI-агента');
        assert.equal(settingLabel({ path: 'aiModelTierFactor' }), 'Множитель класса AI-модели');
    });

    it('forcing-function: ни одна настройка из формул seed не отдаёт fallback «Параметр расчёта …»', () => {
        // §6.ter.7 — класс «утечка внутренних имён» закрывается грепом ВСЕХ S.-ссылок,
        // а не двумя именами из ревью. Любая будущая настройка без метки → fail здесь.
        const seedSrc = fs.readFileSync(path.resolve(here, '../../../js/domain/seed.js'), 'utf8');
        const JS_ARTIFACTS = new Set(['includes', 'map', 'ru', 'filter', 'some', 'every', 'find', 'forEach']);
        const paths = new Set();
        for (const m of seedSrc.matchAll(/\bS\.([a-zA-Z][a-zA-Z0-9]*)/g)) {
            const base = m[1];
            if (JS_ARTIFACTS.has(base)) continue;
            // standSizeRatio.<STAND> / aiStandFactor.<STAND> — проверяем конкретный путь
            paths.add(base === 'standSizeRatio' ? 'standSizeRatio.PROD' : base);
        }
        const leaks = [...paths].filter(p => settingLabel({ path: p }).startsWith('Параметр расчёта '));
        assert.deepEqual(leaks, [], `Настройки без человекочитаемой метки: ${leaks.join(', ')}`);
    });
});
