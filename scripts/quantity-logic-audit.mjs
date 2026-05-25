/**
 * Quantity logic audit report.
 *
 * Проверяет цепочку:
 *   Quick Start / Опросник -> Q.* answers -> qtyFormulas -> qty ЭК ->
 *   costBase/costFinal с единицами, тарифным интервалом и коэффициентами.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../js/domain/seed.js';
import { calculate } from '../js/domain/calculator.js';
import { auditQuantityLogic, buildQuantityTrace } from '../js/domain/quantityTrace.js';
import {
    INDUSTRY_PROFILES,
    PRODUCT_TYPE_OVERRIDES,
    wizardToAnswers
} from '../js/domain/wizardProfiles.js';
import { STAND_IDS } from '../js/utils/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = process.env.QUANTITY_LOGIC_AUDIT_PATH
    ? resolve(process.env.QUANTITY_LOGIC_AUDIT_PATH)
    : resolve(__dirname, '..', 'QUANTITY_LOGIC_AUDIT.md');

function normalizeLineEndings(value) {
    return String(value).replace(/\r\n?/g, '\n');
}

const REPORT_DATE = '2026-05-23';
const CALC_CREATED_AT = '2026-05-23T00:00:00Z';
const SCALES = Object.freeze(['xs', 's', 'm', 'l', 'xl']);
const GEOGRAPHIES = Object.freeze(['ru', 'ru_cis', 'global']);
const ACTIVITIES = Object.freeze(['low', 'medium', 'high']);
const PRODUCT_TYPES = Object.keys(PRODUCT_TYPE_OVERRIDES);
const INDUSTRIES = Object.keys(INDUSTRY_PROFILES);

const SAMPLE_SCENARIOS = Object.freeze([
    {
        id: 'internal_xs',
        label: 'Внутренний XS',
        wizard: { product_type: 'internal', industry: 'corporate', scale: 'xs', geography: 'ru', pdn: false, activity: 'low', ai_used: false }
    },
    {
        id: 'b2b_m',
        label: 'B2B M',
        wizard: { product_type: 'b2b', industry: 'corporate', scale: 'm', geography: 'ru', pdn: true, activity: 'medium', ai_used: false }
    },
    {
        id: 'fintech_m',
        label: 'FinTech M',
        wizard: { product_type: 'b2b', industry: 'fintech', scale: 'm', geography: 'ru', pdn: true, activity: 'medium', ai_used: false }
    },
    {
        id: 'b2c_ai_m',
        label: 'B2C AI M',
        wizard: { product_type: 'b2c', industry: 'edtech', scale: 'm', geography: 'ru', pdn: true, activity: 'high', ai_used: true }
    },
    {
        id: 'global_xl_ai',
        label: 'Global XL AI',
        wizard: { product_type: 'b2c', industry: 'consumer', scale: 'xl', geography: 'global', pdn: true, activity: 'high', ai_used: true }
    }
]);

const CORE_ITEMS = Object.freeze([
    'cpu-vcpu-shared',
    'ram-gb',
    'storage-ssd-tb',
    'storage-object-tb',
    'network-lb-l7',
    'network-waf',
    'llm-tokens-input-1m'
]);

const fmtRub = value => Math.round(value).toLocaleString('ru-RU') + ' ₽';
const fmtNum = value => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

function allWizardScenarios() {
    const scenarios = [];
    for (const product_type of PRODUCT_TYPES) {
        for (const industry of INDUSTRIES) {
            for (const scale of SCALES) {
                for (const geography of GEOGRAPHIES) {
                    for (const pdn of [false, true]) {
                        for (const activity of ACTIVITIES) {
                            for (const ai_used of [false, true]) {
                                scenarios.push({ product_type, industry, scale, geography, pdn, activity, ai_used });
                            }
                        }
                    }
                }
            }
        }
    }
    return scenarios;
}

function buildCalcFromWizard(dictionaries, wizard) {
    const baseAnswers = defaultAnswersFrom(dictionaries.questions);
    const { answers, meta } = wizardToAnswers(wizard);
    return {
        id: `quantity-audit-${wizard.product_type}-${wizard.industry}-${wizard.scale}`,
        name: 'Quantity audit',
        version: '1.0',
        schemaVersion: 20,
        createdAt: CALC_CREATED_AT,
        updatedAt: CALC_CREATED_AT,
        settings: { ...SEED_SETTINGS },
        answers: { ...baseAnswers, ...answers },
        answersMeta: meta,
        wizard,
        dictionaries
    };
}

function collectDependencyStats(dictionaries) {
    const questionUsage = new Map();
    const settingUsage = new Map();
    let formulaCount = 0;

    const calc = {
        id: 'dependency-stats',
        name: 'Dependency stats',
        version: '1.0',
        schemaVersion: 20,
        createdAt: CALC_CREATED_AT,
        updatedAt: CALC_CREATED_AT,
        settings: { ...SEED_SETTINGS },
        answers: defaultAnswersFrom(dictionaries.questions),
        answersMeta: {},
        dictionaries
    };

    for (const item of dictionaries.items) {
        for (const stand of STAND_IDS) {
            if (!(item.applicableStands || []).includes(stand)) continue;
            const formula = item.qtyFormulas?.[stand] || '';
            if (!formula.trim()) continue;
            formulaCount++;
            const trace = buildQuantityTrace(calc, item.id, stand);
            for (const ref of trace.references.questions) {
                if (!questionUsage.has(ref)) questionUsage.set(ref, new Set());
                questionUsage.get(ref).add(item.id);
            }
            for (const ref of trace.references.settings) {
                if (!settingUsage.has(ref)) settingUsage.set(ref, new Set());
                settingUsage.get(ref).add(item.id);
            }
        }
    }

    return {
        formulaCount,
        questionUsage: Array.from(questionUsage.entries())
            .map(([id, set]) => ({ id, count: set.size }))
            .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
        settingUsage: Array.from(settingUsage.entries())
            .map(([id, set]) => ({ id, count: set.size }))
            .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    };
}

function runWizardMatrixAudit(dictionaries) {
    const scenarios = allWizardScenarios();
    const errors = [];
    let warnings = 0;
    let formulaRefs = 0;
    for (const wizard of scenarios) {
        const calc = buildCalcFromWizard(dictionaries, wizard);
        const audit = auditQuantityLogic(calc);
        warnings += audit.warnings.length;
        formulaRefs += audit.stats.questionRefs + audit.stats.settingRefs;
        if (audit.errors.length > 0) {
            errors.push({
                wizard,
                messages: audit.errors.slice(0, 5).map(error => error.message)
            });
        }
    }
    return { scenarios: scenarios.length, errors, warnings, formulaRefs };
}

function topProdItems(result, dictionaries, limit = 5) {
    return Object.entries(result.items)
        .map(([itemId, itemResult]) => ({
            itemId,
            name: dictionaries.items.find(item => item.id === itemId)?.name || itemId,
            value: itemResult.stands.PROD?.costFinal || 0
        }))
        .filter(row => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
}

function sampleRows(dictionaries) {
    return SAMPLE_SCENARIOS.map(sample => {
        const calc = buildCalcFromWizard(dictionaries, sample.wizard);
        const result = calculate(calc);
        const quantities = Object.fromEntries(CORE_ITEMS.map(itemId => [
            itemId,
            result.items[itemId]?.stands?.PROD?.qty || 0
        ]));
        return {
            ...sample,
            totalMonthly: result.totalMonthly,
            quantities,
            topItems: topProdItems(result, dictionaries, 3)
        };
    });
}

function renderReport() {
    const dictionaries = buildSeedDictionaries();
    const dependencyStats = collectDependencyStats(dictionaries);
    const matrix = runWizardMatrixAudit(dictionaries);
    const samples = sampleRows(dictionaries);
    const seedAudit = auditQuantityLogic({
        id: 'quantity-audit-seed',
        name: 'Seed audit',
        version: '1.0',
        schemaVersion: 20,
        createdAt: CALC_CREATED_AT,
        updatedAt: CALC_CREATED_AT,
        settings: { ...SEED_SETTINGS },
        answers: defaultAnswersFrom(dictionaries.questions),
        answersMeta: {},
        dictionaries
    });

    const lines = [];
    const print = (line = '') => lines.push(String(line));

    print('# Аудит логики расчёта количества ЭК');
    print('');
    print(`Дата отчёта: ${REPORT_DATE}. Дата расчёта в проверочных сценариях: ${CALC_CREATED_AT.slice(0, 10)}.`);
    print('');
    print('## Что проверено');
    print('');
    print('| Проверка | Результат |');
    print('|---|---:|');
    print(`| ЭК в справочнике | ${dictionaries.items.length} |`);
    print(`| Применимых qty-формул | ${dependencyStats.formulaCount} |`);
    print(`| Ошибок на seed-расчёте | ${seedAudit.errors.length} |`);
    print(`| Quick Start-сценариев | ${matrix.scenarios} |`);
    print(`| Ошибок в Quick Start-сценариях | ${matrix.errors.length} |`);
    print(`| Проверенных ссылок Q.* и S.* в Quick Start | ${matrix.formulaRefs} |`);
    print('');
    print('Проверка валидирует не только итоговую сумму, а всю цепочку: ответы пользователя, формулы количества, единицы измерения, месячный множитель тарифа, риск-коэффициенты и НДС.');
    print('');
    print('## Цепочка расчёта');
    print('');
    print('1. Quick Start заполняет ответы Опросника: масштаб, тип продукта, отрасль, география, активность, ПДн и AI.');
    print('2. Каждая qty-формула ЭК читает только явные переменные `Q.<ответ>` и `S.<параметр>`.');
    print('3. Количество ЭК считается по формуле стенда. Пустая формула на применимом стенде считается ошибкой аудита.');
    print('4. Базовая стоимость: `qty × цена за единицу × месячный множитель тарифа`.');
    print('5. Итоговая стоимость: базовая стоимость × риск-множители × НДС.');
    print('');
    print('## Единицы измерения и период');
    print('');
    print('| Тип тарифа | Как приводится к месяцу |');
    print('|---|---|');
    print('| Месячный | `×1` |');
    print('| Дневной | `×daysPerMonth` |');
    print('| Годовой | `×1/12` |');
    print('| Разовый | `÷ phaseDurationMonths` |');
    print('');
    print('Пакетные единицы нормализуются для пользователя: `1000 SMS` отображается как `тыс. SMS`, `1 млн токенов` — как `млн токенов`. Проверка costBase валидирует, что `qty × pricePerUnit × billingIntervalMul` сходится с расчётом, а costFinal дополнительно сходится с рисками и НДС.');
    print('');
    print('## Главные драйверы qty');
    print('');
    print('| Ответ Опросника | Сколько ЭК зависит |');
    print('|---|---:|');
    for (const row of dependencyStats.questionUsage.slice(0, 12)) {
        print(`| \`Q.${row.id}\` | ${row.count} |`);
    }
    print('');
    print('| Параметр расчёта | Сколько ЭК зависит |');
    print('|---|---:|');
    for (const row of dependencyStats.settingUsage.slice(0, 10)) {
        print(`| \`S.${row.id}\` | ${row.count} |`);
    }
    print('');
    print('## Представительные сценарии');
    print('');
    print('| Сценарий | Итого/мес | vCPU ПРОМ | RAM ПРОМ, ГБ | SSD ПРОМ, ТБ | S3 ПРОМ, ТБ | WAF | LLM input, млн |');
    print('|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const row of samples) {
        print(
            `| ${row.label} | ${fmtRub(row.totalMonthly)} | ` +
            `${fmtNum(row.quantities['cpu-vcpu-shared'])} | ` +
            `${fmtNum(row.quantities['ram-gb'])} | ` +
            `${fmtNum(row.quantities['storage-ssd-tb'])} | ` +
            `${fmtNum(row.quantities['storage-object-tb'])} | ` +
            `${fmtNum(row.quantities['network-waf'])} | ` +
            `${fmtNum(row.quantities['llm-tokens-input-1m'])} |`
        );
    }
    print('');
    print('## Топ-статьи в ПРОМ');
    for (const row of samples) {
        print('');
        print(`### ${row.label}`);
        print('');
        print('| ЭК | ₽/мес |');
        print('|---|---:|');
        for (const item of row.topItems) {
            print(`| ${item.name} | ${fmtRub(item.value)} |`);
        }
    }

    if (matrix.errors.length > 0) {
        print('');
        print('## Ошибки');
        for (const error of matrix.errors.slice(0, 20)) {
            print('');
            print(`- ${JSON.stringify(error.wizard)}: ${error.messages.join('; ')}`);
        }
    }

    return lines.join('\n') + '\n';
}

const output = renderReport();
const mode = process.argv[2] || '';

if (mode === '--write') {
    writeFileSync(REPORT_PATH, output, 'utf8');
    console.log(`QUANTITY_LOGIC_AUDIT.md updated`);
} else if (mode === '--check') {
    if (!existsSync(REPORT_PATH)) {
        console.error('QUANTITY_LOGIC_AUDIT.md отсутствует. Run: npm run quantity:audit');
        process.exit(1);
    }
    const current = normalizeLineEndings(readFileSync(REPORT_PATH, 'utf8'));
    if (current !== output) {
        console.error('QUANTITY_LOGIC_AUDIT.md is stale. Run: npm run quantity:audit');
        process.exit(1);
    }
} else if (mode) {
    console.error(`Unknown mode: ${mode}`);
    process.exit(1);
} else {
    process.stdout.write(output);
}
