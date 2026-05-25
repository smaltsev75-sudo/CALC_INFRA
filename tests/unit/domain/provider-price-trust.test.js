/**
 * Provider price trust labels: internal codes are allowed, UI labels are Russian.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    TERM_HINTS,
    PROVIDER_TRUST_MATRIX_CAPABILITIES,
    getPriceTrustInfo,
    getProviderPriceTrust,
    getProviderPriceWarnings,
    getProviderCapabilityTrust,
    getProviderPriceActuality,
    getCalculationProviderPriceActuality,
    getProviderSecurityPriceWarningForCalc
} from '../../../js/domain/providerPriceTrust.js';
import { aggregateProviderPrices } from '../../../js/domain/providerAnalytics.js';
import { getProviderPriceBundleMeta } from '../../../js/domain/providerOverlay.js';

describe('providerPriceTrust — русские подписи для UI', () => {
    it('verified/source-level/by-request имеют человекочитаемые русские labels', () => {
        assert.equal(getPriceTrustInfo('verified').fullLabel, 'Проверено по официальным тарифам');
        assert.equal(getPriceTrustInfo('source-level').fullLabel, 'Взято из публичного прайса');
        assert.equal(getPriceTrustInfo('by-request').fullLabel, 'Цена по запросу у провайдера');
        assert.equal(getPriceTrustInfo('partial').fullLabel, 'Частично покрыто прайсом');
    });

    it('WAF и DDoS имеют русские расшифровки для tooltip/title', () => {
        assert.match(TERM_HINTS.WAF, /защита веб-приложений/);
        assert.match(TERM_HINTS.DDoS, /распределённая атака отказа в обслуживании/);
    });

    it('VK network-waf без публичной цены классифицируется как "по запросу"', () => {
        const trust = getProviderPriceTrust({
            providerId: 'vk',
            itemId: 'network-waf',
            effectiveEntry: null,
            frozenEntry: null
        });

        assert.equal(trust.status, 'by-request');
        assert.equal(trust.shortLabel, 'По запросу');
        assert.match(trust.description, /VK Cloud публикует цену WAF по запросу/);
    });

    it('обычная отсутствующая цена классифицируется как "нет публичной цены"', () => {
        const trust = getProviderPriceTrust({
            providerId: 'sbercloud',
            itemId: 'license-os-per-node',
            effectiveEntry: null,
            frozenEntry: null
        });

        assert.equal(trust.status, 'missing');
        assert.equal(trust.shortLabel, 'Нет цены');
    });

    it('изменённая effective entry классифицируется как ручной ввод/импорт', () => {
        const frozenEntry = { pricePerUnit: 100, vendor: 'A', priceSource: 'official', vatPolicyConfidence: 'verified' };
        const effectiveEntry = { pricePerUnit: 120, vendor: 'A', priceSource: 'manual import', vatPolicyConfidence: 'verified' };
        const trust = getProviderPriceTrust({
            providerId: 'sbercloud',
            itemId: 'cpu-vcpu-shared',
            effectiveEntry,
            frozenEntry
        });

        assert.equal(trust.status, 'user-declared');
        assert.equal(trust.shortLabel, 'Задано вручную');
    });

    it('для UI показывается только дата актуальности без технической версии', () => {
        const meta = getProviderPriceBundleMeta('yandex');
        const actuality = getProviderPriceActuality(meta);

        assert.equal(actuality.date, '22.05.2026');
        assert.equal(actuality.label, 'Актуальность прайса: 22.05.2026');
        assert.equal(actuality.version, '2026-05-22-official');
        assert.doesNotMatch(actuality.label, /версия|2026-05-22-official/);
        assert.equal(actuality.title, undefined);
    });

    it('для расчёта берётся дата применённого providerVersion, а не текущий latest', () => {
        const actuality = getCalculationProviderPriceActuality({
            settings: { provider: 'yandex' },
            providerVersion: {
                id: 'yandex',
                version: 'old-commercial',
                timestamp: '2026-04-10T00:00:00.000Z'
            }
        });

        assert.equal(actuality.date, '10.04.2026');
        assert.match(actuality.labelWithProvider, /Yandex Cloud/);
        assert.match(actuality.labelWithProvider, /10\.04\.2026/);
        assert.doesNotMatch(actuality.labelWithProvider, /old-commercial/);
    });

    it('для расчёта без providerVersion используется bundled-прайс выбранного провайдера', () => {
        const actuality = getCalculationProviderPriceActuality({
            settings: { provider: 'sbercloud' }
        });

        assert.equal(actuality.date, '22.05.2026');
        assert.match(actuality.labelWithProvider, /Cloud\.ru/);
    });
});

describe('providerAnalytics — trust metadata reaches comparison matrix', () => {
    it('Yandex CPU — verified, VK CPU — public price-list, SberCloud license — missing', () => {
        const r = aggregateProviderPrices(['sbercloud', 'yandex', 'vk']);
        const sber = r.providers.find(p => p.id === 'sbercloud');
        const yandex = r.providers.find(p => p.id === 'yandex');
        const vk = r.providers.find(p => p.id === 'vk');

        assert.equal(yandex.byCategory.CPU.trust.status, 'verified');
        assert.equal(vk.byCategory.CPU.trust.status, 'source-level');
        assert.equal(sber.byCategory.LICENSE.trust.status, 'missing');
    });

    it('VK row carries WAF/DDoS warning with Russian hints', () => {
        const warnings = getProviderPriceWarnings('vk');
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0].label, 'WAF/DDoS по запросу');
        assert.match(warnings[0].title, /защита веб-приложений/);
        assert.match(warnings[0].title, /распределённая атака отказа в обслуживании/);
    });

    it('trust matrix covers core provider comparison capabilities', () => {
        const r = aggregateProviderPrices(['sbercloud', 'yandex', 'vk']);
        const keys = r.trustMatrix.capabilities.map(c => c.key);
        assert.deepEqual(keys, [
            'compute',
            'memory',
            'block-storage',
            'object-storage',
            'load-balancer',
            'waf',
            'traffic',
            'licenses'
        ]);
        assert.ok(PROVIDER_TRUST_MATRIX_CAPABILITIES.some(c => c.label === 'WAF/DDoS'));
    });

    it('VK WAF — по запросу, VK licenses — частично, Yandex compute — verified', () => {
        const r = aggregateProviderPrices(['yandex', 'vk']);
        const yandex = r.trustMatrix.providers.find(p => p.id === 'yandex');
        const vk = r.trustMatrix.providers.find(p => p.id === 'vk');

        assert.equal(yandex.byCapability.compute.status, 'verified');
        assert.equal(vk.byCapability.waf.status, 'by-request');
        assert.equal(vk.byCapability.licenses.status, 'partial');
    });

    it('capability aggregator returns partial when covered and missing SKU are mixed', () => {
        const trust = getProviderCapabilityTrust({
            providerId: 'vk',
            itemIds: ['license-db-per-vcpu', 'license-siem-edr-per-node'],
            effectivePrices: {
                'license-db-per-vcpu': { pricePerUnit: 1, vatPolicyConfidence: 'source-level' }
            },
            frozenPrices: {
                'license-db-per-vcpu': { pricePerUnit: 1, vatPolicyConfidence: 'source-level' }
            }
        });

        assert.equal(trust.status, 'partial');
        assert.equal(trust.coverage.covered, 1);
        assert.equal(trust.coverage.missing, 1);
    });

    it('VK security warning for calc includes Russian message and price date', () => {
        const warning = getProviderSecurityPriceWarningForCalc({
            settings: { provider: 'vk' },
            answers: { waf_required: true, ddos_protection_required: true }
        });

        assert.equal(warning.id, 'pricing-vk-security-by-request');
        assert.match(warning.message, /WAF\/DDoS включены/);
        assert.match(warning.message, /12\.01\.2026/);
        assert.deepEqual(warning.fieldIds, ['waf_required', 'ddos_protection_required']);
    });
});
