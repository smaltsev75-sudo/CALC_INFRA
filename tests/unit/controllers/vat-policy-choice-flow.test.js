/**
 * Stage VAT-2 Phase 5: controller flow для VAT-policy choice при импорте
 * legacy v1 JSON без vatPolicy metadata.
 *
 * Pipeline:
 *   1. updateProviderPricesFromFile(providerId) с v1 без vatPolicy →
 *      validator вернёт vat-policy-required (т.к. options.requireVatPolicy=true) →
 *      open modal `vatPolicyChoice` с preloaded JSON → result.ok=false reason='vat-policy-required'.
 *   2. applyProviderPricesWithVatPolicy(providerId, preloaded, 'gross-22') →
 *      повторный validate с userVatPolicy='gross-22' → save → success.
 *   3. Cancel-path (UI calls cancelVatPolicyChoice) — модалка закрывается, prices не меняются.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from '../../integration/storage-mock.js';

let providerCtl;
let store;
let persist;

const LEGACY_V1_NO_VAT_POLICY = Object.freeze({
    schemaVersion: 1,
    providerId: 'sbercloud',
    version: '2026-legacy-import',
    timestamp: '2026-05-12T10:00:00.000Z',
    source: 'legacy export without vatPolicy',
    prices: {
        'cpu-vcpu-shared': {
            pricePerUnit: 122,
            vendor: 'LegacySource',
            priceSource: 'legacy цена с НДС 22%'
        }
    }
});

/* Фейковый file-picker: возвращает «выбранный» blob с заранее данным content. */
function makeFakePicker(jsonContent) {
    return {
        _pickFile: async () => ({ name: 'legacy.json', size: jsonContent.length }),
        _readJsonFile: async () => ({ ok: true, data: jsonContent })
    };
}

before(async () => {
    installLocalStorage();
    providerCtl = await import('../../../js/controllers/providerController.js');
    ({ store } = await import('../../../js/state/store.js'));
    persist = await import('../../../js/state/persistence.js');
});

beforeEach(() => {
    installLocalStorage();
    store.closeModal('vatPolicyChoice');
    providerCtl.clearProviderUpdateStatus('sbercloud');
});

describe('Phase 5.1: updateProviderPricesFromFile открывает modal на legacy v1 без vatPolicy', () => {
    it('возвращает { ok:false, reason:"vat-policy-required", awaitingChoice:true }', async () => {
        const result = await providerCtl.updateProviderPricesFromFile(
            'sbercloud', makeFakePicker(LEGACY_V1_NO_VAT_POLICY));
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'vat-policy-required');
        assert.equal(result.awaitingChoice, true);
    });

    it('открывает state.modals.vatPolicyChoice с providerId и preloaded JSON', async () => {
        await providerCtl.updateProviderPricesFromFile(
            'sbercloud', makeFakePicker(LEGACY_V1_NO_VAT_POLICY));
        const m = store.getState().modals.vatPolicyChoice;
        assert.equal(m.open, true);
        assert.equal(m.providerId, 'sbercloud');
        assert.equal(m.preloaded.schemaVersion, 1);
        assert.equal(m.preloaded.prices['cpu-vcpu-shared'].pricePerUnit, 122);
    });

    it('сбрасывает providerOverlayUpdate status (status не "loading" и не "error")', async () => {
        await providerCtl.updateProviderPricesFromFile(
            'sbercloud', makeFakePicker(LEGACY_V1_NO_VAT_POLICY));
        const ui = store.getState().ui.providerOverlayUpdate || {};
        assert.equal(ui.sbercloud, undefined,
            'status должен быть очищен — модалка ведёт flow дальше');
    });

    it('НЕ сохраняет override до user-выбора', async () => {
        await providerCtl.updateProviderPricesFromFile(
            'sbercloud', makeFakePicker(LEGACY_V1_NO_VAT_POLICY));
        const overrides = persist.loadProviderOverrides();
        assert.equal(overrides?.sbercloud, undefined,
            'override НЕ должен быть сохранён без явного user-выбора политики');
    });
});

describe('Phase 5.2: applyProviderPricesWithVatPolicy завершает import после user-выбора', () => {
    it('userVatPolicy="gross-22" → net = 122/1.22 = 100 → save', async () => {
        const result = await providerCtl.applyProviderPricesWithVatPolicy(
            'sbercloud', LEGACY_V1_NO_VAT_POLICY, 'gross-22');
        assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);

        const overrides = persist.loadProviderOverrides();
        const entry = overrides?.sbercloud?.prices?.['cpu-vcpu-shared'];
        assert.ok(entry, 'override должен быть сохранён');
        assert.equal(entry.pricePerUnit, 100, 'pricePerUnit = net = gross / 1.22');
        assert.equal(entry.pricePerUnitGross, 122);
        assert.equal(entry.pricePerUnitNet, 100);
        assert.equal(entry.vatRateIncluded, 0.22);
        assert.equal(entry.vatNormalized, true);
        assert.equal(entry.vatPolicyConfidence, 'user-declared');
    });

    it('userVatPolicy="net" → цены не меняются (pricePerUnit=122)', async () => {
        const result = await providerCtl.applyProviderPricesWithVatPolicy(
            'sbercloud', LEGACY_V1_NO_VAT_POLICY, 'net');
        assert.equal(result.ok, true);
        const overrides = persist.loadProviderOverrides();
        assert.equal(overrides.sbercloud.prices['cpu-vcpu-shared'].pricePerUnit, 122);
    });

    it('userVatPolicy="gross-20" → net = 120/1.20', async () => {
        const v1With120 = {
            ...LEGACY_V1_NO_VAT_POLICY,
            prices: {
                'cpu-vcpu-shared': { pricePerUnit: 120, vendor: 'X', priceSource: 'y' }
            }
        };
        const result = await providerCtl.applyProviderPricesWithVatPolicy(
            'sbercloud', v1With120, 'gross-20');
        assert.equal(result.ok, true);
        const overrides = persist.loadProviderOverrides();
        assert.equal(overrides.sbercloud.prices['cpu-vcpu-shared'].pricePerUnit, 100);
    });

    it('null preloaded → reject invalid-preloaded', async () => {
        const result = await providerCtl.applyProviderPricesWithVatPolicy(
            'sbercloud', null, 'gross-22');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'invalid-preloaded');
    });

    it('некорректный userVatPolicy → validator вернёт invalid-user-vat-policy', async () => {
        const result = await providerCtl.applyProviderPricesWithVatPolicy(
            'sbercloud', LEGACY_V1_NO_VAT_POLICY, 'gross-25');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'invalid-user-vat-policy');
    });
});

describe('Phase 5.3: v2 JSON НЕ требует user-выбора (vatPolicy внутри JSON)', () => {
    it('v2 JSON с vatPolicy сразу сохраняется без modal', async () => {
        const v2 = {
            schemaVersion: 2,
            providerId: 'sbercloud',
            version: '2026-v2-import',
            timestamp: '2026-05-12T10:00:00.000Z',
            source: 'test',
            vatPolicy: { pricesIncludeVat: false, confidence: 'verified' },
            prices: {
                'cpu-vcpu-shared': {
                    pricePerUnitNet: 100,
                    vendor: 'X',
                    priceSource: 'y'
                }
            }
        };
        const result = await providerCtl.updateProviderPricesFromFile(
            'sbercloud', makeFakePicker(v2));
        assert.equal(result.ok, true);
        const m = store.getState().modals.vatPolicyChoice;
        assert.equal(m.open, false, 'для v2 модалка НЕ должна открываться');
    });
});
