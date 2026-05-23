/**
 * User-facing provider price trust UI.
 *
 * UI may use internal status codes in class names, but visible labels and
 * tooltips must be Russian and must explain WAF/DDoS.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

const TRUST_SRC = stripJsComments(read('js/domain/providerPriceTrust.js'));
const PRICE_ACTUALITY_SRC = stripJsComments(read('js/ui/providerPriceActuality.js'));
const SUMMARY_SRC = stripJsComments(read('js/ui/providerPriceSummary.js'));
const ANALYTICS_SRC = stripJsComments(read('js/ui/modals/providerAnalyticsModal.js'));
const PROVIDER_SETTINGS_SRC = stripJsComments(read('js/ui/questionnaireProviderSettings.js'));
const DASHBOARD_SRC = stripJsComments(read('js/ui/dashboard.js'));
const DETAILS_SRC = stripJsComments(read('js/ui/details.js'));
const COMPARISON_SRC = stripJsComments(read('js/ui/comparison.js'));
const BUDGET_SRC = stripJsComments(read('js/ui/modals/budgetGuardrailsModal.js'));
const OPTIMIZATION_SRC = stripJsComments(read('js/ui/modals/costOptimizationPlannerModal.js'));
const SCENARIO_CMP_SRC = stripJsComments(read('js/ui/modals/providerScenarioComparisonModal.js'));
const DECISION_MEMO_CONTROLLER_SRC = stripJsComments(read('js/controllers/decisionMemoController.js'));
const DECISION_MEMO_EXPORT_SRC = stripJsComments(read('js/services/decisionMemoExport.js'));
const CSV_EXPORT_SRC = stripJsComments(read('js/services/csvExport.js'));
const STATE_SUMMARY_SRC = stripJsComments(read('js/ui/calculationStateSummary.js'));
const FORMS_CSS = stripCssComments(read('css/forms.css'));
const TABLES_CSS = stripCssComments(read('css/tables.css'));
const DASHBOARD_CSS = stripCssComments(read('css/dashboard.css'));
const PRINT_CSS = stripCssComments(read('css/print.css'));

describe('provider trust labels — Russian copy source of truth', () => {
    it('contains Russian labels for verified/public/manual/request/missing states', () => {
        assert.match(TRUST_SRC, /Проверено по официальным тарифам/);
        assert.match(TRUST_SRC, /Взято из публичного прайса/);
        assert.match(TRUST_SRC, /Задано вручную/);
        assert.match(TRUST_SRC, /Частично покрыто прайсом/);
        assert.match(TRUST_SRC, /Цена по запросу у провайдера/);
        assert.match(TRUST_SRC, /Нет публичной цены/);
    });

    it('contains Russian WAF and DDoS hints', () => {
        assert.match(TRUST_SRC, /WAF.*защита веб-приложений/);
        assert.match(TRUST_SRC, /DDoS.*распределённая атака отказа в обслуживании/);
    });
});

describe('provider price summary — trust badges and term hints', () => {
    it('renders trust notice and per-row trust badge', () => {
        assert.match(SUMMARY_SRC, /_renderProviderTrustNotice/);
        assert.match(SUMMARY_SRC, /provider-price-trust-badge/);
        assert.match(SUMMARY_SRC, /getProviderPriceTrust/);
    });

    it('does not repeat row trust badges when they duplicate provider-level trust', () => {
        assert.match(SUMMARY_SRC, /providerTrustStatus/);
        assert.match(SUMMARY_SRC, /r\.trust\.status\s*===\s*providerTrustStatus[\s\S]{0,120}\?\s*null/);
    });

    it('renders visible price actuality date-only notice', () => {
        assert.match(SUMMARY_SRC, /_renderProviderActualityNotice/);
        assert.match(SUMMARY_SRC, /provider-price-actuality/);
        assert.match(SUMMARY_SRC, /getProviderPriceActuality/);
        assert.match(SUMMARY_SRC, /getProviderPriceBundleMeta/);
        assert.match(SUMMARY_SRC, /if\s*\(!expanded\)[\s\S]*actualityNotice/);
    });

    it('renders WAF as term hint, not as unexplained bare text', () => {
        assert.match(SUMMARY_SRC, /TERM_HINTS\.WAF/);
        assert.match(SUMMARY_SRC, /class:\s*['"]term-hint['"]/);
    });

    it('renders by-request rows as "по запросу"', () => {
        assert.match(SUMMARY_SRC, /по запросу/);
        assert.match(SUMMARY_SRC, /provider-price-row--missing/);
    });
});

describe('provider analytics modal — trust metadata is visible', () => {
    it('renders analytics trust badges and provider WAF/DDoS warning', () => {
        assert.match(ANALYTICS_SRC, /analytics-trust-badge/);
        assert.match(ANALYTICS_SRC, /analytics-provider-warning/);
        assert.match(ANALYTICS_SRC, /p\.warnings/);
    });

    it('renders provider trust matrix and price actuality in the price table', () => {
        assert.match(ANALYTICS_SRC, /analytics-trust-matrix/);
        assert.match(ANALYTICS_SRC, /Cloud\.ru vs Yandex vs VK/);
        assert.match(ANALYTICS_SRC, /analytics-table/);
        assert.match(ANALYTICS_SRC, /analytics-provider-meta/);
        assert.match(ANALYTICS_SRC, /getProviderPriceActuality/);
    });

    it('hint explains calc-specific benchmark in Russian', () => {
        assert.match(ANALYTICS_SRC, /до.*крупнейших ЭК/);
        assert.match(ANALYTICS_SRC, /публичная цена Cloud\.ru/);
        assert.match(ANALYTICS_SRC, /месячному вкладу/);
        assert.match(ANALYTICS_SRC, /Вклад ЭК/);
        assert.doesNotMatch(ANALYTICS_SRC, /CPU = 1 vCPU/);
        assert.doesNotMatch(ANALYTICS_SRC, /процессоры = 1 виртуальное ядро/);
    });

    it('trust matrix explains price-source quality in Russian', () => {
        assert.match(ANALYTICS_SRC, /качество источника цены/);
        assert.match(ANALYTICS_SRC, /где прайс проверен/);
        assert.match(ANALYTICS_SRC, /где цена отсутствует или выдаётся по запросу/);
    });
});

describe('VK provider price warning reaches details and dashboard', () => {
    it('Details renders provider price actuality date banner', () => {
        assert.match(DETAILS_SRC, /renderCalculationProviderPriceActuality/);
        assert.match(DETAILS_SRC, /details-provider-price-actuality/);
        assert.match(DETAILS_SRC, /Прайс расчёта/);
    });

    it('Details renders VK WAF/DDoS price warning banner', () => {
        assert.match(DETAILS_SRC, /getProviderSecurityPriceWarningForCalc/);
        assert.match(DETAILS_SRC, /details-provider-price-warning/);
        assert.match(DETAILS_SRC, /Открыть проверку/);
    });

    it('Calculation State Summary renders provider price warning row', () => {
        assert.match(STATE_SUMMARY_SRC, /getProviderSecurityPriceWarningForCalc/);
        assert.match(STATE_SUMMARY_SRC, /calc-state-summary-row-provider-price/);
        assert.match(STATE_SUMMARY_SRC, /Прайс защитных сервисов/);
    });
});

describe('price actuality appears wherever user sees cost output', () => {
    it('Dashboard and state summary render calculation price actuality', () => {
        assert.match(DASHBOARD_SRC, /renderCalculationProviderPriceActuality/);
        assert.match(DASHBOARD_SRC, /dashboard-provider-price-actuality/);
        assert.match(STATE_SUMMARY_SRC, /getCalculationPriceActualityInfo/);
        assert.match(STATE_SUMMARY_SRC, /Прайс расчёта/);
    });

    it('Comparison and cross-provider comparison render price actuality', () => {
        assert.match(COMPARISON_SRC, /renderComparisonPriceActuality/);
        assert.match(COMPARISON_SRC, /comparison-price-actuality/);
        assert.match(SCENARIO_CMP_SRC, /scenario-cmp-provider-price-date/);
        assert.match(SCENARIO_CMP_SRC, /getProviderPriceActuality/);
    });

    it('Budget and optimization modals render calculation price actuality', () => {
        assert.match(BUDGET_SRC, /renderCalculationProviderPriceActuality/);
        assert.match(OPTIMIZATION_SRC, /renderCalculationProviderPriceActuality/);
        assert.match(BUDGET_SRC, /Прайс расчёта/);
        assert.match(OPTIMIZATION_SRC, /Прайс расчёта/);
    });

    it('Decision memo and CSV exports include calculation price actuality', () => {
        assert.match(DECISION_MEMO_CONTROLLER_SRC, /getCalculationProviderPriceActuality/);
        assert.match(DECISION_MEMO_EXPORT_SRC, /Актуальность прайса/);
        assert.match(CSV_EXPORT_SRC, /Актуальность прайса/);
        assert.match(CSV_EXPORT_SRC, /getCalculationProviderPriceActuality/);
    });

    it('visible price actuality rows do not duplicate the same date in title tooltips', () => {
        assert.doesNotMatch(PRICE_ACTUALITY_SRC, /title\s*:\s*info\.title/);
        assert.doesNotMatch(SUMMARY_SRC, /title\s*:\s*actuality\.title/);
        assert.doesNotMatch(ANALYTICS_SRC, /title\s*:\s*actuality\.title/);
        assert.doesNotMatch(SCENARIO_CMP_SRC, /title\s*:\s*actuality\.title/);
        assert.doesNotMatch(COMPARISON_SRC, /title\s*:\s*info\.title/);
        assert.doesNotMatch(STATE_SUMMARY_SRC, /title\s*:\s*info\.title/);
    });
});

describe('provider settings tooltip — WAF/DDoS expanded in Russian', () => {
    it('tooltip expands WAF and DDoS terms', () => {
        assert.match(PROVIDER_SETTINGS_SRC, /WAF.*защита веб-приложений/);
        assert.match(PROVIDER_SETTINGS_SRC, /DDoS.*защита от распределённых атак/);
    });
});

describe('provider trust CSS', () => {
    it('styles trust badges and term hints', () => {
        assert.match(FORMS_CSS, /\.provider-price-trust-badge/);
        assert.match(FORMS_CSS, /\.provider-price-actuality/);
        assert.match(FORMS_CSS, /\.analytics-trust-badge/);
        assert.match(FORMS_CSS, /\.analytics-trust-matrix/);
        assert.match(FORMS_CSS, /\.analytics-provider-meta/);
        assert.match(FORMS_CSS, /\.analytics-provider-warning/);
        assert.match(FORMS_CSS, /\.term-hint/);
        assert.match(FORMS_CSS, /\.scenario-cmp-provider-price-date/);
        assert.match(DASHBOARD_CSS, /\.dashboard-price-actuality/);
        assert.match(DASHBOARD_CSS, /\.comparison-price-actuality/);
        assert.match(DASHBOARD_CSS, /\.modal-price-actuality/);
        assert.match(TABLES_CSS, /\.details-provider-price-actuality/);
        assert.match(TABLES_CSS, /\.details-provider-price-warning/);
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-row-provider-actuality/);
        assert.match(DASHBOARD_CSS, /\.calc-state-summary-row-provider-price/);
        assert.match(PRINT_CSS, /\.details-provider-price-actuality/);
        assert.match(PRINT_CSS, /\.dashboard-price-actuality/);
    });
});
