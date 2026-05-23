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
import { buildRootCauseAnalysisModel } from '../../../js/domain/rootCauseAnalysis.js';
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

    it('модель корневых причин показывает параметры с реальной экономией бюджета', () => {
        const calc = buildQuickStartCalc();
        const result = calculate(calc);
        const model = buildRootCauseAnalysisModel(calc, { result, limit: 8 });

        assert.ok(model.rows.length > 0, 'должны быть причины с ненулевой экономией');
        assert.ok(model.rows.length <= 8, 'отчёт должен ограничиваться top-X');
        assert.ok(model.rows.every(row => row.savingMonthly > 0), 'каждая причина должна снижать бюджет');
        assert.ok(model.rows.every(row => row.affectedItemsCount > 0), 'должны быть затронутые ЭК');
        assert.ok(!model.rows.some(row => ['applyRiskFactors', 'vatEnabled', 'vatRate'].includes(row.fieldId)),
            'НДС и полное отключение рисков не должны выдаваться как оптимизация');
    });

    it('корневая причина связывает параметр с зависимыми ЭК', () => {
        const calc = buildQuickStartCalc();
        const result = calculate(calc);
        const model = buildRootCauseAnalysisModel(calc, { result, limit: 50 });
        const cause = model.rows.find(row => row.directFormulaCount > 0 && row.topAffectedItems.length > 0);

        assert.ok(cause, 'хотя бы одна причина должна иметь прямые связи в формулах');
        assert.ok(cause.label);
        assert.ok(cause.topAffectedItems.some(item => item.savingMonthly > 0));
        assert.ok(cause.directItemNames.length > 0);
    });

    it('Детализация открывает корневые причины бюджета отдельным окном без PDF-вывода', () => {
        const detailsSrc = stripJsComments(read('js/ui/details.js'));
        const reportSrc = stripJsComments(read('js/ui/rootCauseReport.js'));
        const modalSrc = stripJsComments(read('js/ui/modals/rootCauseReportModal.js'));
        const indexSrc = stripJsComments(read('js/ui/index.js'));
        const storeSrc = stripJsComments(read('js/state/store.js'));
        const appSrc = stripJsComments(read('js/app.js'));
        const modalsCss = stripCssComments(read('css/modals.css'));
        const printCss = stripCssComments(read('css/print.css'));

        assert.doesNotMatch(detailsSrc, /renderCostCheckReport\(/);
        assert.match(detailsSrc, /data-testid['"]?:\s*['"]details-root-cause-open['"]/);
        assert.match(detailsSrc, /ctx\.openRootCauseReportModal\?\.\(\)/);
        assert.match(appSrc, /openRootCauseReportModal\(\)\s*\{\s*store\.openModal\(['"]rootCauseReport['"]\)/);
        assert.match(storeSrc, /rootCauseReport:\s*\{\s*open:\s*false\s*\}/);
        assert.match(indexSrc, /renderRootCauseReportModal/);
        assert.match(indexSrc, /\['rootCauseReport',\s*renderRootCauseReportModal\]/);
        assert.match(modalSrc, /renderRootCauseReportContent\(.*\{\s*limit:\s*8\s*\}/s);
        assert.match(modalSrc, /data-testid['"]?:\s*['"]root-cause-modal['"]/);
        assert.match(reportSrc, /data-testid['"]?:\s*['"]root-cause-report['"]/);
        assert.match(detailsSrc, /Анализ факторов/);
        assert.match(modalSrc, /Анализ факторов/);
        assert.match(reportSrc, /Top-\$\{model\.shown\} корневых причин/);
        assert.match(reportSrc, /Что меняем для оценки/);
        assert.match(reportSrc, /Показать связи с ЭК/);
        assert.match(modalsCss, /\.root-cause-row\s*\{[^}]*grid-template-columns/);
        assert.match(modalsCss, /\.root-cause-name\s*\{[^}]*overflow-wrap\s*:\s*anywhere/);
        assert.doesNotMatch(modalsCss, /\.root-cause-name\s*\{[^}]*text-overflow\s*:\s*ellipsis/);
        assert.doesNotMatch(printCss, /root-cause|cost-check/);
    });
});
