/**
 * Provider price trust labels: internal codes are allowed, UI labels are Russian.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    TERM_HINTS,
    getPriceTrustInfo,
    getProviderPriceTrust,
    getProviderPriceWarnings
} from '../../../js/domain/providerPriceTrust.js';
import { aggregateProviderPrices } from '../../../js/domain/providerAnalytics.js';

describe('providerPriceTrust — русские подписи для UI', () => {
    it('verified/source-level/by-request имеют человекочитаемые русские labels', () => {
        assert.equal(getPriceTrustInfo('verified').fullLabel, 'Проверено по официальным тарифам');
        assert.equal(getPriceTrustInfo('source-level').fullLabel, 'Взято из публичного прайса');
        assert.equal(getPriceTrustInfo('by-request').fullLabel, 'Цена по запросу у провайдера');
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
});
