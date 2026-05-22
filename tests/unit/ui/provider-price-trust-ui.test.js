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
const SUMMARY_SRC = stripJsComments(read('js/ui/providerPriceSummary.js'));
const ANALYTICS_SRC = stripJsComments(read('js/ui/modals/providerAnalyticsModal.js'));
const PROVIDER_SETTINGS_SRC = stripJsComments(read('js/ui/questionnaireProviderSettings.js'));
const FORMS_CSS = stripCssComments(read('css/forms.css'));

describe('provider trust labels — Russian copy source of truth', () => {
    it('contains Russian labels for verified/public/manual/request/missing states', () => {
        assert.match(TRUST_SRC, /Проверено по официальным тарифам/);
        assert.match(TRUST_SRC, /Взято из публичного прайса/);
        assert.match(TRUST_SRC, /Задано вручную/);
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

    it('hint explains trust labels in Russian', () => {
        assert.match(ANALYTICS_SRC, /уровень доверия/);
        assert.match(ANALYTICS_SRC, /проверено, публичный прайс, задано вручную или нет публичной цены/);
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
        assert.match(FORMS_CSS, /\.analytics-trust-badge/);
        assert.match(FORMS_CSS, /\.analytics-provider-warning/);
        assert.match(FORMS_CSS, /\.term-hint/);
    });
});
