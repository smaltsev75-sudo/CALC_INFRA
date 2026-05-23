import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';
import { wizardToAnswers } from '../../../js/domain/wizardProfiles.js';
import { calculate } from '../../../js/domain/calculator.js';
import {
    buildQuantityExplanationModel,
    settingLabel,
    sourceLabel
} from '../../../js/ui/quantityExplanation.js';
import { buildCostCheckReportModel } from '../../../js/ui/costCheckReport.js';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

function read(rel) {
    return readFileSync(join(ROOT, rel), 'utf8');
}

function buildQuickStartCalc() {
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

    return {
        id: 'qty-explainability-test',
        name: 'Explainability test',
        version: '1.0',
        schemaVersion: 20,
        settings: { ...SEED_SETTINGS, applyRiskFactors: true },
        answers: { ...baseAnswers, ...answers },
        answersMeta: meta,
        dictionaries
    };
}

describe('Details quantity explainability', () => {
    it('модель показывает источник Quick Start для входных ответов', () => {
        const calc = buildQuickStartCalc();
        const result = calculate(calc);
        const model = buildQuantityExplanationModel(calc, 'cpu-vcpu-shared', result);
        const inputs = model.traces.flatMap(trace => trace.questionInputs);

        assert.ok(inputs.length > 0, 'у CPU должны быть входные Q.* ответы');
        assert.ok(
            inputs.some(input => sourceLabel(input.source).includes('Quick Start')),
            inputs.map(input => `${input.ref}:${sourceLabel(input.source)}`).join('\n')
        );
    });

    it('модель показывает эффективный коэффициент стенда для RAM', () => {
        const calc = buildQuickStartCalc();
        const result = calculate(calc);
        const model = buildQuantityExplanationModel(calc, 'ram-gb', result, { standLimit: 5 });
        const ratioInput = model.traces
            .flatMap(trace => trace.settingInputs)
            .find(input => input.path === 'standSizeRatio.DEV');

        assert.ok(ratioInput, 'RAM должна показывать коэффициент размера стенда');
        assert.equal(settingLabel(ratioInput.path), 'коэффициент размера стенда DEV');
        assert.equal(ratioInput.value, 0.2);
    });

    it('в строках Детализации есть кнопка «Почему столько?» вместо дубля формулы', () => {
        const src = stripJsComments(read('js/ui/detailsSections.js'));

        assert.match(src, /data-testid['"]?:\s*['"]quantity-explain-button['"]/);
        assert.match(src, /aria-label['"]?:\s*['"]Почему столько\?['"]/);
        assert.match(src, /ctx\.openFormula\(item\.id\)/);
    });

    it('Formula modal открывается как «Почему столько?» и рендерит trace panel', () => {
        const src = stripJsComments(read('js/ui/modals/formulaModal.js'));

        assert.match(src, /Почему столько\?\s*·/);
        assert.match(src, /renderQuantityExplanationPanel\(calc,\s*item,\s*result/);
        assert.match(src, /calculate\(calc\)/);
    });

    it('PDF Детализации содержит печатный блок проверки количества', () => {
        const detailsSrc = stripJsComments(read('js/ui/details.js'));
        const printCss = stripCssComments(read('css/print.css'));
        const tablesCss = stripCssComments(read('css/tables.css'));

        assert.match(detailsSrc, /renderDetailsQuantityPrintSummary\(calc,\s*result,\s*disabledStands\)/);
        assert.match(tablesCss, /\.details-quantity-print-summary\s*\{[^}]*display\s*:\s*none/);
        assert.match(printCss, /\.details-quantity-print-summary\s*\{[^}]*display\s*:\s*block\s*!important/);
    });

    it('отчёт проверки расчёта ЭК показывает top-строки, источники и контроль единиц', () => {
        const calc = buildQuickStartCalc();
        const result = calculate(calc);
        const model = buildCostCheckReportModel(calc, result, [], { limit: 10 });

        assert.ok(model.rows.length > 0, 'в отчёте должны быть строки top-ЭК');
        assert.ok(model.rows.length <= 10, 'отчёт должен ограничиваться top-10');
        assert.ok(model.rows.every(row => row.monthly > 0), 'каждая строка должна влиять на бюджет');
        assert.ok(model.rows.every(row => row.unitCheck.ok), 'единицы и формулы стоимости должны сходиться');
    });

    it('отчёт проверки расчёта ЭК сохраняет источник Quick Start и коэффициенты стенда', () => {
        const calc = buildQuickStartCalc();
        const result = calculate(calc);
        const model = buildCostCheckReportModel(calc, result, [], { limit: 50 });
        const cpu = model.rows.find(row => row.itemId === 'cpu-vcpu-shared');

        assert.ok(cpu, 'CPU должен попасть в расширенную проверку');
        assert.ok(
            cpu.sourceSummary.some(text => text.includes('Quick Start')),
            cpu.sourceSummary.join('\n')
        );
        assert.match(cpu.answersText, /Quick Start/);
        assert.match(cpu.settingsText, /коэффициент размера стенда/);
        assert.match(cpu.unitText, /месячный тариф|дневной тариф|годовой тариф|разовый платёж/);
    });

    it('Детализация рендерит отчёт проверки расчёта ЭК перед таблицей стоимости', () => {
        const detailsSrc = stripJsComments(read('js/ui/details.js'));
        const reportSrc = stripJsComments(read('js/ui/costCheckReport.js'));
        const tablesCss = stripCssComments(read('css/tables.css'));

        assert.match(detailsSrc, /renderCostCheckReport\(calc,\s*result,\s*disabledStands/);
        assert.match(reportSrc, /data-testid['"]?:\s*['"]cost-check-report['"]/);
        assert.match(reportSrc, /Проверка расчёта ЭК/);
        assert.match(tablesCss, /\.cost-check-table\s*\{[^}]*table-layout\s*:\s*fixed/);
    });
});
